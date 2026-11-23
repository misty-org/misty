#[cfg(target_os = "macos")]
pub mod app_menu;
pub mod autostart;
pub mod commands;
pub(crate) mod crash_log;
pub mod dropped_files;
pub(crate) mod error;
pub(crate) mod first_draw;
pub mod handlers;
pub mod lifecycle;
pub mod macos_window_effects;
pub mod permission_commands;
pub mod platform_info;
#[cfg(desktop)]
pub(crate) mod plugin_routes;
pub mod plugins;
pub mod runtime;
pub mod settings_commands;
pub(crate) mod setup;
pub(crate) mod shell_plugins;
#[cfg(desktop)]
pub mod tray;
#[cfg(target_os = "macos")]
mod tray_mark;
pub mod trusted_windows;
#[cfg(windows)]
pub mod windows;
pub(crate) mod workers;

#[cfg(test)]
#[ctor::ctor]
fn isolate_tests() {
    file_access::paths::isolate_for_tests();
}
