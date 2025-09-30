import { LRUCache } from 'lru-cache';

import readline from 'readline';
import * as utils from './utils.js'

export const SNAPSHOTS_DIR = "data/snapshots";

const DEFAULT_META: {[key: string]: any} = {
    latest_date: "",
    boundaries: [],
    limit: 0,
    memory_cache: {}
};

export class Snapshot {
    name: string;
    date: string;
    boundaries: number[][];

    fullPath: string;
    rootPath: string;

    meta: any;
    
    constructor(name: string, date: string = "", boundaries = []) {
        this.name = name;
        this.date = date;
        this.boundaries = boundaries;

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
        const meta = await this.readMeta();

        await this.setDatePath(meta.latest_date);
        this.boundaries = meta.boundaries;
    }

    async writeMeta(meta: any) {
        await utils.writeJson(`${SNAPSHOTS_DIR}/${this.name}/metadata.json`, meta)
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
    SNAPSHOT_PATH: string;
    SNAPSHOT_NAME: string;
    AREA: number[][];

    constructor(settings: {[key: string]: any}) {
        this.rl = readline.createInterface({
            input: process.stdin,
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

        this.SNAPSHOT_PATH = 'data/snapshots/' + settings.current_snapshot + '/' + settings.current_date;
        this.SNAPSHOT_NAME = settings.current_snapshot;

        this.AREA = settings.selection;
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

        this.SNAPSHOT_PATH = snapshot.fullPath;
        this.SNAPSHOT_NAME = snapshot.name;
        this.AREA = snapshot.boundaries;

        const settings: {[key: string]: any} = await utils.readJson('settings.json');

        settings.current_snapshot = snapshot.name;
        settings.current_date     = snapshot.date;
        settings.selection        = snapshot.boundaries;

        await utils.writeJson("settings.json", settings);
    }
}