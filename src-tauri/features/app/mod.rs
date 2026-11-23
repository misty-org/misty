#[cfg(target_os = "macos")]
pub mod app_menu;
pub mod autostart;
pub mod commands;
pub(crate) mod crash_log;
pub mod dropped_files;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
#[path = "../sandbox/embedded_workers.rs"]
pub(crate) mod embedded_workers;
pub(crate) mod error;
pub mod handlers;
pub mod permission_commands;
pub mod platform_info;
pub mod plugins;
pub mod runtime;
pub mod settings_commands;
pub(crate) mod setup;
pub(crate) mod shell_plugins;
#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
pub(crate) mod embedded_workers {
    pub(crate) fn builtin_worker(service: &str, _protocol: u32) -> Result<&'static [u8], String> {
        Err(format!("The {service} helper isn't built for this system."))
    }
}
pub mod lifecycle;
pub mod macos_window_effects;
#[cfg(desktop)]
pub(crate) mod plugin_routes;
#[cfg(desktop)]
pub mod tray;
#[cfg(target_os = "macos")]
mod tray_mark;
pub mod trusted_windows;
#[cfg(windows)]
pub mod windows;

#[cfg(test)]
#[ctor::ctor]
fn isolate_tests() {
    file_access::paths::isolate_for_tests();
}
