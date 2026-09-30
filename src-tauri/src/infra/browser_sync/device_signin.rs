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

use super::super::browser_data_budget::Limit;
use super::super::browser_data_coverage::{area_site, site, Coverage, DataKind, SkipReason};
use super::super::browser_signin_scope::scope_records;
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
    active
        .website_data
        .insert(workspace.into(), DeviceWebsiteData::new(workspace, state, sites));
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
    if selected_profile()
        .lock()
        .map_err(|_| "Browser profile state is unavailable")?
        .as_ref()
        != Some(&wanted)
    {
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

/// One pass for the device this session writes: load it if another session
/// changed it, otherwise capture this machine's store and publish changes.
pub(super) async fn reconcile(
    app: &tauri::AppHandle,
    active: &mut Session,
) -> Result<Option<&'static str>, String> {
    if !full_sync_enabled(active) {
        active.capture_view = None;
        return Ok(None);
    }
    if !handoff::supported() {
        return Ok(Some(
            "Website sign-in sync requires macOS 14 or newer, or Windows.",
        ));
    }
    let (workspace, holder) = {
        let view = active.handle.workspaces.borrow();
        let workspace = view.on_workspace.clone().filter(|_| view.seat_confirmed);
        let holder = workspace.is_some() && view.driving_workspace == workspace;
        (workspace, holder)
    };
    let Some(workspace) = workspace else { return Ok(None) };
    let status = active
        .handle
        .signin_status(workspace.clone())
        .await
        .map_err(issue)?;
    if !holder {
        return open_without_lease(app, active, &workspace, &status).await;
    }
    if !status.writer || !status.current {
        return Ok(None);
    }
    let logical = default_profile_id(&active.scope)?;
    let binding = match status.binding.clone() {
        Some(binding) => binding,
        None => device_data::adopt(active, &workspace, &logical).await?,
    };
    // Changes queued here are still on their way; the server lags behind them.
    if !status.pending && !binding.reflects(&status.server) {
        set_state(active, &workspace, DeviceDataState::Loading);
        let result = load(app, active, &workspace, &logical, binding, &status.server).await;
        set_state(
            active,
            &workspace,
            if result.is_ok() {
                DeviceDataState::Synced
            } else {
                DeviceDataState::Attention
            },
        );
        return result.map(|()| None);
    }
    switch_to(app, active, &workspace, &logical, &binding.physical_id)?;
    let result = capture(app, active, &workspace, &logical, binding, &status).await;
    if result.is_err() {
        set_state(active, &workspace, DeviceDataState::Attention);
    }
    result
}

/// A machine that opened a device without its lease: its pages use that
/// device's published sign-ins (loaded now if this machine's copy is older),
/// and nothing it does in them is published.
async fn open_without_lease(
    app: &tauri::AppHandle,
    active: &mut Session,
    workspace: &str,
    status: &SigninStatus,
) -> Result<Option<&'static str>, String> {
    if !status.current {
        return Ok(None);
    }
    let logical = default_profile_id(&active.scope)?;
    let binding = match status.binding.clone() {
        Some(binding) => binding,
        None => device_data::adopt(active, workspace, &logical).await?,
    };
    if !binding.reflects(&status.server) {
        set_state(active, workspace, DeviceDataState::Loading);
        let result = load(app, active, workspace, &logical, binding, &status.server).await;
        set_state(
            active,
            workspace,
            if result.is_ok() {
                DeviceDataState::Synced
            } else {
                DeviceDataState::Attention
            },
        );
        return result.map(|()| None);
    }
    switch_to(app, active, workspace, &logical, &binding.physical_id)?;
    Ok(None)
}

/// Points new pages at this device's store. Pages of another store close
/// first; the renderer reopens them when the profile-changed event arrives.
fn switch_to(
    app: &tauri::AppHandle,
    active: &mut Session,
    workspace: &str,
    logical: &str,
    physical: &str,
) -> Result<(), String> {
    let wanted = SelectedProfile {
        logical: logical.into(),
        physical: physical.into(),
    };
    let browser = DeviceBrowser {
        workspace: workspace.into(),
        physical: physical.into(),
    };
    let current = selected_profile()
        .lock()
        .map_err(|_| "Browser profile state is unavailable")?
        .clone();
    if current.as_ref() == Some(&wanted) {
        active.device_browser = Some(browser);
        return Ok(());
    }
    super::super::agent_workspace::stop_account_tasks(app)?;
    active.capture_view = None;
    super::super::browser::close_account_views_except(app, None)?;
    *selected_profile()
        .lock()
        .map_err(|_| "Browser profile state is unavailable")? = Some(wanted);
    active.device_browser = Some(browser);
    let _ = app.emit_to("main", "misty:browser-profile-changed", &active.id);
    Ok(())
}

/// Reads and verifies every published shard of the device.
async fn read_shards(
    active: &Session,
    workspace: &str,
    server: &BTreeMap<i16, [u8; 32]>,
) -> Result<(Vec<Vec<u8>>, BTreeMap<i16, String>), String> {
    let mut shards = Vec::new();
    let mut written = BTreeMap::new();
    for kind in server.keys() {
        let plaintext =
            tokio::time::timeout(READ_TIMEOUT, active.handle.read_signin(workspace.into(), *kind))
                .await
                .map_err(|_| "Reading this device's sign-ins timed out. Retrying automatically.")?
                .map_err(issue)?
                // The slot moved on since this pass started; the next pass retries.
                .ok_or("This device's sign-ins changed while loading. Retrying automatically.")?;
        written.insert(*kind, signin_digest_hex(&signin::digest(&plaintext)));
        shards.push(plaintext);
    }
    Ok((shards, written))
}

/// Replaces this machine's copy of the device's sign-in data with what the
/// device published, and verifies the browser read it back exactly. Origins
/// the device never published keep their local data.
async fn load(
    app: &tauri::AppHandle,
    active: &mut Session,
    workspace: &str,
    logical: &str,
    binding: DeviceSignin,
    server: &BTreeMap<i16, [u8; 32]>,
) -> Result<(), String> {
    let (shards, written) = read_shards(active, workspace, server).await?;
    let observations = signin::unpack(shards.iter().map(Vec::as_slice))
        .map_err(|_| "This device's published sign-in data is invalid.")?;
    let target = records(logical, observations);
    // Pages using the store close before its contents are replaced, and are
    // reopened afterwards whether or not loading succeeded.
    super::super::agent_workspace::stop_account_tasks(app)?;
    active.capture_view = None;
    active.device_browser = None;
    super::super::browser::close_account_views_except(app, None)?;
    let physical = binding.physical_id.clone();
    let result = replace(app, active, workspace, logical, binding, server, written, target).await;
    // Pages open in this device's store either way. After a failed load it is
    // not captured from: its binding still differs from the published slots,
    // so the next pass loads again before anything is published.
    *selected_profile()
        .lock()
        .map_err(|_| "Browser profile state is unavailable")? = Some(SelectedProfile {
        logical: logical.into(),
        physical: physical.clone(),
    });
    active.device_browser = Some(DeviceBrowser {
        workspace: workspace.into(),
        physical,
    });
    let _ = app.emit_to("main", "misty:browser-profile-changed", &active.id);
    result
}

#[allow(clippy::too_many_arguments)]
async fn replace(
    app: &tauri::AppHandle,
    active: &mut Session,
    workspace: &str,
    logical: &str,
    mut binding: DeviceSignin,
    server: &BTreeMap<i16, [u8; 32]>,
    written: BTreeMap<i16, String>,
    target: Vec<CredentialRecord>,
) -> Result<(), String> {
    let observer = capture::CaptureView::open(app, &binding.physical_id)?;
    let mut backend = super::super::browser_storage_restore::BrowserProfile::for_generation(
        observer.view.clone(),
        logical.into(),
        binding.physical_id.clone(),
    );
    backend.preflight(&target).await.map_err(engine)?;
    backend.apply(&target).await.map_err(engine)?;
    let observed = backend.readback(&target).await.map_err(engine)?;
    if !credentials_equivalent(&observed, &target).map_err(issue)? {
        return Err(engine(EngineError::Invalid));
    }
    drop(observer);
    binding.applied = server
        .iter()
        .map(|(kind, hash)| (*kind, signin_digest_hex(hash)))
        .collect();
    binding.written = written.clone();
    active
        .handle
        .bind_signin(workspace.into(), binding.clone())
        .await
        .map_err(issue)?;
    active.baselines.insert(
        workspace.into(),
        Baseline {
            written,
            server: server.clone(),
            records: target,
            observed: None,
        },
    );
    Ok(())
}

/// The device's data as last published, so origins without an open page are
/// kept instead of read as deleted. After a restart it is re-read once.
async fn baseline(
    active: &mut Session,
    workspace: &str,
    binding: &DeviceSignin,
    status: &SigninStatus,
) -> Result<Vec<CredentialRecord>, String> {
    if let Some(cached) = active.baselines.get(workspace).filter(|cached| {
        cached.written == binding.written
            || (!cached.server.is_empty() && cached.server == status.server)
    }) {
        return Ok(cached.records.clone());
    }
    if status.server.is_empty() {
        return migrated_baseline(active, workspace).await;
    }
    let (shards, written) = read_shards(active, workspace, &status.server).await?;
    let observations = signin::unpack(shards.iter().map(Vec::as_slice))
        .map_err(|_| "This device's published sign-in data is invalid.")?;
    let records = records(&default_profile_id(&active.scope)?, observations);
    active.baselines.insert(
        workspace.into(),
        Baseline {
            written,
            server: status.server.clone(),
            records: records.clone(),
            observed: None,
        },
    );
    Ok(records)
}

fn items(observation: &BrowserObservation) -> u32 {
    let count = match &observation.area {
        misty_browser_sync::document::credentials::Area::IndexedDb { .. } => observation.payload
            ["databases"]
            .as_array()
            .map_or(0, Vec::len),
        _ => observation
            .payload
            .as_object()
            .map_or(0, serde_json::Map::len),
    };
    count.try_into().unwrap_or(u32::MAX)
}

/// Units the shard packer could not keep move from synced to skipped.
fn report_pack_skips(
    coverage: &mut Coverage,
    packed: &signin::Packed,
    observations: &[BrowserObservation],
) {
    for skip in &packed.skipped {
        let reason = match skip.reason {
            PackReason::TooLarge => SkipReason::TooLarge,
            PackReason::SyncLimit => SkipReason::SyncLimit,
        };
        match (&skip.cookie_domain, area_site(&skip.area)) {
            (Some(domain), _) => coverage.unsync(
                &site(domain),
                DataKind::Cookies,
                reason,
                skip.count.try_into().unwrap_or(u32::MAX),
            ),
            (None, Some((host, kind))) => {
                let key = serde_json::to_value(&skip.area).ok();
                let count = observations
                    .iter()
                    .find(|o| serde_json::to_value(&o.area).ok() == key)
                    .map_or(1, items);
                coverage.unsync(&host, kind, reason, count.max(1));
            }
            (None, None) => {}
        }
    }
}

async fn capture(
    app: &tauri::AppHandle,
    active: &mut Session,
    workspace: &str,
    logical: &str,
    binding: DeviceSignin,
    status: &SigninStatus,
) -> Result<Option<&'static str>, String> {
    let previous = baseline(active, workspace, &binding, status).await?;
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
    let collected = collect::collect(
        app,
        &view,
        &binding.physical_id,
        &previous,
        None,
        Limit::Shards,
    )
    .await?;
    publish(active, workspace, logical, binding, status, collected).await
}

/// Identifies one capture's input: equal fingerprints pack to equal shards.
fn fingerprint(observations: &[BrowserObservation], coverage: &Coverage) -> Option<[u8; 32]> {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(serde_json::to_vec(observations).ok()?);
    hasher.update(serde_json::to_vec(&coverage.report()).ok()?);
    Some(hasher.finalize().into())
}

async fn publish(
    active: &mut Session,
    workspace: &str,
    logical: &str,
    binding: DeviceSignin,
    status: &SigninStatus,
    collected: collect::Collected,
) -> Result<Option<&'static str>, String> {
    let observed = fingerprint(&collected.observations, &collected.coverage);
    // Unchanged since the last pass that packed it: the shards, and what they
    // skipped, are exactly what was published then.
    if observed.is_some()
        && active
            .baselines
            .get(workspace)
            .is_some_and(|base| base.observed == observed && base.written == binding.written)
    {
        active.held = collected.held;
        let state = if status.pending {
            DeviceDataState::Publishing
        } else {
            DeviceDataState::Synced
        };
        let sites = active
            .website_data
            .get(workspace)
            .map(|data| data.sites.clone())
            .unwrap_or_default();
        active
            .website_data
            .insert(workspace.into(), DeviceWebsiteData::new(workspace, state, sites));
        return Ok(None);
    }
    let mut coverage = collected.coverage;
    let verified: BTreeSet<[u8; 32]> = binding
        .written
        .values()
        .filter_map(|digest| parse_digest(digest))
        .collect();
    let packed = signin::pack(&collected.observations, &verified)
        .map_err(|_| "Could not prepare this device's sign-in data.")?;
    report_pack_skips(&mut coverage, &packed, &collected.observations);
    let written: BTreeMap<i16, String> = packed
        .digests
        .iter()
        .map(|(kind, digest)| (*kind, signin_digest_hex(digest)))
        .collect();
    let writes: Vec<(i16, Option<Vec<u8>>)> = (FIRST_SLOT..=LAST_SLOT)
        .filter(|kind| written.get(kind) != binding.written.get(kind))
        .map(|kind| (kind, packed.shards.get(&kind).cloned()))
        .collect();
    if !writes.is_empty() {
        active
            .handle
            .write_signin(workspace.into(), writes, written.clone())
            .await
            .map_err(issue)?;
    }
    let published = signin::unpack(packed.shards.values().map(Vec::as_slice))
        .map_err(|_| "Could not prepare this device's sign-in data.")?;
    active.baselines.insert(
        workspace.into(),
        Baseline {
            written,
            server: BTreeMap::new(),
            records: records(logical, published),
            observed,
        },
    );
    active.held = collected.held;
    let state = if status.pending || binding.written != active.baselines[workspace].written {
        DeviceDataState::Publishing
    } else {
        DeviceDataState::Synced
    };
    active.website_data.insert(
        workspace.into(),
        DeviceWebsiteData::new(workspace, state, coverage.report()),
    );
    Ok(None)
}

#[cfg(test)]
mod tests;
