import * as utils from "./utils.js" 
import fs from 'fs/promises';
import path from "path";

import { createCanvas, Image } from 'canvas';
import { SNAPSHOTS_DIR, Snapshot, Context } from './context.ts';

// operations with snapshot //

async function getSnapshotChanges(snapshot: Snapshot, flag: string = ""): Promise<any[]> {
  const files = await fs.readdir(snapshot.rootPath, { withFileTypes: true }); 
  const years: string[] = files.filter(d => d.isDirectory()).map(d => d.name);
  const dates: any[] = [];
  
  for (const year of years) {
    const months = await fs.readdir(path.join(snapshot.rootPath, year));
    for (const month of months) {
      const days = await fs.readdir(path.join(snapshot.rootPath, year, month));
      for (const day of days) {
        const hours = await fs.readdir(path.join(snapshot.rootPath, year, month, day));
        for (const hour of hours) {
          const minutes = await fs.readdir(path.join(snapshot.rootPath, year, month, day, hour));
          for (const minute of minutes) {
            const d = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
            dates.push(d);
          }
        }
      }
    }
  }

  if(flag == '-a' ) {         // ascend by date
    dates.sort((a, b) => a - b);
  } else if(flag == '-d') {   // descend by date
    dates.sort((a, b) => b - a);
  }
  return dates;
}

interface GetSnapshotSizeOptions {
  metaIn?: any | null;
  date?: string;
}

async function getSnapshotSize(snapshot: Snapshot, options: GetSnapshotSizeOptions = {date: "", metaIn: null}) : Promise<number> {
  const meta = await snapshot.readMeta();

  const queue: {path: string, depth: number}[] = [{ path: `${SNAPSHOTS_DIR}/${snapshot.name}/${options.date}`, depth: 0 }];
  const resultFolders: string[] = [];

  while (queue.length) {
    const { path: currentPath, depth } = queue.shift()!;

    if (depth === 5) {
      resultFolders.push(currentPath);
      continue;
    }

    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          queue.push({ path: path.join(currentPath, entry.name), depth: depth + 1 });
        }
      }
    } catch (err) {
      console.error('Error reading folder:', currentPath, err);
    }
  }
  
  let totalSize = 0;

  for(const folderPath of resultFolders) {
    if(meta && folderPath in meta.memory_cache) {
      totalSize+=meta.memory_cache[folderPath];
      continue;
    }

    const tiles = await fs.readdir(folderPath);
    let snapshotSize = 0;

    for (const tile of tiles) {
      const stats = await fs.stat(path.join(folderPath, tile));
      snapshotSize += stats.size;
    }

    meta.memory_cache[folderPath] = snapshotSize;

    totalSize += snapshotSize;
  }

  if(!options.metaIn) await snapshot.writeMeta(meta);

  return totalSize;
}

// Commands //

export async function handleLoad(ctx: Context, input: {[key: string]: any}) {
    let [, name, date] = input.args as [string, string, string]; 

    const snapshot: Snapshot = new Snapshot(name, date);
    await snapshot.fetchMeta();

    if (!name) {
        if (!ctx.SNAPSHOT_NAME) name = ctx.SNAPSHOT_NAME;
        else {
            console.log("Name is not chosen.");
            return;
        }
    }

    if (date) {
        const [month = 0, day = 0, year = 0, hour = 0, minute = 0] = (date || "").trim().split(/[-/:/]+/).map(Number);

        const after = new Date(year, month - 1, day, hour, minute);
        const dates = await getSnapshotChanges(snapshot);

        const candidates = dates.filter(d => d >= after);

        snapshot.setDate(candidates[0]);
    }

    // Saves to settings 

    await ctx.changeSnapshot(snapshot);
    console.log(`Snapshot was succefully loaded. The current snapshot is ${name}[${utils.pathToFormatted(snapshot.date)}].`)
}

export async function handleSnapshot(ctx: Context, input: {[key: string]: any[]}) {
    let [, name, tlx0, tly0, tlx1, tly1] = input.args;

    if (!name) {
        if (ctx.SNAPSHOT_NAME) {
            name = ctx.SNAPSHOT_NAME;
        } else {
            console.log("Name is not defined.");
            return;
        }
    }

    const snapshot: Snapshot = new Snapshot(name);
    const meta = await snapshot.readMeta();

    await snapshot.setDateNow();
    await fs.mkdir(snapshot.fullPath, {recursive: true});

    let limit = meta.limit;

    const limitParam = input.params.find(p => p.key === 'limit');
    if (limitParam) {
        limit = Number(limitParam.value) * 1024 * 1024; // converts megabytes into bytes.
    }

    if (!tlx0) {
        if (ctx.AREA.length > 0) {
            tlx0 = ctx.AREA[0][0];
            tly0 = ctx.AREA[0][1];
            tlx1 = ctx.AREA[1][0];
            tly1 = ctx.AREA[1][1];

            snapshot.boundaries = ctx.AREA;
        }else {
            console.log("Points are not defined.")
            return;
        }
    }    

    const queue = [];

    for (let y = tly0; y >= tly1; y--) {
        for (let x = tlx0; x <= tlx1; x++) {
            queue.push([x, y]);
        }
    }

    let downloadSize = 0;
    while (queue.length > 0) {
        const batch = queue.splice(0, ctx.DOWNLOAD_LIMIT);
        await Promise.all(batch.map(async ([x, y]) => {
            try {
                const tile_png = await utils.downloadFileWithRetry(`https://backend.wplace.live/files/s0/tiles/${x}/${y}.png`);
                downloadSize += tile_png.length;
                const tilePath = path.join(snapshot.fullPath, `${x}_${y}.png`);
                await fs.writeFile(tilePath, tile_png);
                console.log(`Saved tile: ${tilePath}`);
            } catch (e: any) {
                console.error(`Failed to load tile with tl X: ${x}, tl Y: ${y}:`, e.message);
            }
        }));
        await utils.sleep(ctx.DOWNLOAD_COOLDOWN);
    }

    if (limit != 0) {
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

    }
    console.log("All tiles saved successfully!");

    meta.latest_date = snapshot.date;
    meta.boundaries = [tlx0, tly0, tlx1, tly1];
    meta.limit = limit;

    await utils.writeJson(`data/snapshots/${name}/metadata.json`, meta);

    if (input.flags.includes('-s') || input.flags.includes('-switch')) {
        await ctx.changeSnapshot(snapshot);
    }
}

export async function handleDelete(ctx: Context, input: {[key: string]: any}) {
    const [, name, date] = input.args;
    if (name) {
        try {
            let path = ""
            if (date) {
                path = `data/snapshots/${name}/${date}`;
            } else {
                path = `data/snapshots/${name}`;
            }
            const stat = await fs.stat(path);
            if (stat.isDirectory()) {
                await fs.rm(path, { recursive: true, force: true });
                console.log(`Snapshot was deleted.`);
            }
        } catch (err: any) {
            if (err.code === "ENOENT") {
                console.log("Snapshot not found");
            } else {
                console.error("Error while deleting:", err);
            }
        }
    }
}

export async function handleMemory(ctx: Context, input: {[key: string]: any}) {
    const [, name] = input.args as [string, string];
    const snapshot: Snapshot = new Snapshot(name);

    if (name) {
        const snapshotSize = await getSnapshotSize(snapshot);
        console.log(`${name} - ${(snapshotSize / (1024 * 1024)).toFixed(2)} mb`);
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
    console.log(ctx.SNAPSHOT_NAME, ctx.SNAPSHOT_PATH);
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

    const tlx0 = ctx.AREA[0][0];
    const tly0 = ctx.AREA[0][1];
    const tlx1 = ctx.AREA[1][0];
    const tly1 = ctx.AREA[1][1];
    
    const width = (tlx1 - tlx0 + 1) * 1000;
    const height = (tly0 - tly1 + 1) * 1000;
    const canvas = createCanvas(width, height);
    const __ctx = canvas.getContext('2d');

    const tiles = [];
    for (let cy = tly0; cy >= tly1; cy--) {
        for (let cx = tlx0; cx <= tlx1; cx++) {
            tiles.push({ cx, cy });
        }
    }

    for (let i = 0; i < tiles.length; i += ctx.CONCURRENCY) {
        const batch = tiles.slice(i, i + ctx.CONCURRENCY);
        await Promise.all(batch.map(async tile => {
            const buf = await utils.downloadFileWithRetry(`https://backend.wplace.live/files/s0/tiles/${tile.cx}/${tile.cy}.png`);
            const img = new Image();
            img.src = buf;
            if (img.width && img.height) {
                __ctx.drawImage(img, (tile.cx - tlx0) * 1000, (tile.cy - tly1) * 1000);
            } else {
                console.warn(`Tile ${tile.cx},${tile.cy} is empty`);
            }
        }));
    }

    await fs.mkdir('data/images/', { recursive: true });

    const buffer = canvas.toBuffer('image/png');
    await fs.writeFile(`data/images/${img_name}.png`, buffer);
    console.log(`Image '${img_name}' was uploaded to directory 'data/images/'.`);
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