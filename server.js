import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import axios from "axios";

import { createCanvas, loadImage } from 'canvas';
import { LRUCache } from 'lru-cache';

import readline from 'readline';

const app = express();

const TILE_SIZE  = 1000;
const CHUNK_SIZE = 1000;
const NATIVE_ZOOM = 12;

const limit = 5;

const TILE_CACHE = new LRUCache({
  max: 1000,
});
const CHUNK_IMAGE_CACHE = new LRUCache({
  max: 1000
});

function clearCache() {
  TILE_CACHE.clear();
  CHUNK_IMAGE_CACHE.clear();
}

let SNAPSHOT_PATH = "";
let SNAPSHOT_NAME = "";
let AREA = [];

function switchSnapshot(name, date) {
  SNAPSHOT_PATH = name + '/' + date;
  SNAPSHOT_NAME = name;
}

function chunkPath(cx, cy) {
  return path.resolve(`data/snapshots/${SNAPSHOT_PATH}//${cx}_${cy}.png`);
}

function tileToPixel(z, x, y) {
  const scale = Math.pow(2, NATIVE_ZOOM - z);
  const px = Math.round(x * TILE_SIZE * scale);
  const py = Math.round(y * TILE_SIZE * scale);
  return { px, py, scale };
}

function normalizeCorners(p1, p2) {
  const xMin = Math.min(p1[0], p2[0]);
  const yMin = Math.max(p1[1], p2[1]);
  const xMax = Math.max(p1[0], p2[0]);
  const yMax = Math.min(p1[1], p2[1]);

  return [
    [xMin, yMin],
    [xMax, yMax]
  ];
}

app.use(express.json());

app.use(express.static(path.join(process.cwd(), 'public')));

app.get('/tiles/:z/:x/:y.png', async (req, res) => {
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  const cacheKey = `${z}_${x}_${y}`;

  const cached = TILE_CACHE.get(cacheKey);
  if (cached) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(cached.length));
    return res.send(cached);
  }

  const canvas = createCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);

  const { px, py, scale } = tileToPixel(z, x, y);

  const tileWorldWidth  = Math.round(TILE_SIZE * scale);
  const tileWorldHeight = Math.round(TILE_SIZE * scale);

  const cx0 = Math.floor(px / CHUNK_SIZE);
  const cy0 = Math.floor(py / CHUNK_SIZE);
  const cx1 = Math.floor((px + tileWorldWidth - 1) / CHUNK_SIZE);
  const cy1 = Math.floor((py + tileWorldHeight - 1) / CHUNK_SIZE);

  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      const p = chunkPath(cx, cy);

      try {
        await fs.access(p);
      } catch {
        continue;
      }

      const chunkKey = `${cx}_${cy}`;
      let img = CHUNK_IMAGE_CACHE.get(chunkKey);
      if (!img) {
        try {
          img = await loadImage(p);
          CHUNK_IMAGE_CACHE.set(chunkKey, img);
        } catch (e) {
          continue;
        }
      }

      const chunkPx = cx * CHUNK_SIZE;
      const chunkPy = cy * CHUNK_SIZE;

      const sx = Math.max(0, px - chunkPx);
      const sy = Math.max(0, py - chunkPy);
      const ex = Math.min(CHUNK_SIZE, px + tileWorldWidth - chunkPx);
      const ey = Math.min(CHUNK_SIZE, py + tileWorldHeight - chunkPy);
      const sWidth = ex - sx;
      const sHeight = ey - sy;
      if (sWidth <= 0 || sHeight <= 0) continue;

      const dstOffsetX_world = chunkPx + sx - px;
      const dstOffsetY_world = chunkPy + sy - py;

      const dx = Math.round(dstOffsetX_world / scale);
      const dy = Math.round(dstOffsetY_world / scale);
      const dw = Math.round(sWidth / scale);
      const dh = Math.round(sHeight / scale);

      try {
        ctx.drawImage(img, sx, sy, sWidth, sHeight, dx, dy, dw, dh);
      } catch (e) {
        console.error('drawImage error', e);
      }
    }
  }

  const buffer = canvas.toBuffer('image/png');
  TILE_CACHE.set(cacheKey, buffer);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Length', String(buffer.length));
  res.send(buffer);
});

app.post('/points', async (req, res) => {
  const { tileX0, tileY0, tileX1, tileY1 } = req.body;

  AREA = normalizeCorners([tileX0, tileY0], [tileX1, tileY1]);

  res.json({ status: "ok", received: req.body });
}) 

app.listen(3000, () => console.log('Tile server on :3000'));

async function downloadFileWithRetry(url) {
  try {
    const res = await fetch(url);

    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after"); 
      const wait = (retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000); // мс
      console.warn(`429 received. Retrying after ${wait}ms...`);
      await sleep(wait);
      return await downloadFileWithRetry(url);
    }

    if (!res.ok) {
      throw new Error(`Failed with status ${res.status}`);
    }

    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error("Download error:", err.message);
    throw err;
  }
}

async function readJson(filePath) {
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch (err) {
    if (err.code === "ENOENT") {
      await fs.writeFile(filePath, JSON.stringify(fallback, null, 2), "utf8");
      return fallback;
    }
    throw err;
  }
}

async function writeJson(filePath, obj) {
  try {
    const data = JSON.stringify(obj, null, 2);
    await fs.writeFile(filePath, data, 'utf8');
  } catch (err) {
    console.error('Failed to write JSON:', err);
  }
}

async function getSnapshotChanges(snapshotName, flag) {
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

function pathToDate(p) {
  const [year, month, day, hour, minute] = p.trim().split(/\/+/);
  return new Date(month-1, day, year, hour, minute);
}

function pathToFormatted(p) {
  const [year, month, day, hour, minute] = p.trim().split(/\/+/);
  return `${month}-${day}-${year} ${hour}:${minute}`;
}

function dateToPath(d) {
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}/${String(d.getHours()).padStart(2,'0')}/${String(d.getMinutes()).padStart(2,'0')}`
}

function dateToFormatted(d) {
  return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> '
});

rl.prompt();

rl.on('line', async (line) => {
  const allArgs = line.trim().split(/\s+/);

  const flags = allArgs.filter(arg =>  arg.startsWith('-'));
  const args  = allArgs.filter(arg => !arg.startsWith('-'));

  const command = args[0];

  switch (command) {
    case 'status':
      console.log('Server is working!');
      break;
    case 'exit':
      console.log('Closing...');
      process.exit(0);
    case 'snapshot': {
      let [ , name, tlx0, tly0, tlx1, tly1] = args;
      
      if(!name) {
        name = SNAPSHOT_NAME;
      } 
      
      if(!tlx0) {
        if(AREA.length > 0) {
          tlx0 = AREA[0][0];
          tly0 = AREA[0][1];
          tlx1 = AREA[1][0];
          tly1 = AREA[1][1];
        } else {
          console.log("Points are not defined.")
          break;
        }
      }

      const now = new Date();

      const folderPath = path.resolve(`data/snapshots/${name}/${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}/${String(now.getHours()).padStart(2,'0')}/${String(now.getMinutes()).padStart(2,'0')}`);
      await fs.mkdir(folderPath, { recursive: true });

      const queue = [];

      for (let y = tly0; y >= tly1; y--) {
        for (let x = tlx0; x <= tlx1; x++) {
          queue.push([x, y]);
        }
      }

      while (queue.length > 0) {
        const batch = queue.splice(0, limit);
        await Promise.all(batch.map(async ([x, y]) => {
          try {
            const tile_png = await downloadFileWithRetry(`https://backend.wplace.live/files/s0/tiles/${x}/${y}.png`);
            const tilePath = path.join(folderPath, `${x}_${y}.png`);
            await fs.writeFile(tilePath, tile_png);
            console.log(`Saved tile: ${tilePath}`);
          } catch (e) {
            console.error(`Failed to load tile with tl X: ${x}, tl Y: ${y}:`, e.message);
          }
        }));
        await sleep(400);
      }
      console.log("All tiles saved successfully!");

      let meta = await readJson(`data/snapshots/${name}/metadata.json`);
      if(!meta) {
        meta = {
          latest_date: "",
          boundaries:  []
        }
      }

      meta.latest_date = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}/${now.getHours()}/${now.getMinutes()}`;
      meta.boundaries  = [tlx0, tly0, tlx1, tly1];
      //meta.dates.push(meta.latest_date);
      await writeJson(`data/snapshots/${name}/metadata.json`, meta);

      if(flags.includes('-s') || flags.includes('-switch')) {
        clearCache();
        switchSnapshot(name, meta.latest_date);
      }
      break;
    }
    case 'update':
      break;
    case 'show': {
      const [ , name, date, time] = args;

      if(name) {
        if(date) {
          const [month, day, year] = date.trim().split(/[-/]+/).map(Number);

          const [hour, minute] = time.trim().split(/[:\-\/]+/).map(Number);
        } else {
          const dates = getSnapshotChanges(name, flags[0]);
          const formatted = dates.map(d => dateToFormatted(d));

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

      break;
    }
    case 'schedule':
      break;
    case 'load': {
      clearCache();

      const [ , name, date, time] = args;

      let chosen_date = ""; // format with slashes 

      if(flags.length == 0 || flags.includes('-latest')) {
        const meta = await readJson(`data/snapshots/${name}/metadata.json`);
        if (!meta || !meta.latest_date) {
          console.error('Metadata.json is empty or corrupted.');
          break;
        }
        chosen_date = meta.latest_date
      } else if (flags.includes('-next')) {
        // 
      } else if(name) {
        const [month = 0, day = 0, year = 0] = (date || "").trim().split(/[-/]+/).map(Number);
        const [hour = 0, minute = 0] = (time || "").trim().split(/[:\-\/]+/).map(Number);

        if(date && time) {
          snapshotPath = `${name}/${year}/${month}/${day}/${hour}/${minute}`;
          break;
        } else {
          const after = new Date(year, month-1, day, hour, minute)
          const candidates = parsed.filter(d => d > after);

          chosen_date = dateToPath(candidates[0]);
        }
      }

      if(flags.includes('-save')) {
        const settings = await readJson('settings.json');

        SNAPSHOT_NAME = name;
        
        settings.current_snapshot = name;
        settings.current_date = chosen_date;

        writeJson("settings.json", settings);
      }

      switchSnapshot(name, chosen_date);
      console.log(`Snapshot was succefully loaded. The current snapshot is ${name}[${pathToFormatted(chosen_date)}].`)

      break;
    }
    case 'delete':
      break;
    default:
      console.log(`Unknown Command: ${command}`);
  }

  rl.prompt();
});