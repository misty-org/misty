//! Which folders can be projects: never the disk, the home folder itself,
//! system or library folders, folders holding keys or app data, or Misty's own
//! data. Coding tools run inside the chosen folder, so this is the boundary.
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

/// Why a folder can't be a project, or Ok.
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
                return refuse("System folders can't be projects.");
            }
        }
        let temp = plain_path(&std::env::temp_dir());
        if let Some(home) = home.filter(|_| !root.starts_with(&temp)) {
            if root.starts_with(home.join("AppData")) {
                return refuse("That folder holds app data or keys, so it can't be a project.");
            }
        }
    }
    if !root.is_absolute() || root.parent().is_none() {
        return refuse("Choose a project folder, not the whole disk.");
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
            return refuse("System folders can't be projects.");
        }
    }
    if let Some(home) = home {
        if root == home || home.starts_with(root) {
            return refuse("Choose a folder inside your home folder, not the home folder itself.");
        }
        for private in [
            "Library", ".ssh", ".aws", ".config", ".gnupg", ".kube", ".docker", ".claude", ".codex",
        ] {
            if root.starts_with(home.join(private)) {
                return refuse("That folder holds app data or keys, so it can't be a project.");
            }
        }
    }
    Ok(())
}

#[cfg(test)]
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
            "/Users/me/.codex/x",
            "/Users/me/Library/Application Support/Misty",
        ] {
            assert!(
                check_root(Path::new(path), &misty, Some(home)).is_err(),
                "{path}"
            );
        }
        for path in [
            "/Users/me/code/app",
            "/tmp/scratch",
            "/Volumes/Work/site",
            "/home/me/code/app",
        ] {
            assert!(
                check_root(Path::new(path), &misty, Some(home)).is_ok(),
                "{path}"
            );
        }
    }
}
