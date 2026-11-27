//! Files: Misty's own file manager, a Finder for the whole disk, behind the disk grant.
//!
//! Much of it is adapted from Kura (MIT, Copyright (c) 2026 Kura contributors; see `NOTICE`), kept
//! to what Finder does: no saved workspaces or transfer history, no tabs, no cloud drives. Long
//! work (a copy, a delete, an archive, a folder's size, duplicates, a comparison) waits its turn on
//! a small native queue (`runtime.rs`), reports its progress on `files://progress` to the window
//! that started it, and stops on `files_cancel`.
//!
//! Every path a window names reaches the disk only through `file_access::disk`, which this folder
//! alone may use (`gate_tests.rs` holds the rest of the code to that), as open, checked folder
//! handles (`gated.rs`) rather than path strings, and every command first checks it came from a
//! person's own window. Nothing here replaces an item unless the person chose Replace. Agents
//! reach the same code only through `agent_paths::admit` and the agent gate.
//!
//! The renderer's side is `src/features/files/api/disk.ts`, which names every command and shape.

pub mod clipboard;
pub(crate) mod copy_source;
pub mod entry;
mod fs_events;
pub(crate) mod gated;
pub mod info;
pub mod pick;
pub mod listing;
pub mod open;
pub mod ops;
pub mod places;
pub mod progress;
pub mod protocol;
#[cfg(target_os = "macos")]
mod quick_look_thumbnail;
pub mod runtime;
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
    file_access::disk::normalize_asked(Path::new(path)).map_err(|error| error.to_string())
}

pub(crate) fn asked_paths(paths: &[String]) -> Result<Vec<PathBuf>, String> {
    paths.iter().map(|path| asked_path(path)).collect()
}

pub(crate) fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

pub(crate) fn failed(path: &Path, error: impl std::fmt::Display) -> String {
    format!("{}: {error}", display_name(path))
}
