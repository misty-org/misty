use std::path::{Path, PathBuf};

/// Recursive background work must not enter macOS locations that can trigger
/// TCC prompts for another app's data. Direct Explorer navigation is left
/// alone so a user can still choose to open a protected location explicitly.
pub fn is_background_scan_excluded(path: &Path, home_dir: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        if protected_app_data_roots(home_dir)
            .iter()
            .any(|root| path == root || path.starts_with(root))
        {
            return true;
        }

        return path.extension().is_some_and(|extension| {
            matches!(
                extension.to_string_lossy().to_ascii_lowercase().as_str(),
                "photoslibrary" | "photolibrary"
            )
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (path, home_dir);
        false
    }
}

#[cfg(target_os = "macos")]
fn protected_app_data_roots(home_dir: &Path) -> Vec<PathBuf> {
    let library = home_dir.join("Library");
    [
        library.join("Application Scripts"),
        library.join("Containers"),
        library.join("Daemon Containers"),
        library.join("Group Containers"),
        library.join("Application Support").join("AddressBook"),
        library.join("Calendars"),
        library.join("HomeKit"),
        library.join("Mail"),
        library.join("Messages"),
        library.join("PersonalizationPortrait"),
        library.join("Safari"),
        library.join("Suggestions"),
    ]
    .into_iter()
    .collect()
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn excludes_other_apps_private_data_from_background_scans() {
        let home = Path::new("/Users/example");

        assert!(is_background_scan_excluded(
            Path::new("/Users/example/Library/Containers/com.example.app/Data"),
            home,
        ));
        assert!(is_background_scan_excluded(
            Path::new("/Users/example/Pictures/Family.photoslibrary"),
            home,
        ));
        assert!(!is_background_scan_excluded(
            Path::new("/Users/example/Documents/project"),
            home,
        ));
        assert!(!is_background_scan_excluded(
            Path::new("/Users/example/Library/Mobile Documents"),
            home,
        ));
    }
}
