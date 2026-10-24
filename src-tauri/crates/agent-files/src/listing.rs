//! Listing a granted folder into a bounded snapshot.
use super::*;

pub(crate) fn scan(
    root: &File,
    absolute: &Path,
    relative: &str,
    depth: usize,
    snapshot: &mut Snapshot,
) -> Result<()> {
    if depth > 8 {
        snapshot.excluded.push(format!("{relative}: depth limit"));
        return Ok(());
    }
    let mut entries = fs::read_dir(absolute)
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        if name.starts_with('.') || platform::is_link(&entry) {
            snapshot
                .excluded
                .push(format!("{path}: hidden item or link"));
            continue;
        }
        if snapshot.items.len() >= MAX_ITEMS {
            return Err("Choose a smaller folder (at most 500 visible items)".into());
        }
        let item = match open_item(root, &path) {
            Ok(file) => file,
            Err(_) => {
                snapshot.excluded.push(format!("{path}: inaccessible"));
                continue;
            }
        };
        let metadata = item.metadata().map_err(err)?;
        if !metadata.is_file() && !metadata.is_dir() {
            snapshot.excluded.push(format!("{path}: unsupported type"));
            continue;
        }
        snapshot.items.push(Item {
            id: Uuid::new_v4().to_string(),
            name,
            relative_path: path.clone(),
            directory: metadata.is_dir(),
            size: metadata.len(),
            fingerprint: fingerprint(&item)?,
        });
        if metadata.is_dir() {
            if scan(root, &entry.path(), &path, depth + 1, snapshot).is_err() {
                snapshot.excluded.push(format!("{path}: incomplete scan"));
            }
        }
    }
    Ok(())
}
