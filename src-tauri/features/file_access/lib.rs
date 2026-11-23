#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

pub mod autostart_entry;
pub mod disk;
pub mod fs;
pub mod fs_async;
mod fs_handles;
pub mod looks;
mod policy;
pub mod quarantine;
mod real_path;
pub mod secrets;

use std::{
    io,
    path::Path,
    sync::{LazyLock, RwLock},
};

use policy::{Policy, Shape};
pub use real_path::is_local_path;
use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Access {
    Read,
    Write,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Reach {
    MistyHome,
    AppFolders,
    OwnTemp,
    AutostartEntry,
    #[cfg_attr(any(target_os = "macos", windows), allow(dead_code))]
    HostnameFile,
    DownloadsFolder,
    RecordedDownload,
    SharedFolder,
    LinkedFolder,
    PickedFile,
    BenchmarkKeys,
    EngineConfig,
    EditorConfig,
    BundledResources,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    WebsiteData,
    SpaceDrive,
    #[cfg(any(test, feature = "test-fixtures"))]
    TestFixtures,
}

static POLICY: LazyLock<RwLock<Policy>> = LazyLock::new(|| RwLock::new(always_allowed()));

fn always_allowed() -> Policy {
    let mut policy = Policy::default();
    if let Some(home) = paths::misty_root_dir() {
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
    #[cfg(target_os = "macos")]
    if let Some(home) = dirs::home_dir() {
        let stores = home
            .join("Library")
            .join("WebKit")
            .join(&app.config().identifier)
            .join("WebsiteDataStore");
        with_policy(|policy| policy.add(Reach::WebsiteData, &stores, Shape::Folder, Access::Write));
    }
}

fn refused(path: &Path, access: Access) -> io::Error {
    #[cfg(debug_assertions)]
    eprintln!("[file gate] refused {access:?} on {}", path.display());
    #[cfg(not(debug_assertions))]
    let _ = (path, access);
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "Misty doesn't have access to this location.",
    )
}

pub fn check(path: &Path, access: Access) -> io::Result<()> {
    let real = real_path::resolve(path)?;
    let allowed = POLICY
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .allows(&real, access);
    allowed.then_some(()).ok_or_else(|| refused(path, access))
}

pub(crate) fn check_link(path: &Path, access: Access) -> io::Result<()> {
    let real = real_path::resolve_parent(path)?;
    let allowed = POLICY
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .allows(&real, access);
    allowed.then_some(()).ok_or_else(|| refused(path, access))
}

pub fn is_picked_file(path: &Path) -> bool {
    real_path::resolve(path).is_ok_and(|real| {
        POLICY
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .was_picked(&real)
    })
}

pub fn allow_picked_file(path: &Path, access: Access) {
    with_policy(|policy| policy.add(Reach::PickedFile, path, Shape::Exact, access));
}

pub fn allow_bundled_resources(folder: &Path) {
    with_policy(|policy| {
        policy.add(Reach::BundledResources, folder, Shape::Folder, Access::Read);
    });
}

pub fn allow_benchmark_keys(path: &Path) {
    with_policy(|policy| policy.add(Reach::BenchmarkKeys, path, Shape::Exact, Access::Read));
}

pub fn allow_editor_config_folder(folder: &Path) {
    with_policy(|policy| policy.add(Reach::EditorConfig, folder, Shape::Folder, Access::Read));
}

pub fn allow_engine_config_folder(folder: &Path) {
    with_policy(|policy| policy.add(Reach::EngineConfig, folder, Shape::Folder, Access::Write));
}

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

pub fn allow_recorded_download(path: &Path) {
    with_policy(|policy| policy.add(Reach::RecordedDownload, path, Shape::Exact, Access::Write));
}

pub fn allow_shared_folder(folder: &Path, access: Access) {
    with_policy(|policy| policy.add(Reach::SharedFolder, folder, Shape::Folder, access));
}

pub fn revoke_shared_folder(folder: &Path) {
    with_policy(|policy| policy.remove(Reach::SharedFolder, folder));
}

pub fn allow_space_drive(folder: &Path) {
    with_policy(|policy| policy.add(Reach::SpaceDrive, folder, Shape::Folder, Access::Write));
}

pub fn revoke_space_drive(folder: &Path) {
    with_policy(|policy| policy.remove(Reach::SpaceDrive, folder));
}

pub fn is_in_space_drive(path: &Path) -> bool {
    real_path::resolve(path).is_ok_and(|real| {
        POLICY
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .reach_covers(Reach::SpaceDrive, &real)
    })
}

pub fn allow_linked_folder(folder: &Path) {
    with_policy(|policy| policy.add(Reach::LinkedFolder, folder, Shape::Folder, Access::Write));
}

pub fn revoke_linked_folder(folder: &Path) {
    with_policy(|policy| policy.remove(Reach::LinkedFolder, folder));
}

pub mod conf;
pub mod paths;
#[cfg(test)]
mod tests;

#[cfg(test)]
#[ctor::ctor]
fn isolate_tests() {
    paths::isolate_for_tests();
}
