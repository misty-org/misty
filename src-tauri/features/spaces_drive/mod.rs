//! Misty's glue for the Space drive (`space_drive`): the account's session as its network, this
//! computer's id and name, mounting each Space the renderer lists, the Tauri commands and events
//! of the build contract (Appendix B), and the realtime events the renderer forwards.
//!
//! - The renderer hands over the server, the account and its Spaces with `drive_sync_spaces`;
//!   native code mounts and unmounts drives to match, at `~/.misty/mnt/<Space>` (`mnt-dev` in
//!   debug builds): FUSE on Linux, a link there to the Space's folder in the account's one File
//!   Provider domain on macOS, a Cloud Files sync root there on Windows.
//! - Realtime lives in the renderer; it forwards `drive.*` events with `drive_realtime_event`.
//! - Events: `misty://drive-status`, `misty://drive-changed`, `misty://drive-notice`.
//! - Every command refuses anything but a person's own window.
//! - What agents trash is recorded in `files_agent_trash` in `misty.db`, never on the server.

pub mod commands;
pub mod file_commands;
mod device;
mod http;

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, LazyLock, Mutex},
};

use serde::{Deserialize, Serialize};
use space_drive::{
    AgentTrash, ChangedEntry, Drive, DriveConfig, DriveError, DriveStatus, Events, Notice,
    OsFace, SpaceId, SpaceMount, StatusKind,
};
use tauri::{AppHandle, Emitter, Manager};

use crate::app::runtime::MistyRuntime;

pub(crate) const STATUS_EVENT: &str = "misty://drive-status";
pub(crate) const CHANGED_EVENT: &str = "misty://drive-changed";
pub(crate) const NOTICE_EVENT: &str = "misty://drive-notice";

/// One Space the renderer lists.
#[derive(Clone, Debug, Deserialize)]
pub struct SpaceRef {
    pub id: String,
    pub name: String,
}

struct Host {
    server: String,
    account_id: String,
    drive: Drive,
    /// Spaces that couldn't mount, with why.
    failed: HashMap<SpaceId, String>,
    /// Why no Space can mount on this computer at all (an unsigned macOS build).
    unavailable: Option<String>,
    #[cfg(target_os = "linux")]
    fuse: Arc<space_drive::face::fuse::FuseFace>,
    #[cfg(target_os = "windows")]
    cloud: Arc<space_drive::face::cloud_files::CloudFilesFace>,
    #[cfg(target_os = "macos")]
    provider: Option<Arc<space_drive::face::file_provider::FileProviderFace>>,
    #[cfg(target_os = "macos")]
    _socket: Option<space_drive::socket::Server>,
}

static HOST: LazyLock<Mutex<Option<Host>>> = LazyLock::new(|| Mutex::new(None));
/// Each mounted Space's folder, for agents' runs and for recording agents' trash.
static MOUNTS: LazyLock<Mutex<HashMap<String, PathBuf>>> = LazyLock::new(Default::default);

fn host() -> std::sync::MutexGuard<'static, Option<Host>> {
    HOST.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn mounts() -> std::sync::MutexGuard<'static, HashMap<String, PathBuf>> {
    MOUNTS.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The account's drive, while one is open.
pub(crate) fn drive() -> Result<Drive, String> {
    host()
        .as_ref()
        .map(|host| host.drive.clone())
        .ok_or_else(|| "Space drives aren't set up yet.".to_string())
}

/// The folder of a Space's drive on this computer, when the OS shows it there: what an agent's run
/// in that Space reads (`engines/runs.rs`).
pub(crate) fn run_folder(space: &str) -> Option<PathBuf> {
    mounts().get(space).cloned()
}

/// A folder name from an id: letters, digits, `-` and `_`.
fn folder_name(id: &str) -> Option<&str> {
    let fine = !id.is_empty()
        && id.len() <= 128
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    fine.then_some(id)
}

struct AppEvents {
    app: AppHandle,
}

#[derive(Clone, Serialize)]
struct ChangedPayload<'a> {
    space_id: &'a SpaceId,
    items: &'a [ChangedEntry],
    removed: Vec<&'a space_drive::ItemId>,
}

impl Events for AppEvents {
    fn status(&self, status: &DriveStatus) {
        let _ = self.app.emit(STATUS_EVENT, status);
    }

    fn changed(&self, space: &SpaceId, entries: &[ChangedEntry]) {
        let removed = entries
            .iter()
            .filter(|entry| entry.removed)
            .map(|entry| &entry.entry.id)
            .collect();
        let _ = self.app.emit(
            CHANGED_EVENT,
            ChangedPayload {
                space_id: space,
                items: entries,
                removed,
            },
        );
    }

    fn notice(&self, notice: &Notice) {
        let _ = self.app.emit(NOTICE_EVENT, notice);
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

/// Forgets an agent's trash record of a drive item: it was put back, or deleted for good.
pub(crate) fn forget_agent_trash(app: &AppHandle, space: &str, item: &str) {
    let store = app.state::<MistyRuntime>().environment.store();
    if let Ok(connection) = store.connect() {
        let _ = connection.execute(
            "DELETE FROM files_agent_trash WHERE space_id = ?1 AND drive_item_id = ?2",
            rusqlite::params![space, item],
        );
    }
}

/// Shared folders became folders in each Space's drive, so the copies this computer downloaded
/// into its data folder (`spaces/<space>/folders/`, with `.<id>.partial` beside them) are stale
/// duplicates of what the drive now holds. They were Misty's own cache, never the person's files.
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
    let network = Arc::new(http::AccountHttp::new(base, account_id.to_owned())?);
    let events = Arc::new(AppEvents { app: app.clone() });
    // Tauri's own runtime, which outlives any one command and is there from any thread.
    let handle = tauri::async_runtime::handle().inner().clone();
    let drive = Drive::start(config, network, events, handle).map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    let (provider, socket, unavailable) = {
        use space_drive::face::file_provider::{group_container, FileProviderFace};
        // The socket's path follows `socket::socket_path` (`drive.sock`, else `d.sock`, else
        // none fits), which the extension follows too. Without a socket no Space can mount, and
        // the drive's status says why.
        let started = group_container().and_then(|container| {
            file_access::allow_space_drive(&container.path);
            let path = space_drive::socket::socket_path(&container.path)?;
            space_drive::socket::Server::start(drive.clone(), path, container.staging())
        });
        match started {
            Ok(socket) => {
                // Finder shows the drive as "Misty - <name>", one place for every Space.
                let name = person_name
                    .as_deref()
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .unwrap_or("Spaces");
                (Some(FileProviderFace::new(drive.clone(), name)), Some(socket), None)
            }
            Err(error) => (None, None, Some(error.to_string())),
        }
    };
    Ok(Host {
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
        // Leaving the Space forgets what this computer kept of it; otherwise it stays for next time.
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
        for mount in self.drive.mounted() {
            self.unmount(&mount.space, false);
        }
        self.drive.shutdown();
    }
}

/// Mounts and unmounts so the account's drives match `spaces`. A Space that left the list is
/// unmounted; its records and (on macOS) its folder go only once nothing waits to upload there,
/// so a list given while the renderer is still loading never costs unsynced work.
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
        // Signed out, or nothing to show: unmount, keeping what's on this computer.
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
    // Folder names: safe here and unique among the Spaces, in a stable order.
    let mut ordered: Vec<(&SpaceId, &String)> = wanted.iter().collect();
    ordered.sort();
    let names: Vec<String> = ordered
        .iter()
        .map(|(_, name)| space_drive::names::safe_local_name(name))
        .collect();
    let keys: Vec<String> = ordered.iter().map(|(id, _)| id.0.clone()).collect();
    let unique = space_drive::names::unique_names(&names, &keys);
    let root = file_access::paths::misty_mount_dir().ok_or("Misty couldn't find its data folder.")?;
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

/// Unmounts every drive as Misty quits.
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
