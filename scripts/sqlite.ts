import Database from "better-sqlite3";

const db = new Database("data/tiles.db");

db.exec(`
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS snapshots_history (
            snapshot_id INTEGER NOT NULL,
            version INTEGER NOT NULL,
            size    INTEGER DEFAULT 0,
            
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            PRIMARY KEY (snapshot_id, version),
            FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tiles (
            snapshot_id INTEGER NOT NULL,
            hash        INTEGER NOT NULL, 

            baseline    INTEGER DEFAULT 0,
            version     INTEGER DEFAULT 0,

            size        INTEGER DEFAULT 0,
            changed     INTEGER DEFAULT 0,
            
            FOREIGN KEY (snapshot_id, version) REFERENCES snapshots_history(snapshot_id, version) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tiles_snapshot_hash_version
        ON tiles(snapshot_id, hash, version DESC);
`);

export class SnapshotEntity {
    id: number;
    name: string;

    constructor(data?: Partial<SnapshotEntity>) {
        this.id = data?.id ?? 0;
        this.name = data?.name ?? "";
    }
}

export class HistoryItemEntity {
    snapshot_id: number;
    version:     number;
    size:        number;

    created_at:  string;

    constructor(data?: Partial<HistoryItemEntity>) {
        this.snapshot_id = data?.snapshot_id ?? 0;
        this.version = data?.version ?? 0;
        this.size = data?.size ?? 0;
        
        this.created_at = data?.created_at ?? "";
    }
}

export class TileEntity {
    snapshot_id: number;
    hash:        number;

    baseline:    number;
    version:     number;

    size:    number;
    changed: number;
    
    constructor(data?: Partial<TileEntity>) {
        this.snapshot_id = data?.snapshot_id ?? 0;
        this.hash = data?.hash ?? 0;

        this.baseline = data?.baseline ?? 0;
        this.version  = data?.version ?? 0;
        
        this.size = data?.size ?? 0;
        this.changed = data?.changed ?? 0;
    }
};

export class TileRepository {
    static get_stmt = db.prepare(`
        SELECT * FROM tiles 
        WHERE snapshot_id = ? AND version <= ? AND hash = ? 
        ORDER BY version DESC 
        LIMIT 1;
    `);

    static get_latest_stmt = db.prepare(`
        SELECT * FROM tiles 
        WHERE snapshot_id = ? AND hash = ? 
        ORDER BY version DESC 
        LIMIT 1;
    `)

    static insert_stmt = db.prepare(`
        INSERT INTO tiles (snapshot_id, hash, baseline, version, size, changed) VALUES (?, ?, ?, ?, ?, ?);
    `);

    static get(id: number, version: number, hash: number) {
        const row = this.get_stmt.get(id, version, hash);
        return row ? new TileEntity(row) : null;
    }

    static getLatest(id: number, hash: number) {
        const row = this.get_latest_stmt.get(id, hash);
        return row ? new TileEntity(row) : null;
    }

    static save(entity: TileEntity): void {
        this.insert_stmt.run(entity.snapshot_id, entity.hash, entity.baseline, entity.version, entity.size, entity.changed);
    }
}

export class SnapshotRepository {
    static insert_stmt = db.prepare("INSERT INTO snapshots (name) VALUES (?);");
    static delete_stmt = db.prepare("DELETE FROM snapshots WHERE id = ?;")

    static get_stmt = db.prepare("SELECT * FROM snapshots WHERE id = ?;")
    static get_by_name_stmt = db.prepare("SELECT * FROM snapshots WHERE name = ?;")

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
}

export class HistoryRepository {
    static insert_stmt = db.prepare("INSERT INTO snapshots_history (snapshot_id, version, size, created_at) VALUES (?, ?, ?, ?);");
    static get_stmt = db.prepare("SELECT * FROM snapshots_history WHERE snapshot_id = ? ORDER BY created_at DESC LIMIT 1;")
    static get_by_date_stmt = db.prepare("SELECT * FROM snapshots_history WHERE snapshot_id = ? AND created_at = ? LIMIT 1;")
    
    static save(entity: HistoryItemEntity) {
        this.insert_stmt.run(entity.snapshot_id, entity.version, entity.size, entity.created_at);
    }

    static getByDate(id: number, date: string) {
        const row = this.get_by_date_stmt.get(id, date)
        return row ? new HistoryItemEntity(row) : null;
    }

    static getLatest(id: number) {
        const row = this.get_stmt.get(id)
        return row ? new HistoryItemEntity(row) : null;
    }
}