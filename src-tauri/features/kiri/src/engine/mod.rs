//! Engine hooks: websites never get the camera, microphone or location, so every engine refuses
//! those requests without asking; and editing commands only the engine runs. One file per OS.

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

/// Refuses the tab's camera, microphone and location requests before the engine can ask the
/// person. Safe to call again for the same tab.
pub fn deny_permission_requests(webview: &Webview) -> Result<(), String> {
    platform::deny_permission_requests(webview)
}

/// Editing commands the embedder's own menus run in a tab.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditCommand {
    Copy,
    Cut,
    Paste,
}

/// Runs an editing command on the tab's selection or focused field, as the
/// engine's own context menu would. Focus the tab first.
pub fn edit(webview: &Webview, command: EditCommand) -> Result<(), String> {
    platform::edit(webview, command)
}
