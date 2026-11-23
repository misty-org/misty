//! The Windows face: each Space is a Cloud Files sync root at `%USERPROFILE%\.misty\mnt\<Space>`
//! (`mnt-dev` in debug builds), the API OneDrive is built on, through the `windows` crate
//! (MIT/Apache-2.0). It needs no driver and no admin: `cldflt`, the filter behind it, ships with
//! Windows 10 1709 and later.
//!
//! - **Registration.** `StorageProviderSyncRootManager::Register` (WinRT), not `CfRegisterSyncRoot`.
//!   It registers the same root with the filter and also with the shell, which is what gives the
//!   Space its entry in Explorer's navigation pane, the cloud and check marks in its status column,
//!   and "Always keep on this device" / "Free up space" in its menu; `CfRegisterSyncRoot` alone
//!   gives none of those. The root's id is `Misty!<user SID>!<account id>.<space id>`
//!   (`MistyDev!…` in debug builds), as the shell asks ids to be written. Unmounting (Misty
//!   quitting, signing out) only disconnects, so the files stay in Explorer, online-only ones
//!   showing as unavailable; `remove_sync_root` unregisters it when the person leaves the Space.
//! - **Policies.** Hydration `Full` with `AutoDehydrationAllowed`: a file is fetched whole the
//!   first time anything reads it, and Windows may free it again when space runs low. Population
//!   `AlwaysFull`: every name is created as a placeholder up front and kept up to date from
//!   `changed`, so Windows never asks for a folder's names. Misty already holds the whole tree in
//!   `drive.db` (names only, small), so there is nothing to fetch on demand, and tools that walk
//!   the folder (search, Git, an engine's file search) see every name at once without a callback
//!   per folder. In-sync tracking covers every attribute and time the shell names (the WinRT
//!   equivalent of `CF_INSYNC_POLICY_TRACK_ALL`), so any local change clears a file's in-sync mark.
//! - **Identity.** Each placeholder's file identity is `<item id>\n<version>\n<sha256>`: the item,
//!   and the server version and content it shows. Callbacks name items by it, never by path.
//! - **Callbacks.** FETCH_DATA downloads through `Drive::fetch_to` and hands the bytes over in
//!   1 MiB `TRANSFER_DATA` chunks with progress; CANCEL_FETCH_DATA stops that. Open and close
//!   completions become `Drive::open`/`close`, in order, on one task; since Windows doesn't say
//!   whether an open was for writing, an open turns into editing when its first write is seen.
//!   NOTIFY_DELETE, and a rename out of the root (the Recycle Bin is one), is a trash move that
//!   waits for the server: a file someone has open is refused, so Windows keeps it. A
//!   rename inside the root is `Drive::rename`. Dehydration is refused while a file has changes
//!   not uploaded, or is open; once done it is `Drive::remove_download`.
//! - **Local changes.** Cloud Files has no callback for new files or for writes, so the root is
//!   watched with `ReadDirectoryChangesW` (the API `notify` wraps; called directly, as the crate's
//!   other Windows code calls Win32 directly). After a quiet second, a file that isn't a
//!   placeholder is new: `Drive::create_resolving`, then `CfConvertToPlaceholder` with its
//!   identity; a placeholder that lost its in-sync mark was edited: `Drive::modify` against the
//!   version its identity names (a text edit merges with what came since, anything else is the
//!   last save and wins). Once the upload lands, the identity moves to the new version and the
//!   file is marked in sync; one the drive merged takes the merged content. A full walk at
//!   mount (and when the watcher's buffer overflows) catches what changed while Misty was away.
//! - **Pins.** Explorer's "Always keep on this device" and "Free up space" set the placeholder's
//!   pin state, which shows as the `PINNED`/`UNPINNED` attributes: the watcher sees the attribute
//!   change and maps it to `Drive::keep_downloaded`. There is no callback for it.
//! - **Always writable.** Nothing in a drive is read-only: a read-only mark an earlier Misty set
//!   is taken off when the placeholder is next brought in line.
//!
//! Every path this face hands to a Win32 or WinRT call is checked with `file_access::check`
//! first; everything else goes through `file_access::fs`.
use std::{
    collections::{HashMap, HashSet},
    ffi::{c_void, OsString},
    io::{Read, Seek, SeekFrom},
    mem::{offset_of, size_of},
    os::windows::{ffi::OsStringExt, fs::MetadataExt},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc, LazyLock, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

use file_access::Access;
use windows::core::{GUID, HRESULT, HSTRING, PCWSTR, PWSTR};
use windows::Security::Cryptography::CryptographicBuffer;
use windows::Storage::Provider::{
    StorageProviderHardlinkPolicy, StorageProviderHydrationPolicy,
    StorageProviderHydrationPolicyModifier, StorageProviderInSyncPolicy,
    StorageProviderPopulationPolicy, StorageProviderSyncRootInfo, StorageProviderSyncRootManager,
};
use windows::Storage::StorageFolder;
use windows::Win32::Foundation::{
    CloseHandle, LocalFree, ERROR_ACCESS_DENIED, ERROR_NOT_A_CLOUD_FILE, ERROR_OPERATION_ABORTED,
    HANDLE, HLOCAL, NTSTATUS, STATUS_CLOUD_FILE_IN_USE, STATUS_CLOUD_FILE_NETWORK_UNAVAILABLE,
    STATUS_CLOUD_FILE_NOT_IN_SYNC, STATUS_CLOUD_FILE_UNSUCCESSFUL, STATUS_OBJECT_NAME_COLLISION,
    STATUS_SUCCESS, WAIT_TIMEOUT, WIN32_ERROR,
};
use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
use windows::Win32::Storage::CloudFilters::*;
use windows::Win32::Storage::FileSystem::{
    CreateFileW, GetFileAttributesW, ReadDirectoryChangesW, SetFileAttributesW,
    FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_READONLY, FILE_BASIC_INFO,
    FILE_FLAGS_AND_ATTRIBUTES, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OVERLAPPED, FILE_GENERIC_READ,
    FILE_LIST_DIRECTORY, FILE_NOTIFY_CHANGE_ATTRIBUTES, FILE_NOTIFY_CHANGE_CREATION,
    FILE_NOTIFY_CHANGE_DIR_NAME, FILE_NOTIFY_CHANGE_FILE_NAME, FILE_NOTIFY_CHANGE_LAST_WRITE,
    FILE_NOTIFY_CHANGE_SIZE, FILE_NOTIFY_INFORMATION, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE,
    FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_WRITE_ATTRIBUTES, INVALID_FILE_ATTRIBUTES,
    OPEN_EXISTING, READ_CONTROL, SYNCHRONIZE, WRITE_DAC,
};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
use windows::Win32::System::IO::{
    CancelIoEx, GetOverlappedResult, GetOverlappedResultEx, OVERLAPPED,
};

use crate::{
    lock, names, Drive, DriveError, Item, ItemId, Kind, LocalState, NewNode, Node, OsFace, SpaceId,
    SpaceMount, TrashBy, Version,
};

const PROVIDER: &str = if cfg!(debug_assertions) {
    "MistyDev"
} else {
    "Misty"
};
const PROVIDER_ID: GUID = GUID::from_u128(0x6d1f3c2a_9b4e_4f57_a0c8_3e5d7b2194f6);
const CHUNK: usize = 1 << 20;
const ALIGN: u64 = 4096;
const QUIET: Duration = Duration::from_millis(1500);
const SETTLE_EVERY: Duration = Duration::from_secs(5);
const MAX_IDENTITY: usize = CF_PLACEHOLDER_MAX_FILE_IDENTITY_LENGTH as usize;
const SHARING: [i32; 2] = [32, 33];

pub struct CloudFilesFace {
    drive: Drive,
    roots: Mutex<HashMap<SpaceId, Arc<Root>>>,
}

impl CloudFilesFace {
    pub fn new(drive: Drive) -> Arc<Self> {
        Arc::new(Self {
            drive,
            roots: Mutex::new(HashMap::new()),
        })
    }

    fn root(&self, space: &SpaceId) -> Option<Arc<Root>> {
        lock(&self.roots).get(space).cloned()
    }

    pub fn remove_sync_root(&self, mount: &SpaceMount) -> Result<(), DriveError> {
        let root = lock(&self.roots).remove(&mount.space);
        if let Some(root) = root {
            root.shutdown();
        }
        let id = sync_root_id(mount)?;
        if file_access::fs::is_dir(&mount.path) {
            remove_in_sync(&mount.path);
        }
        let unregistered = StorageProviderSyncRootManager::Unregister(&HSTRING::from(id.as_str()))
            .map_err(|error| face_error("Windows couldn't remove the drive", error));
        let empty = file_access::fs::read_dir(&mount.path)
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false);
        if empty {
            let _ = file_access::fs::remove_dir(&mount.path);
        }
        file_access::revoke_space_drive(&mount.path);
        unregistered
    }
}

impl OsFace for CloudFilesFace {
    fn mount(&self, space: &SpaceMount) -> Result<(), DriveError> {
        if self.root(&space.space).is_some() {
            return Ok(());
        }
        file_access::fs::create_dir_all(&space.path).map_err(DriveError::io)?;
        let id = sync_root_id(space)?;
        register(space, &id)?;
        let root = Root::connect(self.drive.clone(), space)?;
        lock(&self.roots).insert(space.space.clone(), root);
        Ok(())
    }

    fn unmount(&self, space: &SpaceId) -> Result<(), DriveError> {
        let root = lock(&self.roots).remove(space);
        if let Some(root) = root {
            root.shutdown();
        }
        Ok(())
    }

    fn changed(&self, space: &SpaceId, items: &[Item]) {
        if let Some(root) = self.root(space) {
            root.send(Work::Changed(items.to_vec()));
        }
    }

    fn evict(&self, space: &SpaceId, item: &ItemId) -> Result<(), DriveError> {
        let Some(root) = self.root(space) else {
            return Ok(());
        };
        if lock(&root.quiet_evict).contains(item) {
            return Ok(());
        }
        let Some(path) = root.path_of(item) else {
            return Ok(());
        };
        if !file_access::fs::is_file(&path) {
            return Ok(());
        }
        let handle = open_item(&path)?;
        // SAFETY: a handle opened above, kept open for both calls.
        let freed = unsafe {
            let _ = CfSetPinState(handle.0, CF_PIN_STATE_UNPINNED, CF_SET_PIN_FLAG_NONE, None);
            CfDehydratePlaceholder(handle.0, 0, -1, CF_DEHYDRATE_FLAG_NONE, None)
        };
        freed.map_err(|error| face_error("Windows couldn't free up this file", error))
    }
}

struct Owned(HANDLE);

// SAFETY: a kernel handle may be used and closed from any thread.
unsafe impl Send for Owned {}

impl Drop for Owned {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            // SAFETY: the handle is owned here and closed once.
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}

fn face_error(what: &str, error: windows::core::Error) -> DriveError {
    DriveError::Face(format!("{what}. ({error})"))
}

fn is_win32(error: &windows::core::Error, code: WIN32_ERROR) -> bool {
    error.code() == HRESULT::from_win32(code.0)
}

fn is_sharing(error: &windows::core::Error) -> bool {
    SHARING
        .iter()
        .any(|code| error.code() == HRESULT::from_win32(*code as u32))
}

fn gate(path: &Path, access: Access) -> Result<(), DriveError> {
    file_access::check(path, access).map_err(DriveError::io)
}

fn open_item(path: &Path) -> Result<Owned, DriveError> {
    gate(path, Access::Write)?;
    let access =
        FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | READ_CONTROL | WRITE_DAC | SYNCHRONIZE;
    // SAFETY: a NUL-terminated path that outlives the call; no security attributes or template.
    let handle = unsafe {
        CreateFileW(
            &HSTRING::from(path),
            access.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            None,
        )
    }
    .map_err(|error| face_error("Windows couldn't open a file in the drive", error))?;
    Ok(Owned(handle))
}

fn nobody_writing(path: &Path) -> Result<bool, DriveError> {
    gate(path, Access::Read)?;
    // SAFETY: as in `open_item`.
    let opened = unsafe {
        CreateFileW(
            &HSTRING::from(path),
            FILE_GENERIC_READ.0,
            FILE_SHARE_READ,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            None,
        )
    };
    match opened {
        Ok(handle) => {
            drop(Owned(handle));
            Ok(true)
        }
        Err(error) if is_sharing(&error) => Ok(false),
        Err(error) => Err(face_error(
            "Windows couldn't open a file in the drive",
            error,
        )),
    }
}

fn filetime(ms: i64) -> i64 {
    (ms.max(0) + 11_644_473_600_000) * 10_000
}

fn ms_of(time: std::time::SystemTime) -> i64 {
    time.duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

fn set_readonly(path: &Path, readonly: bool) {
    if gate(path, Access::Write).is_err() {
        return;
    }
    let wide = HSTRING::from(path);
    // SAFETY: a NUL-terminated path that outlives the call.
    let attributes = unsafe { GetFileAttributesW(&wide) };
    if attributes == INVALID_FILE_ATTRIBUTES {
        return;
    }
    let wanted = if readonly {
        attributes | FILE_ATTRIBUTE_READONLY.0
    } else {
        attributes & !FILE_ATTRIBUTE_READONLY.0
    };
    if wanted == attributes {
        return;
    }
    let was_in_sync = placeholder(path)
        .ok()
        .flatten()
        .is_some_and(|state| state.in_sync);
    // SAFETY: as above.
    if unsafe { SetFileAttributesW(&wide, FILE_FLAGS_AND_ATTRIBUTES(wanted)) }.is_err() {
        return;
    }
    if was_in_sync {
        if let Ok(handle) = open_item(path) {
            // SAFETY: a handle opened above.
            unsafe {
                let _ = CfSetInSyncState(
                    handle.0,
                    CF_IN_SYNC_STATE_IN_SYNC,
                    CF_SET_IN_SYNC_FLAG_NONE,
                    None,
                );
            }
        }
    }
}

fn is_readonly(path: &Path) -> bool {
    if gate(path, Access::Read).is_err() {
        return false;
    }
    // SAFETY: a NUL-terminated path that outlives the call.
    let attributes = unsafe { GetFileAttributesW(&HSTRING::from(path)) };
    attributes != INVALID_FILE_ATTRIBUTES && attributes & FILE_ATTRIBUTE_READONLY.0 != 0
}

fn user_sid() -> Result<String, DriveError> {
    let failed = |error| face_error("Windows couldn't name the signed-in user", error);
    // SAFETY: the token handle is owned and closed by `Owned`; the buffer is as long as the size
    // given and 8-byte aligned, which `TOKEN_USER` needs; the string the SID converts into is
    // freed with `LocalFree`, as the API asks.
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).map_err(failed)?;
        let token = Owned(token);
        let mut needed = 0u32;
        let _ = GetTokenInformation(token.0, TokenUser, None, 0, &mut needed);
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8).max(8)];
        GetTokenInformation(
            token.0,
            TokenUser,
            Some(buffer.as_mut_ptr().cast()),
            (buffer.len() * 8) as u32,
            &mut needed,
        )
        .map_err(failed)?;
        let user = &*(buffer.as_ptr() as *const TOKEN_USER);
        let mut text = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut text).map_err(failed)?;
        let sid = text.to_string();
        let _ = LocalFree(Some(HLOCAL(text.0.cast())));
        sid.map_err(|_| DriveError::Face("Windows gave an unreadable user id.".to_owned()))
    }
}

fn sync_root_id(mount: &SpaceMount) -> Result<String, DriveError> {
    if mount.domain.contains('!') {
        return Err(DriveError::Invalid(
            "That Space can't have a drive here.".to_owned(),
        ));
    }
    Ok(format!("{PROVIDER}!{}!{}", user_sid()?, mount.domain))
}

fn register(mount: &SpaceMount, id: &str) -> Result<(), DriveError> {
    gate(&mount.path, Access::Write)?;
    let failed = |error| face_error("Windows couldn't set up the drive", error);
    let folder = StorageFolder::GetFolderFromPathAsync(&HSTRING::from(mount.path.as_path()))
        .and_then(|operation| operation.get())
        .map_err(failed)?;
    let info = StorageProviderSyncRootInfo::new().map_err(failed)?;
    info.SetId(&HSTRING::from(id)).map_err(failed)?;
    info.SetPath(&folder).map_err(failed)?;
    info.SetDisplayNameResource(&HSTRING::from(format!("Misty - {}", mount.mount_name)))
        .map_err(failed)?;
    let icon = std::env::current_exe()
        .map(|exe| format!("{},0", exe.display()))
        .unwrap_or_default();
    info.SetIconResource(&HSTRING::from(icon)).map_err(failed)?;
    info.SetHydrationPolicy(StorageProviderHydrationPolicy::Full)
        .map_err(failed)?;
    info.SetHydrationPolicyModifier(StorageProviderHydrationPolicyModifier::AutoDehydrationAllowed)
        .map_err(failed)?;
    info.SetPopulationPolicy(StorageProviderPopulationPolicy::AlwaysFull)
        .map_err(failed)?;
    let track_all = StorageProviderInSyncPolicy::FileCreationTime
        | StorageProviderInSyncPolicy::FileReadOnlyAttribute
        | StorageProviderInSyncPolicy::FileHiddenAttribute
        | StorageProviderInSyncPolicy::FileSystemAttribute
        | StorageProviderInSyncPolicy::FileLastWriteTime
        | StorageProviderInSyncPolicy::DirectoryCreationTime
        | StorageProviderInSyncPolicy::DirectoryReadOnlyAttribute
        | StorageProviderInSyncPolicy::DirectoryHiddenAttribute
        | StorageProviderInSyncPolicy::DirectorySystemAttribute
        | StorageProviderInSyncPolicy::DirectoryLastWriteTime;
    info.SetInSyncPolicy(track_all).map_err(failed)?;
    info.SetHardlinkPolicy(StorageProviderHardlinkPolicy::None)
        .map_err(failed)?;
    info.SetVersion(&HSTRING::from(env!("CARGO_PKG_VERSION")))
        .map_err(failed)?;
    info.SetShowSiblingsAsGroup(false).map_err(failed)?;
    let context =
        CryptographicBuffer::CreateFromByteArray(mount.domain.as_bytes()).map_err(failed)?;
    info.SetContext(&context).map_err(failed)?;
    let _ = info.SetAllowPinning(true);
    let _ = info.SetProviderId(PROVIDER_ID);
    StorageProviderSyncRootManager::Register(&info).map_err(failed)
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Identity {
    id: ItemId,
    version: Option<Version>,
    sha256: Option<String>,
}

impl Identity {
    fn of(node: &Node) -> Self {
        Self {
            id: node.id.clone(),
            version: node.version,
            sha256: if node.kind == Kind::File {
                node.sha256.clone()
            } else {
                None
            },
        }
    }

    fn bytes(&self) -> Vec<u8> {
        format!(
            "{}\n{}\n{}",
            self.id,
            self.version
                .map(|version| version.0.to_string())
                .unwrap_or_default(),
            self.sha256.as_deref().unwrap_or_default()
        )
        .into_bytes()
    }

    fn parse(bytes: &[u8]) -> Option<Self> {
        let text = std::str::from_utf8(bytes).ok()?;
        let mut parts = text.split('\n');
        let id = parts.next()?;
        if !ItemId::is_valid(id) {
            return None;
        }
        let version = parts
            .next()
            .and_then(|text| text.parse::<i64>().ok())
            .map(Version);
        let sha256 = parts
            .next()
            .filter(|text| !text.is_empty())
            .map(str::to_owned);
        Some(Self {
            id: ItemId(id.to_owned()),
            version,
            sha256,
        })
    }
}

#[derive(Clone, Debug)]
struct Placeholder {
    identity: Option<Identity>,
    in_sync: bool,
    pin: CF_PIN_STATE,
    on_disk: i64,
}

fn placeholder(path: &Path) -> Result<Option<Placeholder>, DriveError> {
    let handle = open_item(path)?;
    placeholder_of(&handle)
}

fn placeholder_of(handle: &Owned) -> Result<Option<Placeholder>, DriveError> {
    let size = size_of::<CF_PLACEHOLDER_STANDARD_INFO>() + MAX_IDENTITY;
    let mut buffer = vec![0u64; size.div_ceil(8)];
    // SAFETY: the buffer is as long as the size given and 8-byte aligned, as the struct needs.
    let result = unsafe {
        CfGetPlaceholderInfo(
            handle.0,
            CF_PLACEHOLDER_INFO_STANDARD,
            buffer.as_mut_ptr().cast(),
            (buffer.len() * 8) as u32,
            None,
        )
    };
    match result {
        Ok(()) => {}
        Err(error) if is_win32(&error, ERROR_NOT_A_CLOUD_FILE) => return Ok(None),
        Err(error) => return Err(face_error("Windows couldn't read a file's state", error)),
    }
    // SAFETY: the call above filled the struct at the buffer's start; its identity bytes follow
    // in the same buffer, `FileIdentityLength` long (capped at what the buffer holds).
    let (info, identity) = unsafe {
        let info = &*(buffer.as_ptr() as *const CF_PLACEHOLDER_STANDARD_INFO);
        let start = (buffer.as_ptr() as *const u8)
            .add(offset_of!(CF_PLACEHOLDER_STANDARD_INFO, FileIdentity));
        let length = (info.FileIdentityLength as usize).min(MAX_IDENTITY);
        (*info, std::slice::from_raw_parts(start, length).to_vec())
    };
    Ok(Some(Placeholder {
        identity: Identity::parse(&identity),
        in_sync: info.InSyncState == CF_IN_SYNC_STATE_IN_SYNC,
        pin: info.PinState,
        on_disk: info.OnDiskDataSize,
    }))
}

fn set_in_sync(path: &Path) {
    if let Ok(handle) = open_item(path) {
        // SAFETY: a handle opened above.
        unsafe {
            let _ = CfSetInSyncState(
                handle.0,
                CF_IN_SYNC_STATE_IN_SYNC,
                CF_SET_IN_SYNC_FLAG_NONE,
                None,
            );
        }
    }
}

fn fs_metadata(node: &Node) -> CF_FS_METADATA {
    let time = filetime(node.mtime_ms);
    let attributes = match node.kind {
        Kind::Folder => FILE_ATTRIBUTE_DIRECTORY.0,
        Kind::File => FILE_ATTRIBUTE_NORMAL.0,
    };
    CF_FS_METADATA {
        BasicInfo: FILE_BASIC_INFO {
            CreationTime: time,
            LastAccessTime: time,
            LastWriteTime: time,
            ChangeTime: time,
            FileAttributes: attributes,
        },
        FileSize: if node.kind == Kind::File {
            node.size as i64
        } else {
            0
        },
    }
}

fn update_placeholder(
    path: &Path,
    metadata: Option<&CF_FS_METADATA>,
    identity: &Identity,
    flags: CF_UPDATE_FLAGS,
) -> Result<(), DriveError> {
    let bytes = identity.bytes();
    let attempt = || -> Result<(), windows::core::Error> {
        let handle = open_item(path)
            .map_err(|_| windows::core::Error::from(HRESULT(0x8000_4005_u32 as i32)))?;
        // SAFETY: the handle, metadata and identity bytes outlive the call.
        unsafe {
            CfUpdatePlaceholder(
                handle.0,
                metadata.map(|metadata| metadata as *const CF_FS_METADATA),
                Some(bytes.as_ptr().cast()),
                bytes.len() as u32,
                None,
                flags,
                None,
                None,
            )
        }
    };
    let result = match attempt() {
        Err(error) if is_win32(&error, ERROR_ACCESS_DENIED) && is_readonly(path) => {
            set_readonly(path, false);
            let again = attempt();
            set_readonly(path, true);
            again
        }
        other => other,
    };
    result.map_err(|error| face_error("Windows couldn't update a file in the drive", error))
}

fn remove_in_sync(path: &Path) -> bool {
    let Ok(meta) = file_access::fs::symlink_metadata(path) else {
        return true;
    };
    if meta.is_dir() {
        let mut all = true;
        if let Ok(entries) = file_access::fs::read_dir(path) {
            for entry in entries.flatten() {
                all &= remove_in_sync(&entry.path());
            }
        }
        if all && placeholder(path).ok().flatten().is_some() {
            return file_access::fs::remove_dir(path).is_ok();
        }
        return false;
    }
    match placeholder(path) {
        Ok(Some(state)) if state.in_sync => {
            if is_readonly(path) {
                set_readonly(path, false);
            }
            file_access::fs::remove_file(path).is_ok()
        }
        _ => false,
    }
}

enum Work {
    Changed(Vec<Item>),
    Path(PathBuf),
    Rescan,
    Stop,
}

enum OpenEvent {
    Opened(ItemId),
    Closed(ItemId),
    Editing(ItemId),
    Stop,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Fingerprint {
    size: u64,
    written: u64,
}

fn fingerprint(path: &Path) -> Option<Fingerprint> {
    file_access::fs::metadata(path)
        .ok()
        .map(|meta| Fingerprint {
            size: meta.len(),
            written: meta.last_write_time(),
        })
}

#[derive(Clone, Debug)]
struct Pending {
    path: PathBuf,
    fingerprint: Option<Fingerprint>,
}

enum Outcome {
    Done,
    Retry,
}

static ROOTS: LazyLock<Mutex<HashMap<usize, Arc<Root>>>> = LazyLock::new(Default::default);
static NEXT_KEY: AtomicUsize = AtomicUsize::new(1);

struct Root {
    drive: Drive,
    space: SpaceId,
    path: PathBuf,
    key: usize,
    pid: u32,
    connection: Mutex<Option<CF_CONNECTION_KEY>>,
    stop: AtomicBool,
    index: Mutex<HashMap<ItemId, PathBuf>>,
    own: Mutex<HashSet<ItemId>>,
    deleting: Mutex<HashSet<ItemId>>,
    quiet_evict: Mutex<HashSet<ItemId>>,
    transfers: Mutex<HashMap<i64, Arc<AtomicBool>>>,
    pending: Mutex<HashMap<ItemId, Pending>>,
    work: Mutex<mpsc::Sender<Work>>,
    opens: tokio::sync::mpsc::UnboundedSender<OpenEvent>,
    hydrate: Mutex<mpsc::Sender<PathBuf>>,
    watcher: Mutex<Option<JoinHandle<()>>>,
}

impl Root {
    fn connect(drive: Drive, mount: &SpaceMount) -> Result<Arc<Self>, DriveError> {
        let key = NEXT_KEY.fetch_add(1, Ordering::SeqCst);
        let (work, work_receive) = mpsc::channel();
        let (opens, opens_receive) = tokio::sync::mpsc::unbounded_channel();
        let (hydrate, hydrate_receive) = mpsc::channel::<PathBuf>();
        let root = Arc::new(Self {
            drive: drive.clone(),
            space: mount.space.clone(),
            path: mount.path.clone(),
            key,
            pid: std::process::id(),
            connection: Mutex::new(None),
            stop: AtomicBool::new(false),
            index: Mutex::new(HashMap::new()),
            own: Mutex::new(HashSet::new()),
            deleting: Mutex::new(HashSet::new()),
            quiet_evict: Mutex::new(HashSet::new()),
            transfers: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
            work: Mutex::new(work),
            opens,
            hydrate: Mutex::new(hydrate),
            watcher: Mutex::new(None),
        });
        gate(&mount.path, Access::Write)?;
        lock(&ROOTS).insert(key, root.clone());
        // SAFETY: the callback table is a static that outlives the connection; the context is a
        // plain key, never dereferenced.
        let connected = unsafe {
            CfConnectSyncRoot(
                &HSTRING::from(mount.path.as_path()),
                CALLBACKS.as_ptr(),
                Some(key as *const c_void),
                CF_CONNECT_FLAG_REQUIRE_PROCESS_INFO | CF_CONNECT_FLAG_REQUIRE_FULL_FILE_PATH,
            )
        };
        let connection = match connected {
            Ok(connection) => connection,
            Err(error) => {
                lock(&ROOTS).remove(&key);
                return Err(face_error("Windows couldn't connect the drive", error));
            }
        };
        *lock(&root.connection) = Some(connection);

        drive.runtime().spawn(opens_task(
            drive.clone(),
            mount.space.clone(),
            opens_receive,
        ));
        std::thread::Builder::new()
            .name("misty-drive-hydrate".to_owned())
            .spawn(move || {
                for path in hydrate_receive {
                    if let Ok(handle) = open_item(&path) {
                        // SAFETY: a handle opened above; this fetches through Misty's own
                        // FETCH_DATA callback, on another thread.
                        unsafe {
                            let _ =
                                CfHydratePlaceholder(handle.0, 0, -1, CF_HYDRATE_FLAG_NONE, None);
                        }
                    }
                }
            })
            .map_err(DriveError::io)?;
        let worker = root.clone();
        std::thread::Builder::new()
            .name("misty-drive-face".to_owned())
            .spawn(move || worker.work_loop(work_receive))
            .map_err(DriveError::io)?;
        let watched = root.clone();
        let watcher = std::thread::Builder::new()
            .name("misty-drive-watch".to_owned())
            .spawn(move || watched.watch())
            .map_err(DriveError::io)?;
        *lock(&root.watcher) = Some(watcher);
        Ok(root)
    }

    fn shutdown(&self) {
        self.stop.store(true, Ordering::SeqCst);
        self.send(Work::Stop);
        let _ = self.opens.send(OpenEvent::Stop);
        if let Some(watcher) = lock(&self.watcher).take() {
            let _ = watcher.join();
        }
        if let Some(connection) = lock(&self.connection).take() {
            // SAFETY: a connection made in `connect`, disconnected once.
            unsafe {
                let _ = CfDisconnectSyncRoot(connection);
            }
        }
        lock(&ROOTS).remove(&self.key);
    }

    fn send(&self, work: Work) {
        let _ = lock(&self.work).send(work);
    }

    fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }

    fn relative(&self, path: &Path) -> Option<PathBuf> {
        let full = path.to_string_lossy();
        let root = self.path.to_string_lossy();
        let root = root.trim_end_matches('\\');
        let head = full.get(..root.len())?;
        if !head.eq_ignore_ascii_case(root) {
            return None;
        }
        let rest = full.get(root.len()..)?;
        if !rest.is_empty() && !rest.starts_with('\\') {
            return None;
        }
        let rest = PathBuf::from(rest.trim_start_matches('\\'));
        rest.components()
            .all(|part| matches!(part, Component::Normal(_)))
            .then_some(rest)
    }

    fn local_path(&self, node: &Node) -> PathBuf {
        names::local_path(&self.path, &node.path)
    }

    fn path_of(&self, id: &ItemId) -> Option<PathBuf> {
        if let Some(path) = lock(&self.index).get(id).cloned() {
            if file_access::fs::exists(&path) {
                return Some(path);
            }
        }
        self.drive
            .node(&self.space, id)
            .ok()
            .flatten()
            .map(|node| self.local_path(&node))
    }

    fn indexed(&self, id: &ItemId) -> Option<PathBuf> {
        let path = lock(&self.index).get(id).cloned()?;
        let found = placeholder(&path).ok().flatten()?.identity?;
        (found.id == *id).then_some(path)
    }

    fn remember(&self, id: &ItemId, path: &Path) {
        lock(&self.index).insert(id.clone(), path.to_path_buf());
    }

    fn as_own<T>(&self, id: &ItemId, work: impl FnOnce() -> T) -> T {
        lock(&self.own).insert(id.clone());
        let out = work();
        lock(&self.own).remove(id);
        out
    }

    fn is_own(&self, id: &ItemId) -> bool {
        lock(&self.own).contains(id)
    }

    fn work_loop(self: Arc<Self>, receive: mpsc::Receiver<Work>) {
        self.reconcile_all();
        let mut waiting: HashMap<PathBuf, Instant> = HashMap::new();
        let mut settled = Instant::now();
        loop {
            match receive.recv_timeout(Duration::from_millis(500)) {
                Ok(Work::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Ok(Work::Changed(items)) => {
                    self.apply_server(&items);
                    self.settle();
                    settled = Instant::now();
                }
                Ok(Work::Path(path)) => {
                    waiting.insert(path, Instant::now());
                }
                Ok(Work::Rescan) => self.reconcile_all(),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            if self.stopped() {
                break;
            }
            let mut ready: Vec<PathBuf> = waiting
                .iter()
                .filter(|(_, at)| at.elapsed() >= QUIET)
                .map(|(path, _)| path.clone())
                .collect();
            ready.sort_by_key(|path| path.components().count());
            for path in ready {
                waiting.remove(&path);
                if let Outcome::Retry = self.local_change(&path) {
                    waiting.insert(path, Instant::now());
                }
            }
            if settled.elapsed() >= SETTLE_EVERY {
                self.settle();
                settled = Instant::now();
            }
        }
    }

    fn reconcile_all(&self) {
        let root = self.path.clone();
        self.reconcile_folder(None, &root);
    }

    fn reconcile_folder(&self, folder: Option<&ItemId>, dir: &Path) {
        if self.stopped() {
            return;
        }
        let Ok(children) = self.drive.list(&self.space, folder) else {
            return;
        };
        let mut by_id: HashMap<ItemId, Node> = children
            .into_iter()
            .map(|node| (node.id.clone(), node))
            .collect();
        let mut here: HashSet<String> = HashSet::new();
        let mut folders: Vec<(ItemId, PathBuf)> = Vec::new();
        if let Ok(entries) = file_access::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().into_owned();
                here.insert(names::fold(&name));
                let state = match placeholder(&path) {
                    Ok(state) => state,
                    Err(_) => continue,
                };
                let Some(state) = state else {
                    self.send(Work::Path(path));
                    continue;
                };
                let Some(identity) = state.identity.clone() else {
                    continue;
                };
                if lock(&self.deleting).contains(&identity.id) {
                    continue;
                }
                self.remember(&identity.id, &path);
                let node = match by_id.remove(&identity.id) {
                    Some(node) => Some(node),
                    None => self.drive.node(&self.space, &identity.id).ok().flatten(),
                };
                let Some(mut node) = node else {
                    if state.in_sync {
                        self.remove_tree(&path);
                    } else {
                        self.send(Work::Path(path));
                    }
                    continue;
                };
                if node.parent.as_ref() != folder || names::fold(&node.name) != names::fold(&name) {
                    match self.drive.rename(&self.space, &node.id, folder, &name) {
                        Ok(moved) => node = moved,
                        Err(_) => continue,
                    }
                }
                self.sync_placeholder(&path, &node, &state);
                if node.kind == Kind::Folder {
                    folders.push((node.id.clone(), path));
                }
            }
        }
        let mut missing = Vec::new();
        for node in by_id.into_values() {
            if here.contains(&names::fold(&node.name)) {
                continue;
            }
            if node.state == LocalState::NotSynced {
                let _ = self.drive.trash(&self.space, &node.id, TrashBy::Person);
                continue;
            }
            missing.push(node);
        }
        self.create_placeholders(dir, &missing);
        for node in &missing {
            if node.kind == Kind::Folder {
                folders.push((node.id.clone(), dir.join(&node.name)));
            }
        }
        for (id, path) in folders {
            self.reconcile_folder(Some(&id), &path);
        }
    }

    fn create_placeholders(&self, dir: &Path, nodes: &[Node]) {
        if nodes.is_empty() || gate(dir, Access::Write).is_err() {
            return;
        }
        let names: Vec<Vec<u16>> = nodes
            .iter()
            .map(|node| node.name.encode_utf16().chain(std::iter::once(0)).collect())
            .collect();
        let identities: Vec<Vec<u8>> = nodes
            .iter()
            .map(|node| Identity::of(node).bytes())
            .collect();
        let mut infos: Vec<CF_PLACEHOLDER_CREATE_INFO> = nodes
            .iter()
            .enumerate()
            .map(|(at, node)| {
                let uploading = node.state == LocalState::Uploading;
                let flags = match node.kind {
                    Kind::Folder => {
                        CF_PLACEHOLDER_CREATE_FLAG_MARK_IN_SYNC
                            | CF_PLACEHOLDER_CREATE_FLAG_DISABLE_ON_DEMAND_POPULATION
                    }
                    Kind::File if uploading => CF_PLACEHOLDER_CREATE_FLAG_NONE,
                    Kind::File => CF_PLACEHOLDER_CREATE_FLAG_MARK_IN_SYNC,
                };
                CF_PLACEHOLDER_CREATE_INFO {
                    RelativeFileName: PCWSTR(names[at].as_ptr()),
                    FsMetadata: fs_metadata(node),
                    FileIdentity: identities[at].as_ptr().cast(),
                    FileIdentityLength: identities[at].len() as u32,
                    Flags: flags,
                    ..Default::default()
                }
            })
            .collect();
        // SAFETY: the names and identities the infos point into live until after the call.
        let _ = unsafe {
            CfCreatePlaceholders(&HSTRING::from(dir), &mut infos, CF_CREATE_FLAG_NONE, None)
        };
        for (at, node) in nodes.iter().enumerate() {
            if infos[at].Result.is_err() {
                continue;
            }
            let path = dir.join(&node.name);
            self.remember(&node.id, &path);
            if node.kind == Kind::File && node.state == LocalState::Uploading {
                lock(&self.pending).insert(
                    node.id.clone(),
                    Pending {
                        fingerprint: fingerprint(&path),
                        path: path.clone(),
                    },
                );
            }
            let kept = self
                .drive
                .entry_by_id(&self.space, &node.id)
                .ok()
                .flatten()
                .is_some_and(|entry| entry.keep_downloaded);
            if kept && node.kind == Kind::File {
                let _ = lock(&self.hydrate).send(path);
            }
        }
    }

    fn sync_placeholder(&self, path: &Path, node: &Node, state: &Placeholder) {
        let identity = Identity::of(node);
        match node.kind {
            Kind::Folder => {
                if state.identity.as_ref() != Some(&identity) {
                    let _ = update_placeholder(path, None, &identity, CF_UPDATE_FLAG_MARK_IN_SYNC);
                } else if !state.in_sync {
                    set_in_sync(path);
                }
            }
            Kind::File => {
                self.update_file(path, node, state, &identity);
                if is_readonly(path) {
                    set_readonly(path, false);
                }
            }
        }
        self.pins(path, node, state);
    }

    fn update_file(&self, path: &Path, node: &Node, state: &Placeholder, identity: &Identity) {
        if state.identity.as_ref() == Some(identity) {
            if !state.in_sync && state.on_disk > 0 && !lock(&self.pending).contains_key(&node.id) {
                self.send(Work::Path(path.to_path_buf()));
            } else if !state.in_sync && state.on_disk == 0 && node.state != LocalState::Uploading {
                set_in_sync(path);
            }
            return;
        }
        let shown = state
            .identity
            .as_ref()
            .and_then(|shown| shown.sha256.clone());
        if shown == identity.sha256 {
            let flags = if state.in_sync {
                CF_UPDATE_FLAG_MARK_IN_SYNC
            } else {
                CF_UPDATE_FLAG_NONE
            };
            let _ = update_placeholder(path, None, identity, flags);
            return;
        }
        if !state.in_sync || node.state == LocalState::Uploading {
            if state.on_disk > 0 && !lock(&self.pending).contains_key(&node.id) {
                self.send(Work::Path(path.to_path_buf()));
            }
            return;
        }
        let pinned = state.pin == CF_PIN_STATE_PINNED;
        if pinned {
            if let Ok(handle) = open_item(path) {
                // SAFETY: a handle opened above.
                unsafe {
                    let _ = CfSetPinState(
                        handle.0,
                        CF_PIN_STATE_UNSPECIFIED,
                        CF_SET_PIN_FLAG_NONE,
                        None,
                    );
                }
            }
        }
        let metadata = fs_metadata(node);
        let updated = update_placeholder(
            path,
            Some(&metadata),
            identity,
            CF_UPDATE_FLAG_DEHYDRATE | CF_UPDATE_FLAG_MARK_IN_SYNC,
        );
        if pinned {
            if let Ok(handle) = open_item(path) {
                // SAFETY: a handle opened above.
                unsafe {
                    let _ =
                        CfSetPinState(handle.0, CF_PIN_STATE_PINNED, CF_SET_PIN_FLAG_NONE, None);
                }
            }
            if updated.is_ok() {
                let _ = lock(&self.hydrate).send(path.to_path_buf());
            }
        }
    }

    fn pins(&self, path: &Path, node: &Node, state: &Placeholder) {
        let Ok(Some(entry)) = self.drive.entry_by_id(&self.space, &node.id) else {
            return;
        };
        let asked = match state.pin {
            CF_PIN_STATE_PINNED => Some(true),
            CF_PIN_STATE_UNPINNED => Some(false),
            _ => None,
        };
        match asked {
            Some(keep) if keep != entry.keep_downloaded => {
                let drive = self.drive.clone();
                let space = self.space.clone();
                let at = node.path.clone();
                self.drive.runtime().spawn(async move {
                    let _ = drive.keep_downloaded(&space, &at, keep).await;
                });
            }
            Some(_) => {}
            None if entry.keep_downloaded && state.pin == CF_PIN_STATE_UNSPECIFIED => {
                if let Ok(handle) = open_item(path) {
                    // SAFETY: a handle opened above.
                    unsafe {
                        let _ = CfSetPinState(
                            handle.0,
                            CF_PIN_STATE_PINNED,
                            CF_SET_PIN_FLAG_NONE,
                            None,
                        );
                    }
                }
                if node.kind == Kind::File && state.on_disk == 0 && node.size > 0 {
                    let _ = lock(&self.hydrate).send(path.to_path_buf());
                }
            }
            None => {}
        }
    }

    fn remove_tree(&self, path: &Path) -> bool {
        let Ok(meta) = file_access::fs::symlink_metadata(path) else {
            return true;
        };
        let state = placeholder(path).ok().flatten();
        let id = state
            .as_ref()
            .and_then(|state| state.identity.as_ref())
            .map(|identity| identity.id.clone());
        if meta.is_dir() {
            let mut all = true;
            if let Ok(entries) = file_access::fs::read_dir(path) {
                for entry in entries.flatten() {
                    all &= self.remove_tree(&entry.path());
                }
            }
            if !all || state.is_none() {
                return false;
            }
            let removed = match &id {
                Some(id) => self.as_own(id, || file_access::fs::remove_dir(path)),
                None => file_access::fs::remove_dir(path),
            };
            if let (Ok(()), Some(id)) = (&removed, &id) {
                lock(&self.index).remove(id);
            }
            return removed.is_ok();
        }
        let Some(state) = state else {
            return false;
        };
        if !state.in_sync {
            return false;
        }
        if is_readonly(path) {
            set_readonly(path, false);
        }
        let removed = match &id {
            Some(id) => self.as_own(id, || file_access::fs::remove_file(path)),
            None => file_access::fs::remove_file(path),
        };
        if let (Ok(()), Some(id)) = (&removed, &id) {
            lock(&self.index).remove(id);
        }
        removed.is_ok()
    }

    fn apply_server(&self, items: &[Item]) {
        for item in items {
            if self.stopped() {
                return;
            }
            if lock(&self.deleting).contains(&item.id) {
                continue;
            }
            let node = if item.is_live() {
                self.drive.node(&self.space, &item.id).ok().flatten()
            } else {
                None
            };
            match node {
                Some(node) => {
                    self.place(&node, 0);
                }
                None => {
                    if let Some(path) = self.indexed(&item.id) {
                        self.remove_tree(&path);
                    }
                }
            }
        }
    }

    fn place(&self, node: &Node, depth: usize) -> Option<PathBuf> {
        if depth > 64 {
            return None;
        }
        let expected = self.local_path(node);
        let parent_dir = expected.parent()?.to_path_buf();
        if !file_access::fs::is_dir(&parent_dir) {
            let parent = self
                .drive
                .node(&self.space, node.parent.as_ref()?)
                .ok()
                .flatten()?;
            self.place(&parent, depth + 1)?;
        }
        let current = self.indexed(&node.id).or_else(|| {
            let found = placeholder(&expected).ok().flatten()?.identity?;
            (found.id == node.id).then(|| expected.clone())
        });
        match current {
            Some(current) if current != expected => {
                let same_name = current
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&expected.to_string_lossy());
                if !same_name && file_access::fs::exists(&expected) {
                    return None;
                }
                let moved = self.as_own(&node.id, || file_access::fs::rename(&current, &expected));
                if moved.is_err() {
                    return None;
                }
                self.remember(&node.id, &expected);
            }
            Some(_) => {}
            None => {
                if file_access::fs::exists(&expected) {
                    return None;
                }
                self.create_placeholders(&parent_dir, std::slice::from_ref(node));
                if node.kind == Kind::Folder {
                    self.reconcile_folder(Some(&node.id), &expected);
                }
                return Some(expected);
            }
        }
        if let Ok(Some(state)) = placeholder(&expected) {
            self.sync_placeholder(&expected, node, &state);
        }
        Some(expected)
    }

    fn settle(&self) {
        let waiting: Vec<(ItemId, Pending)> = lock(&self.pending)
            .iter()
            .map(|(id, pending)| (id.clone(), pending.clone()))
            .collect();
        for (id, pending) in waiting {
            let Ok(node) = self.drive.node(&self.space, &id) else {
                continue;
            };
            let Some(node) = node else {
                lock(&self.pending).remove(&id);
                continue;
            };
            if node.state == LocalState::Uploading || node.version.is_none() {
                continue;
            }
            lock(&self.pending).remove(&id);
            let path = self.path_of(&id).unwrap_or(pending.path.clone());
            if fingerprint(&path) != pending.fingerprint {
                self.send(Work::Path(path));
                continue;
            }
            let shown = crate::ignore::sha256_file(&path, |_| ())
                .ok()
                .map(|(sha256, _)| sha256);
            if node.kind == Kind::File && shown.is_some() && shown != node.sha256 {
                let metadata = fs_metadata(&node);
                let _ = update_placeholder(
                    &path,
                    Some(&metadata),
                    &Identity::of(&node),
                    CF_UPDATE_FLAG_DEHYDRATE | CF_UPDATE_FLAG_MARK_IN_SYNC,
                );
            } else {
                let _ = update_placeholder(
                    &path,
                    None,
                    &Identity::of(&node),
                    CF_UPDATE_FLAG_MARK_IN_SYNC,
                );
            }
            self.remember(&id, &path);
        }
    }

    fn local_change(&self, path: &Path) -> Outcome {
        let Some(relative) = self.relative(path) else {
            return Outcome::Done;
        };
        if relative.as_os_str().is_empty() {
            return Outcome::Done;
        }
        let Ok(drive_path) = names::path_from_components(&relative) else {
            return Outcome::Done;
        };
        let meta = match file_access::fs::symlink_metadata(path) {
            Ok(meta) => meta,
            Err(_) => {
                if let Ok(Some(node)) = self.drive.node_at(&self.space, &drive_path) {
                    if node.state == LocalState::NotSynced {
                        let _ = self.drive.trash(&self.space, &node.id, TrashBy::Person);
                    }
                }
                return Outcome::Done;
            }
        };
        if meta.file_type().is_symlink() {
            return Outcome::Done;
        }
        match placeholder(path) {
            Ok(Some(state)) => self.placeholder_changed(path, &drive_path, meta.is_dir(), state),
            Ok(None) => self.plain_changed(path, &relative, &drive_path, meta.is_dir()),
            Err(_) => Outcome::Retry,
        }
    }

    fn placeholder_changed(
        &self,
        path: &Path,
        drive_path: &str,
        dir: bool,
        state: Placeholder,
    ) -> Outcome {
        let Some(identity) = state.identity.clone() else {
            return Outcome::Done;
        };
        if lock(&self.deleting).contains(&identity.id) {
            return Outcome::Done;
        }
        self.remember(&identity.id, path);
        let node = self.drive.node(&self.space, &identity.id).ok().flatten();
        let Some(node) = node else {
            let other = self.drive.node_at(&self.space, drive_path).ok().flatten();
            return match other {
                Some(other) if (other.kind == Kind::Folder) == dir => {
                    if update_placeholder(path, None, &Identity::of(&other), CF_UPDATE_FLAG_NONE)
                        .is_err()
                    {
                        return Outcome::Retry;
                    }
                    self.remember(&other.id, path);
                    match placeholder(path) {
                        Ok(Some(state))
                            if state
                                .identity
                                .as_ref()
                                .is_some_and(|shown| shown.id == other.id) =>
                        {
                            self.placeholder_changed(path, drive_path, dir, state)
                        }
                        _ => Outcome::Done,
                    }
                }
                _ if !state.in_sync && !dir && state.on_disk > 0 => self.recreate(path, drive_path),
                _ => Outcome::Done,
            };
        };
        self.pins(path, &node, &state);
        if dir {
            if !state.in_sync {
                set_in_sync(path);
            }
            return Outcome::Done;
        }
        if state.in_sync {
            return Outcome::Done;
        }
        if let Some(pending) = lock(&self.pending).get(&node.id) {
            if fingerprint(path) == pending.fingerprint {
                return Outcome::Done;
            }
        }
        if state.on_disk == 0 {
            if !lock(&self.pending).contains_key(&node.id) {
                set_in_sync(path);
            }
            return Outcome::Done;
        }
        self.upload_edit(path, &identity, &node)
    }

    fn upload_edit(&self, path: &Path, identity: &Identity, node: &Node) -> Outcome {
        match nobody_writing(path) {
            Ok(true) => {}
            Ok(false) => return Outcome::Retry,
            Err(_) => return Outcome::Retry,
        }
        match crate::ignore::sha256_file(path, |_| ()) {
            Ok((sha256, _)) if Some(&sha256) == identity.sha256.as_ref() => {
                set_in_sync(path);
                return Outcome::Done;
            }
            Ok(_) => {}
            Err(error)
                if error
                    .raw_os_error()
                    .is_some_and(|code| SHARING.contains(&code)) =>
            {
                return Outcome::Retry;
            }
            Err(_) => return Outcome::Done,
        }
        let staged = self.drive.temp_path();
        if let Err(error) = file_access::fs::copy(path, &staged) {
            let _ = file_access::fs::remove_file(&staged);
            return if error
                .raw_os_error()
                .is_some_and(|code| SHARING.contains(&code))
            {
                Outcome::Retry
            } else {
                Outcome::Done
            };
        }
        let print = fingerprint(path);
        let mtime = file_access::fs::metadata(path)
            .and_then(|meta| meta.modified())
            .map(ms_of)
            .unwrap_or(0);
        let _ = self.opens.send(OpenEvent::Editing(node.id.clone()));
        match self.drive.modify(
            &self.space,
            &node.id,
            identity.version,
            None,
            None,
            Some(staged.as_path()),
            mtime,
        ) {
            Ok((now, refetch)) => {
                if refetch {
                    let metadata = fs_metadata(&now);
                    let _ = update_placeholder(
                        path,
                        Some(&metadata),
                        &Identity::of(&now),
                        CF_UPDATE_FLAG_DEHYDRATE | CF_UPDATE_FLAG_MARK_IN_SYNC,
                    );
                } else {
                    lock(&self.pending).insert(
                        node.id.clone(),
                        Pending {
                            path: path.to_path_buf(),
                            fingerprint: print,
                        },
                    );
                }
                Outcome::Done
            }
            Err(DriveError::NotFound) => {
                let _ = file_access::fs::remove_file(&staged);
                self.recreate(path, &node.path)
            }
            Err(_) => {
                let _ = file_access::fs::remove_file(&staged);
                Outcome::Retry
            }
        }
    }

    fn recreate(&self, path: &Path, drive_path: &str) -> Outcome {
        let Some(relative) = self.relative(path) else {
            return Outcome::Done;
        };
        let parent = match self.ensure_folder(relative.parent().unwrap_or(Path::new(""))) {
            Ok(parent) => parent,
            Err(outcome) => return outcome,
        };
        let name = names::file_name(drive_path).to_owned();
        let Some((node, at)) = self.new_file(path, parent, &name) else {
            return Outcome::Retry;
        };
        let _ = update_placeholder(&at, None, &Identity::of(&node), CF_UPDATE_FLAG_NONE);
        Outcome::Done
    }

    fn new_file(&self, path: &Path, parent: Option<ItemId>, name: &str) -> Option<(Node, PathBuf)> {
        if !matches!(nobody_writing(path), Ok(true)) {
            return None;
        }
        let staged = self.drive.temp_path();
        if file_access::fs::copy(path, &staged).is_err() {
            let _ = file_access::fs::remove_file(&staged);
            return None;
        }
        let print = fingerprint(path);
        let mtime = file_access::fs::metadata(path)
            .and_then(|meta| meta.modified())
            .map(ms_of)
            .unwrap_or(0);
        let made = self.drive.create_resolving(
            &self.space,
            NewNode {
                parent,
                name: name.to_owned(),
                kind: Kind::File,
                content: Some(staged.clone()),
                mtime_ms: mtime,
                id: None,
            },
            true,
        );
        let node = match made {
            Ok(node) => node,
            Err(_) => {
                let _ = file_access::fs::remove_file(&staged);
                return None;
            }
        };
        let at = self.local_path(&node);
        let path = if at != path {
            match file_access::fs::rename(path, &at) {
                Ok(()) => at,
                Err(_) => path.to_path_buf(),
            }
        } else {
            path.to_path_buf()
        };
        if node.state == LocalState::Uploading {
            lock(&self.pending).insert(
                node.id.clone(),
                Pending {
                    path: path.clone(),
                    fingerprint: print,
                },
            );
        }
        self.remember(&node.id, &path);
        Some((node, path))
    }

    fn plain_changed(&self, path: &Path, relative: &Path, drive_path: &str, dir: bool) -> Outcome {
        if let Ok(Some(node)) = self.drive.node_at(&self.space, drive_path) {
            return match (node.kind, dir) {
                (Kind::Folder, true) => {
                    if node.state != LocalState::NotSynced {
                        if self.convert(path, &Identity::of(&node), true).is_err() {
                            return Outcome::Retry;
                        }
                    }
                    self.remember(&node.id, path);
                    self.scan_new(path);
                    Outcome::Done
                }
                (Kind::File, false) => self.adopt_file(path, &node),
                _ => Outcome::Done,
            };
        }
        let parent = match self.ensure_folder(relative.parent().unwrap_or(Path::new(""))) {
            Ok(parent) => parent,
            Err(outcome) => return outcome,
        };
        let name = names::file_name(drive_path).to_owned();
        if dir {
            let mtime = file_access::fs::metadata(path)
                .and_then(|meta| meta.modified())
                .map(ms_of)
                .unwrap_or(0);
            let made = self.drive.create_resolving(
                &self.space,
                NewNode {
                    parent,
                    name,
                    kind: Kind::Folder,
                    content: None,
                    mtime_ms: mtime,
                    id: None,
                },
                true,
            );
            let Ok(node) = made else {
                return Outcome::Retry;
            };
            let at = self.local_path(&node);
            let path = if at != path && file_access::fs::rename(path, &at).is_ok() {
                at
            } else {
                path.to_path_buf()
            };
            if node.state != LocalState::NotSynced
                && self.convert(&path, &Identity::of(&node), true).is_err()
            {
                return Outcome::Retry;
            }
            self.remember(&node.id, &path);
            self.scan_new(&path);
            return Outcome::Done;
        }
        let Some((node, at)) = self.new_file(path, parent, &name) else {
            return Outcome::Retry;
        };
        if node.state == LocalState::NotSynced {
            return Outcome::Done;
        }
        let in_sync = node.state != LocalState::Uploading;
        if self.convert(&at, &Identity::of(&node), in_sync).is_err() {
            return Outcome::Retry;
        }
        Outcome::Done
    }

    fn adopt_file(&self, path: &Path, node: &Node) -> Outcome {
        if !matches!(nobody_writing(path), Ok(true)) {
            return Outcome::Retry;
        }
        let same = crate::ignore::sha256_file(path, |_| ())
            .ok()
            .is_some_and(|(sha256, _)| node.sha256.as_deref() == Some(sha256.as_str()));
        let mut now = node.clone();
        let mut lost = false;
        if !same {
            let staged = self.drive.temp_path();
            if file_access::fs::copy(path, &staged).is_err() {
                let _ = file_access::fs::remove_file(&staged);
                return Outcome::Retry;
            }
            let mtime = file_access::fs::metadata(path)
                .and_then(|meta| meta.modified())
                .map(ms_of)
                .unwrap_or(0);
            match self.drive.modify(
                &self.space,
                &node.id,
                node.version,
                None,
                None,
                Some(staged.as_path()),
                mtime,
            ) {
                Ok((changed, refetch)) => {
                    now = changed;
                    lost = refetch;
                }
                Err(_) => {
                    let _ = file_access::fs::remove_file(&staged);
                    return Outcome::Retry;
                }
            }
        }
        self.remember(&node.id, path);
        if now.state == LocalState::NotSynced {
            return Outcome::Done;
        }
        let in_sync = now.state != LocalState::Uploading;
        if !in_sync {
            lock(&self.pending).insert(
                now.id.clone(),
                Pending {
                    path: path.to_path_buf(),
                    fingerprint: fingerprint(path),
                },
            );
        }
        if self
            .convert(path, &Identity::of(&now), in_sync || lost)
            .is_err()
        {
            return Outcome::Retry;
        }
        if lost {
            lock(&self.pending).remove(&now.id);
            let metadata = fs_metadata(&now);
            let _ = update_placeholder(
                path,
                Some(&metadata),
                &Identity::of(&now),
                CF_UPDATE_FLAG_DEHYDRATE | CF_UPDATE_FLAG_MARK_IN_SYNC,
            );
        }
        Outcome::Done
    }

    fn ensure_folder(&self, relative: &Path) -> Result<Option<ItemId>, Outcome> {
        if relative.as_os_str().is_empty() {
            return Ok(None);
        }
        let drive_path = names::path_from_components(relative).map_err(|_| Outcome::Done)?;
        if let Ok(Some(node)) = self.drive.node_at(&self.space, &drive_path) {
            return if node.kind == Kind::Folder {
                Ok(Some(node.id))
            } else {
                Err(Outcome::Done)
            };
        }
        let local = self.path.join(relative);
        if !file_access::fs::is_dir(&local) {
            return Err(Outcome::Done);
        }
        let parent = self.ensure_folder(relative.parent().unwrap_or(Path::new("")))?;
        let made = self
            .drive
            .create_resolving(
                &self.space,
                NewNode {
                    parent,
                    name: names::file_name(&drive_path).to_owned(),
                    kind: Kind::Folder,
                    content: None,
                    mtime_ms: 0,
                    id: None,
                },
                true,
            )
            .map_err(|_| Outcome::Retry)?;
        let identity = Identity::of(&made);
        match placeholder(&local) {
            Ok(Some(_)) => {
                let _ = update_placeholder(&local, None, &identity, CF_UPDATE_FLAG_MARK_IN_SYNC);
            }
            Ok(None) if made.state != LocalState::NotSynced => {
                let _ = self.convert(&local, &identity, true);
            }
            _ => {}
        }
        self.remember(&made.id, &local);
        Ok(Some(made.id))
    }

    fn scan_new(&self, dir: &Path) {
        if let Ok(entries) = file_access::fs::read_dir(dir) {
            for entry in entries.flatten() {
                self.send(Work::Path(entry.path()));
            }
        }
    }

    fn convert(&self, path: &Path, identity: &Identity, in_sync: bool) -> Result<(), DriveError> {
        let handle = open_item(path)?;
        let bytes = identity.bytes();
        let flags = if in_sync {
            CF_CONVERT_FLAG_MARK_IN_SYNC
        } else {
            CF_CONVERT_FLAG_NONE
        };
        // SAFETY: the handle and identity bytes outlive the call; no overlapped I/O.
        let converted = unsafe {
            CfConvertToPlaceholder(
                handle.0,
                Some(bytes.as_ptr().cast()),
                bytes.len() as u32,
                flags,
                None,
                None,
            )
        };
        converted.map_err(|error| face_error("Windows couldn't add a file to the drive", error))?;
        self.remember(&identity.id, path);
        Ok(())
    }

    fn watch(self: Arc<Self>) {
        if gate(&self.path, Access::Read).is_err() {
            return;
        }
        // SAFETY: a NUL-terminated path that outlives the call.
        let opened = unsafe {
            CreateFileW(
                &HSTRING::from(self.path.as_path()),
                FILE_LIST_DIRECTORY.0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OVERLAPPED,
                None,
            )
        };
        let Ok(handle) = opened else {
            return;
        };
        let handle = Owned(handle);
        let filter = FILE_NOTIFY_CHANGE_FILE_NAME
            | FILE_NOTIFY_CHANGE_DIR_NAME
            | FILE_NOTIFY_CHANGE_SIZE
            | FILE_NOTIFY_CHANGE_LAST_WRITE
            | FILE_NOTIFY_CHANGE_CREATION
            | FILE_NOTIFY_CHANGE_ATTRIBUTES;
        let mut buffer = vec![0u32; 64 * 1024 / 4];
        while !self.stopped() {
            // SAFETY: all zeroes is an idle OVERLAPPED.
            let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
            // SAFETY: the buffer and the OVERLAPPED outlive the operation: it is waited for, or
            // cancelled and waited for, before either goes.
            let started = unsafe {
                ReadDirectoryChangesW(
                    handle.0,
                    buffer.as_mut_ptr().cast(),
                    (buffer.len() * 4) as u32,
                    true,
                    filter,
                    None,
                    Some(std::ptr::addr_of_mut!(overlapped)),
                    None,
                )
            };
            if started.is_err() {
                return;
            }
            let mut got = 0u32;
            let finished = loop {
                // SAFETY: the operation started above, on this handle and OVERLAPPED.
                let waited =
                    unsafe { GetOverlappedResultEx(handle.0, &overlapped, &mut got, 500, false) };
                match waited {
                    Ok(()) => break true,
                    Err(error) if is_win32(&error, WIN32_ERROR(WAIT_TIMEOUT.0)) => {
                        if self.stopped() {
                            // SAFETY: as above; the cancelled operation is waited for so the
                            // buffer outlives it.
                            unsafe {
                                let _ = CancelIoEx(handle.0, Some(std::ptr::addr_of!(overlapped)));
                                let _ = GetOverlappedResult(handle.0, &overlapped, &mut got, true);
                            }
                            return;
                        }
                    }
                    Err(error) if is_win32(&error, ERROR_OPERATION_ABORTED) => return,
                    Err(_) => break false,
                }
            };
            if !finished {
                return;
            }
            if got == 0 {
                self.send(Work::Rescan);
                continue;
            }
            let bytes = (buffer.as_ptr() as *const u8, got as usize);
            let mut offset = 0usize;
            loop {
                if offset + size_of::<FILE_NOTIFY_INFORMATION>() > bytes.1 {
                    break;
                }
                // SAFETY: the system wrote whole records into the first `got` bytes, each
                // DWORD-aligned, chained by `NextEntryOffset`; the name is `FileNameLength` bytes
                // of UTF-16 right after the record's fixed part.
                let (next, name) = unsafe {
                    let record = &*(bytes.0.add(offset) as *const FILE_NOTIFY_INFORMATION);
                    let start = bytes
                        .0
                        .add(offset + offset_of!(FILE_NOTIFY_INFORMATION, FileName))
                        as *const u16;
                    let length = (record.FileNameLength as usize / 2).min(
                        (bytes.1.saturating_sub(
                            offset + offset_of!(FILE_NOTIFY_INFORMATION, FileName),
                        )) / 2,
                    );
                    let name = OsString::from_wide(std::slice::from_raw_parts(start, length));
                    (record.NextEntryOffset as usize, name)
                };
                let path = self.path.join(name);
                if self.relative(&path).is_some() {
                    self.send(Work::Path(path));
                }
                if next == 0 {
                    break;
                }
                offset += next;
            }
        }
    }
}

async fn opens_task(
    drive: Drive,
    space: SpaceId,
    mut receive: tokio::sync::mpsc::UnboundedReceiver<OpenEvent>,
) {
    let mut open: HashMap<ItemId, (u32, bool)> = HashMap::new();
    while let Some(event) = receive.recv().await {
        match event {
            OpenEvent::Opened(id) => {
                let entry = open.entry(id.clone()).or_insert((0, false));
                entry.0 += 1;
                if entry.0 == 1 {
                    let _ = drive.open(&space, &id, false).await;
                }
            }
            OpenEvent::Closed(id) => {
                let Some(entry) = open.get_mut(&id) else {
                    continue;
                };
                entry.0 = entry.0.saturating_sub(1);
                if entry.0 == 0 {
                    let editing = entry.1;
                    open.remove(&id);
                    drive.close(&space, &id, false).await;
                    if editing {
                        drive.close(&space, &id, true).await;
                    }
                }
            }
            OpenEvent::Editing(id) => {
                if let Some(entry) = open.get_mut(&id) {
                    if !entry.1 {
                        entry.1 = true;
                        let _ = drive.open(&space, &id, true).await;
                    }
                }
            }
            OpenEvent::Stop => break,
        }
    }
    for (id, (_, editing)) in open {
        drive.close(&space, &id, false).await;
        if editing {
            drive.close(&space, &id, true).await;
        }
    }
}

type Callback = unsafe extern "system" fn(*const CF_CALLBACK_INFO, *const CF_CALLBACK_PARAMETERS);

const fn entry(kind: CF_CALLBACK_TYPE, callback: Callback) -> CF_CALLBACK_REGISTRATION {
    CF_CALLBACK_REGISTRATION {
        Type: kind,
        Callback: Some(callback),
    }
}

static CALLBACKS: [CF_CALLBACK_REGISTRATION; 9] = [
    entry(CF_CALLBACK_TYPE_FETCH_DATA, on_fetch_data),
    entry(CF_CALLBACK_TYPE_CANCEL_FETCH_DATA, on_cancel_fetch_data),
    entry(
        CF_CALLBACK_TYPE_NOTIFY_FILE_OPEN_COMPLETION,
        on_open_completion,
    ),
    entry(
        CF_CALLBACK_TYPE_NOTIFY_FILE_CLOSE_COMPLETION,
        on_close_completion,
    ),
    entry(CF_CALLBACK_TYPE_NOTIFY_DELETE, on_delete),
    entry(CF_CALLBACK_TYPE_NOTIFY_RENAME, on_rename),
    entry(CF_CALLBACK_TYPE_NOTIFY_DEHYDRATE, on_dehydrate),
    entry(
        CF_CALLBACK_TYPE_NOTIFY_DEHYDRATE_COMPLETION,
        on_dehydrate_completion,
    ),
    CF_CALLBACK_REGISTRATION {
        Type: CF_CALLBACK_TYPE_NONE,
        Callback: None,
    },
];

#[derive(Clone, Copy)]
struct Request {
    connection: CF_CONNECTION_KEY,
    transfer: i64,
    request: i64,
}

impl Request {
    fn of(info: &CF_CALLBACK_INFO) -> Self {
        Self {
            connection: info.ConnectionKey,
            transfer: info.TransferKey,
            request: info.RequestKey,
        }
    }

    fn info(&self, kind: CF_OPERATION_TYPE) -> CF_OPERATION_INFO {
        CF_OPERATION_INFO {
            StructSize: size_of::<CF_OPERATION_INFO>() as u32,
            Type: kind,
            ConnectionKey: self.connection,
            TransferKey: self.transfer,
            CorrelationVector: std::ptr::null(),
            SyncStatus: std::ptr::null(),
            RequestKey: self.request,
        }
    }
}

fn param_size<T>() -> u32 {
    (offset_of!(CF_OPERATION_PARAMETERS, Anonymous) + size_of::<T>()) as u32
}

fn transfer(
    request: &Request,
    buffer: *const c_void,
    offset: i64,
    length: i64,
    status: NTSTATUS,
) -> windows::core::Result<()> {
    let info = request.info(CF_OPERATION_TYPE_TRANSFER_DATA);
    let mut params = CF_OPERATION_PARAMETERS {
        ParamSize: param_size::<CF_OPERATION_PARAMETERS_0_0>(),
        Anonymous: CF_OPERATION_PARAMETERS_0 {
            TransferData: CF_OPERATION_PARAMETERS_0_0 {
                Flags: CF_OPERATION_TRANSFER_DATA_FLAG_NONE,
                CompletionStatus: status,
                Buffer: buffer,
                Offset: offset,
                Length: length,
            },
        },
    };
    // SAFETY: both structs, and the buffer they point at, outlive the call.
    unsafe { CfExecute(&info, &mut params) }
}

fn ack_delete(request: &Request, status: NTSTATUS) {
    let info = request.info(CF_OPERATION_TYPE_ACK_DELETE);
    let mut params = CF_OPERATION_PARAMETERS {
        ParamSize: param_size::<CF_OPERATION_PARAMETERS_0_7>(),
        Anonymous: CF_OPERATION_PARAMETERS_0 {
            AckDelete: CF_OPERATION_PARAMETERS_0_7 {
                Flags: CF_OPERATION_ACK_DELETE_FLAG_NONE,
                CompletionStatus: status,
            },
        },
    };
    // SAFETY: both structs outlive the call.
    unsafe {
        let _ = CfExecute(&info, &mut params);
    }
}

fn ack_rename(request: &Request, status: NTSTATUS) {
    let info = request.info(CF_OPERATION_TYPE_ACK_RENAME);
    let mut params = CF_OPERATION_PARAMETERS {
        ParamSize: param_size::<CF_OPERATION_PARAMETERS_0_6>(),
        Anonymous: CF_OPERATION_PARAMETERS_0 {
            AckRename: CF_OPERATION_PARAMETERS_0_6 {
                Flags: CF_OPERATION_ACK_RENAME_FLAG_NONE,
                CompletionStatus: status,
            },
        },
    };
    // SAFETY: both structs outlive the call.
    unsafe {
        let _ = CfExecute(&info, &mut params);
    }
}

fn ack_dehydrate(request: &Request, status: NTSTATUS, identity: &[u8]) {
    let info = request.info(CF_OPERATION_TYPE_ACK_DEHYDRATE);
    let mut params = CF_OPERATION_PARAMETERS {
        ParamSize: param_size::<CF_OPERATION_PARAMETERS_0_5>(),
        Anonymous: CF_OPERATION_PARAMETERS_0 {
            AckDehydrate: CF_OPERATION_PARAMETERS_0_5 {
                Flags: CF_OPERATION_ACK_DEHYDRATE_FLAG_NONE,
                CompletionStatus: status,
                FileIdentity: identity.as_ptr().cast(),
                FileIdentityLength: identity.len() as u32,
            },
        },
    };
    // SAFETY: both structs, and the identity bytes, outlive the call.
    unsafe {
        let _ = CfExecute(&info, &mut params);
    }
}

fn root_of(info: &CF_CALLBACK_INFO) -> Option<Arc<Root>> {
    lock(&ROOTS).get(&(info.CallbackContext as usize)).cloned()
}

fn identity_bytes(info: &CF_CALLBACK_INFO) -> Vec<u8> {
    if info.FileIdentity.is_null() || info.FileIdentityLength == 0 {
        return Vec::new();
    }
    let length = (info.FileIdentityLength as usize).min(MAX_IDENTITY);
    // SAFETY: Windows hands the placeholder's identity, this long, for the callback's duration.
    unsafe { std::slice::from_raw_parts(info.FileIdentity.cast::<u8>(), length).to_vec() }
}

fn identity_of(info: &CF_CALLBACK_INFO) -> Option<Identity> {
    Identity::parse(&identity_bytes(info))
}

fn from_own_process(root: &Root, info: &CF_CALLBACK_INFO) -> bool {
    if info.ProcessInfo.is_null() {
        return false;
    }
    // SAFETY: asked for with CF_CONNECT_FLAG_REQUIRE_PROCESS_INFO; valid during the callback.
    unsafe { (*info.ProcessInfo).ProcessId == root.pid }
}

fn callback_path(info: &CF_CALLBACK_INFO, text: PCWSTR) -> Option<PathBuf> {
    if text.is_null() {
        return None;
    }
    // SAFETY: a NUL-terminated string Windows hands for the callback's duration.
    let text = String::from_utf16(unsafe { text.as_wide() }).ok()?;
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return Some(PathBuf::from(rest));
    }
    if text.as_bytes().get(1) == Some(&b':') {
        return Some(PathBuf::from(text));
    }
    let drive = if info.VolumeDosName.is_null() {
        String::new()
    } else {
        // SAFETY: as above.
        String::from_utf16(unsafe { info.VolumeDosName.as_wide() }).ok()?
    };
    Some(PathBuf::from(format!(
        "{}{}",
        drive.trim_end_matches('\\'),
        text
    )))
}

fn guarded(work: impl FnOnce()) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(work));
}

unsafe extern "system" fn on_fetch_data(
    info: *const CF_CALLBACK_INFO,
    params: *const CF_CALLBACK_PARAMETERS,
) {
    // SAFETY: Windows passes valid structs for the callback's duration.
    guarded(|| unsafe { fetch_data(&*info, &*params) });
}

unsafe extern "system" fn on_cancel_fetch_data(
    info: *const CF_CALLBACK_INFO,
    _params: *const CF_CALLBACK_PARAMETERS,
) {
    // SAFETY: as above.
    guarded(|| unsafe {
        let info = &*info;
        if let Some(root) = root_of(info) {
            if let Some(cancelled) = lock(&root.transfers).get(&info.TransferKey) {
                cancelled.store(true, Ordering::SeqCst);
            }
        }
    });
}

unsafe extern "system" fn on_open_completion(
    info: *const CF_CALLBACK_INFO,
    params: *const CF_CALLBACK_PARAMETERS,
) {
    // SAFETY: as above.
    guarded(|| unsafe {
        let (info, params) = (&*info, &*params);
        let flags = params.Anonymous.OpenCompletion.Flags;
        if flags.contains(CF_CALLBACK_OPEN_COMPLETION_FLAG_PLACEHOLDER_UNKNOWN)
            || flags.contains(CF_CALLBACK_OPEN_COMPLETION_FLAG_PLACEHOLDER_UNSUPPORTED)
        {
            return;
        }
        open_event(info, OpenEvent::Opened);
    });
}

unsafe extern "system" fn on_close_completion(
    info: *const CF_CALLBACK_INFO,
    _params: *const CF_CALLBACK_PARAMETERS,
) {
    // SAFETY: as above.
    guarded(|| unsafe { open_event(&*info, OpenEvent::Closed) });
}

unsafe extern "system" fn on_delete(
    info: *const CF_CALLBACK_INFO,
    params: *const CF_CALLBACK_PARAMETERS,
) {
    // SAFETY: as above.
    guarded(|| unsafe {
        let (info, params) = (&*info, &*params);
        let request = Request::of(info);
        if params
            .Anonymous
            .Delete
            .Flags
            .contains(CF_CALLBACK_DELETE_FLAG_IS_UNDELETE)
        {
            return ack_delete(&request, STATUS_SUCCESS);
        }
        trash(info, request, ack_delete);
    });
}

unsafe extern "system" fn on_rename(
    info: *const CF_CALLBACK_INFO,
    params: *const CF_CALLBACK_PARAMETERS,
) {
    // SAFETY: as above.
    guarded(|| unsafe {
        let (info, params) = (&*info, &*params);
        let rename = params.Anonymous.Rename;
        let target = callback_path(info, rename.TargetPath);
        rename_item(info, rename.Flags, target);
    });
}

unsafe extern "system" fn on_dehydrate(
    info: *const CF_CALLBACK_INFO,
    _params: *const CF_CALLBACK_PARAMETERS,
) {
    // SAFETY: as above.
    guarded(|| unsafe {
        let info = &*info;
        let request = Request::of(info);
        let bytes = identity_bytes(info);
        let allowed = match (root_of(info), Identity::parse(&bytes)) {
            (Some(root), Some(identity)) => may_free(&root, &identity.id),
            (None, _) => false,
            (_, None) => true,
        };
        let status = if allowed {
            STATUS_SUCCESS
        } else {
            STATUS_CLOUD_FILE_IN_USE
        };
        ack_dehydrate(&request, status, &bytes);
    });
}

unsafe extern "system" fn on_dehydrate_completion(
    info: *const CF_CALLBACK_INFO,
    params: *const CF_CALLBACK_PARAMETERS,
) {
    // SAFETY: as above.
    guarded(|| unsafe {
        let (info, params) = (&*info, &*params);
        let done = params.Anonymous.DehydrateCompletion;
        if !done
            .Flags
            .contains(CF_CALLBACK_DEHYDRATE_COMPLETION_FLAG_DEHYDRATED)
        {
            return;
        }
        let (Some(root), Some(identity)) = (root_of(info), identity_of(info)) else {
            return;
        };
        let Ok(Some(node)) = root.drive.node(&root.space, &identity.id) else {
            return;
        };
        lock(&root.quiet_evict).insert(identity.id.clone());
        let _ = root.drive.remove_download(&root.space, &node.path);
        lock(&root.quiet_evict).remove(&identity.id);
    });
}

fn may_free(root: &Root, id: &ItemId) -> bool {
    let Ok(Some(entry)) = root.drive.entry_by_id(&root.space, id) else {
        return true;
    };
    !entry.in_use.iter().any(|mark| mark.you)
        && !matches!(entry.state, LocalState::Uploading | LocalState::NotSynced)
        && !lock(&root.pending).contains_key(id)
}

fn open_event(info: &CF_CALLBACK_INFO, event: fn(ItemId) -> OpenEvent) {
    let Some(root) = root_of(info) else {
        return;
    };
    if from_own_process(&root, info) {
        return;
    }
    let Some(identity) = identity_of(info) else {
        return;
    };
    let file = root
        .drive
        .node(&root.space, &identity.id)
        .ok()
        .flatten()
        .is_some_and(|node| node.kind == Kind::File);
    if file {
        let _ = root.opens.send(event(identity.id));
    }
}

fn fetch_data(info: &CF_CALLBACK_INFO, params: &CF_CALLBACK_PARAMETERS) {
    let request = Request::of(info);
    // SAFETY: this is a FETCH_DATA callback, so its parameters are `FetchData`.
    let fetch = unsafe { params.Anonymous.FetchData };
    let (offset, length) = (fetch.RequiredFileOffset, fetch.RequiredLength);
    let fail = |status| {
        let _ = transfer(&request, std::ptr::null(), offset, length, status);
    };
    let (Some(root), Some(identity)) = (root_of(info), identity_of(info)) else {
        return fail(STATUS_CLOUD_FILE_UNSUCCESSFUL);
    };
    let size = info.FileSize.max(0);
    let cancelled = Arc::new(AtomicBool::new(false));
    lock(&root.transfers).insert(request.transfer, cancelled.clone());
    let task_root = root.clone();
    root.drive.runtime().spawn(async move {
        let root = task_root;
        // SAFETY: a connection and transfer this callback named.
        unsafe {
            let _ = CfReportProviderProgress(request.connection, request.transfer, size, 0);
        }
        let staged = root.drive.temp_path();
        let fetched = root
            .drive
            .fetch_to(&root.space, &identity.id, &staged)
            .await;
        let shown = |node: &Node| {
            node.size as i64 == size
                && (identity.sha256.is_none() || node.sha256 == identity.sha256)
        };
        let outcome = match fetched {
            Ok(node) if shown(&node) => {
                let path = staged.clone();
                let flag = cancelled.clone();
                tokio::task::spawn_blocking(move || send_file(&request, &path, offset, size, &flag))
                    .await
                    .unwrap_or(Err(Some(STATUS_CLOUD_FILE_UNSUCCESSFUL)))
            }
            Ok(_) => Err(Some(STATUS_CLOUD_FILE_NOT_IN_SYNC)),
            Err(error) if error.code() == "server_unreachable" => {
                Err(Some(STATUS_CLOUD_FILE_NETWORK_UNAVAILABLE))
            }
            Err(_) => Err(Some(STATUS_CLOUD_FILE_UNSUCCESSFUL)),
        };
        if let Err(Some(status)) = outcome {
            if !cancelled.load(Ordering::SeqCst) {
                let _ = transfer(&request, std::ptr::null(), offset, length, status);
            }
        }
        let _ = file_access::fs::remove_file(&staged);
        lock(&root.transfers).remove(&request.transfer);
    });
}

fn send_file(
    request: &Request,
    path: &Path,
    offset: i64,
    size: i64,
    cancelled: &AtomicBool,
) -> Result<(), Option<NTSTATUS>> {
    let failed = Some(STATUS_CLOUD_FILE_UNSUCCESSFUL);
    let mut file = file_access::fs::File::open(path).map_err(|_| failed)?;
    let end = size.max(0) as u64;
    let mut at = (offset.max(0) as u64) / ALIGN * ALIGN;
    file.seek(SeekFrom::Start(at)).map_err(|_| failed)?;
    let mut buffer = vec![0u8; CHUNK];
    while at < end {
        if cancelled.load(Ordering::SeqCst) {
            return Err(None);
        }
        let want = ((end - at) as usize).min(CHUNK);
        file.read_exact(&mut buffer[..want]).map_err(|_| failed)?;
        transfer(
            request,
            buffer.as_ptr().cast(),
            at as i64,
            want as i64,
            STATUS_SUCCESS,
        )
        .map_err(|_| None)?;
        at += want as u64;
        // SAFETY: the connection and transfer the fetch named.
        unsafe {
            let _ = CfReportProviderProgress(request.connection, request.transfer, size, at as i64);
        }
    }
    Ok(())
}

fn trash(info: &CF_CALLBACK_INFO, request: Request, ack: fn(&Request, NTSTATUS)) {
    let Some(root) = root_of(info) else {
        return ack(&request, STATUS_SUCCESS);
    };
    let Some(identity) = identity_of(info) else {
        return ack(&request, STATUS_SUCCESS);
    };
    if root.is_own(&identity.id) {
        return ack(&request, STATUS_SUCCESS);
    }
    match root.drive.node(&root.space, &identity.id) {
        Ok(Some(_)) => {}
        Ok(None) => return ack(&request, STATUS_SUCCESS),
        Err(_) => return ack(&request, STATUS_CLOUD_FILE_UNSUCCESSFUL),
    }
    lock(&root.deleting).insert(identity.id.clone());
    let task_root = root.clone();
    root.drive.runtime().spawn(async move {
        let root = task_root;
        let result = root
            .drive
            .trash_from_os_now(&root.space, &identity.id)
            .await;
        let status = match result {
            Err(DriveError::InUse(_)) => STATUS_CLOUD_FILE_IN_USE,
            Err(DriveError::Held(_)) => STATUS_CLOUD_FILE_UNSUCCESSFUL,
            Err(DriveError::Changed) => STATUS_CLOUD_FILE_NOT_IN_SYNC,
            Err(DriveError::Invalid(_)) => STATUS_CLOUD_FILE_UNSUCCESSFUL,
            _ => STATUS_SUCCESS,
        };
        ack(&request, status);
        lock(&root.deleting).remove(&identity.id);
        if status == STATUS_SUCCESS {
            lock(&root.index).remove(&identity.id);
            lock(&root.pending).remove(&identity.id);
        }
    });
}

fn rename_item(info: &CF_CALLBACK_INFO, flags: CF_CALLBACK_RENAME_FLAGS, target: Option<PathBuf>) {
    let request = Request::of(info);
    let Some(root) = root_of(info) else {
        return ack_rename(&request, STATUS_SUCCESS);
    };
    let Some(identity) = identity_of(info) else {
        return ack_rename(&request, STATUS_SUCCESS);
    };
    if root.is_own(&identity.id) {
        return ack_rename(&request, STATUS_SUCCESS);
    }
    let inside = flags.contains(CF_CALLBACK_RENAME_FLAG_TARGET_IN_SCOPE);
    let relative = target.as_deref().and_then(|target| root.relative(target));
    let (Some(target), Some(relative), true) = (target.clone(), relative, inside) else {
        return trash(info, request, ack_rename);
    };
    let Some(name) = relative
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
    else {
        return ack_rename(&request, STATUS_CLOUD_FILE_UNSUCCESSFUL);
    };
    let folder = match root.ensure_folder(relative.parent().unwrap_or(Path::new(""))) {
        Ok(folder) => folder,
        Err(_) => return ack_rename(&request, STATUS_CLOUD_FILE_UNSUCCESSFUL),
    };
    let replaced = root
        .drive
        .lookup(&root.space, folder.as_ref(), &name)
        .ok()
        .flatten()
        .filter(|other| other.id != identity.id && other.kind == Kind::File);
    if let Some(other) = &replaced {
        lock(&root.own).insert(other.id.clone());
    }
    let status = match root
        .drive
        .rename(&root.space, &identity.id, folder.as_ref(), &name)
    {
        Ok(node) => {
            if let Some(source) = callback_path(info, info.NormalizedPath) {
                if node.id != identity.id {
                    let _ = update_placeholder(
                        &source,
                        None,
                        &Identity::of(&node),
                        CF_UPDATE_FLAG_NONE,
                    );
                    lock(&root.index).remove(&identity.id);
                }
            }
            root.remember(&node.id, &target);
            STATUS_SUCCESS
        }
        Err(DriveError::Exists) => STATUS_OBJECT_NAME_COLLISION,
        Err(DriveError::NotFound) => STATUS_SUCCESS,
        Err(_) => STATUS_CLOUD_FILE_UNSUCCESSFUL,
    };
    ack_rename(&request, status);
    if let Some(other) = replaced {
        let root = root.clone();
        let id = other.id;
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(5));
            lock(&root.own).remove(&id);
        });
    }
    root.send(Work::Path(target));
}
