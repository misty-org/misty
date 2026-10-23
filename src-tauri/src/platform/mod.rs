//! Desktop-platform integrations owned by the Tauri shell.

pub mod app_command_policy;
pub mod app_lifecycle;
pub mod asset_protocol;
#[cfg(desktop)]
pub mod navigation_guard;
pub mod plugins;
#[cfg(windows)]
pub mod shared_windows;
pub mod synced_paths;
