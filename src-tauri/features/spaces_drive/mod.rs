pub mod commands;
mod device;
pub mod file_commands;
mod http;
mod realtime;

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, LazyLock, Mutex,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use space_drive::{
    AgentTrash, ChangedEntry, Drive, DriveConfig, DriveError, DriveStatus, Events, Notice, OsFace,
    SpaceId, SpaceMount, StatusKind,
};
use tauri::{AppHandle, Emitter, Manager};

const CHANGED_QUIET: Duration = Duration::from_millis(60);

use crate::app::runtime::MistyRuntime;

pub(crate) const STATUS_EVENT: &str = "misty://drive-status";
pub(crate) const CHANGED_EVENT: &str = "misty://drive-changed";
pub(crate) const NOTICE_EVENT: &str = "misty://drive-notice";

#[derive(Clone, Debug, Deserialize)]
pub struct SpaceRef {
    pub id: String,
    pub name: String,
}

struct Host {
    server: String,
    account_id: String,
    drive: Drive,
    failed: HashMap<SpaceId, String>,
    unavailable: Option<String>,
    #[cfg(target_os = "linux")]
    fuse: Arc<space_drive::face::fuse::FuseFace>,
    #[cfg(target_os = "windows")]
    cloud: Arc<space_drive::face::cloud_files::CloudFilesFace>,
    #[cfg(target_os = "macos")]
    provider: Option<Arc<space_drive::face::file_provider::FileProviderFace>>,
    #[cfg(target_os = "macos")]
    _socket: Option<space_drive::socket::Server>,
    link: Arc<realtime::NativeLink>,
    listening: tokio::task::JoinHandle<()>,
}

static HOST: LazyLock<Mutex<Option<Host>>> = LazyLock::new(|| Mutex::new(None));
static MOUNTS: LazyLock<Mutex<HashMap<String, PathBuf>>> = LazyLock::new(Default::default);

fn host() -> std::sync::MutexGuard<'static, Option<Host>> {
    HOST.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn mounts() -> std::sync::MutexGuard<'static, HashMap<String, PathBuf>> {
    MOUNTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn drive() -> Result<Drive, String> {
    host()
        .as_ref()
        .map(|host| host.drive.clone())
        .ok_or_else(|| "Space drives aren't set up yet.".to_string())
}

pub(crate) fn native_link_up() -> bool {
    host().as_ref().is_some_and(|host| host.link.up())
}

pub(crate) fn run_folder(space: &str) -> Option<PathBuf> {
    mounts().get(space).cloned()
}

fn folder_name(id: &str) -> Option<&str> {
    let fine = !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    fine.then_some(id)
}

struct AppEvents {
    app: AppHandle,
    pending: Arc<Mutex<Vec<(SpaceId, ChangedEntry)>>>,
    waiting: Arc<AtomicBool>,
}

#[derive(Clone, Serialize)]
struct ChangedPayload {
    space_id: SpaceId,
    items: Vec<ChangedEntry>,
    removed: Vec<space_drive::ItemId>,
}

fn to_people<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    for window in crate::browser::app_windows::person_windows(app) {
        let _ = app.emit_to(window.label(), event, payload.clone());
    }
}

fn send_changed(app: &AppHandle, pending: Vec<(SpaceId, ChangedEntry)>) {
    let mut latest: HashMap<(SpaceId, space_drive::ItemId), ChangedEntry> = HashMap::new();
    let mut order: Vec<(SpaceId, space_drive::ItemId)> = Vec::new();
    for (space, entry) in pending {
        let key = (space, entry.entry.id.clone());
        if latest.insert(key.clone(), entry).is_none() {
            order.push(key);
        }
    }
    let mut folders: Vec<((SpaceId, String), Vec<ChangedEntry>)> = Vec::new();
    for key in order {
        let Some(entry) = latest.remove(&key) else {
            continue;
        };
        let folder = (key.0, space_drive::names::parent(&entry.entry.path));
        match folders.iter_mut().find(|(at, _)| *at == folder) {
            Some((_, list)) => list.push(entry),
            None => folders.push((folder, vec![entry])),
        }
    }
    for ((space, _), items) in folders {
        let removed = items
            .iter()
            .filter(|entry| entry.removed)
            .map(|entry| entry.entry.id.clone())
            .collect();
        to_people(
            app,
            CHANGED_EVENT,
            ChangedPayload {
                space_id: space,
                items,
                removed,
            },
        );
    }
}

impl Events for AppEvents {
    fn status(&self, status: &DriveStatus) {
        to_people(&self.app, STATUS_EVENT, status.clone());
        if matches!(status.status, space_drive::StatusKind::Idle) && status.pending_downloads == 0 {
            crate::engines::thread_work::drive_settled(&self.app, status.space_id.as_str());
        }
    }

    fn changed(&self, space: &SpaceId, entries: &[ChangedEntry]) {
        if entries.is_empty() {
            return;
        }
        crate::engines::agent_memory::index::drive_changed(
            &self.app,
            space.as_str(),
            entries.iter().map(|entry| entry.entry.path.as_str()),
        );
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .extend(entries.iter().map(|entry| (space.clone(), entry.clone())));
        if self.waiting.swap(true, Ordering::SeqCst) {
            return;
        }
        let (app, pending, waiting) =
            (self.app.clone(), self.pending.clone(), self.waiting.clone());
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(CHANGED_QUIET).await;
            waiting.store(false, Ordering::SeqCst);
            let taken = std::mem::take(
                &mut *pending
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()),
            );
            send_changed(&app, taken);
        });
    }

    fn notice(&self, notice: &Notice) {
        to_people(&self.app, NOTICE_EVENT, notice.clone());
    }

    fn agent_trashed(&self, record: &AgentTrash) {
        let original = mounts()
            .get(record.space_id.as_str())
            .map(|mount| space_drive::names::local_path(mount, &record.path))
            .unwrap_or_else(|| PathBuf::from(&record.path));
        let store = self.app.state::<MistyRuntime>().environment.store();
        let saved = store.connect().and_then(|connection| {
            connection.execute(
                "INSERT INTO files_agent_trash (original_path, holding_path, agent_id, chat_id,
                    trashed_at, space_id, drive_item_id)
                 VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    original.to_string_lossy().into_owned(),
                    record.agent_id,
                    record.chat_id,
                    record.at_ms,
                    record.space_id.as_str(),
                    record.item_id.as_str(),
                ],
            )
        });
        if saved.is_err() {
            eprintln!("[drive] couldn't record an agent's trash");
        }
    }
}

pub(crate) fn forget_agent_trash(app: &AppHandle, space: &str, item: &str) {
    let store = app.state::<MistyRuntime>().environment.store();
    if let Ok(connection) = store.connect() {
        let _ = connection.execute(
            "DELETE FROM files_agent_trash WHERE space_id = ?1 AND drive_item_id = ?2",
            rusqlite::params![space, item],
        );
    }
}

fn retire_shared_folder_copies(misty_dir: &std::path::Path) {
    let Ok(spaces) = file_access::fs::read_dir(misty_dir.join("spaces")) else {
        return;
    };
    for space in spaces.flatten() {
        let folders = space.path().join("folders");
        if file_access::fs::is_dir(&folders) {
            let _ = file_access::fs::remove_dir_all(&folders);
        }
    }
}

fn open_host(
    app: &AppHandle,
    server: &str,
    account_id: &str,
    person_name: Option<String>,
) -> Result<Host, String> {
    let base = crate::account::session::server(server)?;
    let account_folder = folder_name(account_id).ok_or("That account can't keep a drive here.")?;
    let data_dir = file_access::paths::misty_shared_dir("drive")
        .ok_or("Misty couldn't find its data folder.")?
        .join(account_folder);
    let runtime = app.state::<MistyRuntime>();
    retire_shared_folder_copies(&runtime.environment.misty_dir());
    let store = runtime.environment.store();
    let device = space_drive::Device {
        id: device::device_id(&store)?,
        name: device::computer_name(),
    };
    let mut config = DriveConfig::new(data_dir, account_id.to_owned(), device);
    config.person_name = person_name.clone().filter(|name| !name.trim().is_empty());
    config.cache_limit_bytes = device::cache_limit(&store);
    config.large_file_bytes = device::large_file_limit(&store);
    let network = Arc::new(http::AccountHttp::new(base.clone(), account_id.to_owned())?);
    let events = Arc::new(AppEvents {
        app: app.clone(),
        pending: Arc::default(),
        waiting: Arc::default(),
    });
    let handle = tauri::async_runtime::handle().inner().clone();
    let drive = Drive::start(config, network, events, handle).map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    let (provider, socket, unavailable) = {
        use space_drive::face::file_provider::{group_container, FileProviderFace};
        let started = group_container().and_then(|container| {
            file_access::allow_space_drive(&container.path);
            let path = space_drive::socket::socket_path(&container.path)?;
            space_drive::socket::Server::start(drive.clone(), path, container.staging())
        });
        match started {
            Ok(socket) => {
                let name = person_name
                    .as_deref()
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .unwrap_or("Spaces");
                (
                    Some(FileProviderFace::new(drive.clone(), name)),
                    Some(socket),
                    None,
                )
            }
            Err(error) => (None, None, Some(error.to_string())),
        }
    };
    let (link, listening) = realtime::start(drive.clone(), base);
    Ok(Host {
        link,
        listening,
        server: server.to_owned(),
        account_id: account_id.to_owned(),
        failed: HashMap::new(),
        #[cfg(target_os = "linux")]
        fuse: space_drive::face::fuse::FuseFace::new(drive.clone()),
        #[cfg(target_os = "windows")]
        cloud: space_drive::face::cloud_files::CloudFilesFace::new(drive.clone()),
        #[cfg(target_os = "macos")]
        provider,
        #[cfg(target_os = "macos")]
        _socket: socket,
        #[cfg(target_os = "macos")]
        unavailable,
        #[cfg(not(target_os = "macos"))]
        unavailable: None,
        drive,
    })
}

impl Host {
    fn face(&self) -> Result<Arc<dyn OsFace>, String> {
        if let Some(why) = &self.unavailable {
            return Err(why.clone());
        }
        #[cfg(target_os = "linux")]
        return Ok(self.fuse.clone() as Arc<dyn OsFace>);
        #[cfg(target_os = "macos")]
        return self
            .provider
            .clone()
            .map(|face| face as Arc<dyn OsFace>)
            .ok_or_else(|| space_drive::face::file_provider::UNSIGNED.to_owned());
        #[cfg(target_os = "windows")]
        return Ok(self.cloud.clone() as Arc<dyn OsFace>);
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        return Ok(Arc::new(space_drive::face::NoFace) as Arc<dyn OsFace>);
    }

    fn unmount(&mut self, space: &SpaceId, leaving: bool) {
        let mount = self.drive.mount_of(space);
        let _ = self.drive.unmount(space, leaving);
        if let Some(mount) = &mount {
            if !cfg!(target_os = "macos") {
                file_access::revoke_space_drive(&mount.path);
            }
            #[cfg(target_os = "macos")]
            if leaving {
                if let Some(provider) = &self.provider {
                    provider.forget_space(mount);
                }
            }
            #[cfg(target_os = "windows")]
            if leaving {
                let _ = self.cloud.remove_sync_root(mount);
            }
        }
        let _ = leaving;
        mounts().remove(space.as_str());
        self.failed.remove(space);
    }

    fn shutdown(&mut self) {
        self.listening.abort();
        for mount in self.drive.mounted() {
            self.unmount(&mount.space, false);
        }
        self.drive.shutdown();
    }
}

pub(crate) fn sync_spaces(
    app: &AppHandle,
    server: &str,
    account_id: &str,
    spaces: Vec<SpaceRef>,
    person_name: Option<String>,
) -> Result<Vec<DriveStatus>, String> {
    let mut slot = host();
    let same = slot
        .as_ref()
        .is_some_and(|host| host.server == server && host.account_id == account_id);
    if !same {
        if let Some(mut old) = slot.take() {
            old.shutdown();
        }
    }
    if spaces.is_empty() {
        if let Some(mut old) = slot.take() {
            old.shutdown();
        }
        return Ok(Vec::new());
    }
    if slot.is_none() {
        *slot = Some(open_host(app, server, account_id, person_name.clone())?);
    }
    let host = slot.as_mut().expect("opened above");
    host.drive.set_person_name(person_name);
    let wanted: HashMap<SpaceId, String> = spaces
        .into_iter()
        .filter(|space| folder_name(&space.id).is_some())
        .map(|space| (SpaceId(space.id), space.name))
        .collect();
    for mount in host.drive.mounted() {
        if !wanted.contains_key(&mount.space) {
            let clean = host
                .drive
                .status(&mount.space)
                .is_some_and(|status| status.pending_uploads == 0);
            host.unmount(&mount.space, clean);
        }
    }
    let mut ordered: Vec<(&SpaceId, &String)> = wanted.iter().collect();
    ordered.sort();
    let names: Vec<String> = ordered
        .iter()
        .map(|(_, name)| space_drive::names::safe_local_name(name))
        .collect();
    let keys: Vec<String> = ordered.iter().map(|(id, _)| id.0.clone()).collect();
    let unique = space_drive::names::unique_names(&names, &keys);
    let root =
        file_access::paths::misty_mount_dir().ok_or("Misty couldn't find its data folder.")?;
    for ((space, name), mount_name) in ordered.into_iter().zip(unique) {
        if host.drive.mount_of(space).is_some() {
            continue;
        }
        let face = match host.face() {
            Ok(face) => face,
            Err(why) => {
                host.failed.insert(space.clone(), why);
                continue;
            }
        };
        let mount = SpaceMount {
            space: space.clone(),
            name: name.clone(),
            path: root.join(&mount_name),
            mount_name,
            domain: format!("{account_id}.{}", space.0),
        };
        match host.drive.mount(mount.clone(), face) {
            Ok(()) => {
                host.failed.remove(space);
                if !cfg!(target_os = "macos") {
                    file_access::allow_space_drive(&mount.path);
                }
                mounts().insert(space.0.clone(), mount.path.clone());
            }
            Err(error) => {
                host.failed.insert(space.clone(), error.to_string());
            }
        }
    }
    Ok(statuses(host))
}

fn statuses(host: &Host) -> Vec<DriveStatus> {
    let mut out = host.drive.statuses();
    for (space, why) in &host.failed {
        out.push(DriveStatus {
            space_id: space.clone(),
            status: StatusKind::Failed,
            message: Some(why.clone()),
            pending_uploads: 0,
            pending_downloads: 0,
        });
    }
    out
}

pub(crate) fn shutdown() {
    if let Some(mut old) = host().take() {
        old.shutdown();
    }
}

pub(crate) fn all_statuses() -> Vec<DriveStatus> {
    host().as_ref().map(statuses).unwrap_or_default()
}

pub(crate) fn error_text(error: DriveError) -> String {
    error.to_string()
}
