//! Capturing this machine's sign-ins and publishing them to the workspace's slots.
use super::*;

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
pub(super) fn report_pack_skips(
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

pub(super) async fn capture(
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

pub(super) async fn publish(
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
        active.website_data.insert(
            workspace.into(),
            DeviceWebsiteData::new(workspace, state, sites),
        );
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
