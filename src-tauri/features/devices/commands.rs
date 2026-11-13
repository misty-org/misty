//! Device commands. The webview asks; this computer's key, its signatures and the job checks stay
//! native.
#![cfg(desktop)]
#[cfg(desktop)]
pub mod jobs;

use crate::app::runtime::MistyRuntime;

/// Only a profile's window may sign its device requests.
pub(crate) fn require_device_window(webview: &tauri::Webview) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("This window can't act for the device.".into());
    }
    Ok(())
}

pub(crate) async fn local_device_id(state: &MistyRuntime) -> Result<String, String> {
    let snapshot = state
        .agents
        .device_snapshot()
        .await
        .map_err(|error| error.to_string())?;
    snapshot["device"]["id"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "This device isn't ready.".to_owned())
}
