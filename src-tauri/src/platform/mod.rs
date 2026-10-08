//! Desktop-platform integrations owned by the Tauri shell.

pub mod app_command_policy;
pub mod app_lifecycle;
pub mod asset_protocol;
#[cfg(desktop)]
pub mod mini_app;
pub mod navigation_guard;
pub mod plugins;
pub mod synced_paths;
