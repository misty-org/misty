//! Application entry points: Tauri command handlers and shared runtime state.

#[cfg(target_os = "macos")]
pub mod app_menu;
pub mod autostart;
pub mod commands;
pub(crate) mod error;
pub mod handlers;
pub mod permission_commands;
pub mod plugins;
pub mod runtime;
pub mod settings_commands;
pub(crate) mod setup;
pub(crate) mod shell_plugins;
pub mod time;
// Beside the sandbox crate, since it is the sandbox that runs these workers. The bytes are built into
// OUT_DIR by the app's build script, so it stays in the app crate.
#[cfg(any(target_os = "macos", windows))]
#[path = "../sandbox/embedded_workers.rs"]
pub(crate) mod embedded_workers;
pub mod lifecycle;
pub mod macos_window_effects;
#[cfg(desktop)]
pub(crate) mod plugin_routes;
#[cfg(desktop)]
pub mod tray;
pub mod trusted_windows;
#[cfg(windows)]
pub mod windows;

/// Tests never reach the person's real data, whatever they exercise.
#[cfg(test)]
#[ctor::ctor]
fn isolate_tests() {
    file_access::paths::isolate_for_tests();
}
