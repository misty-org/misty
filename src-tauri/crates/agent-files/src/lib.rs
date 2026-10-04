//! Folder organization authority lives on the device. Models receive opaque item IDs and
//! relative names; they cannot select a root, overwrite, delete, or execute code.
#![cfg(unix)]
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    ffi::CString,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::fs::{MetadataExt, OpenOptionsExt},
    },
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

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
fn fingerprint(file: &File) -> Result<Fingerprint> {
    let m = file.metadata().map_err(err)?;
    Ok(Fingerprint {
        device: m.dev(),
        inode: m.ino(),
        size: m.len(),
        modified: m.mtime(),
        nanos: m.mtime_nsec(),
    })
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
fn cstring(s: &str) -> Result<CString> {
    CString::new(s).map_err(err)
}
fn child(dir: &File, name: &str, directory: bool) -> Result<File> {
    let name = cstring(name)?;
    let flags = libc::O_RDONLY
        | libc::O_CLOEXEC
        | libc::O_NOFOLLOW
        | libc::O_NONBLOCK
        | if directory { libc::O_DIRECTORY } else { 0 };
    let fd = unsafe { libc::openat(dir.as_raw_fd(), name.as_ptr(), flags) };
    if fd < 0 {
        return Err(err(io::Error::last_os_error()));
    }
    Ok(unsafe { File::from_raw_fd(fd) })
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
fn absent(dir: &File, name: &str) -> Result<()> {
    let name = cstring(name)?;
    let mut m = std::mem::MaybeUninit::<libc::stat>::uninit();
    let result = unsafe {
        libc::fstatat(
            dir.as_raw_fd(),
            name.as_ptr(),
            m.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    if result == 0 {
        return Err("Destination already exists; nothing was overwritten".into());
    }
    let error = io::Error::last_os_error();
    if error.kind() != io::ErrorKind::NotFound {
        return Err(err(error));
    }
    Ok(())
}
fn rename_exclusive(from: &File, source: &str, to: &File, destination: &str) -> Result<()> {
    let source = cstring(source)?;
    let destination = cstring(destination)?;
    #[cfg(target_os = "macos")]
    let result = unsafe {
        libc::renameatx_np(
            from.as_raw_fd(),
            source.as_ptr(),
            to.as_raw_fd(),
            destination.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::renameat2(
            from.as_raw_fd(),
            source.as_ptr(),
            to.as_raw_fd(),
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    return Err("Atomic no-replace moves are unavailable on this platform".into());
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    if result != 0 {
        return Err(err(io::Error::last_os_error()));
    }
    Ok(())
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
/// Serialized by the native command host. A manifest is journaled before every effect.
pub struct Organizer {
    journal: PathBuf,
    grants: HashMap<String, Grant>,
}
impl Organizer {
    pub fn new(journal: PathBuf) -> Result<Self> {
        fs::create_dir_all(&journal).map_err(err)?;
        let mut grants = HashMap::new();
        for entry in fs::read_dir(&journal).map_err(err)? {
            let path = entry.map_err(err)?.path();
            if path.extension().and_then(|s| s.to_str()) == Some("grant") {
                let grant: Grant =
                    serde_json::from_slice(&fs::read(path).map_err(err)?).map_err(err)?;
                grants.insert(grant.snapshot.grant_id.clone(), grant);
            }
        }
        Ok(Self { journal, grants })
    }
    fn save<T: Serialize>(&self, id: &str, extension: &str, value: &T) -> Result<()> {
        Uuid::parse_str(id).map_err(err)?;
        let path = self.journal.join(format!("{id}.{extension}"));
        let temporary = self.journal.join(format!("{}.tmp", Uuid::new_v4()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(err)?;
        file.write_all(&serde_json::to_vec(value).map_err(err)?)
            .map_err(err)?;
        file.sync_all().map_err(err)?;
        fs::rename(&temporary, &path).map_err(err)?;
        File::open(&self.journal)
            .and_then(|dir| dir.sync_all())
            .map_err(err)
    }
    /// This may only be called with the result of a user-operated native folder picker.
    pub fn grant(&mut self, account: &str, path: &Path) -> Result<Snapshot> {
        if account.is_empty() {
            return Err("Sign in first".into());
        }
        let canonical = fs::canonicalize(path).map_err(err)?;
        // Whole disks, home directories and operating-system roots are never organization scopes.
        let count = canonical.components().count();
        if count < 4
            || [
                "/System",
                "/Library",
                "/Applications",
                "/bin",
                "/sbin",
                "/usr",
                "/etc",
                "/private/etc",
                "/private/var/db",
                "/dev",
                "/proc",
                "/sys",
            ]
            .iter()
            .any(|p| canonical.starts_with(p))
            || std::env::var_os("HOME").is_some_and(|home| {
                canonical == Path::new(&home)
                    || canonical.starts_with(Path::new(&home).join("Library"))
            })
        {
            return Err("Choose a specific personal folder, not a disk or system folder".into());
        }
        let root = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
            .open(&canonical)
            .map_err(err)?;
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
        let root = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
            .open(&grant.root)
            .map_err(err)?;
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
    pub fn prepare(
        &self,
        account: &str,
        grant_id: &str,
        plan_id: &str,
        steps: Vec<Step>,
    ) -> Result<Manifest> {
        Uuid::parse_str(plan_id).map_err(err)?;
        let (grant, root) = self.scope(account, grant_id)?;
        if self.journal.join(format!("{plan_id}.manifest")).exists() {
            let existing = self.manifest(account, plan_id)?;
            if existing.grant_id != grant_id || existing.steps != steps {
                return Err("Plan identity was reused with different operations".into());
            }
            return Ok(existing);
        }
        if steps.is_empty() || steps.len() > 100 {
            return Err("A plan must contain 1–100 operations".into());
        }
        let mut sources = HashSet::new();
        let mut destinations = HashSet::new();
        let mut created = HashSet::new();
        let mut receipts = vec![];
        for (index, step) in steps.iter().enumerate() {
            let (destination, source) = match step {
                Step::Move {
                    source_id,
                    destination,
                } => (destination, Some(source_id)),
                Step::Mkdir { destination } => (destination, None),
            };
            let names = parts(destination)?;
            if !destinations.insert(destination.to_lowercase()) {
                return Err("Duplicate destination in the proposal".into());
            }
            let parent_path = names[..names.len() - 1].join("/");
            if !parent_path.is_empty() && !created.contains(&parent_path) {
                let dir = open_item(&root, &parent_path)?;
                if !dir.metadata().map_err(err)?.is_dir() {
                    return Err("Destination parent is not a folder".into());
                }
            }
            if let Ok((dir, name)) = parent(&root, destination) {
                absent(&dir, &name)?;
            }
            let (from, fp) = if let Some(id) = source {
                if !sources.insert(id) {
                    return Err("A source can only move once in a plan".into());
                }
                let item = grant
                    .snapshot
                    .items
                    .iter()
                    .find(|i| &i.id == id && !i.directory)
                    .ok_or("Source is not a granted regular file")?;
                let current = open_item(&root, &item.relative_path)?;
                if !current.metadata().map_err(err)?.is_file()
                    || fingerprint(&current)? != item.fingerprint
                {
                    return Err("A source changed after planning; refresh the proposal".into());
                }
                (
                    Some(item.relative_path.clone()),
                    Some(item.fingerprint.clone()),
                )
            } else {
                created.insert(destination.clone());
                (None, None)
            };
            receipts.push(Receipt {
                index,
                from,
                to: destination.clone(),
                state: "pending".into(),
                error: None,
                fingerprint: fp,
            });
        }
        let manifest = Manifest {
            id: plan_id.into(),
            grant_id: grant_id.into(),
            state: "prepared".into(),
            receipts,
            steps,
        };
        self.save(plan_id, "manifest", &manifest)?;
        Ok(manifest)
    }
    pub fn history(&self, account: &str) -> Result<Vec<Manifest>> {
        let mut paths = fs::read_dir(&self.journal)
            .map_err(err)?
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.path().extension().and_then(|s| s.to_str()) == Some("manifest"))
            .collect::<Vec<_>>();
        paths.sort_by_key(|entry| {
            std::cmp::Reverse(entry.metadata().and_then(|m| m.modified()).ok())
        });
        Ok(paths
            .into_iter()
            .filter_map(|entry| {
                entry
                    .path()
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .and_then(|id| self.manifest(account, id).ok())
            })
            .take(20)
            .collect())
    }
    pub fn manifest(&self, account: &str, id: &str) -> Result<Manifest> {
        Uuid::parse_str(id).map_err(err)?;
        let manifest: Manifest = serde_json::from_slice(
            &fs::read(self.journal.join(format!("{id}.manifest"))).map_err(err)?,
        )
        .map_err(err)?;
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
    pub fn apply(&self, account: &str, id: &str, canceled: impl Fn() -> bool) -> Result<Manifest> {
        let mut manifest = self.manifest(account, id)?;
        if manifest.state == "completed" || manifest.state == "undone" {
            return Ok(manifest);
        }
        let (_, root) = self.scope(account, &manifest.grant_id)?;
        manifest.state = "running".into();
        self.save(id, "manifest", &manifest)?;
        for index in 0..manifest.receipts.len() {
            if canceled() {
                manifest.state = "paused".into();
                break;
            }
            self.scope(account, &manifest.grant_id)?;
            let receipt = manifest.receipts[index].clone();
            if receipt.state == "completed" {
                continue;
            }
            // A crash after a move but before its receipt is reconciled by inode/freshness.
            if receipt.state == "applying" {
                if let (Some(from), Some(expected)) = (&receipt.from, &receipt.fingerprint) {
                    let source_absent = parent(&root, from)
                        .and_then(|(d, n)| absent(&d, &n))
                        .is_ok();
                    if source_absent
                        && open_item(&root, &receipt.to)
                            .and_then(|f| fingerprint(&f))
                            .ok()
                            .as_ref()
                            == Some(expected)
                    {
                        manifest.receipts[index].state = "completed".into();
                        self.save(id, "manifest", &manifest)?;
                        continue;
                    }
                }
                manifest.receipts[index].state = "uncertain".into();
                manifest.receipts[index].error =
                    Some("Interrupted operation needs inspection; it was not repeated".into());
                manifest.state = "needs_review".into();
                break;
            }
            if receipt.state == "uncertain" || receipt.state == "failed" {
                manifest.state = "needs_review".into();
                break;
            }
            manifest.receipts[index].state = "applying".into();
            manifest.receipts[index].error = None;
            self.save(id, "manifest", &manifest)?;
            let result = (|| {
                let (to, name) = parent(&root, &receipt.to)?;
                absent(&to, &name)?;
                if let Some(from) = &receipt.from {
                    let current = open_item(&root, from)?;
                    if Some(fingerprint(&current)?) != receipt.fingerprint {
                        return Err("Source changed; this operation was not applied".into());
                    }
                    let (source, source_name) = parent(&root, from)?;
                    rename_exclusive(&source, &source_name, &to, &name)?;
                    source.sync_all().map_err(err)?;
                    to.sync_all().map_err(err)?;
                    if Some(fingerprint(&open_item(&root, &receipt.to)?)?) != receipt.fingerprint {
                        return Err(
                            "Moved item changed during verification; inspect the manifest".into(),
                        );
                    }
                } else {
                    let name = cstring(&name)?;
                    if unsafe { libc::mkdirat(to.as_raw_fd(), name.as_ptr(), 0o755) } != 0 {
                        return Err(err(io::Error::last_os_error()));
                    }
                    to.sync_all().map_err(err)?;
                    manifest.receipts[index].fingerprint =
                        Some(fingerprint(&open_item(&root, &receipt.to)?)?);
                }
                Ok(())
            })();
            match result {
                Ok(()) => manifest.receipts[index].state = "completed".into(),
                Err(error) => {
                    manifest.receipts[index].state = "failed".into();
                    manifest.receipts[index].error = Some(error);
                    manifest.state = "needs_review".into();
                }
            }
            self.save(id, "manifest", &manifest)?;
            if manifest.state == "needs_review" {
                break;
            }
        }
        if manifest.receipts.iter().all(|r| r.state == "completed") {
            manifest.state = "completed".into();
        }
        self.save(id, "manifest", &manifest)?;
        Ok(manifest)
    }
    pub fn undo(&self, account: &str, id: &str) -> Result<Manifest> {
        let mut manifest = self.manifest(account, id)?;
        let (_, root) = self.scope(account, &manifest.grant_id)?;
        for index in (0..manifest.receipts.len()).rev() {
            let receipt = manifest.receipts[index].clone();
            if receipt.state == "undone" || receipt.state == "pending" || receipt.state == "failed"
            {
                continue;
            }
            if receipt.state != "completed" {
                return Err("Reconcile interrupted operations before undo".into());
            }
            let result = (|| {
                let current = open_item(&root, &receipt.to)?;
                let actual = fingerprint(&current)?;
                let expected = receipt
                    .fingerprint
                    .as_ref()
                    .ok_or("Missing verification receipt")?;
                if let Some(from) = &receipt.from {
                    if &actual != expected {
                        return Err("The moved file changed; undo did not replace it".into());
                    }
                    let (to, name) = parent(&root, from)?;
                    absent(&to, &name)?;
                    manifest.receipts[index].state = "undoing".into();
                    self.save(id, "manifest", &manifest)?;
                    let (source, source_name) = parent(&root, &receipt.to)?;
                    rename_exclusive(&source, &source_name, &to, &name)?;
                    source.sync_all().map_err(err)?;
                    to.sync_all().map_err(err)?;
                } else {
                    if (actual.device, actual.inode) != (expected.device, expected.inode) {
                        return Err("Created folder changed; undo stopped".into());
                    }
                    // rmdir removes only this newly created, still empty directory.
                    let (dir, name) = parent(&root, &receipt.to)?;
                    let name = cstring(&name)?;
                    manifest.receipts[index].state = "undoing".into();
                    self.save(id, "manifest", &manifest)?;
                    if unsafe { libc::unlinkat(dir.as_raw_fd(), name.as_ptr(), libc::AT_REMOVEDIR) }
                        != 0
                    {
                        return Err(err(io::Error::last_os_error()));
                    }
                    dir.sync_all().map_err(err)?;
                }
                Ok(())
            })();
            if let Err(error) = result {
                manifest.state = "needs_review".into();
                manifest.receipts[index].error = Some(error);
                self.save(id, "manifest", &manifest)?;
                return Ok(manifest);
            }
            manifest.receipts[index].state = "undone".into();
            self.save(id, "manifest", &manifest)?;
        }
        manifest.state = "undone".into();
        self.save(id, "manifest", &manifest)?;
        Ok(manifest)
    }
}
fn scan(
    root: &File,
    absolute: &Path,
    relative: &str,
    depth: usize,
    snapshot: &mut Snapshot,
) -> Result<()> {
    if depth > 8 {
        snapshot.excluded.push(format!("{relative}: depth limit"));
        return Ok(());
    }
    let mut entries = fs::read_dir(absolute)
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        if name.starts_with('.') || entry.file_type().map_err(err)?.is_symlink() {
            snapshot
                .excluded
                .push(format!("{path}: hidden item or link"));
            continue;
        }
        if snapshot.items.len() >= MAX_ITEMS {
            return Err("Choose a smaller folder (at most 500 visible items)".into());
        }
        let item = match open_item(root, &path) {
            Ok(file) => file,
            Err(_) => {
                snapshot.excluded.push(format!("{path}: inaccessible"));
                continue;
            }
        };
        let metadata = item.metadata().map_err(err)?;
        if !metadata.is_file() && !metadata.is_dir() {
            snapshot.excluded.push(format!("{path}: unsupported type"));
            continue;
        }
        snapshot.items.push(Item {
            id: Uuid::new_v4().to_string(),
            name,
            relative_path: path.clone(),
            directory: metadata.is_dir(),
            size: metadata.len(),
            fingerprint: fingerprint(&item)?,
        });
        if metadata.is_dir() {
            if scan(root, &entry.path(), &path, depth + 1, snapshot).is_err() {
                snapshot.excluded.push(format!("{path}: incomplete scan"));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
