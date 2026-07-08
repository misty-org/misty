use std::collections::HashSet;
#[cfg(target_os = "macos")]
use std::ffi::c_void;
use std::path::Path;
use std::process::Command;
#[cfg(target_os = "macos")]
use std::ptr;
#[cfg(target_os = "macos")]
use std::thread;

use serde::Serialize;
#[cfg(target_os = "macos")]
use tauri::{Emitter, Wry};

pub const DEVICES_CHANGED_EVENT: &str = "misty://devices-changed";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MountedDeviceSnapshot {
    pub id: String,
    pub name: String,
    pub mount_path: String,
    pub fs_type: String,
    pub is_removable: bool,
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

fn scan_mounted_devices() -> Vec<MountedDeviceSnapshot> {
    let mut devices = scan_from_df();
    devices.sort_by(|left, right| {
        if left.mount_path == "/" {
            return std::cmp::Ordering::Less;
        }
        if right.mount_path == "/" {
            return std::cmp::Ordering::Greater;
        }
        left.name.to_lowercase().cmp(&right.name.to_lowercase())
    });
    devices
}

fn scan_from_df() -> Vec<MountedDeviceSnapshot> {
    let output = Command::new("df").args(["-kP"]).output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&output.stdout);
    parse_df_kp_output(&text)
}

fn parse_df_kp_output(text: &str) -> Vec<MountedDeviceSnapshot> {
    let mut devices = Vec::new();
    let mut seen = HashSet::new();
    for line in text.lines().skip(1) {
        let Some(row) = parse_df_kp_line(line) else {
            continue;
        };
        if !should_show_mount(&row.mount_path, &row.fs_name) {
            continue;
        }
        if !seen.insert(row.mount_path.clone()) {
            continue;
        }
        let name = device_name(&row.mount_path, &row.fs_name);
        devices.push(MountedDeviceSnapshot {
            id: row.mount_path.clone(),
            name,
            mount_path: row.mount_path.clone(),
            fs_type: fs_type_for_row(&row),
            is_removable: is_removable_mount(&row.mount_path),
            total_bytes: row.total_kb.saturating_mul(1024),
            free_bytes: row.available_kb.saturating_mul(1024),
        });
    }
    devices
}

#[derive(Debug, PartialEq, Eq)]
struct DfRow {
    fs_name: String,
    total_kb: u64,
    available_kb: u64,
    mount_path: String,
}

fn parse_df_kp_line(line: &str) -> Option<DfRow> {
    let columns: Vec<&str> = line.split_whitespace().collect();
    if columns.len() < 6 {
        return None;
    }
    let total_kb = columns.get(1)?.parse().ok()?;
    let available_kb = columns.get(3)?.parse().ok()?;
    let mount_path = columns[5..].join(" ");
    Some(DfRow {
        fs_name: columns[0].to_owned(),
        total_kb,
        available_kb,
        mount_path,
    })
}

fn should_show_mount(mount_path: &str, fs_name: &str) -> bool {
    if mount_path == "/" {
        return true;
    }

    #[cfg(target_os = "macos")]
    {
        if fs_name.starts_with("devfs")
            || mount_path.starts_with("/System/")
            || mount_path.starts_with("/private/")
        {
            return false;
        }
        return mount_path.starts_with("/Volumes/");
    }

    #[cfg(target_os = "linux")]
    {
        if mount_path.starts_with("/media/")
            || mount_path.starts_with("/mnt/")
            || mount_path.starts_with("/run/media/")
        {
            return !linux_skip_fs(fs_name);
        }
        return false;
    }

    #[cfg(target_os = "windows")]
    {
        return mount_path.ends_with(":\\") || mount_path.ends_with(":/");
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        false
    }
}

#[cfg(target_os = "linux")]
fn linux_skip_fs(fs_name: &str) -> bool {
    matches!(
        fs_name,
        "sysfs"
            | "proc"
            | "devtmpfs"
            | "devpts"
            | "tmpfs"
            | "cgroup"
            | "cgroup2"
            | "overlay"
            | "squashfs"
            | "fusectl"
    )
}

fn device_name(mount_path: &str, fs_name: &str) -> String {
    if mount_path == "/" {
        #[cfg(target_os = "macos")]
        {
            return "Macintosh HD".to_owned();
        }
        #[cfg(not(target_os = "macos"))]
        {
            return "Root".to_owned();
        }
    }
    Path::new(mount_path)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| fs_name.to_owned())
}

fn fs_type_for_row(row: &DfRow) -> String {
    #[cfg(target_os = "macos")]
    {
        // `df -kP` reports the device name rather than fstype on macOS. Keep
        // the field useful without doing another mount-table call.
        if row.fs_name.starts_with("/dev/") {
            return "local".to_owned();
        }
    }
    row.fs_name.clone()
}

fn is_removable_mount(mount_path: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        return mount_path != "/" && mount_path.starts_with("/Volumes/");
    }
    #[cfg(target_os = "linux")]
    {
        return mount_path.starts_with("/media/") || mount_path.starts_with("/run/media/");
    }
    #[cfg(target_os = "windows")]
    {
        return !mount_path.starts_with("C:");
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn parses_macos_df_rows() {
        let text = "\
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/disk3s1s1 478724992 150000000 310000000 33% /
/dev/disk4s1 1000000 250000 750000 25% /Volumes/USB Drive
devfs 200 200 0 100% /dev
";
        let devices = parse_df_kp_output(text);
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].name, "Macintosh HD");
        assert_eq!(devices[0].mount_path, "/");
        assert_eq!(devices[1].name, "USB Drive");
        assert_eq!(devices[1].free_bytes, 750000 * 1024);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn parses_linux_df_rows() {
        let text = "\
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/nvme0n1p2 1000 250 750 25% /
/dev/sdb1 2000 500 1500 25% /media/me/USB
tmpfs 100 1 99 1% /run
";
        let devices = parse_df_kp_output(text);
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].mount_path, "/");
        assert_eq!(devices[1].name, "USB");
    }
}
