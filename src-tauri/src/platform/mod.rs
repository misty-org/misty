//! Desktop-platform integrations owned by the Tauri shell.

pub mod app_command_policy;
pub mod app_lifecycle;
#[cfg(desktop)]
pub mod mini_app;
pub mod plugins;
