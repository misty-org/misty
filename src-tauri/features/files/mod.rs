//! Files: Misty's own file manager, a Finder for the whole disk, behind the disk grant.
//!
//! Much of it is adapted from Kura (MIT, Copyright (c) 2026 Kura contributors; see `NOTICE`), kept
//! to what Finder does: no transfer queue, no saved workspaces or transfer history, no tabs, no
//! cloud drives. Every operation runs at once and on its own; a long copy reports its progress on
//! `files://progress` and stops on `files_cancel`.
//!
//! Every path a window names reaches the disk only through `file_access::disk`, which this folder
//! alone may use (`gate_tests.rs` holds the rest of the code to that), and every command first
//! checks it came from a person's own window. Agents reach the same code only through
//! `agent_paths::admit`, which checks each path with `file_access::disk::check_agent`.
//!
//! The renderer's side is `src/features/files/api/disk.ts`, which names every command and shape.

pub mod clipboard;
pub mod entry;
pub mod info;
pub mod listing;
pub mod open;
pub mod ops;
pub mod places;
pub mod progress;
pub mod protocol;
#[cfg(target_os = "macos")]
mod system_thumbnail;
pub mod terminal;
pub mod thumbnail_cache;
pub mod transfer;
pub mod trash;
pub mod undo;
pub mod watch;

pub mod archive;
pub mod db;
pub mod power;
pub mod search;
pub mod starred;
pub mod tags;

pub mod agent_delete;
pub mod agent_paths;
pub mod agent_trash;
pub mod grant;

#[cfg(test)]
mod gate_tests;

use std::path::{Path, PathBuf};

pub(crate) use crate::project::person_window;

pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

pub(crate) fn asked_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("That isn't a full path.".into());
    }
    if !file_access::is_local_path(&path) {
        return Err("Files opens only this computer's own drives.".into());
    }
    Ok(path)
}

pub(crate) fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

pub(crate) fn failed(path: &Path, error: impl std::fmt::Display) -> String {
    format!("{}: {error}", display_name(path))
}
