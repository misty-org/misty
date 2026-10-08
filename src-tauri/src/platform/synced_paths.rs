//! Paths that arrive through synced account settings.
//!
//! Account settings are stored on the server, so a path in them is data, not a
//! decision this device made. A download folder must be an ordinary folder the
//! person could have picked: inside their home folder (or on an external drive),
//! never hidden, and never where the system or apps keep configuration that
//! runs on its own.
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
    } else {
        return None;
    };
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
