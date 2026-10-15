//! Coding tools on this device: which are installed and signed in, and
//! stopping a delegated coding run. Starting runs arrives with delegation from
//! the server; until then nothing here can start a tool.
#![cfg(desktop)]

use crate::agents::runners::{detect, registry};
use crate::app::device_commands::require_device_window;

/// Every coding tool's install and sign-in status on this device.
#[tauri::command]
pub async fn coding_engines_detect(
    webview: tauri::Webview,
) -> Result<Vec<detect::EngineStatus>, String> {
    require_device_window(&webview)?;
    tokio::task::spawn_blocking(detect::detect_all)
        .await
        .map_err(|_| "Misty couldn't check your coding tools.".to_owned())
}

/// Stops a delegated coding run's tool. Returns whether it was running.
#[tauri::command]
pub fn coding_runner_stop(webview: tauri::Webview, run_id: String) -> Result<bool, String> {
    require_device_window(&webview)?;
    Ok(registry::stop(&run_id))
}
