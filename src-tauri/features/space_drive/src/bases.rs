use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::model::ItemId;
use crate::rules::{is_text, MAX_TEXT};

pub struct Bases {
    root: PathBuf,
}

impl Bases {
    pub fn new(drive_dir: &Path) -> Self {
        Self {
            root: drive_dir.join("bases"),
        }
    }

    fn path(&self, id: &ItemId) -> Option<PathBuf> {
        ItemId::is_valid(id.as_str()).then(|| self.root.join(id.as_str()))
    }

    pub fn keep(&self, id: &ItemId, bytes: &[u8]) {
        let Some(path) = self.path(id) else {
            return;
        };
        if !is_text(bytes) {
            let _ = file_access::fs::remove_file(&path);
            return;
        }
        if file_access::fs::create_dir_all(&self.root).is_err() {
            return;
        }
        let temp = self
            .root
            .join(format!(".{}.tmp", uuid::Uuid::new_v4().simple()));
        if file_access::fs::write(&temp, bytes).is_ok() {
            if file_access::fs::rename(&temp, &path).is_err() {
                let _ = file_access::fs::remove_file(&temp);
            }
        }
    }

    pub fn keep_file(&self, id: &ItemId, blob: &Path, size: u64) {
        if size > MAX_TEXT {
            self.remove(id);
            return;
        }
        match file_access::fs::read(blob) {
            Ok(bytes) => self.keep(id, &bytes),
            Err(_) => self.remove(id),
        }
    }

    pub fn text(&self, id: &ItemId, sha256: Option<&str>) -> Option<String> {
        let sha256 = sha256?;
        let bytes = file_access::fs::read(self.path(id)?).ok()?;
        if hex::encode(Sha256::digest(&bytes)) != sha256 {
            return None;
        }
        String::from_utf8(bytes).ok()
    }

    pub fn remove(&self, id: &ItemId) {
        if let Some(path) = self.path(id) {
            let _ = file_access::fs::remove_file(path);
        }
    }

    pub fn sweep_temp(&self) {
        if let Ok(entries) = file_access::fs::read_dir(&self.root) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().ends_with(".tmp") {
                    let _ = file_access::fs::remove_file(entry.path());
                }
            }
        }
    }
}
