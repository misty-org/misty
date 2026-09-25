use cap_std::fs::Dir;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
pub fn scan(root: &Dir, name: &str, cancel: &AtomicBool) -> Result<Value, String> {
    let mut stack = vec![(PathBuf::from("."), 0usize)];
    let (mut bytes, mut files, mut folders, mut skipped) = (0u64, 0u64, 0u64, 0u64);
    let mut largest: Vec<(u64, String, String, String)> = Vec::new();
    let mut types: HashMap<String, (u64, u64)> = HashMap::new();
    let started = Instant::now();
    let mut visited = 0;
    let mut truncated = false;
    'scan: while let Some((relative, depth)) = stack.pop() {
        if cancel.load(Ordering::Acquire) {
            return Err("Scan cancelled.".into());
        }
        // Every operation resolves from the retained directory capability, so
        // renaming/replacing a path or symlink cannot escape the chosen root.
        let entries = match root.read_dir(&relative) {
            Ok(entries) => entries,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        for entry in entries {
            if cancel.load(Ordering::Acquire) {
                return Err("Scan cancelled.".into());
            }
            visited += 1;
            if visited > 500_000 || started.elapsed() > Duration::from_secs(120) {
                truncated = true;
                break 'scan;
            }
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            let path = relative.join(entry.file_name());
            if path.as_os_str().len() > 4096 {
                skipped += 1;
                continue;
            }
            let metadata = match root.symlink_metadata(&path) {
                Ok(value) => value,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            if metadata.is_dir() {
                folders += 1;
                if depth < 128 && stack.len() < 16_384 {
                    stack.push((path, depth + 1));
                } else {
                    skipped += 1;
                    truncated = true;
                }
                continue;
            }
            if !metadata.is_file() {
                skipped += 1;
                continue;
            }
            let len = metadata.len();
            bytes = bytes.saturating_add(len);
            files += 1;
            let kind = path
                .extension()
                .and_then(|value| value.to_str())
                .filter(|value| !value.is_empty() && value.len() <= 32)
                .map(|value| format!(".{}", value.to_lowercase()))
                .unwrap_or("Other".into());
            let kind = if types.len() < 256 || types.contains_key(&kind) {
                kind
            } else {
                "Other".into()
            };
            let row = types.entry(kind.clone()).or_default();
            row.0 = row.0.saturating_add(len);
            row.1 += 1;
            largest.push((
                len,
                path.to_string_lossy().into_owned(),
                entry.file_name().to_string_lossy().into_owned(),
                kind,
            ));
            largest.sort_unstable_by(|a, b| b.0.cmp(&a.0));
            largest.truncate(50);
        }
    }
    let mut types: Vec<_> = types.into_iter().collect();
    types.sort_unstable_by(|a, b| b.1 .0.cmp(&a.1 .0));
    types.truncate(20);
    Ok(
        json!({"root":name,"bytes":bytes,"files":files,"folders":folders,"skipped":skipped,"truncated":truncated,
        "largest":largest.into_iter().map(|(bytes,path,name,kind)|json!({"bytes":bytes,"path":path,"name":name,"kind":kind})).collect::<Vec<_>>(),
        "types":types.into_iter().map(|(kind,(bytes,files))|json!({"kind":kind,"bytes":bytes,"files":files})).collect::<Vec<_>>() }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scans_only_the_open_folder_without_following_symlinks_or_disclosing_absolute_paths() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("chosen")).unwrap();
        std::fs::write(root.path().join("chosen/a.txt"), "hello").unwrap();
        std::fs::write(root.path().join("secret.txt"), "outside").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("../secret.txt", root.path().join("chosen/link")).unwrap();
        let dir = Dir::open_ambient_dir(root.path().join("chosen"), cap_std::ambient_authority())
            .unwrap();
        let result = scan(&dir, "chosen", &AtomicBool::new(false)).unwrap();
        assert_eq!(result["bytes"], 5);
        assert_eq!(result["files"], 1);
        assert!(!result.to_string().contains(root.path().to_str().unwrap()));
        assert!(scan(&dir, "chosen", &AtomicBool::new(true)).is_err());
        // The handle keeps referring to the selected directory after its old
        // pathname is replaced by a different folder.
        #[cfg(unix)]
        {
            std::fs::rename(root.path().join("chosen"), root.path().join("moved")).unwrap();
            std::fs::create_dir(root.path().join("chosen")).unwrap();
            std::fs::write(root.path().join("chosen/secret"), "replacement").unwrap();
            assert_eq!(
                scan(&dir, "chosen", &AtomicBool::new(false)).unwrap()["bytes"],
                5
            );
        }
    }
}
