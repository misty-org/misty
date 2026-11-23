use std::{
    path::Path,
    sync::{Mutex, MutexGuard},
    time::Duration,
};

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::model::{Base, Item, ItemId, Kind, Seq, SpaceId, Version};
use crate::names;
use crate::DriveError;

const MIGRATIONS: &[&str] = &[
    "CREATE TABLE items (
        space TEXT NOT NULL,
        id TEXT NOT NULL,
        parent TEXT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        sha256 TEXT,
        size INTEGER NOT NULL DEFAULT 0,
        mtime_ms INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        modified_by TEXT NOT NULL DEFAULT '',
        modified_by_name TEXT NOT NULL DEFAULT '',
        modified_at TEXT NOT NULL DEFAULT '',
        trashed INTEGER NOT NULL DEFAULT 0,
        trashed_at TEXT,
        trashed_by TEXT,
        trash_hold INTEGER NOT NULL DEFAULT 0,
        deleted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (space, id)
     );
     CREATE INDEX items_seq ON items(space, seq);
     CREATE TABLE base (
        space TEXT NOT NULL,
        id TEXT NOT NULL,
        version INTEGER NOT NULL,
        sha256 TEXT,
        size INTEGER NOT NULL DEFAULT 0,
        mtime_ms INTEGER NOT NULL DEFAULT 0,
        parent TEXT,
        name TEXT NOT NULL,
        PRIMARY KEY (space, id)
     );
     CREATE TABLE nodes (
        ino INTEGER PRIMARY KEY AUTOINCREMENT,
        space TEXT NOT NULL,
        id TEXT NOT NULL,
        parent TEXT,
        name TEXT NOT NULL,
        server_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        sha256 TEXT,
        size INTEGER NOT NULL DEFAULT 0,
        mtime_ms INTEGER NOT NULL DEFAULT 0,
        path TEXT NOT NULL,
        created INTEGER NOT NULL DEFAULT 0,
        dirty_content INTEGER NOT NULL DEFAULT 0,
        dirty_place INTEGER NOT NULL DEFAULT 0,
        trash_pending INTEGER NOT NULL DEFAULT 0,
        trash_held INTEGER NOT NULL DEFAULT 0,
        trash_agent TEXT,
        trash_chat TEXT,
        not_synced INTEGER NOT NULL DEFAULT 0,
        downloaded INTEGER NOT NULL DEFAULT 0,
        conflict INTEGER NOT NULL DEFAULT 0,
        last_used_ms INTEGER NOT NULL DEFAULT 0,
        UNIQUE (space, id)
     );
     CREATE INDEX nodes_path ON nodes(space, path);
     CREATE INDEX nodes_parent ON nodes(space, parent);
     CREATE TABLE cursor (
        space TEXT PRIMARY KEY,
        seq INTEGER NOT NULL DEFAULT 0
     );
     CREATE TABLE transfers (
        space TEXT NOT NULL,
        id TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size INTEGER NOT NULL,
        upload_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        part_size INTEGER NOT NULL DEFAULT 0,
        parts TEXT NOT NULL DEFAULT '[]',
        done TEXT NOT NULL DEFAULT '[]',
        started_ms INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        PRIMARY KEY (space, id)
     );
     CREATE TABLE pins (
        space TEXT NOT NULL,
        item_id TEXT NOT NULL,
        PRIMARY KEY (space, item_id)
     );
     CREATE TABLE blobs (
        sha256 TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        last_used_ms INTEGER NOT NULL
     );",
    "ALTER TABLE nodes ADD COLUMN local_seq INTEGER NOT NULL DEFAULT 0;
     CREATE INDEX nodes_local_seq ON nodes(space, local_seq);
     CREATE TABLE local_cursor (
        space TEXT PRIMARY KEY,
        seq INTEGER NOT NULL DEFAULT 0
     );",
    "ALTER TABLE items ADD COLUMN replaced_of TEXT;
     ALTER TABLE nodes ADD COLUMN content_base INTEGER;
     ALTER TABLE nodes DROP COLUMN conflict;",
    "CREATE TABLE space_folders (
        space TEXT PRIMARY KEY,
        folder TEXT NOT NULL
     );
     CREATE TABLE anchors (
        token INTEGER PRIMARY KEY AUTOINCREMENT,
        spaces TEXT NOT NULL
     );
     CREATE INDEX nodes_by_id ON nodes(id);
     CREATE INDEX items_by_id ON items(id);",
];

const KEPT_ANCHORS: i64 = 64;

const SUBTREE: &str =
    "space = ?1 AND (?2 = '/' OR path = ?2 OR (path > ?2 || '/' AND path < ?2 || '0'))";

const NODE_COLUMNS: &str = "ino, space, id, parent, name, server_name, kind, sha256, size, \
     mtime_ms, path, created, dirty_content, dirty_place, trash_pending, trash_held, trash_agent, \
     trash_chat, not_synced, downloaded, content_base, last_used_ms";

const ITEM_COLUMNS: &str = "space, id, parent, name, kind, sha256, size, mtime_ms, version, seq, \
     modified_by, modified_by_name, modified_at, trashed, trashed_at, trashed_by, trash_hold, \
     deleted, replaced_of";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NodeRow {
    pub ino: i64,
    pub space: SpaceId,
    pub id: ItemId,
    pub parent: Option<ItemId>,
    pub name: String,
    pub server_name: String,
    pub kind: Kind,
    pub sha256: Option<String>,
    pub size: u64,
    pub mtime_ms: i64,
    pub path: String,
    pub created: bool,
    pub dirty_content: bool,
    pub dirty_place: bool,
    pub trash_pending: bool,
    pub trash_held: bool,
    pub trash_agent: Option<String>,
    pub trash_chat: Option<String>,
    pub not_synced: bool,
    pub downloaded: bool,
    pub content_base: Option<Version>,
    pub last_used_ms: i64,
}

impl NodeRow {
    pub fn dirty(&self) -> bool {
        !self.not_synced
            && (self.created || self.dirty_content || self.dirty_place || self.trash_pending)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransferRow {
    pub space: SpaceId,
    pub id: ItemId,
    pub sha256: String,
    pub size: u64,
    pub upload_id: String,
    pub mode: String,
    pub part_size: u64,
    pub parts: String,
    pub done: String,
    pub started_ms: i64,
    pub attempts: i64,
    pub last_error: Option<String>,
}

pub struct Store {
    connection: Mutex<Connection>,
}

fn db(error: rusqlite::Error) -> DriveError {
    DriveError::Store(error.to_string())
}

fn kind_of(text: String) -> Kind {
    Kind::parse(&text)
}

fn node_from(row: &Row<'_>) -> rusqlite::Result<NodeRow> {
    Ok(NodeRow {
        ino: row.get(0)?,
        space: SpaceId(row.get(1)?),
        id: ItemId(row.get(2)?),
        parent: row.get::<_, Option<String>>(3)?.map(ItemId),
        name: row.get(4)?,
        server_name: row.get(5)?,
        kind: kind_of(row.get(6)?),
        sha256: row.get(7)?,
        size: row.get::<_, i64>(8)?.max(0) as u64,
        mtime_ms: row.get(9)?,
        path: row.get(10)?,
        created: row.get(11)?,
        dirty_content: row.get(12)?,
        dirty_place: row.get(13)?,
        trash_pending: row.get(14)?,
        trash_held: row.get(15)?,
        trash_agent: row.get(16)?,
        trash_chat: row.get(17)?,
        not_synced: row.get(18)?,
        downloaded: row.get(19)?,
        content_base: row.get::<_, Option<i64>>(20)?.map(Version),
        last_used_ms: row.get(21)?,
    })
}

fn item_from(row: &Row<'_>) -> rusqlite::Result<Item> {
    Ok(Item {
        space_id: SpaceId(row.get(0)?),
        id: ItemId(row.get(1)?),
        parent_id: row.get::<_, Option<String>>(2)?.map(ItemId),
        name: row.get(3)?,
        kind: kind_of(row.get(4)?),
        sha256: row.get(5)?,
        size: row.get::<_, i64>(6)?.max(0) as u64,
        mtime_ms: row.get(7)?,
        version: Version(row.get(8)?),
        seq: Seq(row.get(9)?),
        modified_by: row.get(10)?,
        modified_by_name: row.get(11)?,
        modified_at: row.get(12)?,
        trashed: row.get(13)?,
        trashed_at: row.get(14)?,
        trashed_by: row.get(15)?,
        trash_hold: row.get(16)?,
        deleted: row.get(17)?,
        replaced_of: row.get::<_, Option<String>>(18)?.map(ItemId),
    })
}

fn base_from(row: &Row<'_>) -> rusqlite::Result<Base> {
    Ok(Base {
        id: ItemId(row.get(0)?),
        version: Version(row.get(1)?),
        sha256: row.get(2)?,
        size: row.get::<_, i64>(3)?.max(0) as u64,
        mtime_ms: row.get(4)?,
        parent: row.get::<_, Option<String>>(5)?.map(ItemId),
        name: row.get(6)?,
    })
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, DriveError> {
        if let Some(parent) = path.parent() {
            file_access::fs::create_dir_all(parent).map_err(DriveError::io)?;
        }
        let connection = file_access::fs::open_sqlite(path).map_err(db)?;
        Self::with_connection(connection)
    }

    fn with_connection(connection: Connection) -> Result<Self, DriveError> {
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(db)?;
        connection
            .query_row("PRAGMA journal_mode=WAL", [], |_| Ok(()))
            .map_err(db)?;
        connection
            .execute_batch("PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=OFF;")
            .map_err(db)?;
        let current: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(db)?;
        for (index, migration) in MIGRATIONS.iter().enumerate() {
            let number = index as i64 + 1;
            if number <= current {
                continue;
            }
            connection
                .execute_batch(&format!(
                    "BEGIN; {migration}; PRAGMA user_version = {number}; COMMIT;"
                ))
                .map_err(db)?;
        }
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn lock(&self) -> MutexGuard<'_, Connection> {
        self.connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn transaction<T>(
        &self,
        work: impl FnOnce(&rusqlite::Transaction<'_>) -> Result<T, DriveError>,
    ) -> Result<T, DriveError> {
        let mut connection = self.lock();
        let tx = connection.transaction().map_err(db)?;
        let out = work(&tx)?;
        tx.commit().map_err(db)?;
        Ok(out)
    }

    pub fn put_item(&self, item: &Item) -> Result<(), DriveError> {
        put_item(&self.lock(), item)
    }

    pub fn item(&self, space: &SpaceId, id: &ItemId) -> Result<Option<Item>, DriveError> {
        item(&self.lock(), space, id)
    }

    pub fn items(&self, space: &SpaceId) -> Result<Vec<Item>, DriveError> {
        let connection = self.lock();
        let mut statement = connection
            .prepare(&format!(
                "SELECT {ITEM_COLUMNS} FROM items WHERE space = ?1"
            ))
            .map_err(db)?;
        let rows = statement
            .query_map([space.as_str()], item_from)
            .map_err(db)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db);
        rows
    }

    pub fn items_since(
        &self,
        space: &SpaceId,
        since: Seq,
        limit: usize,
    ) -> Result<Vec<Item>, DriveError> {
        let connection = self.lock();
        let mut statement = connection
            .prepare(&format!(
                "SELECT {ITEM_COLUMNS} FROM items WHERE space = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3"
            ))
            .map_err(db)?;
        let rows = statement
            .query_map(params![space.as_str(), since.0, limit as i64], item_from)
            .map_err(db)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db);
        rows
    }

    pub fn clear_items(&self, space: &SpaceId) -> Result<(), DriveError> {
        self.lock()
            .execute("DELETE FROM items WHERE space = ?1", [space.as_str()])
            .map(|_| ())
            .map_err(db)
    }

    pub fn base(&self, space: &SpaceId, id: &ItemId) -> Result<Option<Base>, DriveError> {
        base(&self.lock(), space, id)
    }

    pub fn bases(&self, space: &SpaceId) -> Result<Vec<Base>, DriveError> {
        let connection = self.lock();
        let mut statement = connection
            .prepare(
                "SELECT id, version, sha256, size, mtime_ms, parent, name FROM base WHERE space = ?1",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([space.as_str()], base_from)
            .map_err(db)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db);
        rows
    }

    pub fn put_base(&self, space: &SpaceId, base: &Base) -> Result<(), DriveError> {
        put_base(&self.lock(), space, base)
    }

    pub fn delete_base(&self, space: &SpaceId, id: &ItemId) -> Result<(), DriveError> {
        self.lock()
            .execute(
                "DELETE FROM base WHERE space = ?1 AND id = ?2",
                params![space.as_str(), id.as_str()],
            )
            .map(|_| ())
            .map_err(db)
    }

    pub fn node(&self, space: &SpaceId, id: &ItemId) -> Result<Option<NodeRow>, DriveError> {
        node(&self.lock(), space, id)
    }

    pub fn node_by_ino(&self, ino: i64) -> Result<Option<NodeRow>, DriveError> {
        self.lock()
            .query_row(
                &format!("SELECT {NODE_COLUMNS} FROM nodes WHERE ino = ?1"),
                [ino],
                node_from,
            )
            .optional()
            .map_err(db)
    }

    pub fn node_at(&self, space: &SpaceId, path: &str) -> Result<Option<NodeRow>, DriveError> {
        self.lock()
            .query_row(
                &format!(
                    "SELECT {NODE_COLUMNS} FROM nodes WHERE space = ?1 AND path = ?2
                     ORDER BY trash_pending ASC LIMIT 1"
                ),
                params![space.as_str(), path],
                node_from,
            )
            .optional()
            .map_err(db)
    }

    pub fn children(
        &self,
        space: &SpaceId,
        parent: Option<&ItemId>,
    ) -> Result<Vec<NodeRow>, DriveError> {
        children(&self.lock(), space, parent)
    }

    pub fn child_named(
        &self,
        space: &SpaceId,
        parent: Option<&ItemId>,
        name: &str,
    ) -> Result<Option<NodeRow>, DriveError> {
        let wanted = names::fold(name);
        Ok(self
            .children(space, parent)?
            .into_iter()
            .find(|child| names::fold(&child.name) == wanted))
    }

    pub fn nodes(&self, space: &SpaceId) -> Result<Vec<NodeRow>, DriveError> {
        let connection = self.lock();
        let mut statement = connection
            .prepare(&format!(
                "SELECT {NODE_COLUMNS} FROM nodes WHERE space = ?1"
            ))
            .map_err(db)?;
        let rows = statement
            .query_map([space.as_str()], node_from)
            .map_err(db)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db);
        rows
    }

    pub fn subtree(&self, space: &SpaceId, path: &str) -> Result<Vec<NodeRow>, DriveError> {
        subtree(&self.lock(), space, path)
    }

    pub fn insert_node(&self, node: &NodeRow) -> Result<NodeRow, DriveError> {
        insert_node(&self.lock(), node)
    }

    pub fn update_node(&self, node: &NodeRow) -> Result<(), DriveError> {
        update_node(&self.lock(), node)
    }

    pub fn move_node(
        &self,
        space: &SpaceId,
        id: &ItemId,
        parent: Option<&ItemId>,
        name: &str,
    ) -> Result<NodeRow, DriveError> {
        self.transaction(|tx| move_node(tx, space, id, parent, name))
    }

    pub fn descendants(&self, space: &SpaceId, id: &ItemId) -> Result<Vec<NodeRow>, DriveError> {
        let connection = self.lock();
        let Some(top) = node(&connection, space, id)? else {
            return Ok(Vec::new());
        };
        let mut out = vec![top];
        let mut index = 0;
        while index < out.len() {
            if out[index].kind == Kind::Folder {
                let below = children(&connection, space, Some(&out[index].id))?;
                out.extend(below);
            }
            index += 1;
        }
        Ok(out)
    }

    pub fn remove_subtree(&self, space: &SpaceId, id: &ItemId) -> Result<Vec<NodeRow>, DriveError> {
        let gone = self.descendants(space, id)?;
        self.transaction(|tx| {
            for node in &gone {
                tx.execute(
                    "DELETE FROM nodes WHERE space = ?1 AND id = ?2",
                    params![space.as_str(), node.id.as_str()],
                )
                .map_err(db)?;
                tx.execute(
                    "DELETE FROM base WHERE space = ?1 AND id = ?2",
                    params![space.as_str(), node.id.as_str()],
                )
                .map_err(db)?;
            }
            Ok(())
        })?;
        Ok(gone)
    }

    pub fn remove_node(&self, space: &SpaceId, id: &ItemId) -> Result<(), DriveError> {
        self.lock()
            .execute(
                "DELETE FROM nodes WHERE space = ?1 AND id = ?2",
                params![space.as_str(), id.as_str()],
            )
            .map(|_| ())
            .map_err(db)
    }

    pub fn rekey(&self, space: &SpaceId, from: &ItemId, to: &ItemId) -> Result<(), DriveError> {
        self.transaction(|tx| {
            tx.execute(
                "UPDATE nodes SET id = ?3 WHERE space = ?1 AND id = ?2",
                params![space.as_str(), from.as_str(), to.as_str()],
            )
            .map_err(db)?;
            tx.execute(
                "UPDATE nodes SET parent = ?3 WHERE space = ?1 AND parent = ?2",
                params![space.as_str(), from.as_str(), to.as_str()],
            )
            .map_err(db)?;
            tx.execute(
                "DELETE FROM base WHERE space = ?1 AND id = ?2",
                params![space.as_str(), from.as_str()],
            )
            .map_err(db)?;
            tx.execute(
                "UPDATE transfers SET id = ?3 WHERE space = ?1 AND id = ?2",
                params![space.as_str(), from.as_str(), to.as_str()],
            )
            .map_err(db)?;
            tx.execute(
                "UPDATE pins SET item_id = ?3 WHERE space = ?1 AND item_id = ?2",
                params![space.as_str(), from.as_str(), to.as_str()],
            )
            .map_err(db)?;
            Ok(())
        })
    }

    pub fn set_space_folder(&self, space: &SpaceId, folder: &str) -> Result<(), DriveError> {
        self.lock()
            .execute(
                "INSERT INTO space_folders (space, folder) VALUES (?1, ?2)
                 ON CONFLICT(space) DO UPDATE SET folder = excluded.folder",
                params![space.as_str(), folder],
            )
            .map(|_| ())
            .map_err(db)
    }

    pub fn space_folders(&self) -> Result<Vec<(SpaceId, String)>, DriveError> {
        let connection = self.lock();
        let mut statement = connection
            .prepare("SELECT space, folder FROM space_folders ORDER BY folder, space")
            .map_err(db)?;
        let rows = statement
            .query_map([], |row| Ok((SpaceId(row.get(0)?), row.get(1)?)))
            .map_err(db)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db);
        rows
    }

    pub fn space_of_item(&self, id: &ItemId) -> Result<Option<SpaceId>, DriveError> {
        let connection = self.lock();
        let found = connection
            .query_row(
                "SELECT space FROM nodes WHERE id = ?1",
                [id.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(db)?;
        let found = match found {
            Some(space) => Some(space),
            None => connection
                .query_row(
                    "SELECT space FROM items WHERE id = ?1",
                    [id.as_str()],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(db)?,
        };
        Ok(found.map(SpaceId))
    }

    pub fn save_anchor(&self, spaces: &str) -> Result<i64, DriveError> {
        self.transaction(|tx| {
            tx.execute("INSERT INTO anchors (spaces) VALUES (?1)", [spaces])
                .map_err(db)?;
            let token = tx.last_insert_rowid();
            tx.execute(
                "DELETE FROM anchors WHERE token <= ?1",
                [token - KEPT_ANCHORS],
            )
            .map_err(db)?;
            Ok(token)
        })
    }

    pub fn anchor(&self, token: i64) -> Result<Option<String>, DriveError> {
        self.lock()
            .query_row(
                "SELECT spaces FROM anchors WHERE token = ?1",
                [token],
                |row| row.get(0),
            )
            .optional()
            .map_err(db)
    }

    pub fn cursor(&self, space: &SpaceId) -> Result<Seq, DriveError> {
        Ok(Seq(self
            .lock()
            .query_row(
                "SELECT seq FROM cursor WHERE space = ?1",
                [space.as_str()],
                |row| row.get(0),
            )
            .optional()
            .map_err(db)?
            .unwrap_or(0)))
    }

    pub fn set_cursor(&self, space: &SpaceId, seq: Seq) -> Result<(), DriveError> {
        self.lock()
            .execute(
                "INSERT INTO cursor (space, seq) VALUES (?1, ?2)
                 ON CONFLICT(space) DO UPDATE SET seq = excluded.seq",
                params![space.as_str(), seq.0],
            )
            .map(|_| ())
            .map_err(db)
    }

    pub fn touch_local(&self, space: &SpaceId, id: &ItemId) -> Result<(), DriveError> {
        self.transaction(|tx| {
            tx.execute(
                "INSERT INTO local_cursor (space, seq) VALUES (?1, 1)
                 ON CONFLICT(space) DO UPDATE SET seq = seq + 1",
                [space.as_str()],
            )
            .map_err(db)?;
            let seq: i64 = tx
                .query_row(
                    "SELECT seq FROM local_cursor WHERE space = ?1",
                    [space.as_str()],
                    |row| row.get(0),
                )
                .map_err(db)?;
            tx.execute(
                "UPDATE nodes SET local_seq = ?3 WHERE space = ?1 AND id = ?2",
                params![space.as_str(), id.as_str(), seq],
            )
            .map_err(db)?;
            Ok(())
        })
    }

    pub fn local_cursor(&self, space: &SpaceId) -> Result<i64, DriveError> {
        Ok(self
            .lock()
            .query_row(
                "SELECT seq FROM local_cursor WHERE space = ?1",
                [space.as_str()],
                |row| row.get(0),
            )
            .optional()
            .map_err(db)?
            .unwrap_or(0))
    }

    pub fn nodes_since_local(
        &self,
        space: &SpaceId,
        since: i64,
        limit: usize,
    ) -> Result<Vec<(NodeRow, i64)>, DriveError> {
        let connection = self.lock();
        let mut statement = connection
            .prepare(&format!(
                "SELECT {NODE_COLUMNS}, local_seq FROM nodes WHERE space = ?1 AND local_seq > ?2
                 ORDER BY local_seq LIMIT ?3"
            ))
            .map_err(db)?;
        let rows = statement
            .query_map(params![space.as_str(), since, limit as i64], |row| {
                Ok((node_from(row)?, row.get::<_, i64>(22)?))
            })
            .map_err(db)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db);
        rows
    }

    pub fn transfer(
        &self,
        space: &SpaceId,
        id: &ItemId,
    ) -> Result<Option<TransferRow>, DriveError> {
        self.lock()
            .query_row(
                "SELECT space, id, sha256, size, upload_id, mode, part_size, parts, done, started_ms,
                        attempts, last_error
                 FROM transfers WHERE space = ?1 AND id = ?2",
                params![space.as_str(), id.as_str()],
                |row| {
                    Ok(TransferRow {
                        space: SpaceId(row.get(0)?),
                        id: ItemId(row.get(1)?),
                        sha256: row.get(2)?,
                        size: row.get::<_, i64>(3)?.max(0) as u64,
                        upload_id: row.get(4)?,
                        mode: row.get(5)?,
                        part_size: row.get::<_, i64>(6)?.max(0) as u64,
                        parts: row.get(7)?,
                        done: row.get(8)?,
                        started_ms: row.get(9)?,
                        attempts: row.get(10)?,
                        last_error: row.get(11)?,
                    })
                },
            )
            .optional()
            .map_err(db)
    }

    pub fn put_transfer(&self, row: &TransferRow) -> Result<(), DriveError> {
        self.lock()
            .execute(
                "INSERT INTO transfers (space, id, sha256, size, upload_id, mode, part_size, parts,
                    done, started_ms, attempts, last_error)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(space, id) DO UPDATE SET sha256 = excluded.sha256,
                    size = excluded.size, upload_id = excluded.upload_id, mode = excluded.mode,
                    part_size = excluded.part_size, parts = excluded.parts, done = excluded.done,
                    started_ms = excluded.started_ms, attempts = excluded.attempts,
                    last_error = excluded.last_error",
                params![
                    row.space.as_str(),
                    row.id.as_str(),
                    row.sha256,
                    row.size as i64,
                    row.upload_id,
                    row.mode,
                    row.part_size as i64,
                    row.parts,
                    row.done,
                    row.started_ms,
                    row.attempts,
                    row.last_error,
                ],
            )
            .map(|_| ())
            .map_err(db)
    }

    pub fn delete_transfer(&self, space: &SpaceId, id: &ItemId) -> Result<(), DriveError> {
        self.lock()
            .execute(
                "DELETE FROM transfers WHERE space = ?1 AND id = ?2",
                params![space.as_str(), id.as_str()],
            )
            .map(|_| ())
            .map_err(db)
    }

    pub fn set_pin(&self, space: &SpaceId, id: &ItemId, keep: bool) -> Result<(), DriveError> {
        let connection = self.lock();
        let sql = if keep {
            "INSERT OR IGNORE INTO pins (space, item_id) VALUES (?1, ?2)"
        } else {
            "DELETE FROM pins WHERE space = ?1 AND item_id = ?2"
        };
        connection
            .execute(sql, params![space.as_str(), id.as_str()])
            .map(|_| ())
            .map_err(db)
    }

    pub fn pinned(&self, space: &SpaceId, id: &ItemId) -> Result<bool, DriveError> {
        self.lock()
            .query_row(
                "SELECT 1 FROM pins WHERE space = ?1 AND item_id = ?2",
                params![space.as_str(), id.as_str()],
                |_| Ok(()),
            )
            .optional()
            .map(|found| found.is_some())
            .map_err(db)
    }

    pub fn kept(&self, space: &SpaceId, node: &NodeRow) -> Result<bool, DriveError> {
        let mut current = Some(node.clone());
        while let Some(at) = current {
            if self.pinned(space, &at.id)? {
                return Ok(true);
            }
            current = match &at.parent {
                Some(parent) => self.node(space, parent)?,
                None => None,
            };
        }
        Ok(false)
    }

    pub fn touch_blob(&self, sha256: &str, size: u64, at_ms: i64) -> Result<(), DriveError> {
        self.lock()
            .execute(
                "INSERT INTO blobs (sha256, size, last_used_ms) VALUES (?1, ?2, ?3)
                 ON CONFLICT(sha256) DO UPDATE SET last_used_ms = excluded.last_used_ms",
                params![sha256, size as i64, at_ms],
            )
            .map(|_| ())
            .map_err(db)
    }

    pub fn blobs_by_age(&self) -> Result<Vec<(String, u64)>, DriveError> {
        let connection = self.lock();
        let mut statement = connection
            .prepare("SELECT sha256, size FROM blobs ORDER BY last_used_ms ASC")
            .map_err(db)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?.max(0) as u64,
                ))
            })
            .map_err(db)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db);
        rows
    }

    pub fn cache_size(&self) -> Result<u64, DriveError> {
        Ok(self
            .lock()
            .query_row("SELECT COALESCE(SUM(size), 0) FROM blobs", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(db)?
            .max(0) as u64)
    }

    pub fn nodes_with_blob(&self, sha256: &str) -> Result<Vec<NodeRow>, DriveError> {
        let connection = self.lock();
        let mut statement = connection
            .prepare(&format!(
                "SELECT {NODE_COLUMNS} FROM nodes WHERE sha256 = ?1"
            ))
            .map_err(db)?;
        let rows = statement
            .query_map([sha256], node_from)
            .map_err(db)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db);
        rows
    }

    pub fn forget_blob(&self, sha256: &str) -> Result<(), DriveError> {
        self.lock()
            .execute("DELETE FROM blobs WHERE sha256 = ?1", [sha256])
            .map(|_| ())
            .map_err(db)
    }

    pub fn forget_space(&self, space: &SpaceId) -> Result<(), DriveError> {
        self.transaction(|tx| {
            for table in ["items", "base", "nodes", "transfers", "pins"] {
                tx.execute(
                    &format!("DELETE FROM {table} WHERE space = ?1"),
                    [space.as_str()],
                )
                .map_err(db)?;
            }
            for table in ["cursor", "local_cursor", "space_folders"] {
                tx.execute(
                    &format!("DELETE FROM {table} WHERE space = ?1"),
                    [space.as_str()],
                )
                .map_err(db)?;
            }
            Ok(())
        })
    }
}

fn put_item(connection: &Connection, item: &Item) -> Result<(), DriveError> {
    connection
        .execute(
            &format!(
                "INSERT OR REPLACE INTO items ({ITEM_COLUMNS})
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18,
                    ?19)"
            ),
            params![
                item.space_id.as_str(),
                item.id.as_str(),
                item.parent_id.as_ref().map(ItemId::as_str),
                item.name,
                item.kind.as_str(),
                item.sha256,
                item.size as i64,
                item.mtime_ms,
                item.version.0,
                item.seq.0,
                item.modified_by,
                item.modified_by_name,
                item.modified_at,
                item.trashed,
                item.trashed_at,
                item.trashed_by,
                item.trash_hold,
                item.deleted,
                item.replaced_of.as_ref().map(ItemId::as_str),
            ],
        )
        .map(|_| ())
        .map_err(db)
}

fn item(connection: &Connection, space: &SpaceId, id: &ItemId) -> Result<Option<Item>, DriveError> {
    connection
        .query_row(
            &format!("SELECT {ITEM_COLUMNS} FROM items WHERE space = ?1 AND id = ?2"),
            params![space.as_str(), id.as_str()],
            item_from,
        )
        .optional()
        .map_err(db)
}

fn base(connection: &Connection, space: &SpaceId, id: &ItemId) -> Result<Option<Base>, DriveError> {
    connection
        .query_row(
            "SELECT id, version, sha256, size, mtime_ms, parent, name FROM base
             WHERE space = ?1 AND id = ?2",
            params![space.as_str(), id.as_str()],
            base_from,
        )
        .optional()
        .map_err(db)
}

fn put_base(connection: &Connection, space: &SpaceId, base: &Base) -> Result<(), DriveError> {
    connection
        .execute(
            "INSERT OR REPLACE INTO base (space, id, version, sha256, size, mtime_ms, parent, name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                space.as_str(),
                base.id.as_str(),
                base.version.0,
                base.sha256,
                base.size as i64,
                base.mtime_ms,
                base.parent.as_ref().map(ItemId::as_str),
                base.name,
            ],
        )
        .map(|_| ())
        .map_err(db)
}

fn node(
    connection: &Connection,
    space: &SpaceId,
    id: &ItemId,
) -> Result<Option<NodeRow>, DriveError> {
    connection
        .query_row(
            &format!("SELECT {NODE_COLUMNS} FROM nodes WHERE space = ?1 AND id = ?2"),
            params![space.as_str(), id.as_str()],
            node_from,
        )
        .optional()
        .map_err(db)
}

fn children(
    connection: &Connection,
    space: &SpaceId,
    parent: Option<&ItemId>,
) -> Result<Vec<NodeRow>, DriveError> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT {NODE_COLUMNS} FROM nodes WHERE space = ?1 AND parent IS ?2 ORDER BY name"
        ))
        .map_err(db)?;
    let rows = statement
        .query_map(
            params![space.as_str(), parent.map(ItemId::as_str)],
            node_from,
        )
        .map_err(db)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db);
    rows
}

fn subtree(
    connection: &Connection,
    space: &SpaceId,
    path: &str,
) -> Result<Vec<NodeRow>, DriveError> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT {NODE_COLUMNS} FROM nodes WHERE {SUBTREE} ORDER BY path"
        ))
        .map_err(db)?;
    let rows = statement
        .query_map(params![space.as_str(), path], node_from)
        .map_err(db)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db);
    rows
}

fn parent_path(
    connection: &Connection,
    space: &SpaceId,
    parent: Option<&ItemId>,
) -> Result<String, DriveError> {
    match parent {
        None => Ok(names::ROOT.to_owned()),
        Some(parent) => node(connection, space, parent)?
            .map(|folder| folder.path)
            .ok_or(DriveError::NotFound),
    }
}

fn insert_node(connection: &Connection, node: &NodeRow) -> Result<NodeRow, DriveError> {
    let path = names::join(
        &parent_path(connection, &node.space, node.parent.as_ref())?,
        &node.name,
    );
    connection
        .execute(
            "INSERT INTO nodes (space, id, parent, name, server_name, kind, sha256, size, mtime_ms,
                path, created, dirty_content, dirty_place, trash_pending, trash_held, trash_agent,
                trash_chat, not_synced, downloaded, content_base, last_used_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
                ?18, ?19, ?20, ?21)",
            params![
                node.space.as_str(),
                node.id.as_str(),
                node.parent.as_ref().map(ItemId::as_str),
                node.name,
                node.server_name,
                node.kind.as_str(),
                node.sha256,
                node.size as i64,
                node.mtime_ms,
                path,
                node.created,
                node.dirty_content,
                node.dirty_place,
                node.trash_pending,
                node.trash_held,
                node.trash_agent,
                node.trash_chat,
                node.not_synced,
                node.downloaded,
                node.content_base.map(|version| version.0),
                node.last_used_ms,
            ],
        )
        .map_err(db)?;
    self::node(connection, &node.space, &node.id)?.ok_or(DriveError::NotFound)
}

fn update_node(connection: &Connection, node: &NodeRow) -> Result<(), DriveError> {
    connection
        .execute(
            "UPDATE nodes SET server_name = ?3, kind = ?4, sha256 = ?5, size = ?6, mtime_ms = ?7,
                created = ?8, dirty_content = ?9, dirty_place = ?10, trash_pending = ?11,
                trash_held = ?12, trash_agent = ?13, trash_chat = ?14, not_synced = ?15,
                downloaded = ?16, content_base = ?17, last_used_ms = ?18
             WHERE space = ?1 AND id = ?2",
            params![
                node.space.as_str(),
                node.id.as_str(),
                node.server_name,
                node.kind.as_str(),
                node.sha256,
                node.size as i64,
                node.mtime_ms,
                node.created,
                node.dirty_content,
                node.dirty_place,
                node.trash_pending,
                node.trash_held,
                node.trash_agent,
                node.trash_chat,
                node.not_synced,
                node.downloaded,
                node.content_base.map(|version| version.0),
                node.last_used_ms,
            ],
        )
        .map(|_| ())
        .map_err(db)
}

fn move_node(
    connection: &Connection,
    space: &SpaceId,
    id: &ItemId,
    parent: Option<&ItemId>,
    name: &str,
) -> Result<NodeRow, DriveError> {
    let current = node(connection, space, id)?.ok_or(DriveError::NotFound)?;
    let to = names::join(&parent_path(connection, space, parent)?, name);
    if names::is_within(&to, &current.path) && to != current.path {
        return Err(DriveError::Invalid(
            "A folder can't move into itself.".to_owned(),
        ));
    }
    connection
        .execute(
            "UPDATE nodes SET parent = ?3, name = ?4 WHERE space = ?1 AND id = ?2",
            params![
                space.as_str(),
                id.as_str(),
                parent.map(ItemId::as_str),
                name
            ],
        )
        .map_err(db)?;
    connection
        .execute(
            &format!("UPDATE nodes SET path = ?3 || substr(path, length(?2) + 1) WHERE {SUBTREE}"),
            params![space.as_str(), current.path, to],
        )
        .map_err(db)?;
    node(connection, space, id)?.ok_or(DriveError::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> Store {
        Store::with_connection(Connection::open_in_memory().unwrap()).unwrap()
    }

    fn folder(space: &SpaceId, id: &str, parent: Option<&str>, name: &str) -> NodeRow {
        NodeRow {
            ino: 0,
            space: space.clone(),
            id: ItemId(id.into()),
            parent: parent.map(|p| ItemId(p.into())),
            name: name.into(),
            server_name: name.into(),
            kind: Kind::Folder,
            sha256: None,
            size: 0,
            mtime_ms: 0,
            path: String::new(),
            created: false,
            dirty_content: false,
            dirty_place: false,
            trash_pending: false,
            trash_held: false,
            trash_agent: None,
            trash_chat: None,
            not_synced: false,
            downloaded: false,
            content_base: None,
            last_used_ms: 0,
        }
    }

    #[test]
    fn moving_a_folder_moves_its_subtree_and_nothing_beside_it() {
        let store = store();
        let space = SpaceId("s".into());
        store.insert_node(&folder(&space, "a", None, "A")).unwrap();
        store
            .insert_node(&folder(&space, "b", Some("a"), "B"))
            .unwrap();
        store.insert_node(&folder(&space, "c", None, "A2")).unwrap();
        store.insert_node(&folder(&space, "d", None, "X")).unwrap();
        let moved = store
            .move_node(&space, &ItemId("a".into()), Some(&ItemId("d".into())), "A")
            .unwrap();
        assert_eq!(moved.path, "/X/A");
        assert_eq!(
            store
                .node(&space, &ItemId("b".into()))
                .unwrap()
                .unwrap()
                .path,
            "/X/A/B"
        );
        assert_eq!(
            store
                .node(&space, &ItemId("c".into()))
                .unwrap()
                .unwrap()
                .path,
            "/A2"
        );
        assert_eq!(store.subtree(&space, "/X").unwrap().len(), 3);
        assert!(store
            .move_node(&space, &ItemId("d".into()), Some(&ItemId("b".into())), "X")
            .is_err());
    }
}
