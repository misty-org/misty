use std::{
    collections::{BTreeSet, HashMap, HashSet},
    path::Path,
    sync::{mpsc, Mutex, MutexGuard},
    thread::JoinHandle,
    time::Duration,
};

use rusqlite::{params, Connection, Row};

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
    "CREATE INDEX IF NOT EXISTS nodes_sha256 ON nodes(sha256);",
    "CREATE TABLE large_allowed (
        space TEXT NOT NULL,
        item_id TEXT NOT NULL,
        PRIMARY KEY (space, item_id)
     );",
    "ALTER TABLE items ADD COLUMN content_version INTEGER;
     ALTER TABLE base ADD COLUMN content_version INTEGER;",
    "ALTER TABLE items DROP COLUMN trashed;
     ALTER TABLE items DROP COLUMN trash_hold;
     ALTER TABLE nodes DROP COLUMN trash_held;
     ALTER TABLE nodes DROP COLUMN trash_agent;
     ALTER TABLE nodes DROP COLUMN trash_chat;
     DELETE FROM items;
     UPDATE cursor SET seq = 0;",
];

const KEPT_ANCHORS: i64 = 64;
const BATCH: usize = 1024;

const NODE_COLUMNS: &str = "ino, space, id, parent, name, server_name, kind, sha256, size, \
     mtime_ms, path, created, dirty_content, dirty_place, trash_pending, not_synced, \
     downloaded, content_base, last_used_ms";

const ITEM_COLUMNS: &str = "space, id, parent, name, kind, sha256, size, mtime_ms, version, seq, \
     modified_by, modified_by_name, modified_at, trashed_at, trashed_by, \
     deleted, replaced_of, content_version";

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

    fn untidy(&self) -> bool {
        !(self.created || self.dirty_place || self.trash_pending || self.not_synced)
            && self.name != names::safe_local_name(&self.server_name)
    }

    fn key(&self) -> ChildKey {
        ChildKey {
            file: self.kind == Kind::File,
            fold: names::fold(&self.name),
            id: self.id.clone(),
        }
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

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ChildKey {
    pub file: bool,
    pub fold: String,
    pub id: ItemId,
}

impl ChildKey {
    pub fn cursor(&self) -> String {
        format!(
            "{}{}\u{0}{}",
            if self.file { '1' } else { '0' },
            self.fold,
            self.id.as_str()
        )
    }

    pub fn from_cursor(text: &str) -> Option<Self> {
        let mut chars = text.chars();
        let file = match chars.next()? {
            '0' => false,
            '1' => true,
            _ => return None,
        };
        let (fold, id) = chars.as_str().split_once('\u{0}')?;
        Some(Self {
            file,
            fold: fold.to_owned(),
            id: ItemId(id.to_owned()),
        })
    }
}

#[derive(Default)]
struct SpaceMem {
    nodes: HashMap<ItemId, NodeRow>,
    children: HashMap<Option<ItemId>, BTreeSet<ChildKey>>,
    paths: HashMap<String, Vec<ItemId>>,
    local_seq: HashMap<ItemId, i64>,
    by_local_seq: BTreeSet<(i64, ItemId)>,
    local_cursor: i64,
    items: HashMap<ItemId, Item>,
    by_seq: BTreeSet<(i64, ItemId)>,
    item_children: HashMap<Option<ItemId>, HashSet<ItemId>>,
    bases: HashMap<ItemId, Base>,
    pins: HashSet<ItemId>,
    large_allowed: HashSet<ItemId>,
    transfers: HashMap<ItemId, TransferRow>,
    cursor: i64,
    dirty: HashSet<ItemId>,
    behind: HashSet<ItemId>,
    untidy: HashSet<ItemId>,
    files: u64,
}

impl SpaceMem {
    fn index(&mut self, node: &NodeRow) {
        self.children
            .entry(node.parent.clone())
            .or_default()
            .insert(node.key());
        self.paths
            .entry(node.path.clone())
            .or_default()
            .push(node.id.clone());
        if node.kind == Kind::File {
            self.files += 1;
        }
        self.flags(&node.id);
    }

    fn unindex(&mut self, node: &NodeRow) {
        if let Some(set) = self.children.get_mut(&node.parent) {
            set.remove(&node.key());
            if set.is_empty() {
                self.children.remove(&node.parent);
            }
        }
        if let Some(list) = self.paths.get_mut(&node.path) {
            list.retain(|id| id != &node.id);
            if list.is_empty() {
                self.paths.remove(&node.path);
            }
        }
        if node.kind == Kind::File {
            self.files = self.files.saturating_sub(1);
        }
        self.dirty.remove(&node.id);
        self.untidy.remove(&node.id);
    }

    fn flags(&mut self, id: &ItemId) {
        match self.nodes.get(id) {
            Some(node) => {
                if node.dirty() {
                    self.dirty.insert(id.clone());
                } else {
                    self.dirty.remove(id);
                }
                if node.untidy() {
                    self.untidy.insert(id.clone());
                } else {
                    self.untidy.remove(id);
                }
            }
            None => {
                self.dirty.remove(id);
                self.untidy.remove(id);
            }
        }
        self.judge(id);
    }

    fn judge(&mut self, id: &ItemId) {
        let behind = match self.items.get(id) {
            None => false,
            Some(item) => match self.nodes.get(id) {
                None => item.is_live(),
                Some(node) if node.created => false,
                Some(_) => self
                    .bases
                    .get(id)
                    .is_none_or(|base| base.version != item.version),
            },
        };
        if behind {
            self.behind.insert(id.clone());
        } else {
            self.behind.remove(id);
        }
    }

    fn put_item(&mut self, item: &Item) {
        if let Some(old) = self.items.remove(&item.id) {
            self.by_seq.remove(&(old.seq.0, old.id.clone()));
            if let Some(set) = self.item_children.get_mut(&old.parent_id) {
                set.remove(&old.id);
            }
        }
        self.by_seq.insert((item.seq.0, item.id.clone()));
        self.item_children
            .entry(item.parent_id.clone())
            .or_default()
            .insert(item.id.clone());
        self.items.insert(item.id.clone(), item.clone());
        self.judge(&item.id);
    }

    fn path_of(&self, parent: Option<&ItemId>) -> Result<String, DriveError> {
        match parent {
            None => Ok(names::ROOT.to_owned()),
            Some(parent) => self
                .nodes
                .get(parent)
                .map(|folder| folder.path.clone())
                .ok_or(DriveError::NotFound),
        }
    }

    fn subtree_ids(&self, id: &ItemId) -> Vec<ItemId> {
        let mut out = Vec::new();
        if !self.nodes.contains_key(id) {
            return out;
        }
        out.push(id.clone());
        let mut index = 0;
        while index < out.len() {
            let at = out[index].clone();
            if let Some(children) = self.children.get(&Some(at)) {
                out.extend(children.iter().map(|key| key.id.clone()));
            }
            index += 1;
        }
        out
    }

    fn set_path(&mut self, id: &ItemId, path: String) {
        let Some(node) = self.nodes.get_mut(id) else {
            return;
        };
        let old = std::mem::replace(&mut node.path, path.clone());
        if let Some(list) = self.paths.get_mut(&old) {
            list.retain(|other| other != id);
            if list.is_empty() {
                self.paths.remove(&old);
            }
        }
        self.paths.entry(path).or_default().push(id.clone());
    }
}

#[derive(Default)]
struct Mem {
    spaces: HashMap<SpaceId, SpaceMem>,
    inos: HashMap<i64, (SpaceId, ItemId)>,
    next_ino: i64,
    blobs: HashMap<String, (u64, i64)>,
    blob_users: HashMap<String, HashSet<(SpaceId, ItemId)>>,
    blob_bytes: u64,
    space_folders: HashMap<SpaceId, String>,
    anchors: std::collections::BTreeMap<i64, String>,
    next_anchor: i64,
}

impl Mem {
    fn space(&mut self, space: &SpaceId) -> &mut SpaceMem {
        self.spaces.entry(space.clone()).or_default()
    }

    fn seen(&self, space: &SpaceId) -> Option<&SpaceMem> {
        self.spaces.get(space)
    }

    fn uses_blob(&mut self, node: &NodeRow) {
        if let Some(sha) = &node.sha256 {
            self.blob_users
                .entry(sha.clone())
                .or_default()
                .insert((node.space.clone(), node.id.clone()));
        }
    }

    fn drops_blob(&mut self, node: &NodeRow) {
        if let Some(sha) = &node.sha256 {
            if let Some(users) = self.blob_users.get_mut(sha) {
                users.remove(&(node.space.clone(), node.id.clone()));
                if users.is_empty() {
                    self.blob_users.remove(sha);
                }
            }
        }
    }

    fn add_node(&mut self, node: NodeRow) {
        self.inos
            .insert(node.ino, (node.space.clone(), node.id.clone()));
        self.uses_blob(&node);
        let space = self.space(&node.space);
        space.nodes.insert(node.id.clone(), node.clone());
        space.index(&node);
    }

    fn take_node(&mut self, space_id: &SpaceId, id: &ItemId) -> Option<NodeRow> {
        let space = self.space(space_id);
        let node = space.nodes.remove(id)?;
        space.unindex(&node);
        if let Some(seq) = space.local_seq.remove(id) {
            space.by_local_seq.remove(&(seq, id.clone()));
        }
        space.judge(id);
        self.inos.remove(&node.ino);
        self.drops_blob(&node);
        Some(node)
    }
}

type Job = Box<dyn FnOnce(&Connection) -> rusqlite::Result<()> + Send>;

enum Message {
    Write(Job),
    Flush(mpsc::Sender<()>),
    Stop,
}

pub struct Store {
    mem: Mutex<Mem>,
    send: Mutex<mpsc::Sender<Message>>,
    writer: Mutex<Option<JoinHandle<()>>>,
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
        not_synced: row.get(15)?,
        downloaded: row.get(16)?,
        content_base: row.get::<_, Option<i64>>(17)?.map(Version),
        last_used_ms: row.get(18)?,
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
        trashed_at: row.get(13)?,
        trashed_by: row.get(14)?,
        deleted: row.get(15)?,
        replaced_of: row.get::<_, Option<String>>(16)?.map(ItemId),
        content_version: row.get::<_, Option<i64>>(17)?.map(Version),
    })
}

fn load(connection: &Connection) -> rusqlite::Result<Mem> {
    let mut mem = Mem::default();
    let mut highest = 0i64;
    {
        let mut statement = connection.prepare(&format!(
            "SELECT {NODE_COLUMNS}, local_seq FROM nodes ORDER BY ino"
        ))?;
        let rows = statement.query_map([], |row| Ok((node_from(row)?, row.get::<_, i64>(19)?)))?;
        for row in rows {
            let (node, local) = row?;
            highest = highest.max(node.ino);
            let (space, id) = (node.space.clone(), node.id.clone());
            mem.add_node(node);
            if local > 0 {
                let at = mem.space(&space);
                at.local_seq.insert(id.clone(), local);
                at.by_local_seq.insert((local, id));
            }
        }
    }
    let sequence: Option<i64> = connection
        .query_row(
            "SELECT seq FROM sqlite_sequence WHERE name = 'nodes'",
            [],
            |row| row.get(0),
        )
        .ok();
    mem.next_ino = highest.max(sequence.unwrap_or(0)) + 1;
    {
        let mut statement = connection.prepare(&format!("SELECT {ITEM_COLUMNS} FROM items"))?;
        for item in statement.query_map([], item_from)? {
            let item = item?;
            mem.space(&item.space_id.clone()).put_item(&item);
        }
    }
    {
        let mut statement = connection
            .prepare("SELECT space, id, version, sha256, size, mtime_ms, parent, name, content_version FROM base")?;
        let rows = statement.query_map([], |row| {
            Ok((
                SpaceId(row.get(0)?),
                Base {
                    id: ItemId(row.get(1)?),
                    version: Version(row.get(2)?),
                    sha256: row.get(3)?,
                    size: row.get::<_, i64>(4)?.max(0) as u64,
                    mtime_ms: row.get(5)?,
                    parent: row.get::<_, Option<String>>(6)?.map(ItemId),
                    name: row.get(7)?,
                    content_version: row.get::<_, Option<i64>>(8)?.map(Version),
                },
            ))
        })?;
        for row in rows {
            let (space, base) = row?;
            let at = mem.space(&space);
            let id = base.id.clone();
            at.bases.insert(id.clone(), base);
            at.judge(&id);
        }
    }
    {
        let mut statement = connection.prepare("SELECT space, item_id FROM pins")?;
        let rows =
            statement.query_map([], |row| Ok((SpaceId(row.get(0)?), ItemId(row.get(1)?))))?;
        for row in rows {
            let (space, id) = row?;
            mem.space(&space).pins.insert(id);
        }
    }
    {
        let mut statement = connection.prepare("SELECT space, item_id FROM large_allowed")?;
        let rows =
            statement.query_map([], |row| Ok((SpaceId(row.get(0)?), ItemId(row.get(1)?))))?;
        for row in rows {
            let (space, id) = row?;
            mem.space(&space).large_allowed.insert(id);
        }
    }
    {
        let mut statement = connection.prepare(
            "SELECT space, id, sha256, size, upload_id, mode, part_size, parts, done, started_ms,
                    attempts, last_error FROM transfers",
        )?;
        let rows = statement.query_map([], |row| {
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
        })?;
        for row in rows {
            let row = row?;
            mem.space(&row.space.clone())
                .transfers
                .insert(row.id.clone(), row);
        }
    }
    for (table, local) in [("cursor", false), ("local_cursor", true)] {
        let mut statement = connection.prepare(&format!("SELECT space, seq FROM {table}"))?;
        let rows =
            statement.query_map([], |row| Ok((SpaceId(row.get(0)?), row.get::<_, i64>(1)?)))?;
        for row in rows {
            let (space, seq) = row?;
            let at = mem.space(&space);
            if local {
                at.local_cursor = seq;
            } else {
                at.cursor = seq;
            }
        }
    }
    {
        let mut statement = connection.prepare("SELECT sha256, size, last_used_ms FROM blobs")?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?.max(0) as u64,
                row.get::<_, i64>(2)?,
            ))
        })?;
        for row in rows {
            let (sha, size, used) = row?;
            mem.blob_bytes += size;
            mem.blobs.insert(sha, (size, used));
        }
    }
    {
        let mut statement = connection.prepare("SELECT space, folder FROM space_folders")?;
        let rows = statement.query_map([], |row| {
            Ok((SpaceId(row.get(0)?), row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (space, folder) = row?;
            mem.space_folders.insert(space, folder);
        }
    }
    {
        let mut statement = connection.prepare("SELECT token, spaces FROM anchors")?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (token, spaces) = row?;
            mem.anchors.insert(token, spaces);
        }
    }
    let anchor_sequence: Option<i64> = connection
        .query_row(
            "SELECT seq FROM sqlite_sequence WHERE name = 'anchors'",
            [],
            |row| row.get(0),
        )
        .ok();
    mem.next_anchor = mem
        .anchors
        .keys()
        .next_back()
        .copied()
        .unwrap_or(0)
        .max(anchor_sequence.unwrap_or(0))
        + 1;
    Ok(mem)
}

fn write_loop(connection: Connection, receive: mpsc::Receiver<Message>) {
    let mut stopping = false;
    while !stopping {
        let Ok(first) = receive.recv() else {
            return;
        };
        let mut batch = vec![first];
        while batch.len() < BATCH {
            match receive.try_recv() {
                Ok(message) => batch.push(message),
                Err(_) => break,
            }
        }
        let mut flushed = Vec::new();
        let began = connection.execute_batch("BEGIN").is_ok();
        for message in batch {
            match message {
                Message::Write(job) => {
                    if let Err(error) = job(&connection) {
                        eprintln!("[drive] a record didn't save: {error}");
                    }
                }
                Message::Flush(done) => flushed.push(done),
                Message::Stop => stopping = true,
            }
        }
        if began {
            if let Err(error) = connection.execute_batch("COMMIT") {
                eprintln!("[drive] records didn't save: {error}");
                let _ = connection.execute_batch("ROLLBACK");
            }
        }
        for done in flushed {
            let _ = done.send(());
        }
    }
}

fn save_node(connection: &Connection, node: &NodeRow, local_seq: i64) -> rusqlite::Result<()> {
    let mut statement = connection.prepare_cached(
        "INSERT INTO nodes (ino, space, id, parent, name, server_name, kind, sha256, size, mtime_ms,
            path, created, dirty_content, dirty_place, trash_pending, not_synced, downloaded,
            content_base, last_used_ms, local_seq)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18,
            ?19, ?20)
         ON CONFLICT(ino) DO UPDATE SET space = excluded.space, id = excluded.id,
            parent = excluded.parent, name = excluded.name, server_name = excluded.server_name,
            kind = excluded.kind, sha256 = excluded.sha256, size = excluded.size,
            mtime_ms = excluded.mtime_ms, path = excluded.path, created = excluded.created,
            dirty_content = excluded.dirty_content, dirty_place = excluded.dirty_place,
            trash_pending = excluded.trash_pending,
            not_synced = excluded.not_synced, downloaded = excluded.downloaded,
            content_base = excluded.content_base, last_used_ms = excluded.last_used_ms,
            local_seq = excluded.local_seq",
    )?;
    statement.execute(params![
        node.ino,
        node.space.as_str(),
        node.id.as_str(),
        node.parent.as_ref().map(ItemId::as_str),
        node.name,
        node.server_name,
        node.kind.as_str(),
        node.sha256,
        node.size as i64,
        node.mtime_ms,
        node.path,
        node.created,
        node.dirty_content,
        node.dirty_place,
        node.trash_pending,
        node.not_synced,
        node.downloaded,
        node.content_base.map(|version| version.0),
        node.last_used_ms,
        local_seq,
    ])?;
    Ok(())
}

fn save_item(connection: &Connection, item: &Item) -> rusqlite::Result<()> {
    let mut statement = connection.prepare_cached(&format!(
        "INSERT OR REPLACE INTO items ({ITEM_COLUMNS})
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)"
    ))?;
    statement.execute(params![
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
        item.trashed_at,
        item.trashed_by,
        item.deleted,
        item.replaced_of.as_ref().map(ItemId::as_str),
        item.content_version.map(|version| version.0),
    ])?;
    Ok(())
}

fn save_base(connection: &Connection, space: &SpaceId, base: &Base) -> rusqlite::Result<()> {
    let mut statement = connection.prepare_cached(
        "INSERT OR REPLACE INTO base (space, id, version, sha256, size, mtime_ms, parent, name, content_version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )?;
    statement.execute(params![
        space.as_str(),
        base.id.as_str(),
        base.version.0,
        base.sha256,
        base.size as i64,
        base.mtime_ms,
        base.parent.as_ref().map(ItemId::as_str),
        base.name,
        base.content_version.map(|version| version.0),
    ])?;
    Ok(())
}

fn exec(
    connection: &Connection,
    sql: &'static str,
    values: &[&dyn rusqlite::ToSql],
) -> rusqlite::Result<()> {
    connection.prepare_cached(sql)?.execute(values)?;
    Ok(())
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
        connection.set_prepared_statement_cache_capacity(64);
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
        let mem = load(&connection).map_err(db)?;
        let (send, receive) = mpsc::channel();
        let writer = std::thread::Builder::new()
            .name("misty-drive-store".into())
            .spawn(move || write_loop(connection, receive))
            .map_err(DriveError::io)?;
        Ok(Self {
            mem: Mutex::new(mem),
            send: Mutex::new(send),
            writer: Mutex::new(Some(writer)),
        })
    }

    fn mem(&self) -> MutexGuard<'_, Mem> {
        self.mem
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn later(&self, job: impl FnOnce(&Connection) -> rusqlite::Result<()> + Send + 'static) {
        let send = self
            .send
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _ = send.send(Message::Write(Box::new(job)));
    }

    pub fn flush(&self) {
        let (done, wait) = mpsc::channel();
        {
            let send = self
                .send
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if send.send(Message::Flush(done)).is_err() {
                return;
            }
        }
        let _ = wait.recv_timeout(Duration::from_secs(10));
    }

    fn persist(&self, mem: &Mem, space: &SpaceId, id: &ItemId) {
        let Some(at) = mem.seen(space) else {
            return;
        };
        let Some(node) = at.nodes.get(id).cloned() else {
            return;
        };
        let local = at.local_seq.get(id).copied().unwrap_or(0);
        self.later(move |connection| save_node(connection, &node, local));
    }

    fn unpersist(&self, ino: i64) {
        self.later(move |connection| exec(connection, "DELETE FROM nodes WHERE ino = ?1", &[&ino]));
    }

    pub fn put_item(&self, item: &Item) -> Result<(), DriveError> {
        self.mem().space(&item.space_id).put_item(item);
        let item = item.clone();
        self.later(move |connection| save_item(connection, &item));
        Ok(())
    }

    pub fn item(&self, space: &SpaceId, id: &ItemId) -> Result<Option<Item>, DriveError> {
        Ok(self
            .mem()
            .seen(space)
            .and_then(|at| at.items.get(id).cloned()))
    }

    pub fn items(&self, space: &SpaceId) -> Result<Vec<Item>, DriveError> {
        Ok(self
            .mem()
            .seen(space)
            .map(|at| at.items.values().cloned().collect())
            .unwrap_or_default())
    }

    pub fn item_children(
        &self,
        space: &SpaceId,
        parent: Option<&ItemId>,
    ) -> Result<Vec<Item>, DriveError> {
        let mem = self.mem();
        let Some(at) = mem.seen(space) else {
            return Ok(Vec::new());
        };
        Ok(at
            .item_children
            .get(&parent.cloned())
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| at.items.get(id).cloned())
                    .collect()
            })
            .unwrap_or_default())
    }

    pub fn item_by_writer(&self, space: &SpaceId, writer: &str) -> Option<Item> {
        self.mem().seen(space).and_then(|at| {
            at.items
                .values()
                .find(|item| item.modified_by == writer && !item.modified_by_name.is_empty())
                .cloned()
        })
    }

    pub fn items_since(
        &self,
        space: &SpaceId,
        since: Seq,
        limit: usize,
    ) -> Result<Vec<Item>, DriveError> {
        let mem = self.mem();
        let Some(at) = mem.seen(space) else {
            return Ok(Vec::new());
        };
        Ok(at
            .by_seq
            .range((since.0 + 1, ItemId(String::new()))..)
            .take(limit)
            .filter_map(|(_, id)| at.items.get(id).cloned())
            .collect())
    }

    pub fn clear_items(&self, space: &SpaceId) -> Result<(), DriveError> {
        {
            let mut mem = self.mem();
            let at = mem.space(space);
            let ids: Vec<ItemId> = at.items.keys().cloned().collect();
            at.items.clear();
            at.by_seq.clear();
            at.item_children.clear();
            for id in ids {
                at.judge(&id);
            }
        }
        let space = space.clone();
        self.later(move |connection| {
            exec(
                connection,
                "DELETE FROM items WHERE space = ?1",
                &[&space.0],
            )
        });
        Ok(())
    }

    pub fn base(&self, space: &SpaceId, id: &ItemId) -> Result<Option<Base>, DriveError> {
        Ok(self
            .mem()
            .seen(space)
            .and_then(|at| at.bases.get(id).cloned()))
    }

    pub fn bases(&self, space: &SpaceId) -> Result<Vec<Base>, DriveError> {
        Ok(self
            .mem()
            .seen(space)
            .map(|at| at.bases.values().cloned().collect())
            .unwrap_or_default())
    }

    pub fn put_base(&self, space: &SpaceId, base: &Base) -> Result<(), DriveError> {
        {
            let mut mem = self.mem();
            let at = mem.space(space);
            at.bases.insert(base.id.clone(), base.clone());
            at.judge(&base.id);
        }
        let (space, base) = (space.clone(), base.clone());
        self.later(move |connection| save_base(connection, &space, &base));
        Ok(())
    }

    pub fn delete_base(&self, space: &SpaceId, id: &ItemId) -> Result<(), DriveError> {
        {
            let mut mem = self.mem();
            let at = mem.space(space);
            at.bases.remove(id);
            at.judge(id);
        }
        let (space, id) = (space.clone(), id.clone());
        self.later(move |connection| {
            exec(
                connection,
                "DELETE FROM base WHERE space = ?1 AND id = ?2",
                &[&space.0, &id.0],
            )
        });
        Ok(())
    }

    pub fn node(&self, space: &SpaceId, id: &ItemId) -> Result<Option<NodeRow>, DriveError> {
        Ok(self
            .mem()
            .seen(space)
            .and_then(|at| at.nodes.get(id).cloned()))
    }

    pub fn node_by_ino(&self, ino: i64) -> Result<Option<NodeRow>, DriveError> {
        let mem = self.mem();
        Ok(mem
            .inos
            .get(&ino)
            .and_then(|(space, id)| mem.seen(space).and_then(|at| at.nodes.get(id).cloned())))
    }

    pub fn node_at(&self, space: &SpaceId, path: &str) -> Result<Option<NodeRow>, DriveError> {
        let mem = self.mem();
        let Some(at) = mem.seen(space) else {
            return Ok(None);
        };
        let Some(ids) = at.paths.get(path) else {
            return Ok(None);
        };
        let mut found: Vec<&NodeRow> = ids.iter().filter_map(|id| at.nodes.get(id)).collect();
        found.sort_by_key(|node| (node.trash_pending, node.ino));
        Ok(found.first().map(|node| (*node).clone()))
    }

    pub fn children(
        &self,
        space: &SpaceId,
        parent: Option<&ItemId>,
    ) -> Result<Vec<NodeRow>, DriveError> {
        let mem = self.mem();
        let Some(at) = mem.seen(space) else {
            return Ok(Vec::new());
        };
        Ok(at
            .children
            .get(&parent.cloned())
            .map(|keys| {
                keys.iter()
                    .filter_map(|key| at.nodes.get(&key.id).cloned())
                    .collect()
            })
            .unwrap_or_default())
    }

    pub fn children_page(
        &self,
        space: &SpaceId,
        parent: Option<&ItemId>,
        after: Option<&ChildKey>,
        limit: usize,
    ) -> (Vec<NodeRow>, Option<ChildKey>) {
        let mem = self.mem();
        let Some(at) = mem.seen(space) else {
            return (Vec::new(), None);
        };
        let Some(keys) = at.children.get(&parent.cloned()) else {
            return (Vec::new(), None);
        };
        let mut out = Vec::new();
        let mut last = None;
        let range: Box<dyn Iterator<Item = &ChildKey>> = match after {
            Some(after) => Box::new(keys.range((
                std::ops::Bound::Excluded(after.clone()),
                std::ops::Bound::Unbounded,
            ))),
            None => Box::new(keys.iter()),
        };
        let mut more = false;
        for key in range {
            let Some(node) = at.nodes.get(&key.id) else {
                continue;
            };
            if node.trash_pending {
                continue;
            }
            if out.len() == limit {
                more = true;
                break;
            }
            out.push(node.clone());
            last = Some(key.clone());
        }
        (out, last.filter(|_| more))
    }

    pub fn child_named(
        &self,
        space: &SpaceId,
        parent: Option<&ItemId>,
        name: &str,
    ) -> Result<Option<NodeRow>, DriveError> {
        Ok(self.children_folded(space, parent, name).into_iter().next())
    }

    pub fn children_folded(
        &self,
        space: &SpaceId,
        parent: Option<&ItemId>,
        name: &str,
    ) -> Vec<NodeRow> {
        let fold = names::fold(name);
        let mem = self.mem();
        let Some(at) = mem.seen(space) else {
            return Vec::new();
        };
        let Some(keys) = at.children.get(&parent.cloned()) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for file in [false, true] {
            let start = ChildKey {
                file,
                fold: fold.clone(),
                id: ItemId(String::new()),
            };
            for key in keys.range(start..) {
                if key.file != file || key.fold != fold {
                    break;
                }
                if let Some(node) = at.nodes.get(&key.id) {
                    out.push(node.clone());
                }
            }
        }
        out
    }

    pub fn nodes(&self, space: &SpaceId) -> Result<Vec<NodeRow>, DriveError> {
        Ok(self
            .mem()
            .seen(space)
            .map(|at| at.nodes.values().cloned().collect())
            .unwrap_or_default())
    }

    pub fn file_count(&self, space: &SpaceId) -> u64 {
        self.mem().seen(space).map_or(0, |at| at.files)
    }

    pub fn dirty_count(&self, space: &SpaceId) -> u64 {
        self.mem().seen(space).map_or(0, |at| at.dirty.len() as u64)
    }

    pub fn dirty_nodes(&self, space: &SpaceId) -> Vec<NodeRow> {
        let mem = self.mem();
        let Some(at) = mem.seen(space) else {
            return Vec::new();
        };
        at.dirty
            .iter()
            .filter_map(|id| at.nodes.get(id).cloned())
            .collect()
    }

    pub fn untidy_nodes(&self, space: &SpaceId) -> Vec<NodeRow> {
        let mem = self.mem();
        let Some(at) = mem.seen(space) else {
            return Vec::new();
        };
        at.untidy
            .iter()
            .filter_map(|id| at.nodes.get(id).cloned())
            .collect()
    }

    pub fn planning(
        &self,
        space: &SpaceId,
        complete: bool,
    ) -> (
        HashMap<ItemId, Item>,
        HashMap<ItemId, Base>,
        HashMap<ItemId, NodeRow>,
    ) {
        let mem = self.mem();
        let Some(at) = mem.seen(space) else {
            return Default::default();
        };
        if complete {
            return (at.items.clone(), at.bases.clone(), at.nodes.clone());
        }
        let mut server = HashMap::new();
        let mut base = HashMap::new();
        let mut local = HashMap::new();
        let take = |id: &ItemId,
                    server: &mut HashMap<ItemId, Item>,
                    base: &mut HashMap<ItemId, Base>,
                    local: &mut HashMap<ItemId, NodeRow>| {
            if let Some(item) = at.items.get(id) {
                server.insert(id.clone(), item.clone());
            }
            if let Some(row) = at.bases.get(id) {
                base.insert(id.clone(), row.clone());
            }
            if let Some(node) = at.nodes.get(id) {
                local.insert(id.clone(), node.clone());
            }
        };
        let mut wanted: Vec<ItemId> = at.dirty.iter().chain(at.behind.iter()).cloned().collect();
        let mut seen: HashSet<ItemId> = HashSet::new();
        while let Some(id) = wanted.pop() {
            if !seen.insert(id.clone()) {
                continue;
            }
            take(&id, &mut server, &mut base, &mut local);
            if let Some(parent) = at.items.get(&id).and_then(|item| item.parent_id.clone()) {
                wanted.push(parent);
            }
            if let Some(parent) = at.nodes.get(&id).and_then(|node| node.parent.clone()) {
                wanted.push(parent);
            }
        }
        (server, base, local)
    }

    pub fn subtree(&self, space: &SpaceId, path: &str) -> Result<Vec<NodeRow>, DriveError> {
        let mem = self.mem();
        let Some(at) = mem.seen(space) else {
            return Ok(Vec::new());
        };
        let mut out: Vec<NodeRow> = at
            .nodes
            .values()
            .filter(|node| names::is_within(&node.path, path))
            .cloned()
            .collect();
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    pub fn insert_node(&self, node: &NodeRow) -> Result<NodeRow, DriveError> {
        let mut mem = self.mem();
        let path = {
            let at = mem.space(&node.space);
            if at.nodes.contains_key(&node.id) {
                return Err(DriveError::Exists);
            }
            names::join(&at.path_of(node.parent.as_ref())?, &node.name)
        };
        let mut row = node.clone();
        row.path = path;
        row.ino = mem.next_ino;
        mem.next_ino += 1;
        mem.add_node(row.clone());
        self.persist(&mem, &row.space, &row.id);
        Ok(row)
    }

    pub fn update_node(&self, node: &NodeRow) -> Result<(), DriveError> {
        let mut mem = self.mem();
        let Some(mut current) = mem
            .seen(&node.space)
            .and_then(|at| at.nodes.get(&node.id).cloned())
        else {
            return Ok(());
        };
        let kind_changed = current.kind != node.kind;
        let sha_changed = current.sha256 != node.sha256;
        if sha_changed {
            mem.drops_blob(&current);
        }
        let at = mem.space(&node.space);
        if kind_changed {
            at.unindex(&current);
        }
        current.server_name = node.server_name.clone();
        current.kind = node.kind;
        current.sha256 = node.sha256.clone();
        current.size = node.size;
        current.mtime_ms = node.mtime_ms;
        current.created = node.created;
        current.dirty_content = node.dirty_content;
        current.dirty_place = node.dirty_place;
        current.trash_pending = node.trash_pending;
        current.not_synced = node.not_synced;
        current.downloaded = node.downloaded;
        current.content_base = node.content_base;
        current.last_used_ms = node.last_used_ms;
        at.nodes.insert(current.id.clone(), current.clone());
        if kind_changed {
            at.index(&current);
        } else {
            at.flags(&current.id);
        }
        if sha_changed {
            mem.uses_blob(&current);
        }
        self.persist(&mem, &node.space, &node.id);
        Ok(())
    }

    pub fn move_node(
        &self,
        space: &SpaceId,
        id: &ItemId,
        parent: Option<&ItemId>,
        name: &str,
    ) -> Result<NodeRow, DriveError> {
        let mut mem = self.mem();
        let at = mem.space(space);
        let current = at.nodes.get(id).cloned().ok_or(DriveError::NotFound)?;
        let to = names::join(&at.path_of(parent)?, name);
        if names::is_within(&to, &current.path) && to != current.path {
            return Err(DriveError::Invalid(
                "A folder can't move into itself.".to_owned(),
            ));
        }
        let subtree = at.subtree_ids(id);
        at.unindex(&current);
        let mut moved = current.clone();
        moved.parent = parent.cloned();
        moved.name = name.to_owned();
        moved.path = to.clone();
        at.nodes.insert(id.clone(), moved.clone());
        at.index(&moved);
        for below in subtree.iter().skip(1) {
            let Some(old) = at.nodes.get(below).map(|node| node.path.clone()) else {
                continue;
            };
            at.set_path(below, names::rebase(&old, &current.path, &to));
        }
        for changed in &subtree {
            self.persist(&mem, space, changed);
        }
        Ok(moved)
    }

    pub fn descendants(&self, space: &SpaceId, id: &ItemId) -> Result<Vec<NodeRow>, DriveError> {
        let mem = self.mem();
        let Some(at) = mem.seen(space) else {
            return Ok(Vec::new());
        };
        Ok(at
            .subtree_ids(id)
            .iter()
            .filter_map(|id| at.nodes.get(id).cloned())
            .collect())
    }

    pub fn remove_subtree(&self, space: &SpaceId, id: &ItemId) -> Result<Vec<NodeRow>, DriveError> {
        let mut mem = self.mem();
        let ids = mem.space(space).subtree_ids(id);
        let mut gone = Vec::new();
        for id in &ids {
            if let Some(node) = mem.take_node(space, id) {
                self.unpersist(node.ino);
                gone.push(node);
            }
            let at = mem.space(space);
            at.bases.remove(id);
            at.judge(id);
        }
        drop(mem);
        let (space, ids) = (space.clone(), ids);
        self.later(move |connection| {
            for id in &ids {
                exec(
                    connection,
                    "DELETE FROM base WHERE space = ?1 AND id = ?2",
                    &[&space.0, &id.0],
                )?;
            }
            Ok(())
        });
        Ok(gone)
    }

    pub fn remove_node(&self, space: &SpaceId, id: &ItemId) -> Result<(), DriveError> {
        let mut mem = self.mem();
        if let Some(node) = mem.take_node(space, id) {
            self.unpersist(node.ino);
        }
        Ok(())
    }

    pub fn rekey(&self, space: &SpaceId, from: &ItemId, to: &ItemId) -> Result<(), DriveError> {
        let mut mem = self.mem();
        let local = mem
            .seen(space)
            .and_then(|at| at.local_seq.get(from).copied());
        let Some(mut node) = mem.take_node(space, from) else {
            return Ok(());
        };
        let children: Vec<ItemId> = mem
            .space(space)
            .children
            .get(&Some(from.clone()))
            .map(|keys| keys.iter().map(|key| key.id.clone()).collect())
            .unwrap_or_default();
        node.id = to.clone();
        mem.add_node(node);
        let at = mem.space(space);
        if let Some(local) = local {
            at.local_seq.insert(to.clone(), local);
            at.by_local_seq.insert((local, to.clone()));
        }
        for child in &children {
            if let Some(mut row) = at.nodes.get(child).cloned() {
                at.unindex(&row);
                row.parent = Some(to.clone());
                at.nodes.insert(child.clone(), row.clone());
                at.index(&row);
            }
        }
        at.bases.remove(from);
        at.judge(from);
        if let Some(mut transfer) = at.transfers.remove(from) {
            transfer.id = to.clone();
            at.transfers.insert(to.clone(), transfer);
        }
        if at.pins.remove(from) {
            at.pins.insert(to.clone());
        }
        if at.large_allowed.remove(from) {
            at.large_allowed.insert(to.clone());
        }
        at.judge(to);
        self.persist(&mem, space, to);
        for child in &children {
            self.persist(&mem, space, child);
        }
        drop(mem);
        let (space, from, to) = (space.clone(), from.clone(), to.clone());
        self.later(move |connection| {
            exec(
                connection,
                "DELETE FROM base WHERE space = ?1 AND id = ?2",
                &[&space.0, &from.0],
            )?;
            exec(
                connection,
                "UPDATE transfers SET id = ?3 WHERE space = ?1 AND id = ?2",
                &[&space.0, &from.0, &to.0],
            )?;
            exec(
                connection,
                "UPDATE pins SET item_id = ?3 WHERE space = ?1 AND item_id = ?2",
                &[&space.0, &from.0, &to.0],
            )?;
            exec(
                connection,
                "UPDATE large_allowed SET item_id = ?3 WHERE space = ?1 AND item_id = ?2",
                &[&space.0, &from.0, &to.0],
            )
        });
        Ok(())
    }

    pub fn set_space_folder(&self, space: &SpaceId, folder: &str) -> Result<(), DriveError> {
        self.mem()
            .space_folders
            .insert(space.clone(), folder.to_owned());
        let (space, folder) = (space.clone(), folder.to_owned());
        self.later(move |connection| {
            exec(
                connection,
                "INSERT INTO space_folders (space, folder) VALUES (?1, ?2)
                 ON CONFLICT(space) DO UPDATE SET folder = excluded.folder",
                &[&space.0, &folder],
            )
        });
        Ok(())
    }

    pub fn space_folders(&self) -> Result<Vec<(SpaceId, String)>, DriveError> {
        let mut out: Vec<(SpaceId, String)> = self
            .mem()
            .space_folders
            .iter()
            .map(|(space, folder)| (space.clone(), folder.clone()))
            .collect();
        out.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
        Ok(out)
    }

    pub fn space_of_item(&self, id: &ItemId) -> Result<Option<SpaceId>, DriveError> {
        let mem = self.mem();
        let mut by_node = None;
        let mut by_item = None;
        for (space, at) in &mem.spaces {
            if at.nodes.contains_key(id) {
                by_node = Some(space.clone());
                break;
            }
            if by_item.is_none() && at.items.contains_key(id) {
                by_item = Some(space.clone());
            }
        }
        Ok(by_node.or(by_item))
    }

    pub fn save_anchor(&self, spaces: &str) -> Result<i64, DriveError> {
        let token = {
            let mut mem = self.mem();
            let token = mem.next_anchor;
            mem.next_anchor += 1;
            mem.anchors.insert(token, spaces.to_owned());
            let keep_from = token - KEPT_ANCHORS;
            mem.anchors.retain(|at, _| *at > keep_from);
            token
        };
        let spaces = spaces.to_owned();
        self.later(move |connection| {
            exec(
                connection,
                "INSERT INTO anchors (token, spaces) VALUES (?1, ?2)",
                &[&token, &spaces],
            )?;
            exec(
                connection,
                "DELETE FROM anchors WHERE token <= ?1",
                &[&(token - KEPT_ANCHORS)],
            )
        });
        Ok(token)
    }

    pub fn anchor(&self, token: i64) -> Result<Option<String>, DriveError> {
        Ok(self.mem().anchors.get(&token).cloned())
    }

    pub fn cursor(&self, space: &SpaceId) -> Result<Seq, DriveError> {
        Ok(Seq(self.mem().seen(space).map_or(0, |at| at.cursor)))
    }

    pub fn set_cursor(&self, space: &SpaceId, seq: Seq) -> Result<(), DriveError> {
        self.mem().space(space).cursor = seq.0;
        let space = space.clone();
        self.later(move |connection| {
            exec(
                connection,
                "INSERT INTO cursor (space, seq) VALUES (?1, ?2)
                 ON CONFLICT(space) DO UPDATE SET seq = excluded.seq",
                &[&space.0, &seq.0],
            )
        });
        Ok(())
    }

    pub fn touch_local(&self, space: &SpaceId, id: &ItemId) -> Result<(), DriveError> {
        let seq = {
            let mut mem = self.mem();
            let at = mem.space(space);
            if !at.nodes.contains_key(id) {
                return Ok(());
            }
            at.local_cursor += 1;
            let seq = at.local_cursor;
            if let Some(old) = at.local_seq.insert(id.clone(), seq) {
                at.by_local_seq.remove(&(old, id.clone()));
            }
            at.by_local_seq.insert((seq, id.clone()));
            self.persist(&mem, space, id);
            seq
        };
        let space = space.clone();
        self.later(move |connection| {
            exec(
                connection,
                "INSERT INTO local_cursor (space, seq) VALUES (?1, ?2)
                 ON CONFLICT(space) DO UPDATE SET seq = excluded.seq",
                &[&space.0, &seq],
            )
        });
        Ok(())
    }

    pub fn local_cursor(&self, space: &SpaceId) -> Result<i64, DriveError> {
        Ok(self.mem().seen(space).map_or(0, |at| at.local_cursor))
    }

    pub fn nodes_since_local(
        &self,
        space: &SpaceId,
        since: i64,
        limit: usize,
    ) -> Result<Vec<(NodeRow, i64)>, DriveError> {
        let mem = self.mem();
        let Some(at) = mem.seen(space) else {
            return Ok(Vec::new());
        };
        Ok(at
            .by_local_seq
            .range((since + 1, ItemId(String::new()))..)
            .take(limit)
            .filter_map(|(seq, id)| at.nodes.get(id).map(|node| (node.clone(), *seq)))
            .collect())
    }

    pub fn transfer(
        &self,
        space: &SpaceId,
        id: &ItemId,
    ) -> Result<Option<TransferRow>, DriveError> {
        Ok(self
            .mem()
            .seen(space)
            .and_then(|at| at.transfers.get(id).cloned()))
    }

    pub fn put_transfer(&self, row: &TransferRow) -> Result<(), DriveError> {
        self.mem()
            .space(&row.space)
            .transfers
            .insert(row.id.clone(), row.clone());
        let row = row.clone();
        self.later(move |connection| {
            connection
                .prepare_cached(
                    "INSERT INTO transfers (space, id, sha256, size, upload_id, mode, part_size,
                        parts, done, started_ms, attempts, last_error)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                     ON CONFLICT(space, id) DO UPDATE SET sha256 = excluded.sha256,
                        size = excluded.size, upload_id = excluded.upload_id, mode = excluded.mode,
                        part_size = excluded.part_size, parts = excluded.parts, done = excluded.done,
                        started_ms = excluded.started_ms, attempts = excluded.attempts,
                        last_error = excluded.last_error",
                )?
                .execute(params![
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
                ])?;
            Ok(())
        });
        Ok(())
    }

    pub fn delete_transfer(&self, space: &SpaceId, id: &ItemId) -> Result<(), DriveError> {
        let had = self.mem().space(space).transfers.remove(id).is_some();
        if had {
            let (space, id) = (space.clone(), id.clone());
            self.later(move |connection| {
                exec(
                    connection,
                    "DELETE FROM transfers WHERE space = ?1 AND id = ?2",
                    &[&space.0, &id.0],
                )
            });
        }
        Ok(())
    }

    pub fn set_pin(&self, space: &SpaceId, id: &ItemId, keep: bool) -> Result<(), DriveError> {
        let changed = {
            let mut mem = self.mem();
            let at = mem.space(space);
            if keep {
                at.pins.insert(id.clone())
            } else {
                at.pins.remove(id)
            }
        };
        if changed {
            let (space, id) = (space.clone(), id.clone());
            self.later(move |connection| {
                let sql = if keep {
                    "INSERT OR IGNORE INTO pins (space, item_id) VALUES (?1, ?2)"
                } else {
                    "DELETE FROM pins WHERE space = ?1 AND item_id = ?2"
                };
                exec(connection, sql, &[&space.0, &id.0])
            });
        }
        Ok(())
    }

    pub fn allow_large(&self, space: &SpaceId, id: &ItemId) -> Result<(), DriveError> {
        if self.mem().space(space).large_allowed.insert(id.clone()) {
            let (space, id) = (space.clone(), id.clone());
            self.later(move |connection| {
                exec(
                    connection,
                    "INSERT OR IGNORE INTO large_allowed (space, item_id) VALUES (?1, ?2)",
                    &[&space.0, &id.0],
                )
            });
        }
        Ok(())
    }

    pub fn large_allowed(&self, space: &SpaceId, id: &ItemId) -> bool {
        self.mem()
            .seen(space)
            .is_some_and(|at| at.large_allowed.contains(id))
    }

    pub fn pinned(&self, space: &SpaceId, id: &ItemId) -> Result<bool, DriveError> {
        Ok(self
            .mem()
            .seen(space)
            .is_some_and(|at| at.pins.contains(id)))
    }

    pub fn pins(&self, space: &SpaceId) -> Vec<ItemId> {
        self.mem()
            .seen(space)
            .map(|at| at.pins.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn kept(&self, space: &SpaceId, node: &NodeRow) -> Result<bool, DriveError> {
        let mem = self.mem();
        let Some(at) = mem.seen(space) else {
            return Ok(false);
        };
        if at.pins.is_empty() {
            return Ok(false);
        }
        let mut current = Some(node.id.clone());
        let mut steps = 0;
        while let Some(id) = current {
            if at.pins.contains(&id) {
                return Ok(true);
            }
            steps += 1;
            if steps > 4096 {
                break;
            }
            current = at.nodes.get(&id).and_then(|row| row.parent.clone());
        }
        Ok(false)
    }

    pub fn touch_blob(&self, sha256: &str, size: u64, at_ms: i64) -> Result<(), DriveError> {
        {
            let mut mem = self.mem();
            let before = mem.blobs.insert(sha256.to_owned(), (size, at_ms));
            match before {
                Some((old, _)) => {
                    mem.blob_bytes = mem.blob_bytes.saturating_sub(old) + size;
                }
                None => mem.blob_bytes += size,
            }
        }
        let sha = sha256.to_owned();
        let size = size as i64;
        self.later(move |connection| {
            exec(
                connection,
                "INSERT INTO blobs (sha256, size, last_used_ms) VALUES (?1, ?2, ?3)
                 ON CONFLICT(sha256) DO UPDATE SET last_used_ms = excluded.last_used_ms,
                    size = excluded.size",
                &[&sha, &size, &at_ms],
            )
        });
        Ok(())
    }

    pub fn blobs_by_age(&self) -> Result<Vec<(String, u64)>, DriveError> {
        let mut out: Vec<(String, u64, i64)> = self
            .mem()
            .blobs
            .iter()
            .map(|(sha, (size, used))| (sha.clone(), *size, *used))
            .collect();
        out.sort_by_key(|(_, _, used)| *used);
        Ok(out.into_iter().map(|(sha, size, _)| (sha, size)).collect())
    }

    pub fn cache_size(&self) -> Result<u64, DriveError> {
        Ok(self.mem().blob_bytes)
    }

    pub fn nodes_with_blob(&self, sha256: &str) -> Result<Vec<NodeRow>, DriveError> {
        let mem = self.mem();
        Ok(mem
            .blob_users
            .get(sha256)
            .map(|users| {
                users
                    .iter()
                    .filter_map(|(space, id)| {
                        mem.seen(space).and_then(|at| at.nodes.get(id).cloned())
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    pub fn forget_blob(&self, sha256: &str) -> Result<(), DriveError> {
        {
            let mut mem = self.mem();
            if let Some((size, _)) = mem.blobs.remove(sha256) {
                mem.blob_bytes = mem.blob_bytes.saturating_sub(size);
            }
        }
        let sha = sha256.to_owned();
        self.later(move |connection| {
            exec(connection, "DELETE FROM blobs WHERE sha256 = ?1", &[&sha])
        });
        Ok(())
    }

    pub fn forget_space(&self, space: &SpaceId) -> Result<(), DriveError> {
        {
            let mut mem = self.mem();
            let ids: Vec<ItemId> = mem
                .seen(space)
                .map(|at| at.nodes.keys().cloned().collect())
                .unwrap_or_default();
            for id in ids {
                mem.take_node(space, &id);
            }
            mem.spaces.remove(space);
            mem.space_folders.remove(space);
        }
        let space = space.clone();
        self.later(move |connection| {
            for sql in [
                "DELETE FROM items WHERE space = ?1",
                "DELETE FROM base WHERE space = ?1",
                "DELETE FROM nodes WHERE space = ?1",
                "DELETE FROM transfers WHERE space = ?1",
                "DELETE FROM pins WHERE space = ?1",
                "DELETE FROM large_allowed WHERE space = ?1",
                "DELETE FROM cursor WHERE space = ?1",
                "DELETE FROM local_cursor WHERE space = ?1",
                "DELETE FROM space_folders WHERE space = ?1",
            ] {
                exec(connection, sql, &[&space.0])?;
            }
            Ok(())
        });
        Ok(())
    }
}

impl Drop for Store {
    fn drop(&mut self) {
        {
            let send = self
                .send
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let _ = send.send(Message::Stop);
        }
        if let Some(writer) = self
            .writer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            let _ = writer.join();
        }
    }
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
        assert!(store.node_at(&space, "/X/A/B").unwrap().is_some());
        assert!(store.node_at(&space, "/A/B").unwrap().is_none());
        assert!(store
            .move_node(&space, &ItemId("d".into()), Some(&ItemId("b".into())), "X")
            .is_err());
    }

    #[test]
    fn key_cursor_paging_stays_put_when_entries_go() {
        let store = store();
        let space = SpaceId("s".into());
        for index in 0..10 {
            store
                .insert_node(&folder(
                    &space,
                    &format!("f{index}"),
                    None,
                    &format!("F{index}"),
                ))
                .unwrap();
        }
        let (first, cursor) = store.children_page(&space, None, None, 4);
        assert_eq!(first.len(), 4);
        let cursor = cursor.expect("more to come");
        let text = cursor.cursor();
        assert_eq!(ChildKey::from_cursor(&text), Some(cursor.clone()));
        store.remove_node(&space, &first[0].id).unwrap();
        store.remove_node(&space, &first[1].id).unwrap();
        let (second, next) = store.children_page(&space, None, Some(&cursor), 4);
        let names: Vec<&str> = second.iter().map(|node| node.name.as_str()).collect();
        assert_eq!(names, ["F4", "F5", "F6", "F7"]);
        let (third, last) = store.children_page(&space, None, next.as_ref(), 4);
        let names: Vec<&str> = third.iter().map(|node| node.name.as_str()).collect();
        assert_eq!(names, ["F8", "F9"]);
        assert!(last.is_none());
    }

    #[test]
    fn records_survive_a_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("drive.db");
        let space = SpaceId("s".into());
        {
            let store = Store::with_connection(Connection::open(&path).unwrap()).unwrap();
            store.insert_node(&folder(&space, "a", None, "A")).unwrap();
            store
                .insert_node(&folder(&space, "b", Some("a"), "B"))
                .unwrap();
            store.set_pin(&space, &ItemId("b".into()), true).unwrap();
            store.set_cursor(&space, Seq(7)).unwrap();
            store.flush();
        }
        let store = Store::with_connection(Connection::open(&path).unwrap()).unwrap();
        let b = store.node_at(&space, "/A/B").unwrap().expect("kept");
        assert!(store.kept(&space, &b).unwrap());
        assert_eq!(store.cursor(&space).unwrap(), Seq(7));
        let fresh = store.insert_node(&folder(&space, "c", None, "C")).unwrap();
        assert!(fresh.ino > b.ino);
    }

    #[test]
    fn content_version_survives_a_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("drive.db");
        let space = SpaceId("s".into());
        let item: Item = serde_json::from_value(serde_json::json!({
            "id": "drv_a", "space_id": "s", "parent_id": null, "name": "notes.txt", "kind": "file",
            "sha256": "a", "size": 1, "mtime_ms": 5, "version": 4, "seq": 9, "content_version": 2
        }))
        .unwrap();
        assert_eq!(item.content_version, Some(Version(2)));
        let older: Item = serde_json::from_value(serde_json::json!({
            "id": "drv_b", "space_id": "s", "name": "old.txt", "kind": "file", "version": 3, "seq": 10
        }))
        .unwrap();
        assert_eq!(older.content_version, None);
        {
            let store = Store::with_connection(Connection::open(&path).unwrap()).unwrap();
            store.put_item(&item).unwrap();
            store.put_base(&space, &Base::of(&item)).unwrap();
            store.put_item(&older).unwrap();
            store.put_base(&space, &Base::of(&older)).unwrap();
            store.flush();
        }
        let store = Store::with_connection(Connection::open(&path).unwrap()).unwrap();
        let id = ItemId("drv_a".into());
        assert_eq!(
            store.item(&space, &id).unwrap().unwrap().content_version,
            Some(Version(2))
        );
        let base = store.base(&space, &id).unwrap().unwrap();
        assert_eq!(
            (base.version, base.content_version),
            (Version(4), Some(Version(2)))
        );
        let old = ItemId("drv_b".into());
        assert_eq!(
            store.base(&space, &old).unwrap().unwrap().content_version,
            None
        );
    }
}
