//! Where Misty's socket is: the app group the extension and Misty are both signed with
//! (`<Team ID>.com.misty.desktop`, `.dev` for dev builds; `tasks/drive-extension.ts`). The extension
//! reads the group from its own entitlement rather than repeating the name, so a build's two halves
//! always agree.
use std::{ffi::c_void, path::PathBuf};

use objc2::rc::Retained;
use objc2_foundation::{NSArray, NSFileManager, NSString};

#[link(name = "Security", kind = "framework")]
extern "C" {
    fn SecTaskCreateFromSelf(allocator: *const c_void) -> *mut c_void;
    fn SecTaskCopyValueForEntitlement(
        task: *mut c_void,
        entitlement: *const c_void,
        error: *mut *mut c_void,
    ) -> *mut c_void;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(object: *const c_void);
}

/// The first app group in this process's `com.apple.security.application-groups` entitlement.
fn app_group() -> Option<Retained<NSString>> {
    let key = NSString::from_str("com.apple.security.application-groups");
    // SAFETY: plain Security calls on this process's own task; the task is released below, and the
    // entitlement's value is a +1 CFArray of CFStrings, toll-free bridged to NSArray<NSString>, whose
    // ownership `Retained::from_raw` takes.
    unsafe {
        let task = SecTaskCreateFromSelf(std::ptr::null());
        if task.is_null() {
            return None;
        }
        let value = SecTaskCopyValueForEntitlement(
            task,
            Retained::as_ptr(&key).cast(),
            std::ptr::null_mut(),
        );
        CFRelease(task);
        let groups = Retained::<NSArray<NSString>>::from_raw(value.cast())?;
        groups.firstObject()
    }
}

/// The app group's container, which the sandbox lets the extension reach.
pub fn container() -> Option<PathBuf> {
    let group = app_group()?;
    let url = NSFileManager::defaultManager().containerURLForSecurityApplicationGroupIdentifier(&group)?;
    Some(PathBuf::from(url.path()?.to_string()))
}
