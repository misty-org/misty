//! Paths that arrive through synced account settings.
//!
//! Account settings are stored on the server, so a path in them is data, not a
//! decision this device made. A download folder must be an ordinary folder the
//! person could have picked: inside their home folder (or on an external drive,
//! or on Windows another local drive), never hidden, and never where the system
//! or apps keep configuration that runs on its own.
use std::path::{Component, Path, PathBuf, Prefix};

/// Windows network (UNC) and device paths are refused before anything touches
/// the filesystem: even checking one makes Windows sign in to that server.
pub fn is_local_path(path: &Path) -> bool {
    match path.components().next() {
        Some(Component::Prefix(prefix)) => {
            matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
        }
        _ => true,
    }
}

pub fn download_directory(candidate: &Path, home: &Path) -> Option<PathBuf> {
    if !is_local_path(candidate) {
        return None;
    }
    let directory = std::fs::canonicalize(candidate).ok()?;
    if !directory.is_dir() {
        return None;
    }
    let home = std::fs::canonicalize(home).unwrap_or_else(|_| home.to_path_buf());
    let relative = if let Ok(relative) = directory.strip_prefix(&home) {
        relative.to_path_buf()
    } else if cfg!(target_os = "macos") {
        // External drives mount under /Volumes/<name>.
        let relative = directory.strip_prefix("/Volumes").ok()?;
        relative.components().next()?;
        relative.to_path_buf()
    } else if let Some(relative) = other_drive(&directory) {
        relative
    } else {
        return None;
    };
    if hidden_within(&directory, &relative) {
        return None;
    }
    let names: Vec<String> = relative
        .components()
        .map(|part| match part {
            Component::Normal(name) => name.to_string_lossy().into_owned(),
            _ => String::from(".."),
        })
        .collect();
    if names.iter().any(|name| name.starts_with('.')) {
        return None;
    }
    let first = names.first().map(|name| name.to_ascii_lowercase());
    match first.as_deref() {
        // macOS keeps launch agents and app state in ~/Library; iCloud Drive
        // (Mobile Documents) is the one ordinary place inside it.
        Some("library") if cfg!(target_os = "macos") => {
            (names.get(1).map(String::as_str) == Some("Mobile Documents")).then_some(directory)
        }
        // Windows keeps startup programs and app state in AppData.
        Some("appdata") => None,
        _ => Some(directory),
    }
}

/// The path below the root of a local drive other than the one Windows
/// runs from, where the person keeps their own files.
#[cfg(windows)]
fn other_drive(directory: &Path) -> Option<PathBuf> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{
        Storage::FileSystem::GetDriveTypeW,
        System::WindowsProgramming::{DRIVE_FIXED, DRIVE_REMOVABLE},
    };
    let letter = match directory.components().next()? {
        Component::Prefix(prefix) => match prefix.kind() {
            Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => letter.to_ascii_uppercase(),
            _ => return None,
        },
        _ => return None,
    };
    let system = std::env::var("SystemDrive").ok()?;
    if system.as_bytes().first().map(u8::to_ascii_uppercase) == Some(letter) {
        return None;
    }
    let root: Vec<u16> = std::ffi::OsStr::new(&format!("{}:\\", char::from(letter)))
        .encode_wide()
        .chain([0])
        .collect();
    // SAFETY: a NUL-terminated drive root.
    if !matches!(
        unsafe { GetDriveTypeW(root.as_ptr()) },
        DRIVE_FIXED | DRIVE_REMOVABLE
    ) {
        return None;
    }
    let relative: PathBuf = directory
        .components()
        .skip_while(|part| matches!(part, Component::Prefix(_) | Component::RootDir))
        .collect();
    Some(relative)
}

#[cfg(not(windows))]
fn other_drive(_directory: &Path) -> Option<PathBuf> {
    None
}

/// Whether a folder on the way to `directory`, within its last `relative`
/// part, is hidden or belongs to the system (Windows marks its own that way,
/// such as `$RECYCLE.BIN`). Elsewhere a leading dot hides a folder, which the
/// name check catches.
#[cfg(windows)]
fn hidden_within(directory: &Path, relative: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM};
    directory
        .ancestors()
        .take(relative.components().count())
        .any(|folder| {
            std::fs::metadata(folder).map_or(true, |metadata| {
                metadata.file_attributes() & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0
            })
        })
}

#[cfg(not(windows))]
fn hidden_within(_directory: &Path, _relative: &Path) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_folders_stay_in_ordinary_user_locations() {
        let home = tempfile::tempdir().unwrap();
        let root = home.path();
        for folder in [
            "Downloads",
            "Documents/Saved",
            ".ssh",
            "Library/LaunchAgents",
            "Library/Mobile Documents/com~apple~CloudDocs",
            "AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup",
            "Projects/.config/autostart",
        ] {
            std::fs::create_dir_all(root.join(folder)).unwrap();
        }
        assert!(download_directory(&root.join("Downloads"), root).is_some());
        assert!(download_directory(&root.join("Documents/Saved"), root).is_some());
        assert!(download_directory(root, root).is_some());
        assert!(download_directory(&root.join(".ssh"), root).is_none());
        assert!(download_directory(&root.join("Projects/.config/autostart"), root).is_none());
        assert!(
            download_directory(&root.join("Library/LaunchAgents"), root).is_none()
                || !cfg!(target_os = "macos")
        );
        assert!(download_directory(
            &root.join("Library/Mobile Documents/com~apple~CloudDocs"),
            root
        )
        .is_some());
        assert!(download_directory(
            &root.join("AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup"),
            root
        )
        .is_none());
        assert!(download_directory(&root.join("Missing"), root).is_none());
        assert!(download_directory(Path::new("/etc"), root).is_none());
        assert!(download_directory(&root.join("Downloads/../.ssh"), root).is_none());
    }

    #[cfg(windows)]
    #[test]
    fn hidden_folders_are_refused_on_windows() {
        use std::os::windows::ffi::OsStrExt;
        let home = tempfile::tempdir().unwrap();
        let folder = home.path().join("Kept");
        std::fs::create_dir_all(folder.join("Inside")).unwrap();
        assert!(download_directory(&folder, home.path()).is_some());
        let wide: Vec<u16> = folder.as_os_str().encode_wide().chain([0]).collect();
        // SAFETY: a NUL-terminated path inside the test's own folder.
        unsafe {
            windows_sys::Win32::Storage::FileSystem::SetFileAttributesW(
                wide.as_ptr(),
                windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_HIDDEN,
            );
        }
        assert!(download_directory(&folder, home.path()).is_none());
        assert!(download_directory(&folder.join("Inside"), home.path()).is_none());
        // The system drive outside the home folder stays refused.
        let windows = std::env::var("SystemRoot").unwrap();
        assert!(download_directory(Path::new(&windows), home.path()).is_none());
    }

    #[test]
    fn network_and_device_paths_are_never_local() {
        assert!(is_local_path(Path::new("/Users/me/Downloads")));
        assert!(is_local_path(Path::new("relative")));
        #[cfg(windows)]
        {
            assert!(is_local_path(Path::new(r"C:\Users\me\Downloads")));
            assert!(is_local_path(Path::new(r"\\?\C:\Users\me")));
            assert!(!is_local_path(Path::new(r"\\server\share\folder")));
            assert!(!is_local_path(Path::new(r"\\?\UNC\server\share")));
            assert!(!is_local_path(Path::new(r"\\.\pipe\name")));
        }
    }

    #[cfg(unix)]
    #[test]
    fn links_are_judged_by_where_they_point() {
        let home = tempfile::tempdir().unwrap();
        let root = home.path();
        std::fs::create_dir_all(root.join(".hidden")).unwrap();
        std::os::unix::fs::symlink(root.join(".hidden"), root.join("Visible")).unwrap();
        assert!(download_directory(&root.join("Visible"), root).is_none());
    }
}
