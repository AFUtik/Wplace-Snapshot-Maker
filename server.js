import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import PQueue from "p-queue";

import { createCanvas, loadImage } from 'canvas';
import { LRUCache } from 'lru-cache';

import * as cmd from "./scripts/commands.js"
import * as utils    from "./scripts/utils.js"

import readline from 'readline';

const DEFAULT_SETTINGS = {
  load_topographic: true,
  current_snapshot: "",
  current_date: "",
  cache_control: true,
  cache_control_lifetime: 60,
  tile_cache: 300,
  chunk_image_cache: 200,
  download_cooldown: 1000,
  download_limit: 5,
  server_port: 3000,
  min_zoom: 6,
  concurrency: 4
};

let settings = await utils.readJson('settings.json')

if (!settings || typeof settings !== 'object') {
  settings = { ...DEFAULT_SETTINGS };
  await utils.writeJson('settings.json', settings); 
} else {
  let changed = false;
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(key in settings)) {
      settings[key] = value;
      changed = true;
    }
  }
  if (changed) {
    await utils.writeJson('settings.json', settings);
  }
}

// Context of the program //
class Context {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> '
    });

    this.CONCURRENCY = settings.concurrency;

    this.TILE_CACHE        = new LRUCache({max: settings.tile_cache,});
    this.CHUNK_IMAGE_CACHE = new LRUCache({max: settings.chunk_image_cache});

    this.CACHE_CONTROL = settings.cache_control;
    this.CACHE_CONTROL_LIFETIME = settings.cache_control_lifetime;

    this.DOWNLOAD_COOLDOWN = settings.download_cooldown;
    this.DOWNLOAD_LIMIT    = settings.download_limit;

    this.SNAPSHOT_PATH = settings.current_snapshot + '/' + settings.current_date;
    this.SNAPSHOT_NAME = settings.current_snapshot;
    this.AREA = [];
  }  

  ask(query) {
    return new Promise(resolve => this.rl.question(query, resolve));
  }

  clearCache() {
    this.TILE_CACHE.clear();
    this.CHUNK_IMAGE_CACHE.clear();
  }

  async changeSnapshot(name, date) {
    this.clearCache();

    this.SNAPSHOT_PATH = name + '/' + date;
    this.SNAPSHOT_NAME = name;

    settings = await utils.readJson('settings.json');

    settings.current_snapshot = name;
    settings.current_date = date;
    
    await utils.writeJson("settings.json", settings);
  }
}

const TILE_SIZE  = 1000;
const CHUNK_SIZE = 1000;
const NATIVE_ZOOM = 12;

const context = new Context();
const app = express();

if(context.SNAPSHOT_NAME) console.log(`Current snapshot is ${settings.current_snapshot}[${utils.pathToFormatted(settings.current_date)}]`)

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

app.get("/settings.json", async (req, res) => {
  try {
    const data = await fs.readFile("settings.json", "utf8");
    res.setHeader("Content-Type", "application/json");
    res.send(data);
  } catch (err) {
    res.status(500).send({ error: "Failed to load settings.json" });
  }
});

const renderQueue = new PQueue({concurrency: context.CONCURRENCY});

app.get('/tiles/:z/:x/:y.png', async (req, res) => {
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  const cacheKey = `${z}_${x}_${y}`;

  const cached = context.TILE_CACHE.get(cacheKey);
  if (cached) {
    res.setHeader('Content-Type', 'image/png');
    if (context.CACHE_CONTROL) res.setHeader('Cache-Control', `public, max-age=${context.CACHE_CONTROL_LIFETIME}`);
    return res.end(cached);
  }


  renderQueue.add(async () => {
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
          const p = path.resolve(`data/snapshots/${context.SNAPSHOT_PATH}/${cx}_${cy}.png`);

          try {
            await fs.access(p);
          } catch {
            continue;
          }

          const chunkKey = `${cx}_${cy}`;
          let img = context.CHUNK_IMAGE_CACHE.get(chunkKey);
          if (!img) {
            try {
              img = await loadImage(p);
              context.CHUNK_IMAGE_CACHE.set(chunkKey, img);
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

    const buf = canvas.toBuffer('image/png');
    context.TILE_CACHE.set(cacheKey, buf);

    if (!res.writableEnded) {
      res.setHeader('Content-Type', 'image/png');
      if (context.CACHE_CONTROL) res.setHeader('Cache-Control', `public, max-age=${context.CACHE_CONTROL_LIFETIME}`);
      res.end(buf);
    }
  }, { priority: z*z });
});

app.post('/points', async (req, res) => {
  const { tileX0, tileY0, tileX1, tileY1 } = req.body;

  context.AREA = normalizeCorners([tileX0, tileY0], [tileX1, tileY1]);

  res.json({ status: "ok", received: req.body });
}) 

app.listen(settings.server_port, () => console.log(`Server on localhost:${settings.server_port}.`));

const commands = {
  load:     cmd.handleLoad,
  snapshot: cmd.handleSnapshot,
  delete:   cmd.handleDelete,
  current:  cmd.handleCurrent,
  memory:   cmd.handleMemory,
  show:     cmd.handleShow,
  limit:    cmd.handleLimit,
  image:    cmd.handleImage
}

function parseInput(line) {
  const allArgs = line.trim().split(/\s+/);

  const params = [];
  const remainingArgs = allArgs.filter(arg => {
    const match = arg.match(/^--(\w+)=(.+)$/);
    if (match) {
      params.push({ key: match[1], value: match[2] });
      return false;
    }
    return true;
  });

  const flags = remainingArgs.filter(arg => arg.startsWith('-'));
  const args  = remainingArgs.filter(arg => !arg.startsWith('-'));
  const command = args[0];

  return { command, args, flags, params };
}

context.rl.prompt();

context.rl.on('line', async (line) => {
  const input = parseInput(line);

  switch (input.command) {
    case 'status':
      console.log('Server is working!');
      break;
    case 'exit':
      console.log('Closing...');
      process.exit(0);
    default:
      if (commands[input.command]) {
        try {
          await commands[input.command](context, input);
        } catch (err) {
          console.error(`Error in command "${input.command}":`, err);
        }
      } else {
        console.log(`Unknown command: ${input.command}`);
      }
  }

  context.rl.prompt();
});