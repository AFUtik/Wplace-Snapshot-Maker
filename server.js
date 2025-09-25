import express from 'express';
import fs from 'fs/promises';
import { createCanvas, loadImage } from 'canvas';
import path from 'path';
import { LRUCache } from 'lru-cache';

import readline from 'readline';

// project imports
import { fetchRegion } from './scripts/region.js';


const app = express();

const TILE_SIZE  = 1000;
const CHUNK_SIZE = 1000;
const NATIVE_ZOOM = 12;

const TILE_CACHE = new LRUCache({
  max: 500,
});
const CHUNK_IMAGE_CACHE = new LRUCache({
  max: 200
});

function chunkPath(cx, cy) {
  return path.resolve(`data/chunks/${cx}_${cy}.png`);
}

function tileToPixel(z, x, y) {
  const scale = Math.pow(2, NATIVE_ZOOM - z);
  const px = Math.round(x * TILE_SIZE * scale);
  const py = Math.round(y * TILE_SIZE * scale);
  return { px, py, scale };
}

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

app.listen(3000, () => console.log('Tile server on :3000'));

// input and out //

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> '
});

rl.prompt();

rl.on('line', (line) => {
  const args = line.trim().split(/\s+/); // разбиваем по пробелам
  const command = args[0];

  switch (command) {
    case 'status':
      console.log('Server is working!');
      break;
    case 'exit':
      console.log('Closing...');
      process.exit(0);
      break;
    case 'snapshot':
      if (args.length < 6) {
        console.log('Usage: fetch <tile x0> <tile y0> <tile x1> <tile y1> <name>');
        break;
      }

      const [ , x0, y0, x1, y1, name ] = args;
      fetchRegion(Number(x0), Number(y0), Number(x1), Number(y1), name);
      break;
    case 'update':
      break;
    case 'schedule':
      break;
    case 'load':
      break;
    case 'delete':
      break;
    default:
      console.log(`Unknown Command: ${command}`);
  }

  rl.prompt();
});