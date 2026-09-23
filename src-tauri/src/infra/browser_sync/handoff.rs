//! Explicit native handoff. The task owns the account/profile write lifetime
//! even when its renderer invocation is canceled during a profile switch.
use super::*;
use misty_browser_sync::{
    document::{credentials::Area, CredentialRecord},
    worker::Phase,
};

pub(super) fn supported() -> bool {
    #[cfg(target_os = "macos")]
    {
        objc2_foundation::NSProcessInfo::processInfo()
            .operatingSystemVersion()
            .majorVersion
            >= 14
    }
    #[cfg(windows)]
    {
        true
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        false
    }
}

fn cookie_target(document: &Document, logical: &str) -> Result<Vec<CredentialRecord>, String> {
    let target: Vec<_> = document
        .credentials
        .values()
        .filter(|v| v.profile_id == logical)
        .cloned()
        .collect();
    if target.is_empty() {
        return Err("This workspace has no captured website sign-ins to restore yet.".into());
    }
    if !target
        .iter()
        .any(|record| matches!(record.area, Area::Cookies))
    {
        return Err("This workspace has no captured website cookies yet.".into());
    }
    let cookies: Vec<misty_browser_sync::document::credentials::Cookie> = serde_json::from_value(
        target
            .iter()
            .find(|record| matches!(record.area, Area::Cookies))
            .ok_or("Missing cookies")?
            .payload
            .clone(),
    )
    .map_err(|_| "The received cookie data is invalid")?;
    if cookies.iter().any(|cookie| {
        cookie.partition_key.is_some() || (cfg!(target_os = "macos") && cookie.same_site.is_none())
    }) {
        return Err("The received cookies use attributes this device cannot restore yet.".into());
    }
    Ok(target)
}

#[tauri::command]
pub async fn browser_sync_capture_credentials(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    session_id: String,
) -> Result<SyncView, String> {
    require_main(&webview)?;
    #[cfg(any(target_os = "macos", windows))]
    {
        tokio::spawn(async move { capture(app, session_id).await })
            .await
            .map_err(|_| {
                "Browser capture was interrupted. Existing data has been preserved.".to_string()
            })?
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (app, session_id);
        Err("Website sign-in capture is not implemented on this device yet.".into())
    }
}

/// An unmapped legacy profile may seed credentials, but has no trusted base for
/// replacing them. Reading the pending projection makes a lost-response retry
/// idempotent before the server acknowledgment arrives.
#[cfg(test)]
fn initial_capture(
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
async fn capture(app: tauri::AppHandle, expected: String) -> Result<SyncView, String> {
    let _lifetime = browser_lifecycle().read().await;
    let mut current = session().lock().await;
    let active = current
        .as_mut()
        .ok_or("Unlock device sync before capturing website sign-ins.")?;
    require_session(active, &expected)?;
    capture_current(&app, active).await?;
    view(active).await
}

#[cfg(any(target_os = "macos", windows))]
pub(super) async fn capture_current(
    app: &tauri::AppHandle,
    active: &mut Session,
) -> Result<(), String> {
    account_api(&active.scope.deployment, &active.scope.account_id)?;
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
    let physical = binding
        .active
        .as_ref()
        .map(|v| v.physical_id.clone())
        .unwrap_or_else(super::super::browser_profile::legacy_profile_identity);
    let observer = capture::CaptureView::open(&app, &physical)?;
    let cookies = super::super::browser_cookie_store::read(&observer.view, &physical)
        .await
        .map_err(|_| {
            "Could not capture this browser's cookie attributes without losing information."
        })?;
    let payload =
        serde_json::to_value(cookies).map_err(|_| "Could not encode the captured cookies")?;
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
    let mut observations = super::super::browser_website_storage::capture(
        app,
        &physical,
        previous,
        Some((observer.view.clone(), origins)),
    )
    .await?;
    observations.push(misty_browser_sync::store::BrowserObservation {
        area: Area::Cookies,
        payload: payload.clone(),
    });
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
                serde_json::to_vec(&payload)
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
    let _ = app.emit_to(
        "main",
        "misty:browser-sync-changed",
        &active.scope.workspace_id,
    );
    Ok(())
}

#[tauri::command]
pub async fn browser_sync_restore_credentials(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    session_id: String,
) -> Result<SyncView, String> {
    require_main(&webview)?;
    #[cfg(any(target_os = "macos", windows))]
    {
        // Dropping JoinHandle detaches rather than cancelling its owned switch.
        tokio::spawn(async move { restore(app, session_id).await })
            .await
            .map_err(|_| {
                "Browser handoff was interrupted. Existing profiles have been preserved."
                    .to_string()
            })?
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (app, session_id);
        Err("Website sign-in restoration is not implemented on this device yet.".into())
    }
}

#[cfg(any(target_os = "macos", windows))]
async fn restore(app: tauri::AppHandle, expected: String) -> Result<SyncView, String> {
    let _lifetime = browser_lifecycle().write().await;
    let mut current = session().lock().await;
    let active = current
        .as_mut()
        .ok_or("Unlock device sync before restoring website sign-ins.")?;
    require_session(active, &expected)?;
    restore_current(&app, active).await?;
    view(active).await
}

#[cfg(any(target_os = "macos", windows))]
pub(super) async fn restore_current(
    app: &tauri::AppHandle,
    active: &mut Session,
) -> Result<(), String> {
    account_api(&active.scope.deployment, &active.scope.account_id)?;
    let status = active.handle.status.borrow().clone();
    if !matches!(status.phase, Phase::CatchingUp | Phase::Ready)
        || status.applied_sequence < status.head_sequence
    {
        return Err("Wait for the workspace to reconnect and receive its latest changes before restoring sign-ins.".into());
    }
    if status.pending_changes > 0 {
        return Err(
            "Wait for this device's changes to finish syncing before restoring sign-ins.".into(),
        );
    }
    let logical = default_profile_id(&active.scope)?;
    let document: Document =
        serde_json::from_slice(&active.handle.snapshot().await.map_err(issue)?)
            .map_err(|_| "Could not read the received workspace")?;
    cookie_target(&document, &logical)?;
    let binding = active
        .handle
        .browser_profile_binding(logical.clone())
        .await
        .map_err(issue)?;
    let journal = active
        .handle
        .browser_import_journal(logical.clone())
        .await
        .map_err(issue)?;
    if let Some(generation) = binding
        .active
        .as_ref()
        .filter(|_| binding.staged.is_none() && journal.pending.is_none() && !journal.quarantined)
    {
        let observer = capture::CaptureView::open(app, &generation.physical_id)?;
        let mut backend = super::super::browser_storage_restore::BrowserProfile::for_generation(
            observer.view.clone(),
            logical.clone(),
            generation.physical_id.clone(),
        );
        // Retain the existing engine store, including website databases. Close
        // pages before refreshing cookies so capture cannot echo the old tokens.
        super::super::agent_workspace::stop_account_tasks(app)?;
        active.capture_view = None;
        super::super::browser::close_account_views_except(app, Some(observer.view.label()))?;
        let result = misty_browser_sync::restore::refresh_active_profile(
            &active.handle,
            &logical,
            &mut backend,
        )
        .await;
        if result.is_ok() {
            *selected_profile()
                .lock()
                .map_err(|_| "Browser profile state is unavailable")? = Some(SelectedProfile {
                logical: logical.clone(),
                physical: generation.physical_id.clone(),
            });
        }
        let _ = app.emit_to("main", "misty:browser-profile-changed", &active.id);
        return result.map(|_| ()).map_err(|_| {
            "Could not refresh incoming website sign-ins. Reconnect to retry.".into()
        });
    }
    // Every retry gets a new isolated store. Late native callbacks from an
    // interrupted earlier attempt can never write into the replacement.
    let generation = uuid::Uuid::new_v4().to_string();
    let staged = active
        .handle
        .stage_browser_profile(logical.clone(), binding.revision, generation.clone())
        .await
        .map_err(issue)?;
    let physical = staged
        .staged
        .as_ref()
        .ok_or("The browser staging profile is unavailable")?
        .physical_id
        .clone();
    let mut closed_live_views = false;
    let result: Result<(), String> = async {
        let staging = capture::CaptureView::open(&app, &physical)?;
        let mut backend = super::super::browser_storage_restore::BrowserProfile::for_generation(staging.view.clone(), logical.clone(), physical.clone());
        misty_browser_sync::restore::restore_staged_profile(&active.handle, &logical, &generation, &mut backend).await
            .map_err(|_| "Could not restore and verify the received website sign-ins. The previous browser profile has been preserved.")?;
        // Stop actions before closing their browser contexts; preserve the task
        // tombstones so syncing/reopening never grants permission to rerun them.
        super::super::agent_workspace::stop_account_tasks(&app)?;
        active.capture_view = None;
        closed_live_views = true;
        super::super::browser::close_account_views_except(&app, Some(staging.view.label()))?;
        active.handle.activate_browser_profile(logical.clone(), staged.revision, generation).await.map_err(issue)?;
        // Verification and activation are separate CAS boundaries; confirm the
        // actual activated store against any changes that arrived meanwhile.
        misty_browser_sync::restore::verify_active_profile(&active.handle, &logical, &mut backend).await
            .map_err(|_| "Newer website sign-in changes arrived during restoration. Retry before continuing.")?;
        *selected_profile().lock().map_err(|_| "Browser profile state is unavailable")? = Some(SelectedProfile { logical: logical.clone(), physical });
        Ok(())
    }.await;
    if closed_live_views {
        // Reopen only after the write lease is released. The frontend discards
        // old view handles and reconstructs visible panes from its workspace.
        let _ = app.emit_to("main", "misty:browser-profile-changed", &active.id);
    }
    active.credential_issue = result.as_ref().err().map(|_| {
        "Website sign-in restoration needs attention. Previous profiles have been preserved."
    });
    let _ = app.emit_to(
        "main",
        "misty:browser-sync-changed",
        &active.scope.workspace_id,
    );
    result?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn initial_capture_deduplicates_pending_data_and_never_replaces_a_received_version() {
        let profile = "a".repeat(64);
        let mut document = Document::default();
        let payload = serde_json::json!([{
            "name": "session", "value": "synthetic", "domain": ".example.test", "path": "/",
            "host_only": false, "secure": true, "http_only": true, "same_site": "lax",
            "expires_unix_seconds": null, "partition_key": null,
        }]);
        let Some(Payload::Credentials { batch, .. }) =
            initial_capture(&document, &profile, payload.clone()).unwrap()
        else {
            panic!("missing initial capture");
        };
        assert_eq!(batch.updates[0].base_sequence, 0);
        let key = Area::Cookies.key(&profile).unwrap();
        document.credentials.insert(
            key.clone(),
            CredentialRecord {
                profile_id: profile.clone(),
                sequence: 10,
                area: Area::Cookies,
                payload: payload.clone(),
            },
        );
        let mut equivalent = payload.clone();
        equivalent[0]["domain"] = serde_json::json!("example.test");
        assert!(initial_capture(&document, &profile, equivalent)
            .unwrap()
            .is_none());
        // Native logout is not allowed to erase a received credential version.
        assert!(initial_capture(&document, &profile, serde_json::json!([])).is_err());
        // Neither may an old local token resurrect a remotely logged-out profile.
        document.credentials.get_mut(&key).unwrap().payload = serde_json::json!([]);
        assert!(initial_capture(&document, &profile, payload).is_err());
    }
    #[test]
    fn restore_requires_captured_supported_data_but_allows_explicit_logout() {
        let profile = "a".repeat(64);
        let mut document = Document::default();
        assert!(cookie_target(&document, &profile).is_err());
        let key = Area::Cookies.key(&profile).unwrap();
        document.credentials.insert(
            key.clone(),
            CredentialRecord {
                sequence: 1,
                profile_id: profile.clone(),
                area: Area::Cookies,
                payload: serde_json::json!([]),
            },
        );
        assert_eq!(cookie_target(&document, &profile).unwrap().len(), 1);
        document.credentials.get_mut(&key).unwrap().area = Area::LocalStorage {
            origin: "https://example.test".into(),
        };
        assert!(cookie_target(&document, &profile).is_err());
        assert!(cookie_target(&document, &"b".repeat(64)).is_err());
    }
}
