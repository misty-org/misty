//! Per-device website data state kept by a session. A device is one tree;
//! each has its own sign-in data, sync state and coverage report.
use std::collections::BTreeMap;

use misty_browser_sync::document::CredentialRecord;
use serde::Serialize;

use super::super::browser_data_coverage::SiteCoverage;

/// The native browser store this session uses for the device it writes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct DeviceBrowser {
    pub tree: String,
    pub physical: String,
}

/// A device's sign-in data as last published or restored by this session:
/// origins not open right now keep this copy instead of being deleted.
#[derive(Clone, Default)]
pub(super) struct Baseline {
    /// Plaintext digests (hex) of the shards this copy was built from.
    pub written: BTreeMap<i16, String>,
    /// Server slot hashes it was read at, when it came from the server.
    pub server: BTreeMap<i16, [u8; 32]>,
    pub records: Vec<CredentialRecord>,
    /// Fingerprint of the capture this copy was packed from, if it was.
    pub observed: Option<[u8; 32]>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum DeviceDataState {
    /// This machine's store matches what the device has published.
    Synced,
    /// Changes are queued for the server.
    Publishing,
    /// Another session wrote this device; its data is being loaded here.
    Loading,
    Attention,
}

/// What one device's sign-in data looks like to this session. Carries only
/// site hosts, counts and fixed reasons, never website data.
#[derive(Clone, Debug, Serialize)]
pub(super) struct DeviceWebsiteData {
    pub device_id: String,
    pub state: DeviceDataState,
    pub sites: Vec<SiteCoverage>,
    /// Milliseconds since the Unix epoch.
    pub checked_at: u64,
}

pub(super) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            elapsed.as_millis().try_into().unwrap_or(u64::MAX)
        })
}

impl DeviceWebsiteData {
    pub fn new(device_id: &str, state: DeviceDataState, sites: Vec<SiteCoverage>) -> Self {
        Self {
            device_id: device_id.into(),
            state,
            sites,
            checked_at: now_ms(),
        }
    }
}

/// Binding for a device this machine has not written before. This machine's
/// own device adopts the browser store it already uses, so upgrading keeps
/// its sign-ins and publishes them as that device's data. Any other device
/// starts from a new, empty store that is loaded from its published data.
pub(super) async fn adopt(
    active: &mut super::Session,
    tree: &str,
    logical: &str,
) -> Result<misty_browser_sync::store::DeviceSignin, String> {
    let physical_id = if tree == active.device_id {
        let selected = super::selected_profile()
            .lock()
            .map_err(|_| "Browser profile state is unavailable")?
            .clone()
            .filter(|selected| selected.logical == logical)
            .map(|selected| selected.physical);
        match selected {
            Some(physical) => physical,
            // Before migration, pages opened in the store named by the
            // logical profile itself; a registered legacy store replaces it.
            None => active
                .handle
                .browser_profile_binding(logical.into())
                .await
                .map_err(super::issue)?
                .active
                .map_or_else(|| logical.to_owned(), |generation| generation.physical_id),
        }
    } else {
        format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        )
    };
    let binding = misty_browser_sync::store::DeviceSignin {
        physical_id,
        ..Default::default()
    };
    active
        .handle
        .bind_signin(tree.into(), binding.clone())
        .await
        .map_err(super::issue)?;
    Ok(binding)
}

/// The store pages open in for the device this session drives. It never
/// switches stores under open pages; the capture loop closes them first.
pub(super) async fn device_store(
    active: &mut super::Session,
    logical: &str,
) -> Result<super::SelectedProfile, String> {
    let tree = active.handle.trees.borrow().driving_tree.clone();
    let tree = tree.ok_or("Choose a device to continue before opening pages.")?;
    if let Some(browser) = active
        .device_browser
        .as_ref()
        .filter(|browser| browser.tree == tree)
    {
        return Ok(super::SelectedProfile {
            logical: logical.into(),
            physical: browser.physical.clone(),
        });
    }
    let status = active
        .handle
        .signin_status(tree.clone())
        .await
        .map_err(super::issue)?;
    let binding = match status.binding {
        Some(binding) => binding,
        None => adopt(active, &tree, logical).await?,
    };
    Ok(super::SelectedProfile {
        logical: logical.into(),
        physical: binding.physical_id,
    })
}

/// A tab's synced session storage from the device's published data.
pub(super) fn tab_session(
    active: &super::Session,
    area: &misty_browser_sync::document::credentials::Area,
) -> Option<serde_json::Value> {
    let tree = active.device_browser.as_ref()?.tree.clone();
    let key = serde_json::to_value(area).ok()?;
    active
        .baselines
        .get(&tree)?
        .records
        .iter()
        .find(|record| serde_json::to_value(&record.area).ok().as_ref() == Some(&key))
        .map(|record| record.payload.clone())
}
