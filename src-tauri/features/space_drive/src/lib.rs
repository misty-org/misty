//! Each Space mounted on the computer as a drive: the sync core.
//!
//! The Space's server is the one authority. Every change (new content, rename, move, trash,
//! restore) is one transaction there, so the server puts every change in one order, the order
//! they reach it, and that order decides (`rules`): a text save merges with what came since, a
//! save of anything else is the last and wins, with what it replaced unseen kept in the trash, and
//! a file can't be trashed while anyone has it open. This computer is a cache that asks the
//! server to apply its changes, one at a time, and accepts the answer; it never compares clocks
//! with anyone.
//!
//! - [`Drive`] is one account's drives: `drive.db` (`store`), the change sequence, in-use marks
//!   (`in_use`), the content cache (`cache`) and transfers (`transfer`). One per signed-in
//!   account, inside Misty's own process. It has no Tauri in it; Misty's glue
//!   (`features/spaces_drive`) hands it the network ([`api::Http`]) and hears its [`Events`].
//! - [`OsFace`] is how one OS shows a Space: FUSE on Linux (`face::fuse`), File Provider on macOS
//!   (`face::file_provider`, which talks to the extension over `socket`), Cloud Files on Windows.
//!   A face calls back into [`Drive`] through the methods under "The faces' calls" below.
//!
//! Every delete in a drive becomes a trash move on the server; nothing here deletes for good
//! except [`Drive::purge`], which only the person's own `drive_purge` command calls.
//!
//! Paths: `drive.db` and the cache live in `misty_shared_dir("drive")/<account id>/`; mounts in
//! `~/.misty/mnt/<Space>` (`mnt-dev` for debug builds), named by the glue.

pub mod api;
pub mod bases;
pub mod cache;
pub mod face;
pub mod ignore;
pub mod in_use;
pub mod model;
pub mod names;
pub mod planner;
pub mod rules;
#[cfg(unix)]
pub mod socket;
pub mod store;
mod sync;
pub mod transfer;

use std::{
    collections::{HashMap, HashSet},
    future::Future,
    io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    time::Duration,
};

use tokio::{runtime::Handle, sync::Notify};

pub use api::{Api, ApiError, Device, Http, HttpError};
pub use model::*;
use store::{NodeRow, Store};

/// What can go wrong, in words a person can read.
#[derive(Clone, Debug, thiserror::Error)]
pub enum DriveError {
    #[error("It isn't there any more.")]
    NotFound,
    #[error("Something by that name is already there.")]
    Exists,
    #[error("A folder isn't empty.")]
    NotEmpty,
    #[error("{0}")]
    InUse(String),
    /// Not answered by the drive any more (a delete is never refused for a change made since);
    /// kept for the faces that map it.
    #[error("It changed since.")]
    Changed,
    #[error("That Space's drive isn't on this computer.")]
    NotMounted,
    #[error("Misty couldn't reach the server.")]
    Offline,
    #[error("The download didn't match what's on the server. Try again.")]
    Corrupt,
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Unsupported(String),
    #[error("{0}")]
    Io(String),
    #[error("Misty couldn't read its drive records: {0}")]
    Store(String),
    #[error("{0}")]
    Api(ApiError),
    #[error("{0}")]
    Face(String),
}

impl DriveError {
    pub fn io(error: io::Error) -> Self {
        Self::Io(error.to_string())
    }

    /// The errno a file system call answers with.
    #[cfg(unix)]
    pub fn errno(&self) -> i32 {
        match self {
            Self::NotFound | Self::NotMounted => libc::ENOENT,
            Self::Exists => libc::EEXIST,
            Self::NotEmpty => libc::ENOTEMPTY,
            Self::InUse(_) => libc::EBUSY,
            Self::Changed => libc::EAGAIN,
            Self::Offline => libc::EIO,
            Self::Corrupt => libc::EIO,
            Self::Invalid(_) => libc::EINVAL,
            Self::Unsupported(_) => libc::ENOTSUP,
            Self::Api(ApiError::Forbidden) => libc::EPERM,
            Self::Api(ApiError::InUse(_)) => libc::EBUSY,
            Self::Api(ApiError::NameTaken(_) | ApiError::IdTaken) => libc::EEXIST,
            Self::Api(ApiError::VersionConflict(_)) => libc::EAGAIN,
            Self::Api(ApiError::NotFound | ApiError::Trashed(_) | ApiError::ParentMissing) => {
                libc::ENOENT
            }
            Self::Api(ApiError::Offline) => libc::EIO,
            Self::Api(_) | Self::Io(_) | Self::Store(_) | Self::Face(_) => libc::EIO,
        }
    }

    /// A short code for the socket protocol and the renderer.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotFound => "not_found",
            Self::Exists => "exists",
            Self::NotEmpty => "not_empty",
            Self::InUse(_) => "in_use",
            Self::Changed => "changed",
            Self::NotMounted => "not_mounted",
            Self::Offline => "server_unreachable",
            Self::Corrupt => "corrupt",
            Self::Invalid(_) => "invalid",
            Self::Unsupported(_) => "unsupported",
            Self::Io(_) => "io",
            Self::Store(_) => "store",
            Self::Api(ApiError::Offline) => "server_unreachable",
            Self::Api(ApiError::SignedOut) => "signed_out",
            Self::Api(ApiError::Forbidden) => "forbidden",
            Self::Api(ApiError::InUse(_)) => "in_use",
            Self::Api(ApiError::VersionConflict(_)) => "changed",
            Self::Api(ApiError::NameTaken(_) | ApiError::IdTaken) => "exists",
            Self::Api(ApiError::NotFound | ApiError::Trashed(_) | ApiError::ParentMissing) => {
                "not_found"
            }
            Self::Api(
                ApiError::ResyncRequired
                | ApiError::UploadIncomplete
                | ApiError::TransferUnavailable
                | ApiError::Server { .. },
            ) => "server",
            Self::Face(_) => "face",
        }
    }
}

impl From<ApiError> for DriveError {
    fn from(error: ApiError) -> Self {
        match error {
            ApiError::Offline => Self::Offline,
            ApiError::NotFound => Self::NotFound,
            other => Self::Api(other),
        }
    }
}

/// One mounted Space, as the glue names it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpaceMount {
    pub space: SpaceId,
    /// The Space's own name.
    pub name: String,
    /// Its folder's name on this computer, safe and unique among the mounted Spaces
    /// (`Design team`, `Design team (2)`).
    pub mount_name: String,
    /// `~/.misty/mnt/<mount_name>` (`mnt-dev` in debug builds).
    pub path: PathBuf,
    /// The File Provider domain's identifier, `<account id>.<space id>`.
    pub domain: String,
}

/// How one OS shows a Space. One face per mounted Space; it calls back into [`Drive`].
pub trait OsFace: Send + Sync {
    /// Registers or mounts the Space at its path.
    fn mount(&self, space: &SpaceMount) -> Result<(), DriveError>;
    fn unmount(&self, space: &SpaceId) -> Result<(), DriveError>;
    /// Server changes landed in `drive.db`: these items are new, changed, trashed or purged. A
    /// file whose content changed under a local save (a merge written back) is among them.
    fn changed(&self, space: &SpaceId, items: &[Item]);
    /// Drops the item's downloaded content, keeping its name.
    fn evict(&self, space: &SpaceId, item: &ItemId) -> Result<(), DriveError>;
}

/// What the drive tells Misty: the glue turns these into `misty://drive-status`,
/// `misty://drive-changed` and `misty://drive-notice`, and records agents' trash.
pub trait Events: Send + Sync {
    fn status(&self, status: &DriveStatus);
    fn changed(&self, space: &SpaceId, entries: &[ChangedEntry]);
    fn notice(&self, notice: &Notice);
    /// An agent's trash reached the server (held). The glue keeps which agent and chat in
    /// `files_agent_trash`; the drive forgets them.
    fn agent_trashed(&self, record: &AgentTrash);
}

/// One account's drive settings, from the glue.
#[derive(Clone, Debug)]
pub struct DriveConfig {
    /// `misty_shared_dir("drive")/<account id>`: `drive.db`, the cache and temporary files.
    pub data_dir: PathBuf,
    pub account_id: String,
    pub device: Device,
    /// The signed-in person's name, for what this computer shows as theirs. Asked of the server
    /// when missing.
    pub person_name: Option<String>,
    /// The content cache's limit at start (a device setting; `u64::MAX` is no limit). The
    /// running drive's is changed with `Drive::set_cache_limit`.
    pub cache_limit_bytes: u64,
    /// Whether downloaded content lives in the cache (the FUSE face) or with the OS.
    pub content_in_cache: bool,
    /// Wait out throttling and lost connections with backoff. Tests turn it off.
    pub patient: bool,
    /// The longest Misty waits after asking whether an item is in use before trashing it.
    pub in_use_wait_cap: Duration,
    /// Run sync rounds by themselves (on a nudge, a local change and every 30 s). Tests turn it
    /// off and call `sync_now`.
    pub background: bool,
}

impl DriveConfig {
    pub fn new(data_dir: PathBuf, account_id: String, device: Device) -> Self {
        Self {
            data_dir,
            account_id,
            device,
            person_name: None,
            cache_limit_bytes: 10 * 1024 * 1024 * 1024,
            content_in_cache: cfg!(target_os = "linux"),
            patient: true,
            in_use_wait_cap: Duration::from_secs(5),
            background: true,
        }
    }
}

/// What the person asked to make with [`Drive::create`].
#[derive(Clone, Debug)]
pub struct NewNode {
    /// `None` is the drive's root.
    pub parent: Option<ItemId>,
    pub name: String,
    pub kind: Kind,
    /// A file's content, moved into the cache. `None` is an empty file.
    pub content: Option<PathBuf>,
    pub mtime_ms: i64,
    /// The id to give it, when the caller made one already (the macOS extension hands its id to
    /// the system at creation, offline too). Made here when `None`.
    pub id: Option<ItemId>,
}

/// One item as a face sees it.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Node {
    /// Stable for the item's life on this computer: FUSE's inode is this plus one (1 is a
    /// mount's root).
    pub ino: u64,
    pub space: SpaceId,
    pub id: ItemId,
    pub parent: Option<ItemId>,
    /// This computer's name for it.
    pub name: String,
    pub kind: Kind,
    pub size: u64,
    pub mtime_ms: i64,
    pub sha256: Option<String>,
    /// The server version this computer last agreed on; `None` before the server has it.
    pub version: Option<Version>,
    /// `/`-rooted path in the drive.
    pub path: String,
    pub state: LocalState,
    pub downloaded: bool,
    /// When it was last used on this computer (an open that lasted, or the OS's last-used
    /// date), in milliseconds since 1970; 0 when never.
    #[serde(default)]
    pub last_used_ms: i64,
}

pub(crate) type Key = (SpaceId, ItemId);

pub(crate) struct Mounted {
    pub mount: SpaceMount,
    pub face: Arc<dyn OsFace>,
    /// Where the OS shows the Space's files, for open-file checks: the mount, or on macOS the
    /// domain's folder in `~/Library/CloudStorage`.
    pub os_root: RwLock<PathBuf>,
    pub kick: Notify,
    pub stop: AtomicBool,
    pub round: tokio::sync::Mutex<()>,
    pub status: Mutex<DriveStatus>,
    /// Items this computer holds a server mark on, and when it was last renewed.
    pub marked: Mutex<HashMap<ItemId, std::time::Instant>>,
    /// A read of the Space's marks is waiting out its debounce after a `drive.in_use`.
    pub marks_pending: AtomicBool,
    /// How the last trash move of each item went, for `trash_now`.
    pub trash_results: Mutex<HashMap<ItemId, Result<(), DriveError>>>,
    pub task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

pub(crate) struct Inner {
    pub config: DriveConfig,
    pub store: Store,
    pub api: Api,
    pub cache: cache::Cache,
    /// Each text file's content at its base version, for merges.
    pub bases: bases::Bases,
    pub events: Arc<dyn Events>,
    pub opens: in_use::Opens,
    /// Every computer's in-use marks in each mounted Space, as the server last listed them.
    pub marks: in_use::Marks,
    pub spaces: RwLock<HashMap<SpaceId, Arc<Mounted>>>,
    pub runtime: Handle,
    pub person: RwLock<Option<String>>,
    /// Downloads under way, by content, so two asks for one file fetch it once.
    pub fetching: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    pub downloading: Mutex<HashSet<Key>>,
    /// The content cache's limit now, from the config and then `Drive::set_cache_limit`.
    pub cache_limit: AtomicU64,
    /// Syncing is paused (Settings › Server › Drive): local changes wait, nothing goes up or down,
    /// until it is turned back on. Not kept across a restart.
    pub paused: AtomicBool,
}

/// One account's drives. Cheap to clone; every clone is the same drives.
#[derive(Clone)]
pub struct Drive {
    pub(crate) inner: Arc<Inner>,
}

fn read<T>(lock: &RwLock<T>) -> std::sync::RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn write<T>(lock: &RwLock<T>) -> std::sync::RwLockWriteGuard<'_, T> {
    lock.write().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Drive {
    /// Opens the account's `drive.db` and cache. Nothing is mounted yet. (`open` is a face's
    /// call: opening an item.)
    pub fn start(
        config: DriveConfig,
        http: Arc<dyn Http>,
        events: Arc<dyn Events>,
        runtime: Handle,
    ) -> Result<Self, DriveError> {
        file_access::fs::create_dir_all(&config.data_dir).map_err(DriveError::io)?;
        let store = Store::open(&config.data_dir.join("drive.db"))?;
        let cache = cache::Cache::new(&config.data_dir, config.content_in_cache);
        cache.sweep_temp();
        let bases = bases::Bases::new(&config.data_dir);
        bases.sweep_temp();
        let mut api = Api::new(http, config.device.clone());
        api.patient = config.patient;
        let person = config.person_name.clone();
        let cache_limit = AtomicU64::new(config.cache_limit_bytes);
        Ok(Self {
            inner: Arc::new(Inner {
                config,
                store,
                api,
                cache,
                bases,
                events,
                opens: in_use::Opens::default(),
                marks: in_use::Marks::default(),
                spaces: RwLock::new(HashMap::new()),
                runtime,
                person: RwLock::new(person),
                fetching: Mutex::new(HashMap::new()),
                downloading: Mutex::new(HashSet::new()),
                cache_limit,
                paused: AtomicBool::new(false),
            }),
        })
    }

    pub fn config(&self) -> &DriveConfig {
        &self.inner.config
    }

    /// Runs `work` to its end from a thread outside the runtime, such as a FUSE thread.
    pub fn block_on<F: Future>(&self, work: F) -> F::Output {
        self.inner.runtime.block_on(work)
    }

    pub fn runtime(&self) -> &Handle {
        &self.inner.runtime
    }

    /// A new limit for the content cache (`u64::MAX`: no limit), from Settings. What's over it
    /// is evicted with each Space's next round, which this asks for.
    pub fn set_cache_limit(&self, bytes: u64) {
        self.inner.cache_limit.store(bytes, Ordering::SeqCst);
        let spaces: Vec<SpaceId> = read(&self.inner.spaces).keys().cloned().collect();
        for space in spaces {
            self.kick(&space);
        }
    }

    /// Pauses or resumes syncing for every Space. Resuming asks each Space for a round at once.
    pub fn set_paused(&self, paused: bool) {
        self.inner.paused.store(paused, Ordering::SeqCst);
        if !paused {
            let spaces: Vec<SpaceId> = read(&self.inner.spaces).keys().cloned().collect();
            for space in spaces {
                self.kick(&space);
            }
        }
    }

    /// Whether syncing is paused now.
    pub fn paused(&self) -> bool {
        self.inner.paused.load(Ordering::SeqCst)
    }

    /// The content cache's limit now.
    pub fn cache_limit(&self) -> u64 {
        self.inner.cache_limit.load(Ordering::SeqCst)
    }

    /// The person's name, once known.
    pub fn set_person_name(&self, name: Option<String>) {
        if name.is_some() {
            *write(&self.inner.person) = name;
        }
    }

    // Mounting.

    /// Mounts a Space through `face` and starts keeping it in sync.
    pub fn mount(&self, mount: SpaceMount, face: Arc<dyn OsFace>) -> Result<(), DriveError> {
        let space = mount.space.clone();
        if read(&self.inner.spaces).contains_key(&space) {
            return Ok(());
        }
        let mounted = Arc::new(Mounted {
            os_root: RwLock::new(mount.path.clone()),
            mount: mount.clone(),
            face: face.clone(),
            kick: Notify::new(),
            stop: AtomicBool::new(false),
            round: tokio::sync::Mutex::new(()),
            status: Mutex::new(DriveStatus {
                space_id: space.clone(),
                status: StatusKind::Syncing,
                message: None,
                pending_uploads: 0,
                pending_downloads: 0,
            }),
            marked: Mutex::new(HashMap::new()),
            marks_pending: AtomicBool::new(false),
            trash_results: Mutex::new(HashMap::new()),
            task: Mutex::new(None),
        });
        write(&self.inner.spaces).insert(space.clone(), mounted.clone());
        if let Err(error) = face.mount(&mount) {
            write(&self.inner.spaces).remove(&space);
            return Err(error);
        }
        if self.inner.config.background {
            let inner = self.inner.clone();
            let task = self.inner.runtime.spawn(async move {
                sync::run(inner, space).await;
            });
            *lock(&mounted.task) = Some(task);
        }
        Ok(())
    }

    /// Stops syncing a Space and takes its face down. What `drive.db` knows stays, so mounting
    /// again carries on; `forget` drops it too (the person left the Space).
    pub fn unmount(&self, space: &SpaceId, forget: bool) -> Result<(), DriveError> {
        let Some(mounted) = write(&self.inner.spaces).remove(space) else {
            if forget {
                self.forget(space)?;
            }
            return Ok(());
        };
        mounted.stop.store(true, Ordering::SeqCst);
        mounted.kick.notify_one();
        if let Some(task) = lock(&mounted.task).take() {
            task.abort();
        }
        let result = mounted.face.unmount(space);
        self.inner.marks.forget(space);
        if forget {
            self.forget(space)?;
        }
        result
    }

    fn forget(&self, space: &SpaceId) -> Result<(), DriveError> {
        for node in self.inner.store.nodes(space)? {
            self.inner.bases.remove(&node.id);
        }
        self.inner.store.forget_space(space)
    }

    /// Every mounted Space.
    pub fn mounted(&self) -> Vec<SpaceMount> {
        read(&self.inner.spaces)
            .values()
            .map(|mounted| mounted.mount.clone())
            .collect()
    }

    pub fn mount_of(&self, space: &SpaceId) -> Option<SpaceMount> {
        read(&self.inner.spaces)
            .get(space)
            .map(|mounted| mounted.mount.clone())
    }

    /// The Space a File Provider domain (`<account id>.<space id>`) names.
    pub fn space_of_domain(&self, domain: &str) -> Option<SpaceId> {
        read(&self.inner.spaces)
            .values()
            .find(|mounted| mounted.mount.domain == domain)
            .map(|mounted| mounted.mount.space.clone())
    }

    /// Where the OS shows a Space's files, when that isn't the mount itself (macOS).
    pub fn set_os_root(&self, space: &SpaceId, root: PathBuf) {
        if let Some(mounted) = read(&self.inner.spaces).get(space) {
            *write(&mounted.os_root) = root;
        }
    }

    /// Unmounts everything, as Misty quits or the account signs out.
    pub fn shutdown(&self) {
        let spaces: Vec<SpaceId> = read(&self.inner.spaces).keys().cloned().collect();
        for space in spaces {
            let _ = self.unmount(&space, false);
        }
    }

    // Syncing.

    /// Asks for a sync round soon.
    pub fn kick(&self, space: &SpaceId) {
        if let Some(mounted) = read(&self.inner.spaces).get(space) {
            mounted.kick.notify_one();
        }
    }

    /// Runs one whole sync round now and waits for it: changes down, local changes up, marks
    /// renewed.
    pub async fn sync_now(&self, space: &SpaceId) -> Result<(), DriveError> {
        sync::round(&self.inner, space).await
    }

    pub fn status(&self, space: &SpaceId) -> Option<DriveStatus> {
        read(&self.inner.spaces)
            .get(space)
            .map(|mounted| lock(&mounted.status).clone())
    }

    pub fn statuses(&self) -> Vec<DriveStatus> {
        read(&self.inner.spaces)
            .values()
            .map(|mounted| lock(&mounted.status).clone())
            .collect()
    }

    /// A realtime `drive.*` event the renderer forwarded (`drive_realtime_event`): `drive.changed
    /// {seq}`, `drive.in_use_check {item_id}`, `drive.in_use {item_id}` (who has something open changed: the Space's marks are read again).
    /// `age` is how long ago the server sent it, when known: an in-use check older than ten
    /// seconds was replayed from the realtime cursor and is ignored.
    pub async fn realtime(
        &self,
        space: &SpaceId,
        kind: &str,
        payload: &serde_json::Value,
        age: Option<Duration>,
    ) {
        sync::realtime(&self.inner, space, kind, payload, age).await;
    }

    // The faces' calls.

    /// The children of a folder (`None`: the drive's root), without what waits to be trashed.
    pub fn list(&self, space: &SpaceId, folder: Option<&ItemId>) -> Result<Vec<Node>, DriveError> {
        Ok(self
            .inner
            .store
            .children(space, folder)?
            .iter()
            .filter(|node| !node.trash_pending)
            .map(|node| self.inner.node_view(node))
            .collect())
    }

    /// The child of `folder` named `name`, matched in NFC; exactly on Linux, ignoring case
    /// elsewhere (as the OS's own disks do).
    pub fn lookup(
        &self,
        space: &SpaceId,
        folder: Option<&ItemId>,
        name: &str,
    ) -> Result<Option<Node>, DriveError> {
        let wanted = names::nfc(name);
        let children = self.inner.store.children(space, folder)?;
        let exact = children
            .iter()
            .find(|node| node.name == wanted && !node.trash_pending);
        let found = match exact {
            Some(node) => Some(node),
            None if !cfg!(target_os = "linux") => children.iter().find(|node| {
                !node.trash_pending && names::fold(&node.name) == names::fold(&wanted)
            }),
            None => None,
        };
        Ok(found.map(|node| self.inner.node_view(node)))
    }

    /// One item by id.
    pub fn node(&self, space: &SpaceId, id: &ItemId) -> Result<Option<Node>, DriveError> {
        Ok(self
            .inner
            .store
            .node(space, id)?
            .filter(|node| self.shown(node))
            .map(|node| self.inner.node_view(&node)))
    }

    /// Whether an item shows: neither it nor a folder it is in waits to go to the trash.
    fn shown(&self, node: &NodeRow) -> bool {
        if node.trash_pending {
            return false;
        }
        let mut parent = node.parent.clone();
        while let Some(at) = parent {
            match self.inner.store.node(&node.space, &at) {
                Ok(Some(folder)) if folder.trash_pending => return false,
                Ok(Some(folder)) => parent = folder.parent,
                _ => break,
            }
        }
        true
    }

    /// One item by its inode less one (FUSE).
    pub fn node_by_ino(&self, ino: u64) -> Result<Option<Node>, DriveError> {
        Ok(self
            .inner
            .store
            .node_by_ino(ino as i64)?
            .filter(|node| self.shown(node))
            .map(|node| self.inner.node_view(&node)))
    }

    /// One item by its drive path.
    pub fn node_at(&self, space: &SpaceId, path: &str) -> Result<Option<Node>, DriveError> {
        let path = names::drive_path(path).map_err(DriveError::Invalid)?;
        Ok(self
            .inner
            .store
            .node_at(space, &path)?
            .filter(|node| self.shown(node))
            .map(|node| self.inner.node_view(&node)))
    }

    /// The item's content in the cache, fetched first if this computer doesn't have it, checked
    /// against its SHA-256. Answers the cached file's path, to read from.
    pub async fn content(&self, space: &SpaceId, id: &ItemId) -> Result<PathBuf, DriveError> {
        sync::content(&self.inner, space, id).await
    }

    /// Fetches the item's content into `to` (the extension's staging file), checked against its
    /// SHA-256 first.
    pub async fn fetch_to(&self, space: &SpaceId, id: &ItemId, to: &Path) -> Result<Node, DriveError> {
        let cached = self.content(space, id).await?;
        if let Some(parent) = to.parent() {
            file_access::fs::create_dir_all(parent).map_err(DriveError::io)?;
        }
        file_access::fs::copy(&cached, to).map_err(DriveError::io)?;
        // The system fetching a file isn't someone using it (Quick Look and Spotlight fetch too);
        // macOS reports real use through the last-used date (`used`).
        let mut node = self.inner.store.node(space, id)?.ok_or(DriveError::NotFound)?;
        node.downloaded = true;
        self.inner.store.update_node(&node)?;
        Ok(self.inner.node_view(&node))
    }

    /// A fresh path in the drive's own temporary folder, for content a face gathers before
    /// handing it to `create` or `write` (which move it into the cache).
    pub fn temp_path(&self) -> PathBuf {
        let path = self.inner.cache.temp_path();
        if let Some(parent) = path.parent() {
            let _ = file_access::fs::create_dir_all(parent);
        }
        path
    }

    /// Where an open file's writes gather until it is closed or synced (the FUSE face).
    pub fn work_path(&self, ino: u64, handle: u64) -> PathBuf {
        let path = self.inner.cache.work_path(ino as i64, handle);
        if let Some(parent) = path.parent() {
            let _ = file_access::fs::create_dir_all(parent);
        }
        path
    }

    /// Makes an item here: a folder, or a file whose content is moved from `content`. It gets its
    /// `drv_` id at once, kept in `drive.db` before anything uploads. Names that an ignore rule,
    /// a junk name or a secret's name leaves out stay on this computer as `not_synced`.
    pub fn create(&self, space: &SpaceId, new: NewNode) -> Result<Node, DriveError> {
        let node = sync::create_local(&self.inner, space, new)?;
        self.kick(space);
        Ok(self.inner.node_view(&node))
    }

    /// `create`, as the macOS extension and the Windows face need it: it never fails because the
    /// name is taken. A new file whose name a file there has is written into that file (a text
    /// save merges, anything else is the last save, the replaced content kept in the trash) and
    /// that file is answered; a new folder whose name a folder has is that folder. Taken by the
    /// other kind, it takes a numbered name. `may_exist` (the system's "may already exist" after
    /// a reset) needs nothing of its own any more: writing the same content changes nothing.
    pub fn create_resolving(
        &self,
        space: &SpaceId,
        mut new: NewNode,
        _may_exist: bool,
    ) -> Result<Node, DriveError> {
        // The same create asked again (its reply was lost): the item it made.
        if let Some(id) = &new.id {
            if let Some(made) = self.node(space, id)? {
                if made.parent == new.parent && made.kind == new.kind {
                    if let Some(path) = &new.content {
                        let _ = file_access::fs::remove_file(path);
                    }
                    return Ok(made);
                }
            }
        }
        let Some(existing) = self.lookup(space, new.parent.as_ref(), &new.name)? else {
            return self.create(space, new);
        };
        match (existing.kind, new.kind) {
            (Kind::Folder, Kind::Folder) => Ok(existing),
            (Kind::File, Kind::File) => {
                let content = match new.content.take() {
                    Some(path) => path,
                    None => {
                        let empty = self.temp_path();
                        file_access::fs::write(&empty, []).map_err(DriveError::io)?;
                        empty
                    }
                };
                // Made from no version of that file: the server keeps all it replaces.
                let node = sync::write_local(
                    &self.inner,
                    space,
                    &existing.id,
                    &content,
                    new.mtime_ms,
                    Some(Version(0)),
                )?;
                sync::wrote(&self.inner, space, &existing.id);
                self.kick(space);
                Ok(self.inner.node_view(&node))
            }
            _ => {
                new.name = sync::unique_name(&self.inner, space, new.parent.as_ref(), &new.name, None)?;
                self.create(space, new)
            }
        }
    }

    /// A change the macOS extension or the Windows face reports, made against `base_version` (the
    /// version its copy came from). It never fails for being out of date, since the system would
    /// only send it again. A rename or move is the latest one, and onto a name another item holds
    /// it trashes that item (both come back if someone has it open). New content goes up saying
    /// it came from `base_version`: a text save merges with what came since, anything else is the
    /// last save, the replaced content kept in the trash. `parent` is `Some(None)` for a move to
    /// the root. The second value is true when the item's content is no longer what was sent, so
    /// the system fetches it again.
    #[allow(clippy::too_many_arguments)]
    pub fn modify(
        &self,
        space: &SpaceId,
        id: &ItemId,
        base_version: Option<Version>,
        name: Option<&str>,
        parent: Option<Option<ItemId>>,
        content: Option<&Path>,
        mtime_ms: i64,
    ) -> Result<(Node, bool), DriveError> {
        let node = self.node(space, id)?.ok_or(DriveError::NotFound)?;
        if name.is_some() || parent.is_some() {
            let folder = parent.clone().unwrap_or_else(|| node.parent.clone());
            let wanted = name.unwrap_or(&node.name).to_owned();
            match self.rename(space, id, folder.as_ref(), &wanted) {
                Ok(_) => {}
                Err(DriveError::Exists) => {
                    // The name is another item's: the later rename wins, and that item goes to
                    // the trash.
                    if let Some(holder) = self
                        .lookup(space, folder.as_ref(), &wanted)?
                        .filter(|holder| &holder.id != id)
                    {
                        self.trash(space, &holder.id, TrashBy::Person)?;
                    }
                    self.rename(space, id, folder.as_ref(), &wanted)?;
                }
                Err(error) => return Err(error),
            }
        }
        let mut refetch = false;
        if let Some(content) = content {
            let written = sync::write_local(&self.inner, space, id, content, mtime_ms, base_version)?;
            sync::wrote(&self.inner, space, id);
            self.kick(space);
            let now = self.node(space, id)?.ok_or(DriveError::NotFound)?;
            refetch = now.sha256 != written.sha256;
        }
        let now = self.node(space, id)?.ok_or(DriveError::NotFound)?;
        Ok((now, refetch))
    }

    /// New content for a file, moved from `content`.
    pub fn write(
        &self,
        space: &SpaceId,
        id: &ItemId,
        content: &Path,
        mtime_ms: i64,
    ) -> Result<Node, DriveError> {
        let node = sync::write_local(&self.inner, space, id, content, mtime_ms, None)?;
        sync::wrote(&self.inner, space, id);
        self.kick(space);
        Ok(self.inner.node_view(&node))
    }

    /// Renames or moves an item within its Space. `folder` `None` is the root.
    pub fn rename(
        &self,
        space: &SpaceId,
        id: &ItemId,
        folder: Option<&ItemId>,
        name: &str,
    ) -> Result<Node, DriveError> {
        let node = sync::rename_local(&self.inner, space, id, folder, name)?;
        if &node.id != id {
            // A save over another file (a temp file renamed into place): that file was written.
            sync::wrote(&self.inner, space, &node.id);
        }
        self.kick(space);
        Ok(self.inner.node_view(&node))
    }

    /// Deletes an item: it leaves the local tree at once and goes to the Space's trash with the
    /// next round, after asking whether anyone has it open. It trashes the item as it is by then,
    /// whatever changed since; only when someone has it open does the server refuse, and then it
    /// comes back with a notice.
    pub fn trash(&self, space: &SpaceId, id: &ItemId, by: TrashBy) -> Result<(), DriveError> {
        sync::trash_local(&self.inner, space, id, &by)?;
        self.kick(space);
        Ok(())
    }

    /// The same, waiting for the server's answer: `InUse` when it refused.
    pub async fn trash_now(&self, space: &SpaceId, id: &ItemId, by: TrashBy) -> Result<(), DriveError> {
        sync::trash_local(&self.inner, space, id, &by)?;
        self.sync_now(space).await?;
        let mounted = self.inner.mounted(space)?;
        let result = lock(&mounted.trash_results).remove(id);
        match result {
            Some(result) => result,
            None if self.inner.store.node(space, id)?.is_none() => Ok(()),
            None => Err(DriveError::Offline),
        }
    }

    /// Opens an item, for reading or for `editing`. It is never refused: being open only stops a
    /// delete. The server marks it in use only if it is still open after `in_use::REPORT_AFTER`
    /// or is written to first, so a brief open (an indexer, a thumbnailer, an antivirus scan)
    /// never marks it on everyone's computers.
    pub async fn open(&self, space: &SpaceId, id: &ItemId, editing: bool) -> Result<(), DriveError> {
        sync::open(&self.inner, space, id, editing).await
    }

    /// Closes what `open` opened, with the same `editing`.
    pub async fn close(&self, space: &SpaceId, id: &ItemId, editing: bool) {
        sync::close(&self.inner, space, id, editing).await;
    }

    /// The item was used at `at_ms` (macOS's last-used date, a preview).
    pub fn used(&self, space: &SpaceId, id: &ItemId, at_ms: i64) -> Result<(), DriveError> {
        if let Some(mut node) = self.inner.store.node(space, id)? {
            if at_ms > node.last_used_ms {
                node.last_used_ms = at_ms;
                self.inner.store.update_node(&node)?;
                self.inner.local_changed(space, id);
            }
        }
        Ok(())
    }

    /// Items whose last change is after `seq`, from `drive.db`, for the extension's sync anchor;
    /// the second value is the next anchor.
    pub fn changes_since(
        &self,
        space: &SpaceId,
        seq: Seq,
        limit: usize,
    ) -> Result<(Vec<Item>, Seq, bool), DriveError> {
        let items = self.inner.store.items_since(space, seq, limit.max(1))?;
        let next = items.last().map(|item| item.seq).unwrap_or(seq);
        let more = items.len() >= limit.max(1);
        Ok((items, next, more))
    }

    /// The Space's newest applied sequence number.
    pub fn current_seq(&self, space: &SpaceId) -> Result<Seq, DriveError> {
        self.inner.store.cursor(space)
    }

    /// Items whose local-only state (last used) changed after the local sequence
    /// number `local`, for the extension's anchor; the second value is the next local number and
    /// the third whether more wait. Items on their way to the trash are left out (the server's
    /// feed brings their end).
    pub fn local_changes_since(
        &self,
        space: &SpaceId,
        local: i64,
        limit: usize,
    ) -> Result<(Vec<Node>, i64, bool), DriveError> {
        let rows = self.inner.store.nodes_since_local(space, local, limit.max(1))?;
        let next = rows.last().map(|(_, seq)| *seq).unwrap_or(local);
        let more = rows.len() >= limit.max(1);
        let nodes = rows
            .iter()
            .filter(|(node, _)| !node.trash_pending)
            .map(|(node, _)| self.inner.node_view(node))
            .collect();
        Ok((nodes, next, more))
    }

    /// The Space's newest local sequence number.
    pub fn current_local_seq(&self, space: &SpaceId) -> Result<i64, DriveError> {
        self.inner.store.local_cursor(space)
    }

    /// The server's item, as `drive.db` last heard it.
    pub fn server_item(&self, space: &SpaceId, id: &ItemId) -> Result<Option<Item>, DriveError> {
        self.inner.store.item(space, id)
    }

    // The renderer's calls (the Tauri commands).

    /// One page of a folder's entries.
    pub fn entries(
        &self,
        space: &SpaceId,
        path: &str,
        cursor: Option<&str>,
        limit: Option<usize>,
    ) -> Result<EntryPage, DriveError> {
        sync::entries(&self.inner, space, path, cursor, limit)
    }

    pub fn entry(&self, space: &SpaceId, path: &str) -> Result<Option<DriveEntry>, DriveError> {
        let path = names::drive_path(path).map_err(DriveError::Invalid)?;
        Ok(self
            .inner
            .store
            .node_at(space, &path)?
            .filter(|node| !node.trash_pending)
            .map(|node| self.inner.entry(&node)))
    }

    pub fn entry_by_id(&self, space: &SpaceId, id: &ItemId) -> Result<Option<DriveEntry>, DriveError> {
        Ok(self
            .inner
            .store
            .node(space, id)?
            .filter(|node| !node.trash_pending)
            .map(|node| self.inner.entry(&node)))
    }

    /// A file's bytes, fetched first if needed.
    pub async fn read_bytes(&self, space: &SpaceId, path: &str) -> Result<Vec<u8>, DriveError> {
        let node = self.node_at(space, path)?.ok_or(DriveError::NotFound)?;
        if node.kind != Kind::File {
            return Err(DriveError::Invalid("That's a folder.".to_owned()));
        }
        let cached = self.content(space, &node.id).await?;
        file_access::fs::read(cached).map_err(DriveError::io)
    }

    /// Writes `bytes` as a file `name` in the folder at `folder`. With `replace`, it is new content
    /// for that item, made against `version`: a text save merges with what came since it,
    /// anything else is the last save, the replaced content kept in the trash.
    pub fn write_bytes(
        &self,
        space: &SpaceId,
        folder: &str,
        name: &str,
        bytes: &[u8],
        replace: Option<(ItemId, Version)>,
    ) -> Result<DriveEntry, DriveError> {
        let entry = sync::write_bytes(&self.inner, space, folder, name, bytes, replace)?;
        sync::wrote(&self.inner, space, &entry.id);
        self.kick(space);
        Ok(entry)
    }

    /// Copies a local folder into the drive at `folder`, under its own name, following its
    /// `.gitignore` and `.mistyignore` and leaving out junk and secrets.
    pub fn copy_in(&self, space: &SpaceId, source: &Path, folder: &str) -> Result<(DriveEntry, CopyReport), DriveError> {
        let out = sync::copy_in(&self.inner, space, source, folder)?;
        self.kick(space);
        Ok(out)
    }

    /// Keep downloaded on or off, for an item and what's under it.
    pub async fn keep_downloaded(&self, space: &SpaceId, path: &str, keep: bool) -> Result<(), DriveError> {
        sync::keep_downloaded(&self.inner, space, path, keep).await
    }

    /// Frees the space of an item's downloaded content (and what's under it), keeping names.
    /// What has changes not uploaded yet, or is open, stays.
    pub fn remove_download(&self, space: &SpaceId, path: &str) -> Result<(), DriveError> {
        sync::remove_download(&self.inner, space, path)
    }

    /// One page of the Space's trash: top-level trashed items, newest first.
    pub async fn trash_list(
        &self,
        space: &SpaceId,
        after: Option<&str>,
        limit: u32,
    ) -> Result<(Vec<TrashEntry>, Option<String>), DriveError> {
        sync::trash_list(&self.inner, space, after, limit).await
    }

    /// Puts a trashed item back. It comes down with the next round.
    pub async fn restore(&self, space: &SpaceId, id: &ItemId) -> Result<Item, DriveError> {
        let item = self.inner.api.restore(space, id).await?;
        self.inner.store.put_item(&item)?;
        self.kick(space);
        Ok(item)
    }

    /// Deletes a trashed item for good. Only the person's own `drive_purge` calls this; nothing
    /// in the sync does.
    pub async fn purge(&self, space: &SpaceId, id: &ItemId) -> Result<(), DriveError> {
        self.inner.api.purge(space, id).await?;
        self.kick(space);
        Ok(())
    }

    /// The drive path of a run's folder for a Space, and the mount it is under.
    pub fn mount_path(&self, space: &SpaceId) -> Option<PathBuf> {
        self.mount_of(space).map(|mount| mount.path)
    }
}

impl Inner {
    pub(crate) fn mounted(&self, space: &SpaceId) -> Result<Arc<Mounted>, DriveError> {
        read(&self.spaces)
            .get(space)
            .cloned()
            .ok_or(DriveError::NotMounted)
    }

    pub(crate) fn person(&self) -> String {
        read(&self.person).clone().unwrap_or_default()
    }

    pub(crate) fn state_of(&self, node: &NodeRow) -> LocalState {
        let key = (node.space.clone(), node.id.clone());
        if node.not_synced {
            LocalState::NotSynced
        } else if node.created || node.dirty_content {
            LocalState::Uploading
        } else if lock(&self.downloading).contains(&key) {
            LocalState::Downloading
        } else if node.kind == Kind::Folder || node.downloaded {
            LocalState::Downloaded
        } else {
            LocalState::Online
        }
    }

    pub(crate) fn node_view(&self, node: &NodeRow) -> Node {
        let version = self
            .store
            .base(&node.space, &node.id)
            .ok()
            .flatten()
            .map(|base| base.version);
        Node {
            ino: node.ino.max(0) as u64,
            space: node.space.clone(),
            id: node.id.clone(),
            parent: node.parent.clone(),
            name: node.name.clone(),
            kind: node.kind,
            size: node.size,
            mtime_ms: node.mtime_ms,
            sha256: node.sha256.clone(),
            version,
            path: node.path.clone(),
            state: self.state_of(node),
            downloaded: node.downloaded,
            last_used_ms: node.last_used_ms,
        }
    }

    /// The item's local-only state changed (last used): it goes on the local change feed, so the
    /// macOS extension hears of it with its next `changes_since`.
    pub(crate) fn local_changed(&self, space: &SpaceId, id: &ItemId) {
        let _ = self.store.touch_local(space, id);
    }

    pub(crate) fn entry(&self, node: &NodeRow) -> DriveEntry {
        let key = (node.space.clone(), node.id.clone());
        let server = self.store.item(&node.space, &node.id).ok().flatten();
        let version = self
            .store
            .base(&node.space, &node.id)
            .ok()
            .flatten()
            .map(|base| base.version);
        let editing_here = self.opens.is_writing(&key);
        // Other people first, then the person's other computers, then this one. This computer's
        // own server marks are left out: what it has open is known here, exactly.
        let mut in_use: Vec<InUse> = self
            .marks
            .on(&node.space, &node.id, now_ms())
            .into_iter()
            .filter(|held| held.device_id != self.config.device.id)
            .map(|held| InUse {
                you: held.user_id == self.config.account_id,
                user_id: held.user_id,
                name: held.name,
                device_name: held.device_name,
                editing: held.editing,
            })
            .collect();
        in_use.sort_by_key(|mark| mark.you);
        if self.opens.is_open(&key) {
            in_use.push(InUse {
                user_id: self.config.account_id.clone(),
                name: self.person(),
                device_name: self.config.device.name.clone(),
                editing: editing_here,
                you: true,
            });
        }
        DriveEntry {
            id: node.id.clone(),
            space_id: node.space.clone(),
            path: node.path.clone(),
            name: node.name.clone(),
            kind: node.kind,
            size: node.size,
            mtime_ms: node.mtime_ms,
            modified_by_name: server
                .map(|item| item.modified_by_name)
                .unwrap_or_else(|| self.person()),
            state: self.state_of(node),
            keep_downloaded: self.store.kept(&node.space, node).unwrap_or(false),
            in_use,
            version,
        }
    }
}
