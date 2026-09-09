//! Desktop-platform integrations owned by the Tauri shell.

pub mod app_command_policy;
#[cfg(desktop)]
pub mod extension_protocol;
#[cfg(desktop)]
pub mod mini_app;
pub mod plugins;
