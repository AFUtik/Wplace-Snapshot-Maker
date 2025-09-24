import fs from "fs";
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
  if (!fs.existsSync(`data/maps/${name}`)) {
    fs.mkdirSync(`data/maps/${name}`);
  }

  const now = new Date();
  const cur_date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;

  const output = fs.createWriteStream(`data/maps/${name}/${cur_date}.zip`);
  const archive = archiver("zip", { zlib: { level: 5 } });

  archive.on("error", err => { throw err; });
  archive.pipe(output);

  for (let y = tly0; y <= tly1; y++) {
    for (let x = tlx0; x <= tlx1; x++) {
      try {
        const tile_png = await downloadFile(`https://backend.wplace.live/files/s0/tiles/${x}/${y}.png`);
        archive.append(tile_png, { name: `${x}_${y}.png` });
      } catch (e) {
        console.error(`Failed to load ${x}_${y} Tile:`, e.message);
      }
    }
  }

  await archive.finalize();
}

export function deleteRegion(name) {

}

export function deteleRegionByDate(name, date) {

}