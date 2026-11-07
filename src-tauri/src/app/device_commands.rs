//! Device commands. The webview drives the UI;
//! identity, trust, signatures and the control channel stay native. Commands
//! that change trust run only in the main window.
#![cfg(desktop)]

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::app::runtime::MistyRuntime;
use crate::infra::{
    devices::admission::{self as admission, DeviceContext},
    devices::channel::{self, ChannelConfig, ChannelSnapshot},
    devices::records::{DevicePolicy, SharedFolder},
    devices::trust,
};

pub(super) fn require_main(webview: &tauri::Webview) -> Result<(), String> {
    if !crate::infra::profile_windows::is_person_window(webview.label()) {
        return Err("Devices are managed from the main Misty window.".into());
    }
    Ok(())
}

/// Only a profile's window may sign its device requests.
pub(crate) fn require_device_window(webview: &tauri::Webview) -> Result<(), String> {
    if !crate::infra::profile_windows::is_person_window(webview.label()) {
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

pub(super) async fn shared_folders(state: &MistyRuntime) -> Vec<SharedFolder> {
    let Ok(snapshot) = state.agents.device_snapshot().await else {
        return Vec::new();
    };
    snapshot["scopes"]
        .as_array()
        .map(|scopes| {
            scopes
                .iter()
                // Every shared folder is offered to the person's other devices
                // read-only (list, read, send).
                .filter_map(|scope| {
                    Some(SharedFolder {
                        scope_id: scope["id"].as_str()?.to_owned(),
                        name: scope["displayName"].as_str()?.chars().take(200).collect(),
                    })
                })
                .take(64)
                .collect()
        })
        .unwrap_or_default()
}

pub(super) async fn context(
    state: &MistyRuntime,
    api_base: &str,
    account_id: &str,
) -> Result<DeviceContext, String> {
    let local = local_device_id(state).await?;
    DeviceContext::open(api_base, account_id, &local)
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicesView {
    pub server_device_id: Option<String>,
    /// This session is registered, which is all it takes to be trusted.
    pub admitted: bool,
    pub channel: ChannelSnapshot,
    pub policy: Option<DevicePolicy>,
}

pub(super) fn view() -> DevicesView {
    DevicesView {
        server_device_id: trust::server_device_id(),
        admitted: trust::self_admitted(),
        channel: channel::snapshot(),
        policy: trust::own_policy().map(|(policy, _)| policy),
    }
}

/// The device name shown in Windows Settings, in the case the person typed,
/// rather than the upper-case NetBIOS name in %COMPUTERNAME%.
#[cfg(target_os = "windows")]
fn windows_device_name() -> Option<String> {
    use windows_sys::Win32::System::SystemInformation::{
        ComputerNamePhysicalDnsHostname, GetComputerNameExW,
    };
    let mut buffer = [0u16; 256];
    let mut length = buffer.len() as u32;
    // SAFETY: `length` holds the buffer's capacity in characters.
    let ok = unsafe {
        GetComputerNameExW(
            ComputerNamePhysicalDnsHostname,
            buffer.as_mut_ptr(),
            &mut length,
        )
    } != 0;
    ok.then(|| String::from_utf16_lossy(&buffer[..length as usize]))
        .or_else(|| std::env::var("COMPUTERNAME").ok())
}

/// The name people gave this computer ("Matthew's MBP"), so each device is
/// recognizable in lists; "This Misty" only when the system has none.
pub(crate) fn computer_name() -> String {
    #[cfg(target_os = "macos")]
    let name = std::process::Command::new("/usr/sbin/scutil")
        .args(["--get", "ComputerName"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).into_owned());
    #[cfg(target_os = "windows")]
    let name = windows_device_name();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let name = crate::infra::file_access::fs::read_to_string("/etc/hostname").ok();
    let name: String = name
        .unwrap_or_default()
        .trim()
        .trim_end_matches(".local")
        .chars()
        .filter(|c| !c.is_control())
        .take(64)
        .collect();
    if name.is_empty() {
        "This Misty".to_owned()
    } else {
        name
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn devices_start(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, MistyRuntime>,
    api_base: String,
    account_id: String,
    name: String,
    platform: String,
    os_version: String,
    app_version: String,
) -> Result<DevicesView, String> {
    require_main(&webview)?;
    let local = local_device_id(&state).await?;
    let mut context = DeviceContext::open(&api_base, &account_id, &local)?;
    let name = match name.trim() {
        "" => computer_name(),
        given => given.to_owned(),
    };
    admission::register(&mut context, &name, &platform, &os_version, &app_version).await?;
    if trust::own_policy().is_none() {
        let first = DevicePolicy::first(shared_folders(&state).await);
        let _ = admission::publish_policy(
            &context,
            &first.files,
            first.clipboard,
            first.agent_surfaces,
            first.shared_folders,
        )
        .await;
    }
    // The encrypted cloud clipboard follows this device's policy and vault.
    state
        .cloud_clipboard
        .start(crate::infra::cloud_clipboard::CloudStart {
            app: app.clone(),
            server_device_id: context.server_device_id.clone(),
            device_name: name.trim().to_owned(),
        });
    channel::start(ChannelConfig {
        app: Some(app.clone()),
        http: context.http.clone(),
        local_device_id: local.clone(),
        server_device_id: context.server_device_id.clone(),
    });
    Ok(view())
}

#[tauri::command]
pub async fn devices_stop(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
) -> Result<(), String> {
    require_main(&webview)?;
    state.cloud_clipboard.stop();
    channel::stop();
    trust::close();
    Ok(())
}

#[tauri::command]
pub async fn devices_view() -> Result<DevicesView, String> {
    Ok(view())
}
