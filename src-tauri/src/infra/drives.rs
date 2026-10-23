#[cfg(target_os = "macos")]
use std::ffi::c_void;
#[cfg(target_os = "macos")]
use std::ptr;
#[cfg(target_os = "macos")]
use std::thread;

use serde::Serialize;

#[cfg(not(windows))]
mod df;
#[cfg(not(windows))]
use df::scan_from_df;

#[cfg(target_os = "macos")]
use tauri::{Emitter, Wry};

pub const DEVICES_CHANGED_EVENT: &str = "misty://devices-changed";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MountedDeviceSnapshot {
    pub id: String,
    pub volume_id: String,
    pub name: String,
    pub mount_path: String,
    pub fs_type: String,
    pub is_removable: bool,
    pub is_system: bool,
    pub is_external: bool,
    pub is_network: bool,
    pub writable: bool,
    pub total_bytes: u64,
    pub free_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSnapshot {
    pub devices: Vec<MountedDeviceSnapshot>,
}

#[derive(Debug, Clone, Default)]
pub struct DeviceService;

impl DeviceService {
    pub fn new() -> Self {
        Self
    }

    pub fn snapshot(&self) -> DeviceSnapshot {
        DeviceSnapshot {
            devices: scan_mounted_devices(),
        }
    }
}

#[cfg(target_os = "macos")]
pub fn start_device_change_listener(app: tauri::AppHandle<Wry>) {
    thread::Builder::new()
        .name("misty-device-change-listener".to_owned())
        .spawn(move || unsafe {
            let session = DASessionCreate(ptr::null());
            if session.is_null() {
                return;
            }

            let context = Box::into_raw(Box::new(app)) as *mut c_void;
            DARegisterDiskAppearedCallback(session, ptr::null(), disk_changed, context);
            DARegisterDiskDisappearedCallback(session, ptr::null(), disk_changed, context);
            DASessionScheduleWithRunLoop(session, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
            CFRunLoopRun();
        })
        .ok();
}

#[cfg(target_os = "macos")]
type CFAllocatorRef = *const c_void;
#[cfg(target_os = "macos")]
type CFDictionaryRef = *const c_void;
#[cfg(target_os = "macos")]
type CFRunLoopRef = *const c_void;
#[cfg(target_os = "macos")]
type CFStringRef = *const c_void;
#[cfg(target_os = "macos")]
type DADiskRef = *const c_void;
#[cfg(target_os = "macos")]
type DASessionRef = *const c_void;

#[cfg(target_os = "macos")]
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFRunLoopDefaultMode: CFStringRef;
    fn CFRunLoopGetCurrent() -> CFRunLoopRef;
    fn CFRunLoopRun();
}

#[cfg(target_os = "macos")]
#[link(name = "DiskArbitration", kind = "framework")]
extern "C" {
    fn DASessionCreate(allocator: CFAllocatorRef) -> DASessionRef;
    fn DASessionScheduleWithRunLoop(
        session: DASessionRef,
        run_loop: CFRunLoopRef,
        run_loop_mode: CFStringRef,
    );
    fn DARegisterDiskAppearedCallback(
        session: DASessionRef,
        match_: CFDictionaryRef,
        callback: extern "C" fn(DADiskRef, *mut c_void),
        context: *mut c_void,
    );
    fn DARegisterDiskDisappearedCallback(
        session: DASessionRef,
        match_: CFDictionaryRef,
        callback: extern "C" fn(DADiskRef, *mut c_void),
        context: *mut c_void,
    );
}

#[cfg(target_os = "macos")]
extern "C" fn disk_changed(_disk: DADiskRef, context: *mut c_void) {
    if context.is_null() {
        return;
    }

    let app = unsafe { &*(context as *const tauri::AppHandle<Wry>) };
    let _ = app.emit(DEVICES_CHANGED_EVENT, ());
}

#[cfg(windows)]
pub use super::drives_windows::start_device_change_listener;

fn scan_mounted_devices() -> Vec<MountedDeviceSnapshot> {
    #[cfg(windows)]
    let mut devices = super::drives_windows::scan();
    #[cfg(not(windows))]
    let mut devices = scan_from_df();
    // The startup disk first, then by name.
    devices.sort_by(|left, right| {
        right
            .is_system
            .cmp(&left.is_system)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    devices
}
