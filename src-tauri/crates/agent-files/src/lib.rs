//! Folder organization authority lives on the device. Models receive opaque item IDs and
//! relative names; they cannot select a root, overwrite, delete, or execute code.
#![cfg(any(unix, windows))]
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    path::{Component, Path, PathBuf},
};

mod platform;
use platform::{
    absent, child, fingerprint, make_folder, open_root, refused_scope, remove_folder,
    rename_exclusive, sync_folder,
};
use uuid::Uuid;

mod effects;
mod listing;
mod plan;
use listing::scan;

type Result<T> = std::result::Result<T, String>;
const MAX_ITEMS: usize = 500;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct Fingerprint {
    device: u64,
    inode: u64,
    size: u64,
    modified: i64,
    nanos: i64,
}
fn identity(file: &File) -> Result<(u64, u64)> {
    let f = fingerprint(file)?;
    Ok((f.device, f.inode))
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn parts(path: &str) -> Result<Vec<String>> {
    if path.is_empty() || path.contains('\\') || path.contains('\0') {
        return Err("Invalid relative name".into());
    }
    let mut names = Vec::new();
    for c in Path::new(path).components() {
        match c {
            Component::Normal(s) if !s.to_string_lossy().starts_with('.') => {
                names.push(s.to_str().ok_or("Invalid filename")?.to_owned())
            }
            _ => return Err("Only visible paths inside the selected folder are permitted".into()),
        }
    }
    if names.is_empty() || names.len() > 16 {
        return Err("Invalid path depth".into());
    }
    Ok(names)
}
fn parent(root: &File, path: &str) -> Result<(File, String)> {
    let mut names = parts(path)?;
    let name = names.pop().unwrap();
    let mut dir = root.try_clone().map_err(err)?;
    for name in names {
        dir = child(&dir, &name, true)?;
    }
    Ok((dir, name))
}
fn open_item(root: &File, path: &str) -> Result<File> {
    let (dir, name) = parent(root, path)?;
    child(&dir, &name, false)
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub name: String,
    pub relative_path: String,
    pub directory: bool,
    pub size: u64,
    fingerprint: Fingerprint,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub grant_id: String,
    pub folder_name: String,
    pub items: Vec<Item>,
    pub excluded: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Step {
    Move {
        source_id: String,
        destination: String,
    },
    Mkdir {
        destination: String,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub index: usize,
    pub from: Option<String>,
    pub to: String,
    pub state: String,
    pub error: Option<String>,
    fingerprint: Option<Fingerprint>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub grant_id: String,
    pub state: String,
    pub receipts: Vec<Receipt>,
    steps: Vec<Step>,
}
#[derive(Serialize, Deserialize)]
struct Grant {
    account: String,
    root: PathBuf,
    root_identity: (u64, u64),
    snapshot: Snapshot,
    revoked: bool,
}
/// Serialized by the native command host. A manifest is journaled before every effect: each
/// save is its own committed transaction (WAL, `synchronous=FULL`), so it is on disk when
/// the call returns and the effect only happens after.
pub struct Organizer {
    database: PathBuf,
    grants: HashMap<String, Grant>,
}
const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS agent_file_grants (
        id TEXT PRIMARY KEY, document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_file_manifests (
        id TEXT PRIMARY KEY, document TEXT NOT NULL, saved_at INTEGER NOT NULL);";
impl Organizer {
    fn connect(database: &Path) -> Result<rusqlite::Connection> {
        let connection = rusqlite::Connection::open(database).map_err(err)?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(err)?;
        connection
            .execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;")
            .map_err(err)?;
        connection.execute_batch(SCHEMA).map_err(err)?;
        Ok(connection)
    }
    /// `database` is the SQLite file the journal lives in (Misty's `misty.db`).
    pub fn new(database: PathBuf) -> Result<Self> {
        if let Some(parent) = database.parent() {
            fs::create_dir_all(parent).map_err(err)?;
        }
        let connection = Self::connect(&database)?;
        let mut grants = HashMap::new();
        let mut statement = connection
            .prepare("SELECT document FROM agent_file_grants")
            .map_err(err)?;
        for document in statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(err)?
        {
            let grant: Grant = serde_json::from_str(&document.map_err(err)?).map_err(err)?;
            grants.insert(grant.snapshot.grant_id.clone(), grant);
        }
        drop(statement);
        drop(connection);
        Ok(Self { database, grants })
    }
    fn save<T: Serialize>(&self, id: &str, kind: &str, value: &T) -> Result<()> {
        Uuid::parse_str(id).map_err(err)?;
        let document = serde_json::to_string(value).map_err(err)?;
        let connection = Self::connect(&self.database)?;
        let saved = if kind == "grant" {
            connection.execute(
                "INSERT INTO agent_file_grants (id, document) VALUES (?1, ?2)
                 ON CONFLICT (id) DO UPDATE SET document = excluded.document",
                rusqlite::params![id, document],
            )
        } else {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_millis() as i64);
            connection.execute(
                "INSERT INTO agent_file_manifests (id, document, saved_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT (id) DO UPDATE SET document = excluded.document, saved_at = excluded.saved_at",
                rusqlite::params![id, document, now],
            )
        };
        saved.map(|_| ()).map_err(err)
    }
    fn manifest_document(&self, id: &str) -> Result<Option<String>> {
        use rusqlite::OptionalExtension;
        Self::connect(&self.database)?
            .query_row(
                "SELECT document FROM agent_file_manifests WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(err)
    }
    /// This may only be called with the result of a user-operated native folder picker.
    pub fn grant(&mut self, account: &str, path: &Path) -> Result<Snapshot> {
        if account.is_empty() {
            return Err("Sign in first".into());
        }
        let canonical = fs::canonicalize(path).map_err(err)?;
        let canonical = platform::plain(&canonical);
        if refused_scope(&canonical) {
            return Err("Choose a specific personal folder, not a disk or system folder".into());
        }
        let root = open_root(&canonical)?;
        let mut snapshot = Snapshot {
            grant_id: Uuid::new_v4().to_string(),
            folder_name: canonical.file_name().unwrap().to_string_lossy().into(),
            items: vec![],
            excluded: vec![],
        };
        scan(&root, &canonical, "", 0, &mut snapshot)?;
        let grant = Grant {
            account: account.into(),
            root: canonical,
            root_identity: identity(&root)?,
            snapshot: snapshot.clone(),
            revoked: false,
        };
        self.save(&snapshot.grant_id, "grant", &grant)?;
        self.grants.insert(snapshot.grant_id.clone(), grant);
        Ok(snapshot)
    }
    fn scope(&self, account: &str, id: &str) -> Result<(&Grant, File)> {
        let grant = self
            .grants
            .get(id)
            .filter(|g| g.account == account && !g.revoked)
            .ok_or("Folder access is unavailable or revoked")?;
        let root = open_root(&grant.root)?;
        if identity(&root)? != grant.root_identity {
            return Err("The selected folder changed".into());
        }
        Ok((grant, root))
    }
    pub fn snapshot(&self, account: &str, id: &str) -> Result<Snapshot> {
        let (grant, _) = self.scope(account, id)?;
        Ok(grant.snapshot.clone())
    }
    pub fn revoke(&mut self, account: &str, id: &str) -> Result<()> {
        let grant = self
            .grants
            .get_mut(id)
            .filter(|g| g.account == account)
            .ok_or("Unknown folder grant")?;
        grant.revoked = true;
        self.save(id, "grant", self.grants.get(id).unwrap())
    }
    pub fn history(&self, account: &str) -> Result<Vec<Manifest>> {
        let ids: Vec<String> = {
            let connection = Self::connect(&self.database)?;
            let mut statement = connection
                .prepare("SELECT id FROM agent_file_manifests ORDER BY saved_at DESC")
                .map_err(err)?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(err)?;
            rows.collect::<std::result::Result<_, _>>().map_err(err)?
        };
        Ok(ids
            .into_iter()
            .filter_map(|id| self.manifest(account, &id).ok())
            .take(20)
            .collect())
    }
    pub fn manifest(&self, account: &str, id: &str) -> Result<Manifest> {
        Uuid::parse_str(id).map_err(err)?;
        let document = self.manifest_document(id)?.ok_or("Unknown plan")?;
        let manifest: Manifest = serde_json::from_str(&document).map_err(err)?;
        // Reading a receipt remains possible after revocation; execution does not.
        if !self
            .grants
            .get(&manifest.grant_id)
            .is_some_and(|g| g.account == account)
        {
            return Err("Unknown plan".into());
        }
        Ok(manifest)
    }
}

#[cfg(test)]
mod tests;
