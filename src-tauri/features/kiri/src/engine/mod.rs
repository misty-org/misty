use tauri::Webview;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
mod unsupported;
#[cfg(windows)]
mod webview2;

#[cfg(target_os = "linux")]
use linux as platform;
#[cfg(target_os = "macos")]
use macos as platform;
#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
use unsupported as platform;
#[cfg(windows)]
use webview2 as platform;

pub fn deny_permission_requests(webview: &Webview) -> Result<(), String> {
    platform::deny_permission_requests(webview)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditCommand {
    Copy,
    Cut,
    Paste,
}

pub fn edit(webview: &Webview, command: EditCommand) -> Result<(), String> {
    platform::edit(webview, command)
}
