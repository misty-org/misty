//! Mounted volumes read from `df -kP`, with the details macOS and Linux add.
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::process::Command;

use super::MountedDeviceSnapshot;

pub(super) fn scan_from_df() -> Vec<MountedDeviceSnapshot> {
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

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
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
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        false
    }
}

#[cfg(test)]
mod tests;
