import * as utils from "./utils.js" 
import fs from 'fs/promises';
import path from "path";

const DEFAULT_META = {
    latest_date: "",
    boundaries: [],
    limit: 0,
    memory_cache: {}
};

// operations with snapshot //

async function getSnapshotChanges(snapshotName, flag = "") {
  const snapshotPath = "data/snapshots/"+snapshotName;

  const files = await fs.readdir(snapshotPath, { withFileTypes: true }); 
  const years = files.filter(d => d.isDirectory()).map(d => d.name);
  const dates = [];
  
  for (const year of years) {
    const months = await fs.readdir(path.join(snapshotPath, year));
    for (const month of months) {
      const days = await fs.readdir(path.join(snapshotPath, year, month));
      for (const day of days) {
        const hours = await fs.readdir(path.join(snapshotPath, year, month, day));
        for (const hour of hours) {
          const minutes = await fs.readdir(path.join(snapshotPath, year, month, day, hour));
          for (const minute of minutes) {
            const d = new Date(year, month - 1, day, hour, minute);
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

async function getSnapshotSize(snapshotName, options = {metaIn: null, date: ""}) {
  const meta = await utils.readJson(`data/snapshots/${snapshotName}/metadata.json`, {default: DEFAULT_META, createIfAbsent: true});

  const queue = [{ path: `data/snapshots/${snapshotName}/${options.date}`, depth: 0 }];
  const resultFolders = [];

  while (queue.length) {
    const { path: currentPath, depth } = queue.shift();

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

  if(!options.metaIn) await utils.writeJson(`data/snapshots/${snapshotName}/metadata.json`, meta);

  return totalSize;
}

// Commands //

export async function handleLoad(ctx, input) {
    const [, name, date] = input.args;

    let chosen_date = ""; // format with slashes 

    if (!name) {
        if (!ctx.SNAPSHOT_NAME) name = ctx.SNAPSHOT_NAME;
        else {
            console.log("Name is not chosen.");
            return;
        }
    }

    if (!date && (input.flags.length == 0 || input.flags.includes('-latest'))) {
        const meta = await utils.readJson(`data/snapshots/${name}/metadata.json`);
        if (!meta || !meta.latest_date) {
            console.error('Metadata.json is empty or corrupted.');
            return;
        }
        chosen_date = meta.latest_date
    }else if (date) {
        const [month = 0, day = 0, year = 0, hour = 0, minute = 0] = (date || "").trim().split(/[-/:/]+/).map(Number);

        const after = new Date(year, month - 1, day, hour, minute)
        const dates = await getSnapshotChanges(name);

        const candidates = dates.filter(d => d >= after);

        chosen_date = utils.dateToPath(candidates[0]);
    }

    // Saves to settings 

    await ctx.changeSnapshot(name, chosen_date);
    console.log(`Snapshot was succefully loaded. The current snapshot is ${name}[${utils.pathToFormatted(chosen_date)}].`)
}

export async function handleSnapshot(ctx, input) {
    let [, name, tlx0, tly0, tlx1, tly1] = input.args;

    if (!name) {
        if (ctx.SNAPSHOT_NAME) {
            name = ctx.SNAPSHOT_NAME;
        } else {
            console.log("Name is not defined.");
            return;
        }
    }

    const meta = await utils.readJson(`data/snapshots/${name}/metadata.json`, { default: DEFAULT_META, createIfAbsent: true });

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
        } else if (meta.boundaries) {
            tlx0 = meta.boundaries[0];
            tly0 = meta.boundaries[1];
            tlx1 = meta.boundaries[2];
            tly1 = meta.boundaries[3];
        } else {
            console.log("Points are not defined.")
            return;
        }
    }

    const now = new Date();

    const folderPath = path.resolve(`data/snapshots/${name}/${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}/${String(now.getHours()).padStart(2, '0')}/${String(now.getMinutes()).padStart(2, '0')}`);
    await fs.mkdir(folderPath, { recursive: true });

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
                const tilePath = path.join(folderPath, `${x}_${y}.png`);
                await fs.writeFile(tilePath, tile_png);
                console.log(`Saved tile: ${tilePath}`);
            } catch (e) {
                console.error(`Failed to load tile with tl X: ${x}, tl Y: ${y}:`, e.message);
            }
        }));
        await utils.sleep(ctx.DOWNLOAD_COOLDOWN);
    }

    if (limit != 0) {
        const sizeBefore = await getSnapshotSize(name, { metaIn: meta });
        let newSize = sizeBefore + downloadSize;

        if (newSize > limit) {
            const changes = await getSnapshotChanges(name, '-a')
            const deletePaths = [];
            for (const change of changes) {
                if (newSize > limit) {
                    const __path = `data/snapshots/${name}/${dateToPath(change)}`

                    newSize -= await getSnapshotSize(name, { metaIn: meta, date: dateToPath(change) });
                    deletePaths.push(__path);
                } else break;
            }

            const answer = await ctx.ask(`You're going to delete ${deletePaths.length} change(s) of '${name}' to free disk space. Are you sure? Write y/n to confirm: `)
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

    meta.latest_date = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}/${String(now.getHours()).padStart(2, '0')}/${String(now.getMinutes()).padStart(2, '0')}`;
    meta.boundaries = [tlx0, tly0, tlx1, tly1];
    meta.limit = limit;

    await utils.writeJson(`data/snapshots/${name}/metadata.json`, meta);

    if (input.flags.includes('-s') || input.flags.includes('-switch')) {
        await ctx.changeSnapshot(name, meta.latest_date);
    }
}

export async function handleDelete(ctx, input) {
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
        } catch (err) {
            if (err.code === "ENOENT") {
                console.log("Snapshot not found");
            } else {
                console.error("Error while deleting:", err);
            }
        }
    }
}

export async function handleMemory(ctx, input) {
    const [, name] = input.args;

    if (name) {
        const snapshotSize = await getSnapshotSize(name);
        console.log(`${name} - ${(snapshotSize / (1024 * 1024)).toFixed(2)} mb`);
    } else {
        let total = 0;

        const snapshots = await fs.readdir("data/snapshots", { withFileTypes: true });
        for (const snapshot of snapshots) {
            const snapshotSize = await getSnapshotSize(snapshot.name);
            console.log(`${snapshot.name} - ${(snapshotSize / (1024 * 1024)).toFixed(2)} mb`);

            total += snapshotSize;
        }

        console.log(`Total memory usage of the disk: ${(total / (1024 * 1024)).toFixed(2)} mb.`,);
    }
}

export async function handleCurrent(ctx, input) {
    console.log(ctx.SNAPSHOT_NAME, ctx.SNAPSHOT_PATH);
}

export async function handleShow(ctx, input) {
    const [, name, date] = input.args;

    if (name) {
        if (date) {
            const [month, day, year, hour, minute] = date.trim().split(/[-/]+/).map(Number);
        } else {
            const dates = await getSnapshotChanges(name, input.flags[0]);
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

export async function handleLimit(ctx, input) {
    const [, name, value] = input.args;
    const meta = await utils.readJson(`data/snapshots/${name}/metadata.json`)

    meta.limit = value * 1024 * 1024;

    await utils.writeJson(`data/snapshots/${name}/metadata.json`, meta);

    console.log(`'${name}' was limited.`)
}