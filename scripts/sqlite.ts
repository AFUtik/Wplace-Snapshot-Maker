import Database from "better-sqlite3";

const db = new Database("data/tiles.db");

db.exec(`
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            size INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
            delta_from INTEGER DEFAULT NULL,
            changed INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS tiles (

        );

        CREATE INDEX IF NOT EXISTS idx_snapshots_name ON snapshots(name);
        CREATE INDEX IF NOT EXISTS idx_snapshots_name_created_at ON snapshots(name, created_at DESC);
`);


db.exec(`
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
        );

        CREATE TABLE IF NOT EXISTS tiles (
            snapshot_id   INTEGER NOT NULL,
            x             INTEGER NOT NULL,
            y             INTEGER NOT NULL,
            size          INTEGER DEFAULT 0,
            
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            origin_path TEXT NULL,
            path        TEXT NOT NULL,

            changed INTEGER DEFAULT 0,     
            
            FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tiles_latest 
        ON tiles(snapshot_id, x, y, created_at DESC);
`);


const create_src_stmt = db.prepare("INSERT INTO snapshots (name, path, size, created_at) VALUES (?, ?, ?, ?);");
const create_delta_stmt = db.prepare("INSERT INTO snapshots (name, path, size, created_at, delta_from, changed) VALUES (?, ?, ?, ?, ?, ?);");
const sel_desc_stmt = db.prepare("SELECT * FROM snapshots ORDER BY created_at DESC;")
const sel_asc_stmt = db.prepare("SELECT * FROM snapshots ORDER BY created_at ASC;")
const get_by_id_stmt = db.prepare("SELECT * FROM snapshots WHERE id = ?;")
const get_latest_by_name_stmt = db.prepare("SELECT * FROM snapshots WHERE name = ? AND delta_from ORDER BY created_at DESC LIMIT 1;")
const get_latest_src_by_name_stmt = db.prepare("SELECT * FROM snapshots WHERE name = ? AND delta_from IS NULL ORDER BY created_at DESC LIMIT 1;")
const get_by_name_date_stmt = db.prepare("SELECT * FROM snapshots WHERE name = ? AND created_at = ?;")
const get_memory_of_each_stmt = db.prepare("SELECT name, size FROM snapshots ORDER BY size DESC;");
const get_dates_by_name_stmt = db.prepare("SELECT created_at FROM snapshots WHERE name = ? ORDER BY created_at DESC;")

export class SnapshotEntity {
    id: number;
    name: string;
    path: string;
    size: number;
    delta_from: number | null;
    changed: number;
    created_at: string;

    constructor(data?: Partial<SnapshotEntity>) {
        this.id = data?.id ?? 0;
        this.name = data?.name ?? "";
        this.path = data?.path ?? "";
        this.size = data?.size ?? 0;
        this.delta_from = data?.delta_from ?? null;
        this.changed = data?.changed ?? 0;
        this.created_at = data?.created_at ?? "";
    }
}

function mapRowToSnapshot(row: any): SnapshotEntity {
    return new SnapshotEntity({
        id: row.id,
        name: row.name,
        path: row.path,
        size: row.size,
        delta_from: row.delta_from,
        changed: row.changed,
        created_at: row.created_at
    });
}

export class SnapshotRepository {
    static createSourceSnapshot(snapshot: SnapshotEntity) {
        create_src_stmt.run(
            snapshot.name, 
            snapshot.path,
            snapshot.size,
            snapshot.created_at);
    }

    static createDeltaSnapshot(snapshot: SnapshotEntity) {
        create_delta_stmt.run(
            snapshot.name, 
            snapshot.path,
            snapshot.size,
            snapshot.created_at,
            snapshot.delta_from,
            snapshot.changed);
    }

    static getById(id: number) {
        return mapRowToSnapshot(get_by_id_stmt.get(id));
    }

    static getLatestSnapshot(name: string): SnapshotEntity | null {
        const row = get_latest_by_name_stmt.get(name);
        return row ? mapRowToSnapshot(row) : null;
    }

    static getLatestSourceSnapshot(name: string): SnapshotEntity | null {
        const row = get_latest_src_by_name_stmt.get(name);
        return row ? mapRowToSnapshot(row) : null;
    }

    static getSnapshot(name: string, date: Date): SnapshotEntity {
        return mapRowToSnapshot(get_by_name_date_stmt.get(name, date));
    }

    static getDatesByName(name: string): any {
        return get_dates_by_name_stmt.all(name);
    }

    static getMemoryOfEach(): any {
        return get_memory_of_each_stmt.all();
    }
}