//! Archive execution belongs to the signed Backups package.
use cap_std::fs::Dir;
use std::sync::Arc;
pub const ARCHIVE_NAME: &str = "Misty Backup.tar";
pub struct Source {
    pub directory: Arc<Dir>,
    pub name: String,
}
#[derive(Default, Debug, serde::Deserialize)]
pub struct Report {
    pub files: u64,
    pub directories: u64,
    pub links: u64,
    pub bytes: u64,
}
