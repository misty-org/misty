//! Browsers lock their databases while they run. Imports read a private copy
//! (with its write-ahead log) and never open or change the original.
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};
use tempfile::TempDir;

pub struct Snapshot {
    _dir: TempDir,
    path: PathBuf,
}

impl Snapshot {
    pub fn sqlite(source: &Path) -> Result<Self, String> {
        let name = source
            .file_name()
            .ok_or_else(|| "That browser file could not be found.".to_owned())?;
        let dir = tempfile::Builder::new()
            .prefix("misty-browser-import")
            .tempdir()
            .map_err(|_| "Misty could not make room to read that browser.".to_owned())?;
        let path = dir.path().join(name);
        std::fs::copy(source, &path).map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => "That browser has none of this data yet.".to_owned(),
            std::io::ErrorKind::PermissionDenied => {
                "Misty isn't allowed to read that browser's files. On a Mac, allow Misty under Privacy & Security > Full Disk Access.".to_owned()
            }
            _ => "That browser's data could not be copied.".to_owned(),
        })?;
        for suffix in ["-wal", "-shm"] {
            let mut side = source.as_os_str().to_owned();
            side.push(suffix);
            let mut target = path.as_os_str().to_owned();
            target.push(suffix);
            let _ = std::fs::copy(PathBuf::from(side), PathBuf::from(target));
        }
        Ok(Self { _dir: dir, path })
    }

    /// Read-write on the copy only, so SQLite can fold the copied log in.
    pub fn open(&self) -> Result<Connection, String> {
        Connection::open_with_flags(
            &self.path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|_| "That browser's data could not be opened.".to_owned())
    }
}
