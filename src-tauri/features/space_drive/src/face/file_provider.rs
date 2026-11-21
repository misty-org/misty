//! The macOS face, Misty's side: File Provider domains, the signals that send the extension to
//! read changes, the `~/.misty/mnt/<Space>` links, and the app group the extension and Misty
//! share. The extension (`com.misty.desktop.drive`, `com.misty.desktop.drivedev` in debug
//! builds) is a separate `.appex` that talks to Misty over the socket in `crate::socket`, whose
//! doc comment is the protocol.
//!
//! - **App group.** Both bundles are signed with the same group, `<Team ID>.com.misty.desktop`
//!   (`….dev` in debug builds). Misty reads it from its own entitlements
//!   (`SecTaskCopyValueForEntitlement("com.apple.security.application-groups")`), as the
//!   extension does. A build with no group (ad-hoc signed) can't host the extension: then the
//!   drive doesn't start, and the glue says "This build of Misty isn't signed, so Space drives
//!   can't start".
//! - **Container.** `~/Library/Group Containers/<group id>/`, with `drive.sock` and `staging/`.
//! - **Domain.** One for the account, so Finder lists one place under Locations: identifier the
//!   account's id, display name the person's name. Its root holds a folder for each Space, named
//!   as its mount is (`crate::socket` describes the tree). macOS puts the domain at
//!   `~/Library/CloudStorage/Misty-<name>`; Misty links `~/.misty/mnt/<Space>` to the Space's
//!   folder in it.
//! - **Before.** Each Space was a domain of its own, `<account id>.<space id>`. The first mount
//!   removes those, keeping any edits macOS hadn't handed over yet
//!   (`NSFileProviderDomainRemovalModePreserveDirtyUserData`). Misty already has everything else.
//! - **Signals.** When changes land, or a Space comes or goes, Misty signals the working set and
//!   the extension asks `changes_since`.
//!
//! Unmounting (Misty quitting, the account signing out) leaves the domain registered, so the
//! files already on the Mac stay; `forget_space` takes a Space's folder away when the person
//! leaves it, which the extension hears of through `changes_since`.
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};

use block2::RcBlock;
use objc2::{rc::Retained, AllocAnyThread};
use objc2_file_provider::{
    NSFileProviderDomain, NSFileProviderDomainRemovalMode, NSFileProviderManager,
    NSFileProviderRootContainerItemIdentifier, NSFileProviderWorkingSetContainerItemIdentifier,
};
use objc2_foundation::{NSArray, NSError, NSString, NSURL};

use crate::{lock, Drive, DriveError, Item, ItemId, OsFace, SpaceId, SpaceMount};

const WAIT: Duration = Duration::from_secs(30);
/// What the glue shows when there is no app group to host the extension.
pub const UNSIGNED: &str = "This build of Misty isn't signed, so Space drives can't start";

/// The app group Misty shares with its extension, and its folder.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GroupContainer {
    pub group_id: String,
    pub path: PathBuf,
}

impl GroupContainer {
    // The socket's path follows `crate::socket::socket_path`, which keeps it short enough.

    pub fn staging(&self) -> PathBuf {
        self.path.join("staging")
    }
}

/// The extension's bundle id, which it registers its domains under.
pub fn extension_bundle_id() -> &'static str {
    if cfg!(debug_assertions) {
        "com.misty.desktop.drivedev"
    } else {
        "com.misty.desktop.drive"
    }
}

mod entitlement {
    //! `SecTaskCopyValueForEntitlement` on Misty's own task, through Security.framework.
    use core_foundation::{base::TCFType, string::CFString};
    use core_foundation_sys::{
        array::{CFArrayGetCount, CFArrayGetTypeID, CFArrayGetValueAtIndex, CFArrayRef},
        base::{CFAllocatorRef, CFGetTypeID, CFRelease, CFTypeRef},
        error::CFErrorRef,
        string::{CFStringGetTypeID, CFStringRef},
    };
    use std::ffi::c_void;

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecTaskCreateFromSelf(allocator: CFAllocatorRef) -> *mut c_void;
        fn SecTaskCopyValueForEntitlement(
            task: *mut c_void,
            entitlement: CFStringRef,
            error: *mut CFErrorRef,
        ) -> CFTypeRef;
    }

    /// The application groups Misty is signed with.
    pub fn application_groups() -> Vec<String> {
        let mut groups = Vec::new();
        // SAFETY: a null allocator is the default one; the task is released below.
        let task = unsafe { SecTaskCreateFromSelf(std::ptr::null()) };
        if task.is_null() {
            return groups;
        }
        let key = CFString::new("com.apple.security.application-groups");
        // SAFETY: the task and key are valid; a null error pointer is allowed.
        let value = unsafe {
            SecTaskCopyValueForEntitlement(task, key.as_concrete_TypeRef(), std::ptr::null_mut())
        };
        if !value.is_null() {
            // SAFETY: `value` is a valid CF object we own; it is checked to be an array of
            // strings before it is read as one.
            unsafe {
                if CFGetTypeID(value) == CFArrayGetTypeID() {
                    let array = value as CFArrayRef;
                    for index in 0..CFArrayGetCount(array) {
                        let entry = CFArrayGetValueAtIndex(array, index);
                        if !entry.is_null() && CFGetTypeID(entry) == CFStringGetTypeID() {
                            let text = CFString::wrap_under_get_rule(entry as CFStringRef);
                            groups.push(text.to_string());
                        }
                    }
                }
                CFRelease(value);
            }
        }
        // SAFETY: created above.
        unsafe { CFRelease(task as CFTypeRef) };
        groups
    }
}

/// The group container, or `UNSIGNED` when this build isn't signed with Misty's app group.
pub fn group_container() -> Result<GroupContainer, DriveError> {
    let suffix = if cfg!(debug_assertions) {
        ".com.misty.desktop.dev"
    } else {
        ".com.misty.desktop"
    };
    let group_id = entitlement::application_groups()
        .into_iter()
        .find(|group| group.ends_with(suffix) && group.len() > suffix.len())
        .ok_or_else(|| DriveError::Unsupported(UNSIGNED.to_owned()))?;
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| DriveError::Unsupported(UNSIGNED.to_owned()))?;
    let path = home
        .join("Library")
        .join("Group Containers")
        .join(&group_id);
    Ok(GroupContainer { group_id, path })
}

fn error_text(error: *mut NSError) -> Option<String> {
    if error.is_null() {
        return None;
    }
    // SAFETY: a non-null error the system handed to the completion block.
    let error = unsafe { &*error };
    Some(error.localizedDescription().to_string())
}

fn domain(identifier: &str, name: &str) -> Retained<NSFileProviderDomain> {
    // SAFETY: a fresh allocation, initialized once with two valid strings.
    unsafe {
        NSFileProviderDomain::initWithIdentifier_displayName(
            NSFileProviderDomain::alloc(),
            &NSString::from_str(identifier),
            &NSString::from_str(name),
        )
    }
}

fn manager(identifier: &str, name: &str) -> Result<Retained<NSFileProviderManager>, DriveError> {
    let domain = domain(identifier, name);
    // SAFETY: a valid domain object.
    unsafe { NSFileProviderManager::managerForDomain(&domain) }
        .ok_or_else(|| DriveError::Face("macOS has no File Provider for Misty's drive.".to_owned()))
}

/// Calls `start` with a completion block and waits for it.
fn wait_for(start: impl FnOnce(&RcBlock<dyn Fn(*mut NSError)>)) -> Result<(), DriveError> {
    let (send, receive) = mpsc::channel::<Option<String>>();
    let block = RcBlock::new(move |error: *mut NSError| {
        let _ = send.send(error_text(error));
    });
    start(&block);
    match receive.recv_timeout(WAIT) {
        Ok(None) => Ok(()),
        Ok(Some(message)) => Err(DriveError::Face(message)),
        Err(_) => Err(DriveError::Face("macOS didn't answer in time.".to_owned())),
    }
}

/// Registers the domain, returning the folder macOS shows its files in.
fn add_domain(identifier: &str, name: &str) -> Result<PathBuf, DriveError> {
    let domain = domain(identifier, name);
    wait_for(|block| {
        // SAFETY: a valid domain and a completion block that outlives the call (it is reference
        // counted, and the system keeps its own reference).
        unsafe { NSFileProviderManager::addDomain_completionHandler(&domain, block) }
    })?;
    let manager = manager(identifier, name)?;
    let (send, receive) = mpsc::channel::<Result<PathBuf, String>>();
    let block = RcBlock::new(move |url: *mut NSURL, error: *mut NSError| {
        let answer = match (url.is_null(), error_text(error)) {
            (_, Some(message)) => Err(message),
            (true, None) => Err("macOS gave no folder for the drive.".to_owned()),
            (false, None) => {
                // SAFETY: a non-null URL the system handed to the block.
                let url = unsafe { &*url };
                match url.path() {
                    Some(path) => Ok(PathBuf::from(path.to_string())),
                    None => Err("macOS gave no folder for the drive.".to_owned()),
                }
            }
        };
        let _ = send.send(answer);
    });
    // SAFETY: the root identifier is a static string the framework exports; the block outlives
    // the call.
    unsafe {
        manager.getUserVisibleURLForItemIdentifier_completionHandler(
            NSFileProviderRootContainerItemIdentifier,
            &block,
        )
    };
    match receive.recv_timeout(WAIT) {
        Ok(Ok(path)) => Ok(path),
        Ok(Err(message)) => Err(DriveError::Face(message)),
        Err(_) => Err(DriveError::Face("macOS didn't answer in time.".to_owned())),
    }
}

/// Every domain the extension has registered: its identifier and display name.
fn registered_domains() -> Vec<(String, String)> {
    let (send, receive) = mpsc::channel::<Vec<(String, String)>>();
    let block = RcBlock::new(
        move |domains: std::ptr::NonNull<NSArray<NSFileProviderDomain>>, _error: *mut NSError| {
            // SAFETY: a non-null array the system handed to the block.
            let domains = unsafe { domains.as_ref() };
            let found = (0..domains.count())
                .map(|index| {
                    let domain = domains.objectAtIndex(index);
                    // SAFETY: plain NSFileProviderDomain getters.
                    unsafe { (domain.identifier().to_string(), domain.displayName().to_string()) }
                })
                .collect();
            let _ = send.send(found);
        },
    );
    // SAFETY: a completion block that outlives the call.
    unsafe { NSFileProviderManager::getDomainsWithCompletionHandler(&block) };
    receive.recv_timeout(WAIT).unwrap_or_default()
}

/// Removes the domains each Space had before the account's one drive (`<account id>.<space
/// id>`). Edits macOS still held for one are kept where macOS puts them, never thrown away.
fn remove_old_domains(account: &str) {
    let prefix = format!("{account}.");
    for (identifier, name) in registered_domains() {
        if !identifier.starts_with(&prefix) {
            continue;
        }
        let domain = domain(&identifier, &name);
        let (send, receive) = mpsc::channel::<Option<String>>();
        let block = RcBlock::new(move |_kept: *mut NSURL, error: *mut NSError| {
            let _ = send.send(error_text(error));
        });
        // SAFETY: a valid domain and a block that outlives the call.
        unsafe {
            NSFileProviderManager::removeDomain_mode_completionHandler(
                &domain,
                NSFileProviderDomainRemovalMode::PreserveDirtyUserData,
                &block,
            )
        };
        if let Ok(Some(message)) = receive.recv_timeout(WAIT) {
            eprintln!("[drive] couldn't remove a Space's old drive: {message}");
        }
    }
}

/// Replaces whatever link is at `link` with one to `target`. A real folder there is left alone.
fn relink(link: &Path, target: &Path) -> Result<(), DriveError> {
    if let Some(parent) = link.parent() {
        file_access::fs::create_dir_all(parent).map_err(DriveError::io)?;
    }
    match file_access::fs::symlink_metadata(link) {
        Ok(meta) if meta.file_type().is_symlink() => {
            if file_access::fs::read_link(link).ok().as_deref() == Some(target) {
                return Ok(());
            }
            file_access::fs::remove_file(link).map_err(DriveError::io)?;
        }
        Ok(_) => {
            return Err(DriveError::Face(format!(
                "{} is already a folder, so the drive can't be linked there.",
                link.display()
            )))
        }
        Err(_) => {}
    }
    file_access::fs::symlink(target, link).map_err(DriveError::io)
}

/// The account's one domain, once registered: its root folder.
struct Registered {
    root: PathBuf,
}

/// One face for every Space of the account: one domain, a folder in it for each Space.
pub struct FileProviderFace {
    /// The domain's identifier (the account's id) and display name (the person's name).
    identifier: String,
    name: String,
    registered: Mutex<Option<Registered>>,
    /// Mounted Spaces: their `~/.misty/mnt` link and their folder in the domain.
    spaces: Mutex<HashMap<SpaceId, (PathBuf, PathBuf)>>,
    drive: Drive,
}

impl FileProviderFace {
    /// `name` is what Finder shows the drive as, after Misty's own name.
    pub fn new(drive: Drive, name: &str) -> Arc<Self> {
        Arc::new(Self {
            identifier: drive.config().account_id.clone(),
            name: name.to_owned(),
            registered: Mutex::new(None),
            spaces: Mutex::new(HashMap::new()),
            drive,
        })
    }

    /// The domain's root folder, registering the domain the first time.
    fn root(&self) -> Result<PathBuf, DriveError> {
        let mut registered = lock(&self.registered);
        if let Some(registered) = registered.as_ref() {
            return Ok(registered.root.clone());
        }
        remove_old_domains(&self.identifier);
        let root = add_domain(&self.identifier, &self.name)?;
        file_access::allow_space_drive(&root);
        *registered = Some(Registered { root: root.clone() });
        Ok(root)
    }

    /// The person left a Space: its link goes, and its folder leaves the Mac once the extension
    /// asks what changed (the Space is no longer among `Drive::space_folders`).
    pub fn forget_space(&self, mount: &SpaceMount) {
        let known = lock(&self.spaces).remove(&mount.space);
        let link = known.map_or_else(|| mount.path.clone(), |(link, _)| link);
        if file_access::fs::symlink_metadata(&link).is_ok_and(|meta| meta.file_type().is_symlink()) {
            let _ = file_access::fs::remove_file(&link);
        }
        self.signal();
    }

    fn manager(&self) -> Option<Retained<NSFileProviderManager>> {
        lock(&self.registered).as_ref()?;
        manager(&self.identifier, &self.name).ok()
    }

    /// Sends the extension to ask what changed.
    fn signal(&self) {
        let Some(manager) = self.manager() else {
            return;
        };
        let block = ignore_error();
        // SAFETY: the working-set identifier is a static string the framework exports.
        unsafe {
            manager.signalEnumeratorForContainerItemIdentifier_completionHandler(
                NSFileProviderWorkingSetContainerItemIdentifier,
                &block,
            )
        };
    }
}

fn ignore_error() -> RcBlock<dyn Fn(*mut NSError)> {
    RcBlock::new(|_error: *mut NSError| {})
}

impl OsFace for FileProviderFace {
    fn mount(&self, space: &SpaceMount) -> Result<(), DriveError> {
        let folder = self.root()?.join(&space.mount_name);
        self.drive.set_os_root(&space.space, folder.clone());
        relink(&space.path, &folder)?;
        lock(&self.spaces).insert(space.space.clone(), (space.path.clone(), folder));
        // The extension catches up from its anchor, and finds the Space's folder if it's new.
        self.signal();
        Ok(())
    }

    fn unmount(&self, space: &SpaceId) -> Result<(), DriveError> {
        // The Space stays in the drive: what is on the Mac stays, and the extension answers
        // "server unreachable" inside it until Misty mounts it again.
        lock(&self.spaces).remove(space);
        Ok(())
    }

    fn changed(&self, _space: &SpaceId, _items: &[Item]) {
        self.signal();
    }

    fn evict(&self, _space: &SpaceId, item: &ItemId) -> Result<(), DriveError> {
        let Some(manager) = self.manager() else {
            return Ok(());
        };
        let id = NSString::from_str(item.as_str());
        wait_for(|block| {
            // SAFETY: a valid manager, identifier and block.
            unsafe { manager.evictItemWithIdentifier_completionHandler(&id, block) }
        })
    }
}
