import * as utils from "./utils.ts" 

import fs  from 'fs/promises';
import fsc from 'fs';

import path from "path";

import { SNAPSHOTS_DIR, Area, Snapshot, Context, SnapshotService } from './context.ts';

import * as dpng from "./dpng.ts"
import sharp from "sharp";

import pkg from "gif-encoder-2";
import { HistoryItemEntity, HistoryRepository, SnapshotRepository, TileEntity, TileRepository } from "./sqlite.ts";

const GIFEncoder = pkg.default || pkg;

// Commands //

export async function handleLoad(ctx: Context, input: {[key: string]: any}): Promise<Snapshot> {
    let [, name, localDate] = input.args as [string, string, string]; 
    const date: number = localDate ? utils.formattedToUnix(localDate) : 0;

    if(name == ctx.snapshot.name && date == ctx.snapshot.created_at) return ctx.snapshot;
    
    await handleImport(ctx,
        {
            args: ['import', name, date]
        }
    )
    
    if (!name) {
        if (!ctx.snapshot.name) name = ctx.snapshot.name;
        else {
            console.log("Name is not chosen.");
            return new Snapshot("");
        }
    }

    let snapshot: Snapshot | null = null;
    if(name && date) {
        snapshot = SnapshotService.findSnapshot(name, date);
    } else {
        snapshot = SnapshotService.findSnapshotLatest(name);
    }

    if(snapshot) {
        await ctx.changeSnapshot(snapshot);
        console.log(`Snapshot was succefully loaded. The current snapshot is ${name}[${utils.unixToFormatted(snapshot.created_at)}].`)
        
        return snapshot;
    } else {
        console.log("Snapshot not found");

        return new Snapshot("");
    }
    
}

export async function handleSnapshot(ctx: Context, input: {[key: string]: any[]}): Promise<Snapshot> {
    let [, name] = input.args;

    if (!name) {
        if (ctx.snapshot.name) {
            name = ctx.snapshot.name;
        } else {
            console.log("Name is not defined.");
            return new Snapshot("");
        }
    }

    let snapshot: Snapshot = new Snapshot(name); // New snapshot //
    let latest_snapshot: Snapshot | null = SnapshotService.findSnapshotLatest(name);

    await snapshot.ensureDir();
    SnapshotService.createSnapshot(snapshot);

    let area: Area = await snapshot.readArea();
    if(input.flags.includes('-select') || area.empty()) area = ctx.selection;

    const queue: number[][] = await area.getXY();
    const progress = ctx.createProgress({total: queue.length, width: 40});

    let downloadSize = 0;

    let created = 0;
    let changed = 0;
    let failed = 0;

    while (queue.length > 0) {
        const batch = queue.splice(0, ctx.DOWNLOAD_LIMIT);
        await Promise.all(batch.map(async ([x, y]) => {
            try {
                progress.tick(1);

                const tile = new TileEntity();
                const tileKey: number = utils.hash_xy(x, y);

                const downloadedTile = await utils.downloadFileWithRetry(`https://backend.wplace.live/files/s0/tiles/${x}/${y}.png`);
                
                tile.snapshot_id = snapshot.id;
                tile.hash = tileKey;
                tile.baseline   = snapshot.created_at;
                tile.created_at = snapshot.created_at;
                tile.size     = downloadedTile.byteLength;
                tile.changed  = 0;

                const latestTileEntity: TileEntity | null = TileRepository.getLatest(snapshot.id, tileKey);
                if(latestTileEntity && ctx.USE_VERSION_SYSTEM) {             
                    const latestTile = await fs.readFile(`${snapshot.rootPath}/${latestTileEntity.baseline}/${x}_${y}.png`);
                    const changes = await dpng.getChanges(latestTile, downloadedTile, 1000, 1000);

                    if(changes.length > ctx.BASELINE_THRESHOLD_MEMORY) {
                        downloadSize += downloadedTile.byteLength;

                        await fs.writeFile(`${snapshot.fullPath}/${x}_${y}.png`, downloadedTile);
                        TileRepository.save(tile);

                        created++;
                    } else if(changes.length > 0) {
                        downloadSize += await dpng.writeDPNG(changes, 1000, 1000, `${snapshot.fullPath}/${x}_${y}.dpng`);

                        tile.baseline = latestTileEntity.baseline;
                        tile.changed  = changes.length;

                        TileRepository.save(tile);
                        changed++;
                    }
                } else {
                    downloadSize += downloadedTile.byteLength;

                    // BASELINE //
                    await fs.writeFile(`${snapshot.fullPath}/${x}_${y}.png`, downloadedTile);
                    TileRepository.save(tile);

                    created++;
                }
            } catch (e: any) {
                console.error(`Failed to load tile with tl X: ${x}, tl Y: ${y}:`, e.message);
            }
        }));
        await utils.sleep(ctx.DOWNLOAD_COOLDOWN);
    }
    snapshot.size = downloadSize;
    HistoryRepository.updateMemory(snapshot.id, snapshot.created_at, snapshot.size);

    console.log(`Snapshot finished! Created: ${created}; Changed: ${changed}; Writed To Disk: ${(downloadSize / (1024*1024)).toFixed(3)} mb`);
    await snapshot.writeArea(area);

    if (input.flags.includes('-s') || input.flags.includes('-switch')) {
        await ctx.changeSnapshot(snapshot);
    }
    return snapshot;
}

export async function handleDelete(ctx: Context, input: {[key: string]: any}) {
    const [, name, date = 0] = input.args;
    if(!name) {
        console.log("Name not specified.");
        return;
    }

    let snapshot: Snapshot | null = null;
    if(name && date) {
        snapshot = SnapshotService.findSnapshot(name, date);
    } else {
        snapshot = SnapshotService.findSnapshotLatest(name);
    }
    
    if(snapshot && await snapshot.exists()) {
        const stat = await fs.stat(snapshot.fullPath);
        if (stat.isDirectory()) {
            await fs.rm(snapshot.fullPath, {recursive: true, force: true});

            console.log(`Snapshot was deleted.`);
        }
    } else {
        console.log("Snapshot not found.")
        return;
    }

    SnapshotService.deleteSnapshot(snapshot);
}

export async function handleMemory(ctx: Context, input: {[key: string]: any}) {
    const [, name] = input.args as [string, string];
    if (name) {
        const snapshot: Snapshot | null = SnapshotService.findSnapshotLatest(name);
        if(!snapshot) {
            console.log("Snapshot not found")
            return;
        }
        console.log(`${name} - ${(snapshot.size / (1024 * 1024)).toFixed(2)} mb`);
    } else {
        let total = 0;

        const snapshots = await SnapshotRepository.getAll();
        for (const snapshot of snapshots) {
            const snapshotSize = HistoryRepository.countMemory(snapshot.id);
            console.log(`${snapshot.name} - ${(snapshotSize / (1024 * 1024)).toFixed(2)} mb`);

            total += snapshotSize;
        }

        console.log(`Total memory usage of the disk: ${(total / (1024 * 1024)).toFixed(2)} mb.`,);
    }
}

export async function handleImage(ctx: Context, input: { [key: string]: any }): Promise<void> {
    const [, img_name] = input.args;

    const tokens: any[] = [];

    const tiles: number[][] = await ctx.selection.getXY();
    const tlx0 = ctx.selection.data[0][0];
    const tly1 = ctx.selection.data[1][1];

    const progress = ctx.createProgress({total: tiles.length, width: 40})

    for (let i = 0; i < tiles.length; i += ctx.CONCURRENCY) {
        const batch = tiles.slice(i, i + ctx.CONCURRENCY);
        await Promise.all(batch.map(async ([cx, cy]) => {
            progress.tick(1);

            let img_buf = ctx.IMAGE_BUFFER_CACHE.get(utils.hash_xy(cx, cy));
            if (!img_buf) img_buf = await utils.downloadFileWithRetry(`https://backend.wplace.live/files/s0/tiles/${cx}/${cy}.png`);

            if (img_buf.length) {
                tokens.push({ 
                    input: img_buf,
                    left: (cx - tlx0) * 1000, 
                    top: (cy - tly1) * 1000 
                });
            } else {
                console.warn(`Tile ${cx},${cy} is empty`);
            }
        }));
    }

    await fs.mkdir('data/images/', { recursive: true });
    await sharp({
        create: {
            width: ctx.selection.width * 1000,
            height: ctx.selection.height * 1000,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
        .composite(tokens)
        .png()
        .toFile(`data/images/${img_name}.png`);

    console.log(`Image '${img_name}' was uploaded to directory 'data/images/'.`);
}

async function handleImageBuffer(ctx: Context, name: string, date: number, area: Area): Promise<Buffer | null> {
    const tokens: any[] = [];

    const tiles: number[][] = await area.getXY();
    const tlx0 = area.data[0][0];
    const tly1 = area.data[1][1];

    if(name) {
        const snapshot: Snapshot | null = date ? SnapshotService.findSnapshot(name, date) : SnapshotService.findSnapshotLatest(name);
        if(!snapshot) {
            console.log("Snapshot not found");
            return null;
        }

        for (let i = 0; i < tiles.length; i += ctx.CONCURRENCY) {
            const batch = tiles.slice(i, i + ctx.CONCURRENCY);
            await Promise.all(batch.map(async ([cx, cy]) => {
                const buffer: Buffer | null = await snapshot.loadTileRawCache(cx, cy);
                if (buffer) {
                    tokens.push({
                        input: buffer, 
                        raw: {width: 1000, height: 1000, channels: 4},
                        left: (cx - tlx0) * 1000, 
                        top: (cy - tly1) * 1000});
                } else {
                    console.warn(`Tile ${cx},${cy} is empty`);
                }
            }));
        }

    }
    return await sharp({
        create: {
            width:  area.width *1000,
            height: area.height*1000,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
        })
        .composite(tokens)
        .toBuffer();
}

export async function handleGif(ctx: Context, input: {[key: string]: any}) {
    const [, output_name, delay, from = 0, to = 0] = input.args;
    const width  = ctx.selection.width  * 1000;
    const height = ctx.selection.height * 1000;
    
    const dates = HistoryRepository.getDates(ctx.snapshot.id);
    const filtered_dates = dates.filter(d => d.created_at >= Number(from) && d.created_at <= Number(to));

    const outPath = `data/gifs/${output_name}.gif`;
    const writeStream = fsc.createWriteStream(outPath);
    
    const encoder = new GIFEncoder(width, height);
    encoder.createReadStream().pipe(writeStream);
    
    encoder.start();
    encoder.setRepeat(0);
    encoder.setDelay(Number(delay));
    encoder.setQuality(10);

    const tiles = ctx.selection.width*ctx.selection.height;
    const progress = ctx.createProgress({total: tiles*filtered_dates.length, width:40});
    
    for(const date of filtered_dates) {
        progress.tick(tiles);

        const imageData = await handleImageBuffer(ctx, ctx.snapshot.name, date.created_at, ctx.selection);
        if(!imageData) continue;

        encoder.addFrame(imageData);
    }
    encoder.finish();
    ctx.snapshot.clearCache();

    await new Promise((res, rej) => {
        writeStream.on("close", res);
        writeStream.on("error", rej);
    });

    console.log("Gif was created.");
}

export async function handleImport(ctx: Context, input: {[key: string]: any}) {
    const [ , name, indate = 0] = input.args;
    if(name && indate) {
        if(SnapshotService.findSnapshot(name, indate)) return;
    } else {
        if(SnapshotService.findSnapshotLatest(name)) return;
    }

    if(await utils.folderExists(`${SNAPSHOTS_DIR}/${name}/data`)) {
        const dates_dirs = await fs.readdir(`${SNAPSHOTS_DIR}/${name}/data`);
        const dates: number[] = dates_dirs.map(d => Number(d)).sort();

        for(const date of dates) {
            let snapshot: Snapshot | null = SnapshotService.findSnapshot(name, date);
            if(!snapshot) {
                snapshot = new Snapshot(name, date);
                SnapshotService.createSnapshot(snapshot);

                const tiles = await fs.readdir(`${snapshot.rootPath}/${date}`);
                for(const tile_file of tiles) {
                    const [xStr, yStr] = tile_file.split(/[_\.]/);
                    const tile_key = utils.hash_xy(Number(xStr), Number(yStr));
                    const tile: TileEntity = new TileEntity({
                        snapshot_id: snapshot.id,
                        hash: tile_key,
                        baseline:   snapshot.created_at,
                        created_at: snapshot.created_at,
                        size: 0,
                        changed: 0
                    });

                    if(path.extname(tile_file) !== '.png') {
                        const prev_tile: TileEntity | null = TileRepository.get(
                            snapshot.id, 
                            snapshot.created_at,
                            tile_key
                        );

                        if(prev_tile) {
                            tile.baseline = prev_tile.baseline;
                        } else {
                            console.log(`Baseline of '${xStr}_${yStr}' not found. The Import may be corrupted.`)
                            return;
                        }
                    }
                    
                    TileRepository.save(tile);
                }
            }
        }

        
    } else {
        console.log(`Import '${name}' not found.`)
    }
}


export async function handleSchedule(ctx: Context, input: {[key: string]: any}) {
    const [, name, time] = input.args;
    if(input.flags.includes('-enable')) {
        if(!time) {
            console.log('Time is missing.')
            return;
        }

        const timeFormat = time.replace(/\d/g, "");
        const timeNumber = Number(time.replace(/\D/g, ""));
        let ms = 0;
        switch(timeFormat) {
            case('ms'): {
                ms = timeNumber;
                break;
            }
            case('s'): {
                ms = timeNumber*1000;
                break;
            }
            case('m'): {
                ms = timeNumber*1000000;
                break;
            }
            case('h'): {
                ms = timeNumber*1000000000;
                break;
            }
            default: {
                ms = timeNumber;
            }
        }
        const intervalId = setInterval(async () => {
            await handleSnapshot(ctx, {
                args: ['snapshot', name],
                params: [],
                flags: []
            });
        }, ms); 
        ctx.intervals[name] = intervalId;
    } else if(input.flags.includes('-disable')) {
        if(name in ctx.intervals) {
            clearInterval(ctx.intervals[name]);
            console.log("Interval was cleared.")
        } else {
            console.log("Interval not found.");
        }
    }
    
}