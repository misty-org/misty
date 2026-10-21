use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

use super::ClipboardCache;

static PARTIAL_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

impl ClipboardCache {
    pub fn temp_path_for(&self, key: &str, file_name: &str) -> PathBuf {
        let directory = self.root.join("staging");
        let _ = fs::create_dir_all(&directory);
        let unique = PARTIAL_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        directory.join(format!(
            "{key}.{:x}.{}.{}-{}",
            self.now_unix_ms(),
            std::process::id(),
            unique,
            sanitize_file_name(file_name)
        ))
    }
}

pub(super) fn sanitize_file_name(name: &str) -> String {
    if name.is_empty() || name == "." || name == ".." {
        return "clipboard-item".to_string();
    }
    name.chars()
        .map(|character| {
            if matches!(character, '/' | '\\' | ':' | '\0') {
                '_'
            } else {
                character
            }
        })
        .collect()
}
