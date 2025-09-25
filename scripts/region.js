import fs from 'fs/promises';
import path from "path";
import archiver from "archiver";
import { downloadFile } from "./downloader.js";

class TileSet {
    constructor() {
        this.set = [];
    }

    addTile(tile) {
        this.tiles.push(tile); // добавляем элемент
    }
}

export async function fetchRegion(tlx0, tly0, tlx1, tly1, name) {
  const folderPath = path.resolve(`data/chunks/`);
  await fs.mkdir(folderPath, { recursive: true });

  for (let y = tly0; y >= tly1; y--) {
    for (let x = tlx0; x <= tlx1; x++) {
      try {
        const tile_png = await downloadFile(`https://backend.wplace.live/files/s0/tiles/${x}/${y}.png`);
        const tilePath = path.join(folderPath, `${x}_${y}.png`);
        await fs.writeFile(tilePath, tile_png);
        console.log(`Saved tile: ${tilePath}`);
      } catch (e) {
        console.error(`Failed to load tile ${x}_${y}:`, e.message);
      }
    }
  }

  console.log("All tiles saved successfully!");
}

export function deleteRegion(name) {

}

export function deteleRegionByDate(name, date) {

}