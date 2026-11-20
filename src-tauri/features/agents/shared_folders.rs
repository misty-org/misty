//! Which folders a person can share with agents, read-only: never the disk, the
//! home folder itself, system or library folders, hidden folders in the home
//! folder (they hold keys and app settings), or Misty's own data.
#[cfg(desktop)]
pub mod commands;
pub mod folder_changes;

use std::path::{Path, PathBuf};

/// Windows' verbatim prefixes (`\\?\`) removed, so paths compare as people see them.
pub fn plain_path(path: &Path) -> PathBuf {
    if !cfg!(windows) {
        return path.to_path_buf();
    }
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\UNC\") {
        Some(rest) => format!(r"\\{rest}").into(),
        None => text.strip_prefix(r"\\?\").unwrap_or(&text).into(),
    }
}

/// Whether `root` is, or is inside, a mounted Space drive: `~/.misty/mnt/<Space>` (`mnt-dev` in
/// debug builds) or, on macOS, `~/Library/CloudStorage/Misty-<Space>`, and the file gate has it
/// as a mounted drive.
fn is_space_drive_root(root: &Path, home: Option<&Path>) -> bool {
    let Some(home) = home else {
        return false;
    };
    let mounts = ["mnt", "mnt-dev"]
        .iter()
        .any(|folder| {
            root.strip_prefix(home.join(".misty").join(folder))
                .is_ok_and(|inside| inside.components().next().is_some())
        });
    let cloud = cfg!(target_os = "macos")
        && root
            .strip_prefix(home.join("Library").join("CloudStorage"))
            .ok()
            .and_then(|inside| inside.components().next())
            .is_some_and(|first| first.as_os_str().to_string_lossy().starts_with("Misty-"));
    (mounts || cloud) && file_access::is_in_space_drive(root)
}

/// Why a folder can't be shared, or Ok.
pub fn check_root(root: &Path, protected: &[PathBuf], home: Option<&Path>) -> Result<(), String> {
    let refuse = |why: &str| Err(why.to_owned());
    let root = &plain_path(root);
    #[cfg(windows)]
    {
        let lower = root.to_string_lossy().to_lowercase();
        let system = [
            "SystemRoot",
            "ProgramFiles",
            "ProgramFiles(x86)",
            "ProgramData",
        ]
        .iter()
        .filter_map(|name| std::env::var_os(name))
        .map(|folder| folder.to_string_lossy().to_lowercase());
        for folder in system {
            if lower == folder || lower.starts_with(&format!("{folder}\\")) {
                return refuse("System folders can't be shared.");
            }
        }
        let temp = plain_path(&std::env::temp_dir());
        if let Some(home) = home.filter(|_| !root.starts_with(&temp)) {
            if root.starts_with(home.join("AppData")) {
                return refuse("That folder holds app data or keys, so it can't be shared.");
            }
        }
    }
    if !root.is_absolute() || root.parent().is_none() {
        return refuse("Choose a folder, not the whole disk.");
    }
    // The one place inside `~/.misty` (and on macOS inside `~/Library`) that may be shared: a
    // Space's drive while it is mounted (`~/.misty/mnt*/<Space>`, `~/Library/CloudStorage/Misty-*`).
    // The file gate knows those roots only from the drive's own mounting.
    if is_space_drive_root(root, home) {
        return Ok(());
    }
    if protected
        .iter()
        .any(|folder| folder.starts_with(root) || root.starts_with(folder))
    {
        return refuse("That folder holds Misty's own data.");
    }
    let temporary = ["/private/tmp/", "/private/var/folders/", "/tmp/"]
        .iter()
        .any(|prefix| root.to_string_lossy().starts_with(prefix));
    for system in [
        "/System",
        "/Library",
        "/usr",
        "/bin",
        "/sbin",
        "/private",
        "/etc",
        "/var",
        "/tmp",
        "/opt",
        "/Applications",
        "/Volumes",
        "/Users",
        "/cores",
        "/dev",
        "/home",
    ] {
        let inside = root.starts_with(system) && !matches!(system, "/Volumes" | "/Users" | "/home");
        if root == Path::new(system) || (inside && !temporary) {
            return refuse("System folders can't be shared.");
        }
    }
    if let Some(home) = home {
        if root == home || home.starts_with(root) {
            return refuse("Choose a folder inside your home folder, not the home folder itself.");
        }
        let private = root.strip_prefix(home).ok().and_then(|inside| {
            let first = inside.components().next()?.as_os_str().to_string_lossy();
            Some(first == "Library" || first.starts_with('.'))
        });
        if private == Some(true) {
            return refuse("That folder holds app data or keys, so it can't be shared.");
        }
    }
    Ok(())
}

// The paths are Unix paths; a path like /Users/me is not absolute on Windows.
#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn refuses_the_disk_home_system_keys_and_misty_data() {
        let home = Path::new("/Users/me");
        let misty = [PathBuf::from("/Users/me/Library/Application Support/Misty")];
        for path in [
            "/",
            "/Users/me",
            "/Users",
            "/etc/nginx",
            "/Users/me/.ssh/keys",
            "/Users/me/.anything/x",
            "/Users/me/Library/Application Support/Misty",
        ] {
            assert!(
                check_root(Path::new(path), &misty, Some(home)).is_err(),
                "{path}"
            );
        }
        for path in [
            "/Users/me/papers/2026",
            "/tmp/scratch",
            "/Volumes/Work/site",
            "/home/me/papers",
        ] {
            assert!(
                check_root(Path::new(path), &misty, Some(home)).is_ok(),
                "{path}"
            );
        }
    }
}
