use std::collections::HashSet;
#[cfg(target_os = "macos")]
use std::ffi::c_void;
use std::fs;
use std::path::Path;
use std::process::Command;
#[cfg(target_os = "macos")]
use std::ptr;
#[cfg(target_os = "macos")]
use std::thread;

use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceUnmountRequest {
    pub volume_id: String,
    pub mount_path: String,
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

    pub fn unmount(&self, request: DeviceUnmountRequest) -> ApiResult<DeviceSnapshot> {
        let devices = scan_mounted_devices();
        let device = devices
            .iter()
            .find(|device| {
                device.volume_id == request.volume_id && device.mount_path == request.mount_path
            })
            .ok_or_else(|| {
                ApiError::Message(
                    "That volume changed or is no longer mounted. Refresh Devices and try again."
                        .to_owned(),
                )
            })?;
        validate_unmount_target(device)?;
        perform_unmount(device)?;
        Ok(DeviceSnapshot {
            devices: scan_mounted_devices(),
        })
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
        let details = device_details(&row);
        devices.push(MountedDeviceSnapshot {
            id: details.volume_id.clone(),
            volume_id: details.volume_id,
            name,
            mount_path: row.mount_path.clone(),
            fs_type: details.fs_type,
            is_removable: details.is_removable,
            is_system: row.mount_path == "/",
            is_external: details.is_external,
            is_network: row.fs_name.starts_with("//") || row.fs_name.contains(":"),
            writable: details.writable,
            total_bytes: row.total_kb.saturating_mul(1024),
            free_bytes: row.available_kb.saturating_mul(1024),
        });
    }
    devices
}

struct DeviceDetails {
    volume_id: String,
    fs_type: String,
    is_external: bool,
    is_removable: bool,
    writable: bool,
}

fn device_details(row: &DfRow) -> DeviceDetails {
    let fallback = DeviceDetails {
        volume_id: row.fs_name.clone(),
        fs_type: fs_type_for_row(row),
        // Fail closed on macOS. If Disk Arbitration cannot describe a volume,
        // keep showing it but do not make a destructive action available.
        is_external: if cfg!(target_os = "macos") {
            false
        } else {
            row.mount_path != "/"
        },
        is_removable: if cfg!(target_os = "macos") {
            false
        } else {
            is_removable_mount(&row.mount_path)
        },
        writable: fs::metadata(&row.mount_path)
            .map(|metadata| !metadata.permissions().readonly())
            .unwrap_or(false),
    };
    #[cfg(target_os = "macos")]
    {
        let Ok(output) = Command::new("diskutil")
            .args(["info", "-plist", &row.mount_path])
            .output()
        else {
            return fallback;
        };
        if !output.status.success() {
            return fallback;
        }
        let xml = String::from_utf8_lossy(&output.stdout);
        let volume_id = plist_string(&xml, "VolumeUUID")
            .or_else(|| plist_string(&xml, "APFSVolumeUUID"))
            .unwrap_or_else(|| fallback.volume_id.clone());
        let fs_type = plist_string(&xml, "FilesystemType")
            .or_else(|| plist_string(&xml, "Type (Bundle)"))
            .unwrap_or_else(|| fallback.fs_type.clone());
        let is_internal = plist_bool(&xml, "Internal").unwrap_or(!fallback.is_external);
        let is_removable = plist_bool(&xml, "RemovableMedia")
            .or_else(|| plist_bool(&xml, "Ejectable"))
            .unwrap_or(fallback.is_removable);
        let writable = plist_bool(&xml, "Writable").unwrap_or(fallback.writable);
        DeviceDetails {
            volume_id,
            fs_type,
            is_external: !is_internal,
            is_removable,
            writable,
        }
    }
    #[cfg(not(target_os = "macos"))]
    fallback
}

fn validate_unmount_target(device: &MountedDeviceSnapshot) -> ApiResult<()> {
    if device.is_system || device.mount_path == "/" {
        return Err(ApiError::Message(
            "Misty will never unmount the startup disk.".to_owned(),
        ));
    }
    if !(device.is_removable || device.is_external || device.is_network) {
        return Err(ApiError::Message(
            "Misty only unmounts removable, external, or network volumes.".to_owned(),
        ));
    }
    #[cfg(target_os = "macos")]
    if !device.mount_path.starts_with("/Volumes/") {
        return Err(ApiError::Message(
            "Misty only unmounts macOS volumes mounted below /Volumes.".to_owned(),
        ));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn perform_unmount(device: &MountedDeviceSnapshot) -> ApiResult<()> {
    let output = Command::new("/usr/sbin/diskutil")
        .args(["unmount", &device.mount_path])
        .output()
        .map_err(|error| ApiError::Message(format!("Could not start macOS unmount: {error}")))?;
    if output.status.success() {
        return Ok(());
    }
    let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    Err(ApiError::Message(if message.is_empty() {
        "macOS could not unmount that volume. Close files using it and try again.".to_owned()
    } else {
        format!("macOS could not unmount that volume: {message}")
    }))
}

#[cfg(not(target_os = "macos"))]
fn perform_unmount(_device: &MountedDeviceSnapshot) -> ApiResult<()> {
    Err(ApiError::Unavailable(
        "Safe device unmounting is currently available on macOS.".to_owned(),
    ))
}

#[cfg(target_os = "macos")]
fn plist_string(xml: &str, key: &str) -> Option<String> {
    let marker = format!("<key>{key}</key>");
    let tail = xml.split_once(&marker)?.1;
    let value = tail
        .split_once("<string>")?
        .1
        .split_once("</string>")?
        .0
        .trim();
    (!value.is_empty()).then(|| value.to_owned())
}
#[cfg(target_os = "macos")]
fn plist_bool(xml: &str, key: &str) -> Option<bool> {
    let marker = format!("<key>{key}</key>");
    let tail = xml.split_once(&marker)?.1.trim_start();
    if tail.starts_with("<true/>") {
        Some(true)
    } else if tail.starts_with("<false/>") {
        Some(false)
    } else {
        None
    }
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
        mount_path.starts_with("/Volumes/")
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
        mount_path != "/" && mount_path.starts_with("/Volumes/")
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

    #[test]
    fn unmount_protects_the_system_volume() {
        let device = test_device("/", true, false, false);
        let error = validate_unmount_target(&device).unwrap_err();
        assert!(error.to_string().contains("never unmount the startup disk"));
    }

    #[test]
    fn unmount_rejects_internal_non_removable_volumes() {
        let device = test_device("/internal", false, false, false);
        let error = validate_unmount_target(&device).unwrap_err();
        assert!(error.to_string().contains("only unmounts removable"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn unmount_accepts_external_macos_volumes() {
        let device = test_device("/Volumes/Backup", false, true, true);
        validate_unmount_target(&device).unwrap();
    }

    fn test_device(
        mount_path: &str,
        is_system: bool,
        is_external: bool,
        is_removable: bool,
    ) -> MountedDeviceSnapshot {
        MountedDeviceSnapshot {
            id: "volume".to_owned(),
            volume_id: "volume".to_owned(),
            name: "Volume".to_owned(),
            mount_path: mount_path.to_owned(),
            fs_type: "test".to_owned(),
            is_removable,
            is_system,
            is_external,
            is_network: false,
            writable: true,
            total_bytes: 1,
            free_bytes: 1,
        }
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
