//! Lets web scrollbars run into the window's rounded corners. Since macOS 26,
//! WKWebView reads its window's corner configuration and shortens its native
//! scroll track by the corner radius (24pt at the bottom-right of a Misty
//! window), so a page's scrollbar stops well short of the corner. Misty draws
//! its own pane corners, so every web view in the process reports no corner
//! configuration instead. Earlier macOS versions lack the method and are left alone.

use objc2::runtime::{AnyClass, AnyObject, Sel};
use objc2::{class, sel};
use std::ffi::c_void;

extern "C" {
    fn class_getInstanceMethod(class: *const AnyClass, name: Sel) -> *mut c_void;
    fn method_setImplementation(method: *mut c_void, imp: *const c_void) -> *const c_void;
}

extern "C" fn no_corner_configuration(_this: *mut AnyObject, _cmd: Sel) -> *mut AnyObject {
    std::ptr::null_mut()
}

pub(crate) fn install() {
    unsafe {
        let method = class_getInstanceMethod(class!(WKWebView), sel!(_cornerConfiguration));
        if !method.is_null() {
            method_setImplementation(method, no_corner_configuration as *const c_void);
        }
    }
}
