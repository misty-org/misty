use std::{fs, path::Path};

use walkdir::WalkDir;

use crate::infra::macos_privacy::is_background_scan_excluded;

pub(super) fn local_directory_size(path: &Path, home_dir: &Path) -> Result<u64, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!("{} is not a directory.", path.display()));
    }
    if is_background_scan_excluded(path, home_dir) {
        return Err("Folder size is unavailable for protected macOS app data.".to_owned());
    }
    let mut total = 0u64;
    for entry in WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !is_background_scan_excluded(entry.path(), home_dir))
        .skip(1)
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_type().is_file() {
            total =
                total.saturating_add(entry.metadata().map_err(|error| error.to_string())?.len());
        }
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn ignores_symlinks() {
        let root = std::env::temp_dir().join(format!("misty-directory-size-{}", Uuid::new_v4()));
        let nested = root.join("nested");
        fs::create_dir_all(&nested).expect("create test dirs");
        fs::write(root.join("a.txt"), vec![0u8; 7]).expect("write file");
        fs::write(nested.join("b.txt"), vec![0u8; 11]).expect("write nested file");
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("a.txt"), root.join("link.txt")).expect("symlink");

        assert_eq!(local_directory_size(&root, &root).unwrap(), 18);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn skips_protected_app_data() {
        let home =
            std::env::temp_dir().join(format!("misty-directory-size-privacy-{}", Uuid::new_v4()));
        let protected = home
            .join("Library")
            .join("Containers")
            .join("com.example.private")
            .join("Data");
        fs::create_dir_all(&protected).expect("create protected test dirs");
        fs::write(home.join("visible.txt"), vec![0u8; 7]).expect("write visible file");
        fs::write(protected.join("private.txt"), vec![0u8; 11]).expect("write private file");

        assert_eq!(local_directory_size(&home, &home).unwrap(), 7);
        let _ = fs::remove_dir_all(home);
    }
}
