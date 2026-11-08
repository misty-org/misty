//! `tokio::fs`, through the gate: the calls async code uses.
use std::{io, path::Path};

use super::{check, Access};

pub async fn create_dir_all(path: impl AsRef<Path>) -> io::Result<()> {
    check(path.as_ref(), Access::Write)?;
    tokio::fs::create_dir_all(path).await
}

pub async fn write(path: impl AsRef<Path>, contents: impl AsRef<[u8]>) -> io::Result<()> {
    check(path.as_ref(), Access::Write)?;
    tokio::fs::write(path, contents).await
}

/// Opens a file for the `asset:` handler, which has already checked it against Tauri's asset scope.
/// That scope is what decides here, not the gate. It starts empty and holds only files the person
/// picked or dropped this session and files Misty downloaded, and the handler refuses website tabs.
pub async fn open_for_asset_protocol(path: impl AsRef<Path>) -> io::Result<tokio::fs::File> {
    tokio::fs::File::open(path).await
}
