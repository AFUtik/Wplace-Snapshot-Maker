import { LRUCache } from 'lru-cache';

import readline from "readline";
import * as utils from './utils.js'

export const SNAPSHOTS_DIR = "data/snapshots";

const DEFAULT_META: {[key: string]: any} = {
    latest_date: "",
    area: [],
    area_type: 'rectangle',
    limit: 0,
    memory_cache: {}
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

    private pointInPolygon(point: [number, number], vs: number[][]): boolean {
        const [x, y] = point;
        let inside = false;
        for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            const xi = vs[i][0], yi = vs[i][1];
            const xj = vs[j][0], yj = vs[j][1];

            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi + 0.0000001) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    private rectIntersectsPolygon(x: number, y: number, poly: number[][]): boolean {
        const corners: [number, number][] = [
            [x, y],
            [x+1, y],
            [x, y+1],
            [x+1, y+1]
        ];
        return corners.some(c => this.pointInPolygon(c, poly));
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
                    if (this.rectIntersectsPolygon(x, y, this.data)) {
                        queue.push([Math.floor(x), Math.floor(y)]);
                    }
                }
            }
        }

        return queue;
    }
}

export class Snapshot {
    name: string;
    date: string;

    fullPath: string;
    rootPath: string;

    meta: any;
    
    area: Area;
    
    constructor(name: string, date: string = "", area: Area = new Area([[0, 0], [0, 0]])) {
        this.name = name;
        this.date = date;

        this.area = area;
        this.meta = DEFAULT_META;

        this.fullPath = `${SNAPSHOTS_DIR}/${name}/${date}`
        this.rootPath = `${SNAPSHOTS_DIR}/${name}`
    }

    async setDateNow() {
        const now = new Date();

        this.date = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}/${String(now.getHours()).padStart(2, '0')}/${String(now.getMinutes()).padStart(2, '0')}`
        this.fullPath = `data/snapshots/${this.name}/${this.date}`;
    }

    async setDatePath(date: string) {
        this.date = date;
        this.fullPath = `data/snapshots/${this.name}/${date}`;
    }

    async setDate(date: Date) {
        this.date = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}/${String(date.getHours()).padStart(2, '0')}/${String(date.getMinutes()).padStart(2, '0')}`
        this.fullPath = `data/snapshots/${this.name}/${this.date}`;
    }

    async readMeta() {
        return await utils.readJson(`${SNAPSHOTS_DIR}/${this.name}/metadata.json`, {default: DEFAULT_META, createIfAbsent: true})
    }

    async fetchMeta() { 
        if(!await utils.folderExists(this.rootPath)) return;

        const meta = await this.readMeta();

        await this.setDatePath(meta.latest_date);
        this.area = new Area(meta.area, meta.area_type)
    }

    async writeMeta(meta: any) {
        await utils.writeJson(`${SNAPSHOTS_DIR}/${this.name}/metadata.json`, meta)
    }

    async exists(): Promise<boolean> {
        if(!await utils.folderExists(this.fullPath)) return false;
        return true;
    }
}

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

        this.TILE_CACHE = new LRUCache({ max: settings.tile_cache, });
        this.IMAGE_BUFFER_CACHE = new LRUCache({ max: settings.chunk_image_cache });

        this.CACHE_CONTROL = settings.cache_control;
        this.CACHE_CONTROL_LIFETIME = settings.cache_control_lifetime;

        this.DOWNLOAD_COOLDOWN = settings.download_cooldown;
        this.DOWNLOAD_LIMIT = settings.download_limit;

        this.selection = new Area([]);
        this.snapshot = new Snapshot("", "", new Area([]));
        
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
    }
}