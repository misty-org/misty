//! The file gate: every file Misty's Rust code touches goes through here, and anything without a
//! grant is refused with `io::ErrorKind::PermissionDenied`.
//!
//! Everything Misty can reach is named by [`Reach`]. It starts with `.misty` and its own app
//! folders, and the rest arrives one click at a time. Clippy's `disallowed-methods` and
//! `disallowed-types` (`src-tauri/clippy.toml`) refuse the standard calls everywhere else, so this
//! folder is the only place allowed to use them.
//!
//! Three things aren't covered: file access in other crates (`browser_data`, Kiri, the
//! engines), processes confined by their own OS profile (the shell, the document workers), and a
//! memory bug in this process. See "What this doesn't cover" in the plan.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

pub mod autostart_entry;
pub mod fs;
pub mod fs_async;
mod fs_handles;
pub mod looks;
mod policy;
pub mod quarantine;
pub mod secrets;
mod real_path;

use std::{
    io,
    path::Path,
    sync::{LazyLock, RwLock},
};

use policy::{Policy, Shape};
pub use real_path::is_local_path;
use tauri::{AppHandle, Manager};

/// Which way a path is used. Write access includes reading.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Access {
    Read,
    Write,
}

/// Everything Misty can reach. Adding a place means adding it here.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Reach {
    /// `.misty`: Misty's data, always, with no prompt.
    MistyHome,
    /// Misty's own app data, local data and cache folders, always. Extensions and agent downloads
    /// live there.
    AppFolders,
    /// Folders Misty makes in the system's temp folder, always. Each is named `misty-*`.
    OwnTemp,
    /// The one launch entry that starts Misty at sign-in, and the folder it goes in, and nothing
    /// else there. Settings turns it on and off.
    AutostartEntry,
    /// `/etc/hostname`, read-only, for this computer's name on Linux.
    #[cfg_attr(any(target_os = "macos", windows), allow(dead_code))]
    HostnameFile,
    /// The Downloads folder, after its grant (`grant:downloads`).
    DownloadsFolder,
    /// A file Misty is saving as a download, so finishing it doesn't depend on its folder's grant.
    RecordedDownload,
    /// A folder the person shared with agents (`grant-shared-folder`). Read-only here: writes come
    /// only from the shell, whose OS profile holds it to `grant-shared-folder-write` per chat.
    SharedFolder,
    /// A project folder the person linked to a Space (`grant-linked-folder`). The agent engines
    /// they chose work there, and the file panel beside a chat reads and writes it.
    LinkedFolder,
    /// One file the person picked in a native dialog (`grant-picked-file`), until Misty quits.
    PickedFile,
    /// `agents.env`, read-only, on a debug build's benchmark run (`models/benchmark_env.rs`).
    BenchmarkKeys,
    /// The agent engines' own configuration in the person's home folder (`~/.claude`,
    /// `~/.claude.json`, `~/.codex` and the like), which Settings › Engines reads and edits: their
    /// MCP servers, skills, commands, provider channels and session logs for usage.
    EngineConfig,
    /// A read-only folder Misty ships with itself, such as the bundled agent catalog.
    BundledResources,
    /// Unit tests build their fixtures anywhere in the temp folder.
    #[cfg(any(test, feature = "test-fixtures"))]
    TestFixtures,
}

static POLICY: LazyLock<RwLock<Policy>> = LazyLock::new(|| RwLock::new(always_allowed()));

fn always_allowed() -> Policy {
    let mut policy = Policy::default();
    if let Some(home) = paths::misty_home_dir() {
        policy.add(Reach::MistyHome, &home, Shape::Folder, Access::Write);
    }
    policy.add(
        Reach::OwnTemp,
        &std::env::temp_dir(),
        Shape::NamesStarting("misty-"),
        Access::Write,
    );
    if let Some(entry) = autostart_entry::launch_entry_path() {
        if let Some(parent) = entry.parent() {
            policy.add(Reach::AutostartEntry, parent, Shape::Exact, Access::Write);
        }
        policy.add(Reach::AutostartEntry, &entry, Shape::Exact, Access::Write);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    policy.add(
        Reach::HostnameFile,
        Path::new("/etc/hostname"),
        Shape::Exact,
        Access::Read,
    );
    #[cfg(any(test, feature = "test-fixtures"))]
    policy.add(
        Reach::TestFixtures,
        &std::env::temp_dir(),
        Shape::Folder,
        Access::Write,
    );
    policy
}

fn with_policy<T>(work: impl FnOnce(&mut Policy) -> T) -> T {
    let mut policy = POLICY
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    work(&mut policy)
}

/// Adds the folders Tauri knows about. Runs first thing in setup, before anything opens them.
pub fn configure(app: &AppHandle) {
    let path = app.path();
    let folders = [
        path.app_data_dir(),
        path.app_local_data_dir(),
        path.app_cache_dir(),
    ];
    with_policy(|policy| {
        for folder in folders.into_iter().flatten() {
            policy.add(Reach::AppFolders, &folder, Shape::Folder, Access::Write);
        }
    });
}

fn refused(path: &Path, access: Access) -> io::Error {
    // Development builds say what was refused. The message itself never carries the path, because
    // these errors can reach the interface and the logs.
    #[cfg(debug_assertions)]
    eprintln!("[file gate] refused {access:?} on {}", path.display());
    #[cfg(not(debug_assertions))]
    let _ = (path, access);
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "Misty doesn't have access to this location.",
    )
}

/// Refuses `path` unless its real location is allowed. `..` and links are resolved first, so
/// neither can reach around a rule.
pub fn check(path: &Path, access: Access) -> io::Result<()> {
    let real = real_path::resolve(path)?;
    let allowed = POLICY
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .allows(&real, access);
    allowed.then_some(()).ok_or_else(|| refused(path, access))
}

/// The same for a call that acts on a link rather than through it, such as deleting one: only the
/// link's own folder counts, wherever it points.
pub(crate) fn check_link(path: &Path, access: Access) -> io::Result<()> {
    let real = real_path::resolve_parent(path)?;
    let allowed = POLICY
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .allows(&real, access);
    allowed.then_some(()).ok_or_else(|| refused(path, access))
}

/// Whether the person picked exactly this file in a system dialog, for a write only that answer
/// justifies, as opposed to one anywhere Misty may write.
pub fn is_picked_file(path: &Path) -> bool {
    real_path::resolve(path).is_ok_and(|real| {
        POLICY
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .was_picked(&real)
    })
}

/// A file the person picked in a native dialog. Only code that just showed the dialog calls this,
/// with the path the dialog returned, never a path that came through a window.
pub fn allow_picked_file(path: &Path, access: Access) {
    with_policy(|policy| policy.add(Reach::PickedFile, path, Shape::Exact, access));
}

/// A folder Misty ships with itself, read-only. Only code that resolved it from the app's own
/// resource folder (or, in a development build, the source tree) calls this.
pub fn allow_bundled_resources(folder: &Path) {
    with_policy(|policy| {
        policy.add(Reach::BundledResources, folder, Shape::Folder, Access::Read);
    });
}

/// Only a debug build's benchmark run calls this, for the one file it reads its keys from.
pub fn allow_benchmark_keys(path: &Path) {
    with_policy(|policy| policy.add(Reach::BenchmarkKeys, path, Shape::Exact, Access::Read));
}

/// An engine's own configuration folder, such as `~/.codex`, and everything in it.
pub fn allow_engine_config_folder(folder: &Path) {
    with_policy(|policy| policy.add(Reach::EngineConfig, folder, Shape::Folder, Access::Write));
}

/// An engine's configuration file directly in `folder`, such as `~/.claude.json`, together with the
/// files staged beside it for a safe write (`.claude.json.misty-….tmp`) and its backups.
pub fn allow_engine_config_file(folder: &Path, name: &'static str) {
    with_policy(|policy| {
        policy.add(
            Reach::EngineConfig,
            folder,
            Shape::NamesStarting(name),
            Access::Write,
        )
    });
}

pub fn allow_downloads_folder(folder: &Path) {
    with_policy(|policy| {
        policy.add(Reach::DownloadsFolder, folder, Shape::Folder, Access::Write);
    });
}

pub fn revoke_downloads_folder() {
    with_policy(|policy| policy.remove_all(Reach::DownloadsFolder));
}

/// A download Misty is saving, so it can finish even if its folder's grant changes meanwhile.
pub fn allow_recorded_download(path: &Path) {
    with_policy(|policy| policy.add(Reach::RecordedDownload, path, Shape::Exact, Access::Write));
}

pub fn allow_shared_folder(folder: &Path, access: Access) {
    with_policy(|policy| policy.add(Reach::SharedFolder, folder, Shape::Folder, access));
}

pub fn revoke_shared_folder(folder: &Path) {
    with_policy(|policy| policy.remove(Reach::SharedFolder, folder));
}

pub fn allow_linked_folder(folder: &Path) {
    with_policy(|policy| policy.add(Reach::LinkedFolder, folder, Shape::Folder, Access::Write));
}

pub fn revoke_linked_folder(folder: &Path) {
    with_policy(|policy| policy.remove(Reach::LinkedFolder, folder));
}

#[cfg(test)]
mod tests;
pub mod paths;

/// Tests never reach the person's real data, whatever they exercise.
#[cfg(test)]
#[ctor::ctor]
fn isolate_tests() {
    paths::isolate_for_tests();
}
