//! Capturing this machine's sign-ins into the account's handoff.
use super::*;

/// An unmapped legacy profile may seed credentials, but has no trusted base for
/// replacing them. Reading the pending projection makes a lost-response retry
/// idempotent before the server acknowledgment arrives.
#[cfg(test)]
pub(super) fn initial_capture(
    document: &Document,
    logical: &str,
    payload: serde_json::Value,
) -> Result<Option<Payload>, String> {
    let records: Vec<_> = document
        .credentials
        .values()
        .filter(|v| v.profile_id == logical)
        .collect();
    if !records.is_empty() {
        if records.len() != 1
            || !matches!(records[0].area, Area::Cookies)
            || Area::Cookies
                .canonical_payload(&records[0].payload)
                .map_err(issue)?
                != Area::Cookies.canonical_payload(&payload).map_err(issue)?
        {
            return Err("This workspace already contains different sign-in data. Restore it before capturing more changes; this device's existing data has been preserved.".into());
        }
        return Ok(None);
    }
    Ok(Some(Payload::Credentials {
        version: 1,
        batch: document::credentials::Batch {
            profile_id: logical.into(),
            updates: vec![document::credentials::AreaUpdate {
                area: Area::Cookies,
                base_sequence: 0,
                payload,
            }],
        },
    }))
}

fn initial_storage_capture(
    document: &Document,
    logical: &str,
    observed: Vec<misty_browser_sync::store::BrowserObservation>,
) -> Result<Option<Payload>, String> {
    let mut updates = vec![];
    for observation in observed {
        let key = observation.area.key(logical).map_err(issue)?;
        if let Some(existing) = document.credentials.get(&key) {
            if observation
                .area
                .canonical_payload(&existing.payload)
                .map_err(issue)?
                != observation
                    .area
                    .canonical_payload(&observation.payload)
                    .map_err(issue)?
            {
                return Err(
                    "Receive the existing website sign-ins before publishing this device".into(),
                );
            }
        } else {
            updates.push(document::credentials::AreaUpdate {
                area: observation.area,
                base_sequence: 0,
                payload: observation.payload,
            });
        }
    }
    Ok(if updates.is_empty() {
        None
    } else {
        Some(Payload::Credentials {
            version: 1,
            batch: document::credentials::Batch {
                profile_id: logical.into(),
                updates,
            },
        })
    })
}

#[cfg(any(target_os = "macos", windows))]
pub(in crate::infra::browser_sync) async fn capture_current(
    app: &tauri::AppHandle,
    active: &mut Session,
) -> Result<(), String> {
    account_api(&active.scope.deployment, &active.scope.account_id)?;
    let committed: Document =
        serde_json::from_slice(&active.handle.snapshot().await.map_err(issue)?)
            .map_err(|_| "Could not read the active device")?;
    if !super::super::may_capture(&committed, active) {
        return Err(issue(misty_browser_sync::Error::InactiveDevice));
    }
    // Workspace mode has no account-wide tenure: credentials are published bare.
    let epoch = if committed.workspace_mode {
        None
    } else {
        Some(
            committed
                .active_device
                .as_ref()
                .ok_or("Choose an active device first")?
                .epoch
                .clone(),
        )
    };
    let status = active.handle.status.borrow().clone();
    if !matches!(status.phase, Phase::CatchingUp | Phase::Ready)
        || status.applied_sequence < status.head_sequence
    {
        return Err(
            "Reconnect and receive the latest workspace before capturing website sign-ins.".into(),
        );
    }
    let logical = default_profile_id(&active.scope)?;
    let binding = active
        .handle
        .browser_profile_binding(logical.clone())
        .await
        .map_err(issue)?;
    if binding.staged.is_some() {
        return Err("Finish restoring the browser profile before capturing sign-ins.".into());
    }
    // Only the personal vault inherits the pre-sync store; a Space starts in its own.
    let physical = binding
        .active
        .as_ref()
        .map(|v| v.physical_id.clone())
        .unwrap_or_else(|| {
            active.space_id.as_ref().map_or_else(
                super::super::super::browser_profile::legacy_profile_identity,
                |_| logical.clone(),
            )
        });
    let observer = super::super::capture::CaptureView::open(&app, &physical)?;
    let journal = active
        .handle
        .browser_import_journal(logical.clone())
        .await
        .map_err(issue)?;
    let previous = journal
        .applied
        .as_ref()
        .map(|receipt| receipt.credentials.as_slice())
        .unwrap_or(&[]);
    let pending = active.handle.pending_snapshot().await.map_err(issue)?;
    let document: Document =
        serde_json::from_slice(&pending.snapshot).map_err(|_| "Could not read the workspace")?;
    let origins = document
        .workspace_view()
        .map_err(issue)?
        .records
        .iter()
        .filter_map(|record| record.fields.get("url").and_then(serde_json::Value::as_str))
        .filter_map(|url| url::Url::parse(url).ok())
        .filter(|url| matches!(url.scheme(), "http" | "https"))
        .map(|url| url.origin().ascii_serialization())
        .collect();
    let collected = collect::collect(
        app,
        &observer.view,
        &physical,
        previous,
        Some((observer.view.clone(), origins)),
        super::super::super::website_data::budget::Limit::SingleEvent,
    )
    .await?;
    active.website_data.insert(
        active.device_id.clone(),
        device_data::DeviceWebsiteData::new(
            &active.device_id,
            device_data::DeviceDataState::Synced,
            collected.coverage.report(),
        ),
    );
    active.held = collected.held;
    let observations = collected.observations;
    if let Some(generation) = binding.active {
        let state = active
            .handle
            .observe_browser_profile(logical, generation.id, observations)
            .await
            .map_err(issue)?;
        if state == misty_browser_sync::store::BrowserCaptureState::NeedsImport {
            return Err(
                "Newer sign-in changes must be restored before publishing this browser's cookies."
                    .into(),
            );
        }
    } else {
        let pending = active.handle.pending_snapshot().await.map_err(issue)?;
        let document: Document = serde_json::from_slice(&pending.snapshot)
            .map_err(|_| "Could not read queued changes")?;
        if let Some(payload) = initial_storage_capture(&document, &logical, observations)? {
            // If another device seeds this area after our read, base=0 loses the
            // reducer comparison. Never silently rebase legacy refresh tokens.
            let bytes = Zeroizing::new(
                serde_json::to_vec(&match epoch {
                    Some(epoch) => payload.published(epoch),
                    None => payload,
                })
                .map_err(|_| "Could not encode the captured cookies")?,
            );
            active.handle.enqueue(bytes).await.map_err(issue)?;
        }
    }
    active
        .handle
        .invalidate_browser_readiness()
        .await
        .map_err(issue)?;
    let _ = crate::infra::space_windows::emit(
        &app,
        "misty:browser-sync-changed",
        &active.scope.vault_id,
    );
    Ok(())
}
