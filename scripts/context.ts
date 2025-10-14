import { LRUCache } from 'lru-cache';

import fs from "fs/promises"
import path from "path"
import readline from "readline";
import * as utils from './utils.js'
import { performance } from 'perf_hooks';

import { SnapshotRepository, SnapshotEntity, TileRepository, TileEntity, HistoryRepository, HistoryItemEntity } from './sqlite.ts';
import { readDPNG, DPNGFile } from './dpng.js';
import sharp from "sharp";

export const SNAPSHOTS_DIR = "data/snapshots";

const DEFAULT_META: {[key: string]: any} = {
    area: [],
    area_type: 'rectangle',
};

export class Area {
    data: number[][];
    type: string;

    width:  number;
    height: number;

    constructor(data: number[][], type: string = "rectangle") {
        this.data = data;
        this.type = type;

        if(type=="rectangle" && data.length > 0) {
            this.width  = Math.abs(data[0][0] - data[1][0]) + 1;
            this.height = Math.abs(data[0][1] - data[1][1]) + 1;
        } else if(type=="polygon") {
            const xs = data.map(p => p[0]);
            const ys = data.map(p => p[1]);

            const minx = Math.min(...xs);
            const maxx = Math.max(...xs);
            const miny = Math.min(...ys);
            const maxy = Math.max(...ys);

            this.width  = maxx - minx;
            this.height = maxy - miny;
        } else {
            this.width  = 0;
            this.height = 0;
        }
    }

    empty() {
        return this.data.length == 0;
    }

    center() {
        let x = 0;
        let y = 0;
        if(this.type == 'rectangle') {
            x = (this.data[0][0] + this.data[1][0]) / 2;
            y = (this.data[0][1] + this.data[1][1]) / 2;
        } else if (this.type == 'polygon') {
            const xs = this.data.map(p => p[0]);
            const ys = this.data.map(p => p[1]);

            const minx = Math.min(...xs);
            const maxx = Math.max(...xs);
            const miny = Math.min(...ys);
            const maxy = Math.max(...ys);

            x = (minx + maxx) / 2;
            y = (miny + maxy) / 2;
        }
        return {x, y};
    }

    private pointInPolygon(x: number, y: number): boolean {
        let inside = false;
        for (let i = 0, j = this.data.length - 1; i < this.data.length; j = i++) {
            const xi = this.data[i][0], yi = this.data[i][1];
            const xj = this.data[j][0], yj = this.data[j][1];

            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi + 0.0000001) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }
    
    private rectIntersectsPolygon(x: number, y: number): boolean {
        const corners: [number, number][] = [
            [x, y],
            [x+1, y],
            [x, y+1],
            [x+1, y+1]
        ];
        return corners.some(c => this.pointInPolygon(c[0], c[1]));
    }
    
    contains(x: number, y: number): boolean {
        if (this.empty()) return false;

        if (this.type === "rectangle") {
            const [x0, y0] = this.data[0];
            const [x1, y1] = this.data[1];
            const minX = Math.min(x0, x1);
            const maxX = Math.max(x0, x1);
            const minY = Math.min(y0, y1);
            const maxY = Math.max(y0, y1);

            return x >= minX && x <= maxX && y >= minY && y <= maxY;
        }

        if (this.type === "polygon") {
            return this.pointInPolygon(x, y);
        }

        return false;
    }


    async getXY(): Promise<number[][]> {
        let queue = [];

        if(this.type == "rectangle") {
            const [x0, y0] = this.data[0] as [number, number];
            const [x1, y1] = this.data[1] as [number, number];
            for (let y = y0; y >= y1; y--) {
                for (let x = x0; x <= x1; x++) {
                    queue.push([x, y]);
                }
            }
        } else if(this.type == "polygon") {
            const xs = this.data.map(p => p[0]);
            const ys = this.data.map(p => p[1]);

            const minx = Math.min(...xs);
            const maxx = Math.max(...xs);
            const miny = Math.min(...ys);
            const maxy = Math.max(...ys);

            for (let y = Math.floor(miny); y <= Math.ceil(maxy); y++) {
                for (let x = Math.floor(minx); x <= Math.ceil(maxx); x++) {
                    if (this.rectIntersectsPolygon(x, y)) {
                        queue.push([Math.floor(x), Math.floor(y)]);
                    }
                }
            }
        }

        return queue;
    }
}

export class Snapshot {
    id: number = 1;
    version: number = 1;

    name: string;
    date: string;
    size: number = 0;

    path: string;
    area: Area;

    constructor(name: string, date: string = "", area: Area = new Area([[0, 0], [0, 0]])) {
        this.name = name;
        if(date) {
            this.date = date;
        } else {
            const now = new Date();
            this.date = `${now.getFullYear()}_${now.getMonth() + 1}_${now.getDate()}_${String(now.getHours()).padStart(2, '0')}_${String(now.getMinutes()).padStart(2, '0')}_${String(now.getSeconds()).padStart(2, '0')}`;
        }

        this.area = area;
        this.path = `${SNAPSHOTS_DIR}/${name}`;
    }

    async loadTile(x: number, y: number): Promise<Buffer | null> {
        const tile: TileEntity | null = TileRepository.get(this.id, this.version, utils.hash_xy(x, y));
        if(!tile) return null;

        const path_to_png  = `${this.path}/${tile.baseline}/${x}_${y}.png`;
        if(tile.baseline != tile.version) {
            const path_to_dpng = `${this.path}/${tile.version}/${x}_${y}.dpng`;
            
            const dpng: DPNGFile = await readDPNG(path_to_dpng);
            const org:  Buffer   = await fs.readFile(path_to_png);

            return await dpng.apply(org);
        } else {
            return await fs.readFile(path_to_png)
        }
    }

    // Reads area info from metadata.json //
    async readArea(): Promise<Area> { 
        if(!await utils.folderExists(this.path)) return new Area([]);

        const meta = await utils.readJson(`${this.path}/metadata.json`, {default: DEFAULT_META, createIfAbsent: true});

        return new Area(meta.area, meta.area_type)
    }

    async writeArea(wr_area: Area): Promise<void> {
        await utils.writeJson(`${this.path}/metadata.json`, {area: wr_area.data, area_type: wr_area.type});
    }

    // Checks a snapshot on disk //
    async exists(): Promise<boolean> {
        if(!await utils.folderExists(this.path)) return false;
        return true;
    }
}

export class SnapshotService {
    static findSnapshotLatest(name: string): Snapshot | null {
        const entity = SnapshotRepository.getByName(name);
        if(!entity) return null;

        const historyItem = HistoryRepository.getLatest(entity.id);
        if(!historyItem) return null;

        const snapshot = new Snapshot(name, historyItem.created_at);
        snapshot.id = entity.id;
        snapshot.version = historyItem.version;

        return snapshot;
    }

    static findSnapshot(name: string, date: string) {
        const entity = SnapshotRepository.getByName(name);
        if(!entity) return null;

        const historyItem = HistoryRepository.getByDate(entity.id, date);
        if(!historyItem) return null;

        const snapshot = new Snapshot(name, historyItem.created_at);
        snapshot.version = historyItem.version;

        return snapshot;
    }

    static createSnapshot(snapshot: Snapshot) {
        let entity: SnapshotEntity | null = SnapshotRepository.getByName(snapshot.name);
        if(!entity) {
            const newid: number = SnapshotRepository.save(snapshot.name);
            entity = new SnapshotEntity({id: newid});
        }

        let latest = HistoryRepository.getLatest(entity.id);
        if(!latest) {
            latest = new HistoryItemEntity({version: 0})
        }
        
        const historyItem = new HistoryItemEntity();
        historyItem.snapshot_id = entity.id;
        historyItem.version = latest.version + 1;
        historyItem.size = 0;
        historyItem.created_at = snapshot.date;

        snapshot.id = entity.id;
        snapshot.version = historyItem.version;

        HistoryRepository.save(historyItem);
    }
};

/*
export class TileService { 
    static getTile(id: number, version: number, x: number, y: number) {

    }
}*/

export class Context {
    rl: readline.Interface;
    intervals: {[key: string]: NodeJS.Timeout};

    CONCURRENCY: number;
    TILE_CACHE:         LRUCache<string, Buffer>;
    IMAGE_BUFFER_CACHE: LRUCache<string, Buffer>;
    CACHE_CONTROL: boolean;
    CACHE_CONTROL_LIFETIME: number;
    DOWNLOAD_COOLDOWN:      number;
    DOWNLOAD_LIMIT:         number;

    BASELINE_THRESHOLD_MEMORY: number;
    USE_VERSION_SYSTEM: boolean;

    snapshot: Snapshot;
    
    selection: Area;

    constructor(settings: {[key: string]: any}) {
        this.rl = readline.createInterface({
            input:  process.stdin,
            output: process.stdout,
            prompt: '> '
        });

        this.intervals = {};
        this.CONCURRENCY = settings.concurrency;

        this.TILE_CACHE = new LRUCache(
            { 
                maxSize: settings.tile_cache_memory, 
                sizeCalculation: (image: Buffer) => image.byteLength
            }
        );

        this.IMAGE_BUFFER_CACHE = new LRUCache(
             { 
                maxSize: settings.image_cache_memory, 
                sizeCalculation: (image: Buffer) => image.byteLength
            }
        );

        this.CACHE_CONTROL = settings.cache_control;
        this.CACHE_CONTROL_LIFETIME = settings.cache_control_lifetime;

        this.DOWNLOAD_COOLDOWN = settings.download_cooldown;
        this.DOWNLOAD_LIMIT = settings.download_limit;

        this.selection = new Area([]);
        this.snapshot = new Snapshot("", "", new Area([]));

        this.BASELINE_THRESHOLD_MEMORY = settings.baseline_threshold_memory;
        this.USE_VERSION_SYSTEM = settings.use_version_system;
    }

    ask(query: string): Promise<string> {
        return new Promise(resolve => this.rl.question(query, resolve));
    }

    clearCache() {
        this.TILE_CACHE.clear();
        this.IMAGE_BUFFER_CACHE.clear();
    }

    async changeSnapshot(snapshot: Snapshot) {
        this.clearCache();

        this.snapshot = snapshot;
        this.snapshot.area = await this.snapshot.readArea();
    }
}