//! Workspace mode: every device (workspace) owns one set of website sign-in data. It is
//! published in the workspace's sign-in slots and held, on each machine on
//! that device, in a native browser store for it. Any machine may be on a
//! device and edit its tabs, but only its sign-in lease holder (confirmed by
//! the server) captures and publishes sign-ins: the device's own machine when
//! online, else a machine on it (`workspaces::lease_to_claim`). Other machines load
//! the published sign-ins once when they open the device and browse with them.
//! A holder's store that no longer reflects the published slots is loaded from
//! them before it publishes anything again.
mod baseline_migration;
use baseline_migration::migrated_baseline;
mod loading;
pub(super) use loading::reconcile;
use loading::baseline;

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use misty_browser_sync::{
    document::CredentialRecord,
    restore::{EngineError, QuiescentProfile},
    store::{credentials_equivalent, signin_digest_hex, BrowserObservation, DeviceSignin},
    workspace::{
        signin::{self, PackReason, FIRST_SLOT, LAST_SLOT},
        sync::SigninStatus,
    },
};

use super::super::website_data::budget::Limit;
use super::super::website_data::coverage::{area_site, site, Coverage, DataKind, SkipReason};
use super::super::website_data::signin_scope::scope_records;
use super::device_data::{self, Baseline, DeviceBrowser, DeviceDataState, DeviceWebsiteData};
use super::*;

const READ_TIMEOUT: Duration = Duration::from_secs(30);

/// Published data is narrowed to the sign-in scope, so a copy published before
/// the scope existed neither restores nor carries application data.
fn records(logical: &str, observations: Vec<BrowserObservation>) -> Vec<CredentialRecord> {
    scope_records(
        observations
            .into_iter()
            .map(|observation| CredentialRecord {
                sequence: 0,
                profile_id: logical.into(),
                area: observation.area,
                payload: observation.payload,
            })
            .collect(),
    )
}

fn parse_digest(value: &str) -> Option<[u8; 32]> {
    let bytes: Vec<u8> = (0..value.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(value.get(i..i + 2)?, 16).ok())
        .collect::<Option<_>>()?;
    bytes.try_into().ok()
}

fn engine(error: EngineError) -> String {
    match error {
        EngineError::Unsupported => {
            "Could not load this device's sign-ins: this browser cannot store some of them."
        }
        EngineError::Unavailable => {
            "Could not load this device's sign-ins: the browser's website storage was unavailable."
        }
        EngineError::Invalid => {
            "Could not load this device's sign-ins: the browser did not read back what was written."
        }
        EngineError::Timeout => {
            "Could not load this device's sign-ins: the browser took too long to respond."
        }
    }
    .into()
}

fn set_state(active: &mut Session, workspace: &str, state: DeviceDataState) {
    let sites = active
        .website_data
        .get(workspace)
        .map(|data| data.sites.clone())
        .unwrap_or_default();
    active.website_data.insert(
        workspace.into(),
        DeviceWebsiteData::new(workspace, state, sites),
    );
}

/// What one periodic pass has to do for the device this session writes.
pub(super) enum Pass {
    Done(Option<&'static str>),
    /// Loading published data or switching stores closes pages, so the pass
    /// runs exclusively (`reconcile`).
    Exclusive,
    /// Reading this machine's store only: done without holding the session,
    /// so opening pages is not blocked behind slow website storage reads.
    Capture(CapturePlan),
}

pub(super) struct CapturePlan {
    session: String,
    workspace: String,
    logical: String,
    binding: DeviceSignin,
    previous: Vec<CredentialRecord>,
    view: tauri::Webview,
}

impl CapturePlan {
    pub(super) async fn collect(
        &self,
        app: &tauri::AppHandle,
    ) -> Result<collect::Collected, String> {
        collect::collect(
            app,
            &self.view,
            &self.binding.physical_id,
            &self.previous,
            None,
            Limit::Shards,
        )
        .await
    }
}

/// Decides the pass under the session lock. Anything that closes pages or
/// replaces the store's contents is left to an exclusive `reconcile`.
pub(super) async fn prepare(app: &tauri::AppHandle, active: &mut Session) -> Result<Pass, String> {
    if !full_sync_enabled(active) {
        active.capture_view = None;
        return Ok(Pass::Done(None));
    }
    if !handoff::supported() {
        return Ok(Pass::Done(Some(
            "Website sign-in sync requires macOS 14 or newer, or Windows.",
        )));
    }
    let (workspace, holder) = {
        let view = active.handle.workspaces.borrow();
        if let Some(claim) =
            workspaces::lease_to_claim(&view, &active.handle.presence.borrow(), &active.device_id)
                .filter(|workspace| workspaces::claim_due(workspace))
        {
            let handle = active.handle.clone();
            tokio::spawn(async move {
                // A lost race or a dropped connection is retried next pass.
                let _ = handle.claim_workspace(claim).await;
            });
        }
        let workspace = view.on_workspace.clone().filter(|_| view.seat_confirmed);
        let holder = workspace.is_some() && view.driving_workspace == workspace;
        (workspace, holder)
    };
    let Some(workspace) = workspace else {
        return Ok(Pass::Done(None));
    };
    if !holder {
        // Without the lease this machine only reads the device's sign-ins:
        // once, when it opens the device. Reloading on every publish would
        // close its pages each time the holder's cookies change.
        return Ok(
            if active
                .device_browser
                .as_ref()
                .is_some_and(|browser| browser.workspace == workspace)
            {
                Pass::Done(None)
            } else {
                Pass::Exclusive
            },
        );
    }
    let status = active
        .handle
        .signin_status(workspace.clone())
        .await
        .map_err(issue)?;
    if !status.writer || !status.current {
        return Ok(Pass::Done(None));
    }
    let Some(binding) = status.binding.clone() else {
        return Ok(Pass::Exclusive);
    };
    if !status.pending && !binding.reflects(&status.server) {
        return Ok(Pass::Exclusive);
    }
    let logical = default_profile_id(&active.scope)?;
    let wanted = SelectedProfile {
        logical: logical.clone(),
        physical: binding.physical_id.clone(),
    };
    if selected_profile(&active.scope.vault_id)?.as_ref() != Some(&wanted) {
        return Ok(Pass::Exclusive);
    }
    active.device_browser = Some(DeviceBrowser {
        workspace: workspace.clone(),
        physical: binding.physical_id.clone(),
    });
    let previous = baseline(active, &workspace, &binding, &status).await?;
    if active
        .capture_view
        .as_ref()
        .is_none_or(|view| view.physical != binding.physical_id)
    {
        active.capture_view = None;
        active.capture_view = Some(capture::CaptureView::open(app, &binding.physical_id)?);
    }
    let view = active
        .capture_view
        .as_ref()
        .ok_or("Native cookie observer is unavailable")?
        .view
        .clone();
    Ok(Pass::Capture(CapturePlan {
        session: active.id.clone(),
        workspace,
        logical,
        binding,
        previous,
        view,
    }))
}

/// Publishes what `prepare`'s plan collected, if the device, its lock and
/// this machine's store are still what the plan was made for.
pub(super) async fn finish(
    active: &mut Session,
    plan: CapturePlan,
    collected: Result<collect::Collected, String>,
) -> Result<Option<&'static str>, String> {
    if active.id != plan.session {
        return Ok(None);
    }
    let status = active
        .handle
        .signin_status(plan.workspace.clone())
        .await
        .map_err(issue)?;
    if !status.writer || !status.current || status.binding.as_ref() != Some(&plan.binding) {
        // Changed while the pages were read; the next pass starts over.
        return Ok(None);
    }
    let result = match collected {
        Ok(collected) => {
            publish(
                active,
                &plan.workspace,
                &plan.logical,
                plan.binding,
                &status,
                collected,
            )
            .await
        }
        Err(error) => Err(error),
    };
    if result.is_err() {
        set_state(active, &plan.workspace, DeviceDataState::Attention);
    }
    result
}


mod publishing;
#[cfg(test)]
use publishing::report_pack_skips;
use publishing::{capture, publish};

#[cfg(test)]
mod tests;
