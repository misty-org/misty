//! Device commands (docs/design/devices/BRIEF.md). The webview drives the UI;
//! identity, trust, signatures, the control channel and LAN connections stay
//! native. Commands that change trust run only in the main window.
#![cfg(desktop)]

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::app::runtime::MistyRuntime;
use crate::infra::{
    connected_devices::ConnectedDevicesService,
    device_admission::{self as admission, DeviceContext},
    device_channel::{self, ChannelConfig, ChannelSnapshot},
    device_discovery,
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
    pub endpoint_id: Option<String>,
    /// This device is in the root-signed device list.
    pub admitted: bool,
    /// This device holds the vault root right now (sync is unlocked).
    pub can_sign: bool,
    pub vault_pinned: bool,
    pub list_version: u64,
    pub channel: ChannelSnapshot,
    pub connected: Vec<String>,
    pub policy: Option<DevicePolicy>,
}

pub(super) async fn view(state: &MistyRuntime, account_id: &str) -> DevicesView {
    DevicesView {
        server_device_id: device_trust::server_device_id(),
        endpoint_id: state
            .connected_devices
            .snapshot()
            .ok()
            .and_then(|snapshot| snapshot.endpoint_id),
        admitted: device_trust::self_admitted(),
        can_sign: crate::infra::browser_sync::device_admission_authority(account_id)
            .await
            .is_some(),
        vault_pinned: device_trust::pinned_root().is_some(),
        list_version: device_trust::list_version(),
        channel: device_channel::snapshot(),
        connected: state.connected_devices.connected_device_ids(),
        policy: device_trust::own_policy().map(|(policy, _)| policy),
    }
}

/// Refreshes trust after a hint and drops connections to removed devices.
async fn refresh(
    api_base: String,
    account_id: String,
    local: String,
    devices: ConnectedDevicesService,
) {
    let Ok(context) = DeviceContext::open(&api_base, &account_id, &local) else {
        return;
    };
    if admission::refresh_trust(&context).await.is_ok() {
        devices.close_untrusted();
    }
}

/// Connects to online, trusted devices on this network that aren't connected:
/// cached addresses first, then a connect intent. At most once a minute per
/// device; nothing is sent while connected.
fn start_auto_connect(devices: ConnectedDevicesService, generation: u64) {
    tauri::async_runtime::spawn(async move {
        let mut attempts: HashMap<String, Instant> = HashMap::new();
        loop {
            tokio::time::sleep(Duration::from_secs(15)).await;
            if GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            let snapshot = device_channel::snapshot();
            if !snapshot.connected || !snapshot.admitted {
                continue;
            }
            for peer in snapshot.peers.iter().filter(|peer| peer.online) {
                if devices.connected_device_ids().contains(&peer.device_id)
                    || device_trust::trusted_peer(&peer.endpoint_id).as_deref()
                        != Some(peer.device_id.as_str())
                    || attempts
                        .get(&peer.device_id)
                        .is_some_and(|at| at.elapsed() < Duration::from_secs(60))
                {
                    continue;
                }
                attempts.insert(peer.device_id.clone(), Instant::now());
                let cached = device_trust::known_addresses(&peer.device_id);
                let reached = !cached.is_empty()
                    && devices
                        .connect_device(&peer.device_id, &peer.endpoint_id, cached)
                        .await
                        .is_ok();
                if !reached && device_channel::same_network(&snapshot, peer) {
                    device_channel::request_connect(&peer.device_id);
                }
            }
        }
    });
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
    admission::register(
        &mut context,
        name.trim(),
        &platform,
        &os_version,
        &app_version,
    )
    .await?;
    state
        .connected_devices
        .set_network_identity(context.server_device_id.clone())
        .map_err(|error| error.to_string())?;
    device_trust::set_own_endpoint(&context.identity.endpoint_id())
        .map_err(|error| error.to_string())?;
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
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let devices = state.connected_devices.clone();
    let endpoint = context.identity.endpoint_id();
    let address_devices = devices.clone();
    let candidate_devices = devices.clone();
    let found_devices = devices.clone();
    let event_devices = devices.clone();
    let (event_base, event_account, event_local) =
        (api_base.clone(), account_id.clone(), local.clone());
    let refreshing = Arc::new(Mutex::new(false));
    device_channel::start(ChannelConfig {
        app: Some(app.clone()),
        http: context.http.clone(),
        local_device_id: local.clone(),
        server_device_id: context.server_device_id.clone(),
        addresses: Arc::new(move || {
            let candidates = address_devices.lan_candidates();
            device_discovery::advertise(&endpoint, &candidates);
            candidates
        }),
        on_candidates: Arc::new(move |device_id, endpoint_id, addresses| {
            let devices = candidate_devices.clone();
            tauri::async_runtime::spawn(async move {
                let _ = devices
                    .connect_device(&device_id, &endpoint_id, addresses)
                    .await;
            });
        }),
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
            let (base, account, local, devices) = (
                event_base.clone(),
                event_account.clone(),
                event_local.clone(),
                event_devices.clone(),
            );
            tauri::async_runtime::spawn(async move {
                refresh(base, account, local, devices).await;
                if let Ok(mut busy) = flag.lock() {
                    *busy = false;
                }
            });
        }),
    });
    device_discovery::start(Arc::new(move |device_id, endpoint_id, candidates| {
        let devices = found_devices.clone();
        tauri::async_runtime::spawn(async move {
            let _ = devices
                .connect_device(&device_id, &endpoint_id, candidates)
                .await;
        });
    }));
    start_auto_connect(devices, generation);
    Ok(view(&state, &account_id).await)
}

#[tauri::command]
pub async fn devices_stop(webview: tauri::Webview) -> Result<(), String> {
    require_main(&webview)?;
    GENERATION.fetch_add(1, Ordering::SeqCst);
    device_channel::stop();
    device_discovery::stop();
    device_trust::close();
    Ok(())
}

#[tauri::command]
pub async fn devices_view(
    state: State<'_, MistyRuntime>,
    account_id: String,
) -> Result<DevicesView, String> {
    Ok(view(&state, &account_id).await)
}

#[tauri::command]
pub async fn devices_refresh(
    state: State<'_, MistyRuntime>,
    api_base: String,
    account_id: String,
) -> Result<DevicesView, String> {
    let context = context(&state, &api_base, &account_id).await?;
    admission::refresh_trust(&context).await?;
    state.connected_devices.close_untrusted();
    Ok(view(&state, &account_id).await)
}
