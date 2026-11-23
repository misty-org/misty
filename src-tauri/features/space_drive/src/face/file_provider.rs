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
pub const UNSIGNED: &str = "This build of Misty isn't signed, so Space drives can't start";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GroupContainer {
    pub group_id: String,
    pub path: PathBuf,
}

impl GroupContainer {
    pub fn staging(&self) -> PathBuf {
        self.path.join("staging")
    }
}

pub fn extension_bundle_id() -> &'static str {
    if cfg!(debug_assertions) {
        "com.misty.desktop.drivedev"
    } else {
        "com.misty.desktop.drive"
    }
}

mod entitlement {
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
                    unsafe {
                        (
                            domain.identifier().to_string(),
                            domain.displayName().to_string(),
                        )
                    }
                })
                .collect();
            let _ = send.send(found);
        },
    );
    // SAFETY: a completion block that outlives the call.
    unsafe { NSFileProviderManager::getDomainsWithCompletionHandler(&block) };
    receive.recv_timeout(WAIT).unwrap_or_default()
}

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

struct Registered {
    root: PathBuf,
}

pub struct FileProviderFace {
    identifier: String,
    name: String,
    registered: Mutex<Option<Registered>>,
    spaces: Mutex<HashMap<SpaceId, (PathBuf, PathBuf)>>,
    drive: Drive,
}

impl FileProviderFace {
    pub fn new(drive: Drive, name: &str) -> Arc<Self> {
        Arc::new(Self {
            identifier: drive.config().account_id.clone(),
            name: name.to_owned(),
            registered: Mutex::new(None),
            spaces: Mutex::new(HashMap::new()),
            drive,
        })
    }

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

    pub fn forget_space(&self, mount: &SpaceMount) {
        let known = lock(&self.spaces).remove(&mount.space);
        let link = known.map_or_else(|| mount.path.clone(), |(link, _)| link);
        if file_access::fs::symlink_metadata(&link).is_ok_and(|meta| meta.file_type().is_symlink())
        {
            let _ = file_access::fs::remove_file(&link);
        }
        self.signal();
    }

    fn manager(&self) -> Option<Retained<NSFileProviderManager>> {
        lock(&self.registered).as_ref()?;
        manager(&self.identifier, &self.name).ok()
    }

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
        self.signal();
        Ok(())
    }

    fn unmount(&self, space: &SpaceId) -> Result<(), DriveError> {
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
