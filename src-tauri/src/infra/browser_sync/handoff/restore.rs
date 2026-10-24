//! Restoring the account's handed-off sign-ins into this machine's store.
use super::*;

#[cfg(any(target_os = "macos", windows))]
#[derive(Clone, Copy, PartialEq, Eq)]
pub(in crate::infra::browser_sync) enum RestoreMode {
    Background,
    Explicit,
}

/// Names which restore step failed, in fixed text only.
#[cfg(any(target_os = "macos", windows))]
fn restore_issue(action: &str, error: misty_browser_sync::restore::RestoreError) -> String {
    use misty_browser_sync::restore::{EngineError, RestoreError};
    let cause = match error {
        RestoreError::Quarantined => {
            "an interrupted earlier restore must be recovered first".into()
        }
        RestoreError::Engine(EngineError::Unsupported) => {
            "this browser cannot store some of the received data".into()
        }
        RestoreError::Engine(EngineError::Unavailable) => {
            "the browser's website storage was unavailable".into()
        }
        RestoreError::Engine(EngineError::Invalid) => {
            "the browser did not read back what was written".into()
        }
        RestoreError::Engine(EngineError::Timeout) => "the browser took too long to respond".into(),
        RestoreError::Journal(error) => issue(error).trim_end_matches('.').to_owned(),
    };
    format!("{action}: {cause}. Retrying automatically.")
}

#[cfg(any(target_os = "macos", windows))]
pub(in crate::infra::browser_sync) const RESTORE_DEFERRED: &str =
    "Website sign-in sync is deferred while browser pages are open. Your local browsing is unchanged.";

#[cfg(any(target_os = "macos", windows))]
pub(super) fn check_restore_mode<'a>(
    mode: RestoreMode,
    labels: impl Iterator<Item = &'a str>,
) -> Result<(), String> {
    // Hidden capture/storage helpers are not user pages. Include all other
    // browser views, including popups and partially registered creations.
    if mode == RestoreMode::Background
        && labels.into_iter().any(|label| {
            label.starts_with("misty-browser-")
                && !label.starts_with("misty-browser-capture-")
                && !label.starts_with("misty-browser-storage-")
        })
    {
        return Err(RESTORE_DEFERRED.into());
    }
    Ok(())
}

#[cfg(any(target_os = "macos", windows))]
pub(in crate::infra::browser_sync) async fn restore_current(
    app: &tauri::AppHandle,
    active: &mut Session,
    mode: RestoreMode,
) -> Result<(), String> {
    // The caller holds the lifecycle write lease, so no page can be created
    // between this check and activation. Background recovery must never close
    // or reload a page, even if the incoming restore would succeed.
    let logical = default_profile_id(&active.scope)?;
    let labels = super::super::super::browser::profile_view_labels(app, &logical)?;
    check_restore_mode(mode, labels.iter().map(String::as_str))?;
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
        let observer = super::super::capture::CaptureView::open(app, &generation.physical_id)?;
        // This live store keeps local data that could not sync.
        let mut backend =
            super::super::super::website_data::storage_restore::BrowserProfile::for_generation(
                observer.view.clone(),
                logical.clone(),
                generation.physical_id.clone(),
            )
            .with_held(active.held.clone());
        // Retain the existing engine store, including website databases. Close
        // pages before refreshing cookies so capture cannot echo the old tokens.
        super::super::super::agents::workspace::stop_account_tasks(app)?;
        active.capture_view = None;
        super::super::super::browser::close_profile_views_except(
            app,
            &logical,
            Some(observer.view.label()),
        )?;
        let result = misty_browser_sync::restore::refresh_active_profile(
            &active.handle,
            &logical,
            &mut backend,
        )
        .await;
        if result.is_ok() {
            let physical = generation.physical_id.clone();
            set_selected_profile(
                &active.scope.vault_id,
                Some(SelectedProfile {
                    logical: logical.clone(),
                    physical,
                }),
            )?;
        }
        if mode == RestoreMode::Explicit {
            let _ = crate::infra::space_windows::emit(
                &app,
                "misty:browser-profile-changed",
                &active.id,
            );
        }
        return result
            .map(|_| ())
            .map_err(|error| restore_issue("Could not refresh incoming website sign-ins", error));
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
        let staging = super::super::capture::CaptureView::open(&app, &physical)?;
        let mut backend = super::super::super::website_data::storage_restore::BrowserProfile::for_generation(staging.view.clone(), logical.clone(), physical.clone());
        misty_browser_sync::restore::restore_staged_profile(&active.handle, &logical, &generation, &mut backend).await
            .map_err(|error| restore_issue("Could not restore the received website sign-ins; the previous browser profile has been preserved", error))?;
        // Stop actions before closing their browser contexts; preserve the task
        // tombstones so syncing/reopening never grants permission to rerun them.
        super::super::super::agents::workspace::stop_account_tasks(&app)?;
        active.capture_view = None;
        closed_live_views = true;
        super::super::super::browser::close_profile_views_except(&app, &logical, Some(staging.view.label()))?;
        active.handle.activate_browser_profile(logical.clone(), staged.revision, generation).await.map_err(issue)?;
        // Verification and activation are separate CAS boundaries; confirm the
        // actual activated store against any changes that arrived meanwhile.
        misty_browser_sync::restore::verify_active_profile(&active.handle, &logical, &mut backend).await
            .map_err(|_| "Newer website sign-in changes arrived during restoration. Retry before continuing.")?;
        set_selected_profile(&active.scope.vault_id, Some(SelectedProfile { logical: logical.clone(), physical }))?;
        Ok(())
    }.await;
    if closed_live_views && mode == RestoreMode::Explicit {
        // Reopen only after the write lease is released. The frontend discards
        // old view handles and reconstructs visible panes from its workspace.
        let _ =
            crate::infra::space_windows::emit(&app, "misty:browser-profile-changed", &active.id);
    }
    active.credential_issue = result.as_ref().err().map(|error| error.clone().into());
    note_issue(&active.scope.vault_id, active.credential_issue.clone());
    let _ = crate::infra::space_windows::emit(
        &app,
        "misty:browser-sync-changed",
        &active.scope.vault_id,
    );
    result?;
    Ok(())
}
