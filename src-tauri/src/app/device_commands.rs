//! Device commands (docs/design/devices/BRIEF.md). The webview drives the UI;
//! identity, trust, signatures and the control channel stay native. Commands
//! that change trust run only in the main window.
#![cfg(desktop)]

use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::app::runtime::MistyRuntime;
use crate::infra::{
    device_admission::{self as admission, DeviceContext},
    device_channel::{self, ChannelConfig, ChannelSnapshot},
    device_records::{DevicePolicy, SharedFolder},
    device_trust,
};

static GENERATION: AtomicU64 = AtomicU64::new(0);

pub(super) fn require_main(webview: &tauri::Webview) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Devices are managed from the main Misty window.".into());
    }
    Ok(())
}

/// Main or an agent's own window may sign its device requests.
pub(super) fn require_device_window(webview: &tauri::Webview) -> Result<(), String> {
    let label = webview.label();
    if label != "main" && !label.starts_with("misty-agent-") {
        return Err("This window can't act for the device.".into());
    }
    Ok(())
}

pub(super) async fn local_device_id(state: &MistyRuntime) -> Result<String, String> {
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
                // Every project is offered to the person's other devices
                // read-only (list, read, send); editing and commands stay on
                // this computer, since no device policy grants "code".
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
    /// This device is in the root-signed device list.
    pub admitted: bool,
    /// This device holds the vault root right now (sync is unlocked).
    pub can_sign: bool,
    pub vault_pinned: bool,
    pub list_version: u64,
    pub channel: ChannelSnapshot,
    pub policy: Option<DevicePolicy>,
}

pub(super) async fn view(account_id: &str) -> DevicesView {
    DevicesView {
        server_device_id: device_trust::server_device_id(),
        admitted: device_trust::self_admitted(),
        can_sign: crate::infra::browser_sync::device_admission_authority(account_id)
            .await
            .is_some(),
        vault_pinned: device_trust::pinned_root().is_some(),
        list_version: device_trust::list_version(),
        channel: device_channel::snapshot(),
        policy: device_trust::own_policy().map(|(policy, _)| policy),
    }
}

/// Refreshes trust after a device-list hint.
async fn refresh(api_base: String, account_id: String, local: String) {
    if let Ok(context) = DeviceContext::open(&api_base, &account_id, &local) {
        let _ = admission::refresh_trust(&context).await;
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
fn computer_name() -> String {
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
    let name = std::fs::read_to_string("/etc/hostname").ok();
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
    let _ = admission::refresh_trust(&context).await;
    // Unlocking sync on this device is the proof that adds it: add once.
    if !device_trust::self_admitted()
        && crate::infra::browser_sync::device_admission_authority(&account_id)
            .await
            .is_some()
    {
        let _ = admission::admit_self(&context).await;
    }
    if device_trust::own_policy().is_none() {
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
            account_id: account_id.clone(),
            server_device_id: context.server_device_id.clone(),
            device_name: name.trim().to_owned(),
        });
    GENERATION.fetch_add(1, Ordering::SeqCst);
    let (event_base, event_account, event_local) =
        (api_base.clone(), account_id.clone(), local.clone());
    let refreshing = Arc::new(Mutex::new(false));
    device_channel::start(ChannelConfig {
        app: Some(app.clone()),
        http: context.http.clone(),
        local_device_id: local.clone(),
        server_device_id: context.server_device_id.clone(),
        on_event: Arc::new(move |topic| {
            if topic != "devices" && topic != "ready" && topic != "reset" {
                return;
            }
            let Ok(mut busy) = refreshing.lock() else {
                return;
            };
            if *busy {
                return;
            }
            *busy = true;
            let flag = refreshing.clone();
            let (base, account, local) = (
                event_base.clone(),
                event_account.clone(),
                event_local.clone(),
            );
            tauri::async_runtime::spawn(async move {
                refresh(base, account, local).await;
                if let Ok(mut busy) = flag.lock() {
                    *busy = false;
                }
            });
        }),
    });
    Ok(view(&account_id).await)
}

#[tauri::command]
pub async fn devices_stop(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
) -> Result<(), String> {
    require_main(&webview)?;
    GENERATION.fetch_add(1, Ordering::SeqCst);
    state.cloud_clipboard.stop();
    device_channel::stop();
    device_trust::close();
    Ok(())
}

#[tauri::command]
pub async fn devices_view(account_id: String) -> Result<DevicesView, String> {
    Ok(view(&account_id).await)
}

#[tauri::command]
pub async fn devices_refresh(
    state: State<'_, MistyRuntime>,
    api_base: String,
    account_id: String,
) -> Result<DevicesView, String> {
    let context = context(&state, &api_base, &account_id).await?;
    admission::refresh_trust(&context).await?;
    Ok(view(&account_id).await)
}
