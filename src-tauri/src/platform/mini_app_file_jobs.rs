//! Folder grants keep their authority in the native registration, never in app paths.
use cap_std::fs::Dir;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

pub struct FolderGrant {
    pub released: Arc<AtomicBool>,
    pub directory: Arc<Dir>,
    pub name: String,
    pub writable: bool,
}
impl Drop for FolderGrant {
    fn drop(&mut self) {
        self.released.store(true, Ordering::Release);
    }
}
