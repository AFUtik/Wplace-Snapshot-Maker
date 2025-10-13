import * as utils from "./utils.js" 

import fs  from 'fs/promises';
import fsc from 'fs';

import path from "path";

import { createCanvas, Image, loadImage } from 'canvas';
import { SNAPSHOTS_DIR, Area, Snapshot, Context, SnapshotService } from './context.ts';

import * as dpng from "./dpng.js"

import pkg from "gif-encoder-2";
const GIFEncoder = pkg.default || pkg;

// Commands //

export async function handleLoad(ctx: Context, input: {[key: string]: any}): Promise<Snapshot> {
    let [, name, date] = input.args as [string, string, string]; 
    if(name == ctx.snapshot.name && date == ctx.snapshot.date) return ctx.snapshot;
    
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
        snapshot = SnapshotService.findSnapshotByName(name);
    }

    if(snapshot) {
        await ctx.changeSnapshot(snapshot);
        console.log(`Snapshot was succefully loaded. The current snapshot is ${name}[${utils.pathToFormatted(snapshot.date)}].`)
        
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
    let latest_snapshot: Snapshot | null = SnapshotService.findSourceSnapshotByName(name);

    if(latest_snapshot) snapshot.delta_from = latest_snapshot;
    
    let area: Area = await snapshot.readArea();
    if(input.flags.includes('-select') || area.empty()) area = ctx.selection;

    await fs.mkdir(snapshot.fullPath, {recursive: true});

    const queue: number[][] = await area.getXY();

    let downloadSize = 0;
    while (queue.length > 0) {
        const batch = queue.splice(0, ctx.DOWNLOAD_LIMIT);
        await Promise.all(batch.map(async ([x, y]) => {
            try {
                const downloadedTile = await utils.downloadFileWithRetry(`https://backend.wplace.live/files/s0/tiles/${x}/${y}.png`);
                downloadSize += downloadedTile.length;

                if(latest_snapshot !== null) {
                    // DELTA //
                    const latestTile = await fs.readFile(path.join(latest_snapshot.fullPath, `${x}_${y}.png`));

                    const changes = await dpng.getChanges(latestTile, downloadedTile, 1000, 1000);
                    if(changes.length > 0) {
                        await dpng.writeDPNG(changes, 1000, 1000, `${snapshot.fullPath}/${x}_${y}.dpng`);
                    }
                } else {
                    // SOURCE //
                    await fs.writeFile(path.join(snapshot.fullPath, `${x}_${y}.png`), downloadedTile);
                }
                
                console.log(`Saved tile '${x}_${y}'.png`);
            } catch (e: any) {
                console.error(`Failed to load tile with tl X: ${x}, tl Y: ${y}:`, e.message);
            }
        }));
        await utils.sleep(ctx.DOWNLOAD_COOLDOWN);
    }
    snapshot.size = downloadSize;

    // TO DO //
    /*if (limit != 0) {
        const sizeBefore = await getSnapshotSize(snapshot);
        let newSize = sizeBefore + downloadSize;

        if (newSize > limit) {
            const changes = await getSnapshotChanges(name, '-a')
            const deletePaths = [];
            for (const change of changes) {
                if (newSize > limit) {
                    const __path = `data/snapshots/${name}/${utils.dateToPath(change)}`

                    newSize -= await getSnapshotSize(name, { metaIn: meta, date: utils.dateToPath(change) });
                    deletePaths.push(__path);
                } else break;
            }

            const answer: string = await ctx.ask(`You're going to delete ${deletePaths.length} change(s) of '${name}' to free disk space. Are you sure? Write y/n to confirm: `)
            if (['y', 'yes'].includes(answer.trim().toLowerCase())) {
                for (const deletePath of deletePaths) {
                    try {
                        await fs.rm(deletePath, { recursive: true, force: true });
                    } catch (e) {
                        console.log("Failed to delete changes.")
                    }
                }
            } else {
                console.log("Tip: You can expand limit by command `limit <your limit in megabytes>`")
            }
        }

    }*/
   
    console.log("All tiles saved successfully!");
    await snapshot.writeArea(area);

    // Saving data to database. //
    SnapshotService.createSnapshot(snapshot);

    if (input.flags.includes('-s') || input.flags.includes('-switch')) {
        await ctx.changeSnapshot(snapshot);
    }
    return snapshot;
}

export async function handleDelete(ctx: Context, input: {[key: string]: any}) {
    const [, name, date] = input.args;
    if(!name) {
        console.log("Name not specified.");
        return;
    }
    let snapshot: Snapshot | null = null;
    if(name && date) {
        snapshot = SnapshotService.findSnapshot(name, date);
    } else {
        snapshot = SnapshotService.findSnapshotByName(name);
    }
    
    if(snapshot && await snapshot.exists()) {
        const stat = await fs.stat(snapshot.fullPath);
        if (stat.isDirectory()) {
            await fs.rm(snapshot.fullPath, { recursive: true, force: true });
            await utils.removeEmptyParents(path.dirname(snapshot.fullPath), snapshot.name);

            console.log(`Snapshot was deleted.`);
        }
    } else {
        console.log("Snapshot not found.")
        return;
    }
}

export async function handleMemory(ctx: Context, input: {[key: string]: any}) {
    const [, name] = input.args as [string, string];
    if (name) {
        const snapshot: Snapshot | null = SnapshotService.findSnapshotByName(name);
        if(!snapshot) {
            console.log("Snapshot not found")
            return;
        }
        console.log(`${name} - ${(snapshot.size / (1024 * 1024)).toFixed(2)} mb`);
    } else {
        let total = 0;

        const snapshots = await fs.readdir("data/snapshots", { withFileTypes: true });
        for (const snapshot_folder of snapshots) {
            const snapshotSize = await getSnapshotSize(new Snapshot(snapshot_folder.name));
            console.log(`${snapshot_folder.name} - ${(snapshotSize / (1024 * 1024)).toFixed(2)} mb`);

            total += snapshotSize;
        }

        console.log(`Total memory usage of the disk: ${(total / (1024 * 1024)).toFixed(2)} mb.`,);
    }
}

export async function handleCurrent(ctx: Context, input: {[key: string]: any}) {
    console.log(ctx.snapshot.name, ctx.snapshot.date);
}

export async function handleShow(ctx: Context, input: {[key: string]: any}) {
    const [, name, date = ""] = input.args;
    const snapshot: Snapshot = new Snapshot(name, date)

    if (name) {
        if (date) {
            const [month, day, year, hour, minute] = date.trim().split(/[-/]+/).map(Number);
        } else {
            const dates = await getSnapshotChanges(snapshot, input.flags[0]);
            const formatted = dates.map(d => utils.dateToFormatted(d));

            console.log("Dates:", formatted);
        }
    } else {
        try {
            const files = await fs.readdir("data/snapshots", { withFileTypes: true });
            const folders = files.filter(d => d.isDirectory()).map(d => d.name);

            console.log('Snapshots:', folders);
        } catch (err) {
            console.error('Failed to read snapshots:', err);
        }
    }
}

export async function handleLimit(ctx: Context, input: {[key: string]: any}) {
    const [, name, value] = input.args;
    const meta = await utils.readJson(`data/snapshots/${name}/metadata.json`)

    meta.limit = value * 1024 * 1024;

    await utils.writeJson(`data/snapshots/${name}/metadata.json`, meta);

    console.log(`'${name}' was limited.`)
}

export async function handleImage(ctx: Context, input: {[key: string]: any}) {
    const [, img_name] = input.args;
    
    const canvas = createCanvas((ctx.selection.width-1)*1000, (ctx.selection.height-1)*1000);
    const __ctx = canvas.getContext('2d');

    const tiles: number[][] = await ctx.selection.getXY();
    const tlx0 = ctx.selection.data[0][0];
    const tly1 = ctx.selection.data[1][1];

    for (let i = 0; i < tiles.length; i += ctx.CONCURRENCY) {
        const batch = tiles.slice(i, i + ctx.CONCURRENCY);
        await Promise.all(batch.map(async ([cx, cy]) => {
            let img_buf = ctx.IMAGE_BUFFER_CACHE.get(`${cx}_${cy}`);
            if(!img_buf) img_buf = await utils.downloadFileWithRetry(`https://backend.wplace.live/files/s0/tiles/${cx}/${cy}.png`);
             
            const img = await loadImage(img_buf);
            if (img.width && img.height) {
                __ctx.drawImage(img, (cx - tlx0) * 1000, (cy - tly1) * 1000);
            } else {
                console.warn(`Tile ${cx},${cy} is empty`);
            }
        }));
    }

    await fs.mkdir('data/images/', { recursive: true });

    const buffer = canvas.toBuffer('image/png');
    await fs.writeFile(`data/images/${img_name}.png`, buffer);

    console.log(`Image '${img_name}' was uploaded to directory 'data/images/'.`);
}

export async function handleGif(ctx: Context, input: {[key: string]: any}) {
    const [, output_name, delay, from, to] = input.args;
    const width  = ctx.selection.width  * 1000;
    const height = ctx.selection.height * 1000;
    const tlx0 = ctx.selection.data[0][0];
    const tly1 = ctx.selection.data[1][1];

    const from_date = utils.pathToDate(from);
    const to_date   = utils.pathToDate(to);

    const dates = await getSnapshotChanges(ctx.snapshot);
    const filtered_dates = dates.filter((d) => d >= from_date && d <= to_date);

    const gridXY = await ctx.selection.getXY();
    const tileOffsets = gridXY.map(([cx, cy]) => {
        return {
            x: Math.round((cx - tlx0) * 1000),
            y: Math.round((cy - tly1) * 1000),
            name: `${cx}_${cy}.png`
        };
    });

    const canvas = createCanvas(width, height);
    const __ctx = canvas.getContext('2d');

    const outPath = `data/gifs/${output_name}.gif`;
    const writeStream = fsc.createWriteStream(outPath);
    
    const encoder = new GIFEncoder(width, height);
    encoder.createReadStream().pipe(writeStream);
    
    encoder.start();
    encoder.setRepeat(0);
    encoder.setDelay(Number(delay));
    encoder.setQuality(10);

    let prevFrameBuffer = null;

    const useFrameDedup  = true;
    const skipEmptyFrame = true;

    for(const date of filtered_dates) {
        __ctx.fillStyle = "#ffffffff";
        __ctx.fillRect(0, 0, width, height);

        const folderPath = `data/snapshots/${ctx.snapshot.name}/${utils.dateToPath(date)}/`
        let success = true;
        for(const [cx, cy] of gridXY) {
            try {
                const buffer = await fs.readFile(folderPath+`${cx}_${cy}.png`)
                const img = await loadImage(buffer);
                
                __ctx.drawImage(img, (cx - tlx0) * 1000, (cy - tly1) * 1000);
            } catch(e) {
                success = false;
                break;
            }
        }

        if(!success) continue;

        const loadPromises = tileOffsets.map(async (t) => {
            const p = folderPath + t.name;
                try {
                    const buf = await fs.readFile(p);
                    const img = await loadImage(buf);
                    return { img, x: t.x, y: t.y };
                } catch (e) {
                    return null;
                }
        });

        const images = await Promise.all(loadPromises);
        for (const it of images) {
            if (!it) continue;
            __ctx.drawImage(it.img, it.x, it.y);
        }
        const imageData = __ctx.getImageData(0, 0, width, height)

        if (skipEmptyFrame) {
            const buf = new Uint32Array(imageData.data.buffer);
            let empty = true;

            for (let i = 0; i < buf.length; i++) {
                if (buf[i] !== 0) {
                    empty = false;
                    break;
                }
            }
            if(empty) continue;
        }

        if (useFrameDedup) {
            const buf = Buffer.from(imageData.data.buffer);

            if (prevFrameBuffer && Buffer.compare(prevFrameBuffer, buf) === 0) {
                continue;
            }
            prevFrameBuffer = buf;
            encoder.addFrame(__ctx);
        } else encoder.addFrame(__ctx);
    }
    encoder.finish();

    await new Promise((res, rej) => {
        writeStream.on("close", res);
        writeStream.on("error", rej);
    });

    console.log("Gif was created.");
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