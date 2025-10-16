import Database from "better-sqlite3";

const db = new Database("data/tiles.db");

db.exec(`
        PRAGMA foreign_keys = 1;

        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS history (
            snapshot_id INTEGER NOT NULL,
            created_at  INTEGER NOT NULL,
            size    INTEGER DEFAULT 0,

            PRIMARY KEY (snapshot_id, created_at),
            FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tiles (
            snapshot_id INTEGER NOT NULL,
            hash        INTEGER NOT NULL, 

            baseline    INTEGER NOT NULL,
            created_at  INTEGER NOT NULL,

            size        INTEGER DEFAULT 0,
            changed     INTEGER DEFAULT 0,
            
            FOREIGN KEY (snapshot_id, created_at) REFERENCES history(snapshot_id, created_at) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tiles_snapshot_hash_version
        ON tiles(snapshot_id, hash, created_at DESC);
`);

export class SnapshotEntity {
    id: number;
    name: string;

    constructor(data?: Partial<SnapshotEntity>) {
        this.id = data?.id ?? 0;
        this.name = data?.name ?? "";
    }
}

export class TileEntity {
    snapshot_id: number;
    hash:        number;

    baseline:   number;
    created_at: number;

    size:    number;
    changed: number;
    
    constructor(data?: Partial<TileEntity>) {
        this.snapshot_id = data?.snapshot_id ?? 0;
        this.hash = data?.hash ?? 0;

        this.baseline    = data?.baseline ?? 0;
        this.created_at  = data?.created_at ?? 0;
        
        this.size = data?.size ?? 0;
        this.changed = data?.changed ?? 0;
    }
};

export class HistoryItemEntity {
    snapshot_id: number;
    created_at:  number;
    size:        number;

    constructor(data?: Partial<HistoryItemEntity>) {
        this.snapshot_id = data?.snapshot_id ?? 0;
        this.created_at = data?.created_at ?? 0;
        this.size = data?.size ?? 0;
    }
}

export class TileRepository {
    static get_stmt = db.prepare(`
        SELECT * FROM tiles 
        WHERE snapshot_id = ? AND created_at <= ? AND hash = ?   
        ORDER BY created_at DESC 
        LIMIT 1;
    `);

    static get_latest_stmt = db.prepare(`
        SELECT * FROM tiles 
        WHERE snapshot_id = ? AND hash = ? 
        ORDER BY created_at DESC 
        LIMIT 1;
    `)

    static insert_stmt = db.prepare(`
        INSERT INTO tiles (snapshot_id, hash, baseline, created_at, size, changed) VALUES (?, ?, ?, ?, ?, ?);
    `);

    static get(id: number, created_at: number, hash: number) {
        const row = this.get_stmt.get(id, created_at, hash);
        return row ? new TileEntity(row) : null;
    }

    static getLatest(id: number, hash: number) {
        const row = this.get_latest_stmt.get(id, hash);
        return row ? new TileEntity(row) : null;
    }

    static save(entity: TileEntity): void {
        this.insert_stmt.run(entity.snapshot_id, entity.hash, entity.baseline, entity.created_at, entity.size, entity.changed);
    }
}

export class SnapshotRepository {
    static insert_stmt = db.prepare("INSERT INTO snapshots (name) VALUES (?);");
    static delete_stmt = db.prepare("DELETE FROM snapshots WHERE id = ?;")

    static get_stmt = db.prepare("SELECT * FROM snapshots WHERE id = ?;")
    static get_by_name_stmt = db.prepare("SELECT * FROM snapshots WHERE name = ?;")

    static get_snapshots = db.prepare("SELECT * FROM snapshots;")

    static save(name: string) {
        const info = this.insert_stmt.run(name);
        console.log(info.lastInsertRowid);
        return info.lastInsertRowid;
    }

    static delete(id: number) {
        this.delete_stmt.run(id);
    }

    static getById(id: number) {
        const row = this.get_stmt.get(id)
        return row ? new SnapshotEntity(row) : null;
    }

    static getByName(name: string) {
        const row = this.get_by_name_stmt.get(name)
        return row ? new SnapshotEntity(row) : null;
    }

    static getAll() {
        return this.get_snapshots.all();
    }
}


export class HistoryRepository {
    static insert_stmt = db.prepare("INSERT INTO history (snapshot_id, created_at, size) VALUES (?, ?, ?);");
    static delete_stmt = db.prepare("DELETE FROM history WHERE snapshot_id = ? AND created_at = ?;")

    static get_stmt = db.prepare("SELECT * FROM history WHERE snapshot_id = ? ORDER BY created_at DESC LIMIT 1;")
    static get_by_date_stmt = db.prepare("SELECT * FROM history WHERE snapshot_id = ? AND created_at = ? LIMIT 1;")

    static get_dates = db.prepare("SELECT * FROM history WHERE snapshot_id = ? ORDER BY created_at DESC;")

    static count_memory_stmt  = db.prepare("SELECT SUM(size) AS total_size FROM history WHERE snapshot_id=?;")
    static update_memory_stmt = db.prepare("UPDATE history SET size = ? WHERE snapshot_id = ? AND created_at = ?;")
    
    static save(entity: HistoryItemEntity) {
        this.insert_stmt.run(entity.snapshot_id, entity.created_at, entity.size);
    }

    static delete(id: number, date: number) {
        this.delete_stmt.run(id, date);
    }

    static getByDate(id: number, date: number) {
        const row = this.get_by_date_stmt.get(id, date)
        return row ? new HistoryItemEntity(row) : null;
    }

    static getLatest(id: number) {
        const row = this.get_stmt.get(id)
        return row ? new HistoryItemEntity(row) : null;
    }

    static getDates(id: number): {
        snapshot_id: number,
        created_at: number, // unix time
        size: number
    }[] {
        return this.get_dates.all(id);
    }

    static countMemory(id: number): number {
        return this.count_memory_stmt.get(id).total_size;
    }

    static updateMemory(id: number, date: number, size: number) {
        this.update_memory_stmt.run(size, id, date);
    }
}