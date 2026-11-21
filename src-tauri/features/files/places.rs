//! The sidebar's fixed places (Home, Desktop, Documents, Downloads, Applications) and the drives
//! mounted on this computer, and how much room a drive has left for the bottom bar.
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::{asked_path, blocking, failed, person_window};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    pub name: String,
    pub path: String,
    pub removable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Places {
    pub home: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desktop: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documents: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloads: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applications: Option<String>,
    pub drives: Vec<Drive>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeSpace {
    pub free: u64,
    pub total: u64,
}

fn text(path: PathBuf) -> String {
    path.display().to_string()
}

/// A drive the sidebar lists, by where it is mounted: on macOS what is under `/Volumes` (the
/// startup disk's own entry there is a link to `/`, which sysinfo reports as `/` and is left
/// out); on Windows every drive letter; on Linux what is under `/media` and `/run/media/$USER`.
fn listed_mount(mount: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        mount.parent() == Some(Path::new("/Volumes"))
    }
    #[cfg(windows)]
    {
        mount.parent().is_none()
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let user = std::env::var("USER").unwrap_or_default();
        mount.starts_with("/media")
            || (!user.is_empty() && mount.starts_with(Path::new("/run/media").join(user)))
    }
}

fn drive_name(mount: &Path, label: &str) -> String {
    #[cfg(windows)]
    {
        let letter = mount.display().to_string();
        let letter = letter.trim_end_matches('\\');
        if label.is_empty() {
            format!("Local Disk ({letter})")
        } else {
            format!("{label} ({letter})")
        }
    }
    #[cfg(not(windows))]
    {
        mount
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| label.to_owned())
    }
}

/// The mounted drives, by name. Read from the system's own list of mounts, so nothing here opens
/// a folder (a drive Files may not open still lists; opening it is refused like any folder).
fn drives() -> Vec<Drive> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mut drives: Vec<Drive> = disks
        .list()
        .iter()
        .filter(|disk| listed_mount(disk.mount_point()))
        .map(|disk| Drive {
            name: drive_name(disk.mount_point(), &disk.name().to_string_lossy()),
            path: disk.mount_point().display().to_string(),
            removable: disk.is_removable(),
        })
        .collect();
    drives.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    drives.dedup_by(|a, b| a.path == b.path);
    drives
}

#[tauri::command]
pub async fn files_places(app: tauri::AppHandle, webview: tauri::Webview) -> Result<Places, String> {
    person_window(&webview)?;
    blocking(move || {
        super::trash::attach(&app);
        let home = dirs::home_dir().ok_or("This computer has no home folder for you.")?;
        let applications = cfg!(target_os = "macos").then(|| "/Applications".to_owned());
        Ok(Places {
            home: text(home),
            desktop: dirs::desktop_dir().map(text),
            documents: dirs::document_dir().map(text),
            downloads: dirs::download_dir().map(text),
            applications,
            drives: drives(),
        })
    })
    .await
}

/// The room left on the drive `path` is on, as the system counts it for this user.
#[cfg(unix)]
fn free_space(path: &Path) -> std::io::Result<FreeSpace> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let name = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::other("The path holds a NUL byte."))?;
    let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: `name` is NUL-terminated and outlives the call; `stat` is written on success.
    if unsafe { libc::statvfs(name.as_ptr(), stat.as_mut_ptr()) } != 0 {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: statvfs returned 0, so it filled `stat`.
    let stat = unsafe { stat.assume_init() };
    #[allow(clippy::useless_conversion)]
    let block = u64::from(stat.f_frsize);
    #[allow(clippy::useless_conversion)]
    let (free, total) = (u64::from(stat.f_bavail), u64::from(stat.f_blocks));
    Ok(FreeSpace {
        free: free.saturating_mul(block),
        total: total.saturating_mul(block),
    })
}

/// On Windows, the drive whose mount point is the longest start of `path`.
#[cfg(windows)]
fn free_space(path: &Path) -> std::io::Result<FreeSpace> {
    let text = path.display().to_string().to_lowercase();
    let text = text.trim_start_matches(r"\\?\");
    let disks = sysinfo::Disks::new_with_refreshed_list();
    disks
        .list()
        .iter()
        .filter(|disk| text.starts_with(&disk.mount_point().display().to_string().to_lowercase()))
        .max_by_key(|disk| disk.mount_point().as_os_str().len())
        .map(|disk| FreeSpace {
            free: disk.available_space(),
            total: disk.total_space(),
        })
        .ok_or_else(|| std::io::Error::from(std::io::ErrorKind::NotFound))
}

#[tauri::command]
pub async fn files_free_space(webview: tauri::Webview, path: String) -> Result<FreeSpace, String> {
    person_window(&webview)?;
    let path = asked_path(&path)?;
    blocking(move || {
        file_access::disk::check_disk(&path, file_access::Access::Read)
            .and_then(|()| free_space(&path))
            .map_err(|error| failed(&path, super::listing::io_text(&error)))
    })
    .await
}
