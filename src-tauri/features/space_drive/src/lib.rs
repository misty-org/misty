pub mod api;
pub mod bases;
pub mod cache;
pub mod face;
pub mod guard;
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
    #[error("It changed since.")]
    Changed,
    #[error("That Space's drive isn't on this computer.")]
    NotMounted,
    #[error("{0}")]
    Fixed(String),
    #[error("{0}")]
    Held(String),
    #[error("Misty's drive records were made again.")]
    AnchorExpired,
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

    #[cfg(unix)]
    pub fn errno(&self) -> i32 {
        match self {
            Self::NotFound | Self::NotMounted => libc::ENOENT,
            Self::Fixed(_) | Self::Held(_) => libc::EPERM,
            Self::AnchorExpired => libc::EIO,
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

    pub fn code(&self) -> &'static str {
        match self {
            Self::NotFound => "not_found",
            Self::Exists => "exists",
            Self::NotEmpty => "not_empty",
            Self::InUse(_) => "in_use",
            Self::Changed => "changed",
            Self::NotMounted => "not_mounted",
            Self::Fixed(_) => "forbidden",
            Self::Held(_) => "held",
            Self::AnchorExpired => "anchor_expired",
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpaceMount {
    pub space: SpaceId,
    pub name: String,
    pub mount_name: String,
    pub path: PathBuf,
    pub domain: String,
}

pub trait OsFace: Send + Sync {
    fn mount(&self, space: &SpaceMount) -> Result<(), DriveError>;
    fn unmount(&self, space: &SpaceId) -> Result<(), DriveError>;
    fn changed(&self, space: &SpaceId, items: &[Item]);
    fn evict(&self, space: &SpaceId, item: &ItemId) -> Result<(), DriveError>;
}

pub trait Events: Send + Sync {
    fn status(&self, status: &DriveStatus);
    fn changed(&self, space: &SpaceId, entries: &[ChangedEntry]);
    fn notice(&self, notice: &Notice);
    fn agent_trashed(&self, record: &AgentTrash);
}

#[derive(Clone, Debug)]
pub struct DriveConfig {
    pub data_dir: PathBuf,
    pub account_id: String,
    pub device: Device,
    pub person_name: Option<String>,
    pub cache_limit_bytes: u64,
    pub content_in_cache: bool,
    pub patient: bool,
    pub in_use_wait_cap: Duration,
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

#[derive(Clone, Debug)]
pub struct NewNode {
    pub parent: Option<ItemId>,
    pub name: String,
    pub kind: Kind,
    pub content: Option<PathBuf>,
    pub mtime_ms: i64,
    pub id: Option<ItemId>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Node {
    pub ino: u64,
    pub space: SpaceId,
    pub id: ItemId,
    pub parent: Option<ItemId>,
    pub name: String,
    pub kind: Kind,
    pub size: u64,
    pub mtime_ms: i64,
    pub sha256: Option<String>,
    pub version: Option<Version>,
    pub path: String,
    pub state: LocalState,
    pub downloaded: bool,
    #[serde(default)]
    pub last_used_ms: i64,
}

pub(crate) type Key = (SpaceId, ItemId);

pub(crate) struct Mounted {
    pub mount: SpaceMount,
    pub face: Arc<dyn OsFace>,
    pub os_root: RwLock<PathBuf>,
    pub kick: Notify,
    pub stop: AtomicBool,
    pub round: tokio::sync::Mutex<()>,
    pub status: Mutex<DriveStatus>,
    pub marked: Mutex<HashMap<ItemId, std::time::Instant>>,
    pub marks_pending: AtomicBool,
    pub trash_results: Mutex<HashMap<ItemId, Result<(), DriveError>>>,
    pub task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

pub(crate) struct Inner {
    pub config: DriveConfig,
    pub store: Store,
    pub api: Api,
    pub cache: cache::Cache,
    pub bases: bases::Bases,
    pub events: Arc<dyn Events>,
    pub opens: in_use::Opens,
    pub marks: in_use::Marks,
    pub spaces: RwLock<HashMap<SpaceId, Arc<Mounted>>>,
    pub runtime: Handle,
    pub person: RwLock<Option<String>>,
    pub fetching: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    pub downloading: Mutex<HashSet<Key>>,
    pub cache_limit: AtomicU64,
    pub paused: AtomicBool,
    pub guard: guard::Guard,
}

fn held_message(space: &str) -> String {
    format!("Too much was deleted from {space} at once, so Misty kept the rest.")
}

#[derive(Clone)]
pub struct Drive {
    pub(crate) inner: Arc<Inner>,
}

fn read<T>(lock: &RwLock<T>) -> std::sync::RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn write<T>(lock: &RwLock<T>) -> std::sync::RwLockWriteGuard<'_, T> {
    lock.write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Drive {
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
                guard: guard::Guard::default(),
            }),
        })
    }

    pub fn config(&self) -> &DriveConfig {
        &self.inner.config
    }

    pub fn block_on<F: Future>(&self, work: F) -> F::Output {
        self.inner.runtime.block_on(work)
    }

    pub fn runtime(&self) -> &Handle {
        &self.inner.runtime
    }

    pub fn set_cache_limit(&self, bytes: u64) {
        self.inner.cache_limit.store(bytes, Ordering::SeqCst);
        let spaces: Vec<SpaceId> = read(&self.inner.spaces).keys().cloned().collect();
        for space in spaces {
            self.kick(&space);
        }
    }

    pub fn set_paused(&self, paused: bool) {
        self.inner.paused.store(paused, Ordering::SeqCst);
        if !paused {
            let spaces: Vec<SpaceId> = read(&self.inner.spaces).keys().cloned().collect();
            for space in spaces {
                self.kick(&space);
            }
        }
    }

    pub fn paused(&self) -> bool {
        self.inner.paused.load(Ordering::SeqCst)
    }

    pub fn cache_limit(&self) -> u64 {
        self.inner.cache_limit.load(Ordering::SeqCst)
    }

    pub fn set_person_name(&self, name: Option<String>) {
        if name.is_some() {
            *write(&self.inner.person) = name;
        }
    }

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
        if let Err(error) = self.inner.store.set_space_folder(&space, &mount.mount_name) {
            write(&self.inner.spaces).remove(&space);
            return Err(error);
        }
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

    pub fn space_folders(&self) -> Result<Vec<(SpaceId, String)>, DriveError> {
        self.inner.store.space_folders()
    }

    pub fn space_of_item(&self, id: &ItemId) -> Result<Option<SpaceId>, DriveError> {
        self.inner.store.space_of_item(id)
    }

    pub fn save_anchor(&self, spaces: &str) -> Result<i64, DriveError> {
        self.inner.store.save_anchor(spaces)
    }

    pub fn anchor(&self, token: i64) -> Result<Option<String>, DriveError> {
        self.inner.store.anchor(token)
    }

    pub fn set_os_root(&self, space: &SpaceId, root: PathBuf) {
        if let Some(mounted) = read(&self.inner.spaces).get(space) {
            *write(&mounted.os_root) = root;
        }
    }

    pub fn shutdown(&self) {
        let spaces: Vec<SpaceId> = read(&self.inner.spaces).keys().cloned().collect();
        for space in spaces {
            let _ = self.unmount(&space, false);
        }
    }

    pub fn kick(&self, space: &SpaceId) {
        if let Some(mounted) = read(&self.inner.spaces).get(space) {
            mounted.kick.notify_one();
        }
    }

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

    pub async fn realtime(
        &self,
        space: &SpaceId,
        kind: &str,
        payload: &serde_json::Value,
        age: Option<Duration>,
    ) {
        sync::realtime(&self.inner, space, kind, payload, age).await;
    }

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

    pub fn node(&self, space: &SpaceId, id: &ItemId) -> Result<Option<Node>, DriveError> {
        Ok(self
            .inner
            .store
            .node(space, id)?
            .filter(|node| self.shown(node))
            .map(|node| self.inner.node_view(&node)))
    }

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

    pub fn node_by_ino(&self, ino: u64) -> Result<Option<Node>, DriveError> {
        Ok(self
            .inner
            .store
            .node_by_ino(ino as i64)?
            .filter(|node| self.shown(node))
            .map(|node| self.inner.node_view(&node)))
    }

    pub fn node_at(&self, space: &SpaceId, path: &str) -> Result<Option<Node>, DriveError> {
        let path = names::drive_path(path).map_err(DriveError::Invalid)?;
        Ok(self
            .inner
            .store
            .node_at(space, &path)?
            .filter(|node| self.shown(node))
            .map(|node| self.inner.node_view(&node)))
    }

    pub async fn content(&self, space: &SpaceId, id: &ItemId) -> Result<PathBuf, DriveError> {
        sync::content(&self.inner, space, id).await
    }

    pub async fn fetch_to(
        &self,
        space: &SpaceId,
        id: &ItemId,
        to: &Path,
    ) -> Result<Node, DriveError> {
        let cached = self.content(space, id).await?;
        if let Some(parent) = to.parent() {
            file_access::fs::create_dir_all(parent).map_err(DriveError::io)?;
        }
        file_access::fs::copy(&cached, to).map_err(DriveError::io)?;
        let mut node = self
            .inner
            .store
            .node(space, id)?
            .ok_or(DriveError::NotFound)?;
        node.downloaded = true;
        self.inner.store.update_node(&node)?;
        Ok(self.inner.node_view(&node))
    }

    pub fn temp_path(&self) -> PathBuf {
        let path = self.inner.cache.temp_path();
        if let Some(parent) = path.parent() {
            let _ = file_access::fs::create_dir_all(parent);
        }
        path
    }

    pub fn work_path(&self, ino: u64, handle: u64) -> PathBuf {
        let path = self.inner.cache.work_path(ino as i64, handle);
        if let Some(parent) = path.parent() {
            let _ = file_access::fs::create_dir_all(parent);
        }
        path
    }

    pub fn create(&self, space: &SpaceId, new: NewNode) -> Result<Node, DriveError> {
        let node = sync::create_local(&self.inner, space, new)?;
        self.kick(space);
        Ok(self.inner.node_view(&node))
    }

    pub fn create_resolving(
        &self,
        space: &SpaceId,
        mut new: NewNode,
        _may_exist: bool,
    ) -> Result<Node, DriveError> {
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
                new.name =
                    sync::unique_name(&self.inner, space, new.parent.as_ref(), &new.name, None)?;
                self.create(space, new)
            }
        }
    }

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
            let written =
                sync::write_local(&self.inner, space, id, content, mtime_ms, base_version)?;
            sync::wrote(&self.inner, space, id);
            self.kick(space);
            let now = self.node(space, id)?.ok_or(DriveError::NotFound)?;
            refetch = now.sha256 != written.sha256;
        }
        let now = self.node(space, id)?.ok_or(DriveError::NotFound)?;
        Ok((now, refetch))
    }

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

    pub fn rename(
        &self,
        space: &SpaceId,
        id: &ItemId,
        folder: Option<&ItemId>,
        name: &str,
    ) -> Result<Node, DriveError> {
        let node = sync::rename_local(&self.inner, space, id, folder, name)?;
        if &node.id != id {
            sync::wrote(&self.inner, space, &node.id);
        }
        self.kick(space);
        Ok(self.inner.node_view(&node))
    }

    pub fn trash(&self, space: &SpaceId, id: &ItemId, by: TrashBy) -> Result<(), DriveError> {
        sync::trash_local(&self.inner, space, id, &by)?;
        self.kick(space);
        Ok(())
    }

    pub fn trash_from_os(&self, space: &SpaceId, id: &ItemId) -> Result<(), DriveError> {
        let files = self.guard_delete(space, id)?;
        self.trash(space, id, TrashBy::Person)?;
        self.inner.guard.record(space, id, files);
        Ok(())
    }

    pub async fn trash_from_os_now(&self, space: &SpaceId, id: &ItemId) -> Result<(), DriveError> {
        let files = self.guard_delete(space, id)?;
        self.trash_now(space, id, TrashBy::Person).await?;
        self.inner.guard.record(space, id, files);
        Ok(())
    }

    fn guard_delete(&self, space: &SpaceId, id: &ItemId) -> Result<u64, DriveError> {
        let subtree = self.inner.store.descendants(space, id)?;
        let Some(top) = subtree.iter().find(|node| node.id == *id) else {
            return Err(DriveError::NotFound);
        };
        if top.not_synced || top.created {
            return Ok(0);
        }
        let files = guard::files_in(&subtree);
        let space_files = guard::files_in(&self.inner.store.nodes(space)?);
        let name = self
            .mount_of(space)
            .map(|mount| mount.mount_name)
            .unwrap_or_default();
        match self.inner.guard.check(space, files, space_files) {
            guard::Verdict::Go => Ok(files),
            guard::Verdict::Held => Err(DriveError::Held(held_message(&name))),
            guard::Verdict::Stopped {
                files: taken,
                burst,
            } => {
                self.inner.events.notice(&Notice {
                    kind: NoticeKind::DeletesHeld,
                    space_id: space.clone(),
                    name: name.clone(),
                    by: None,
                    item_id: None,
                    path: None,
                    device_name: None,
                    count: Some(taken),
                    burst: Some(burst),
                });
                Err(DriveError::Held(held_message(&name)))
            }
        }
    }

    pub async fn restore_burst(&self, space: &SpaceId, burst: &str) -> Result<u64, DriveError> {
        let mut restored = 0;
        for id in self.inner.guard.take(space, burst) {
            match self.restore(space, &id).await {
                Ok(_) => restored += 1,
                Err(DriveError::NotFound) => {}
                Err(DriveError::Offline) => return Err(DriveError::Offline),
                Err(_) => {}
            }
        }
        Ok(restored)
    }

    pub async fn trash_now(
        &self,
        space: &SpaceId,
        id: &ItemId,
        by: TrashBy,
    ) -> Result<(), DriveError> {
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

    pub async fn open(
        &self,
        space: &SpaceId,
        id: &ItemId,
        editing: bool,
    ) -> Result<(), DriveError> {
        sync::open(&self.inner, space, id, editing).await
    }

    pub async fn close(&self, space: &SpaceId, id: &ItemId, editing: bool) {
        sync::close(&self.inner, space, id, editing).await;
    }

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

    pub fn current_seq(&self, space: &SpaceId) -> Result<Seq, DriveError> {
        self.inner.store.cursor(space)
    }

    pub fn local_changes_since(
        &self,
        space: &SpaceId,
        local: i64,
        limit: usize,
    ) -> Result<(Vec<Node>, i64, bool), DriveError> {
        let rows = self
            .inner
            .store
            .nodes_since_local(space, local, limit.max(1))?;
        let next = rows.last().map(|(_, seq)| *seq).unwrap_or(local);
        let more = rows.len() >= limit.max(1);
        let nodes = rows
            .iter()
            .filter(|(node, _)| !node.trash_pending)
            .map(|(node, _)| self.inner.node_view(node))
            .collect();
        Ok((nodes, next, more))
    }

    pub fn current_local_seq(&self, space: &SpaceId) -> Result<i64, DriveError> {
        self.inner.store.local_cursor(space)
    }

    pub fn server_item(&self, space: &SpaceId, id: &ItemId) -> Result<Option<Item>, DriveError> {
        self.inner.store.item(space, id)
    }

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

    pub fn entry_by_id(
        &self,
        space: &SpaceId,
        id: &ItemId,
    ) -> Result<Option<DriveEntry>, DriveError> {
        Ok(self
            .inner
            .store
            .node(space, id)?
            .filter(|node| !node.trash_pending)
            .map(|node| self.inner.entry(&node)))
    }

    pub async fn read_bytes(&self, space: &SpaceId, path: &str) -> Result<Vec<u8>, DriveError> {
        let node = self.node_at(space, path)?.ok_or(DriveError::NotFound)?;
        if node.kind != Kind::File {
            return Err(DriveError::Invalid("That's a folder.".to_owned()));
        }
        let cached = self.content(space, &node.id).await?;
        file_access::fs::read(cached).map_err(DriveError::io)
    }

    pub fn local_content(
        &self,
        space: &SpaceId,
        path: &str,
    ) -> Result<Option<PathBuf>, DriveError> {
        let Some(node) = self.node_at(space, path)? else {
            return Ok(None);
        };
        let Some(sha256) = node.sha256.filter(|_| node.kind == Kind::File) else {
            return Ok(None);
        };
        Ok(self
            .inner
            .cache
            .has(&sha256)
            .then(|| self.inner.cache.blob_path(&sha256)))
    }

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

    pub fn copy_in(
        &self,
        space: &SpaceId,
        source: &Path,
        folder: &str,
    ) -> Result<(DriveEntry, CopyReport), DriveError> {
        let out = sync::copy_in(&self.inner, space, source, folder)?;
        self.kick(space);
        Ok(out)
    }

    pub async fn keep_downloaded(
        &self,
        space: &SpaceId,
        path: &str,
        keep: bool,
    ) -> Result<(), DriveError> {
        sync::keep_downloaded(&self.inner, space, path, keep).await
    }

    pub fn remove_download(&self, space: &SpaceId, path: &str) -> Result<(), DriveError> {
        sync::remove_download(&self.inner, space, path)
    }

    pub async fn trash_list(
        &self,
        space: &SpaceId,
        after: Option<&str>,
        limit: u32,
    ) -> Result<(Vec<TrashEntry>, Option<String>), DriveError> {
        sync::trash_list(&self.inner, space, after, limit).await
    }

    pub async fn restore(&self, space: &SpaceId, id: &ItemId) -> Result<Item, DriveError> {
        let item = self.inner.api.restore(space, id).await?;
        self.inner.store.put_item(&item)?;
        self.kick(space);
        Ok(item)
    }

    pub async fn purge(&self, space: &SpaceId, id: &ItemId) -> Result<(), DriveError> {
        self.inner.api.purge(space, id).await?;
        self.kick(space);
        Ok(())
    }

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
