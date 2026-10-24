//! One observation of this machine's store: read under the lease, then accepted durably.
use super::*;

pub(super) async fn observe(
    app: &tauri::AppHandle,
    active: &mut Session,
) -> Result<Option<&'static str>, String> {
    let logical = default_profile_id(&active.scope)?;
    let binding = active
        .handle
        .browser_profile_binding(logical.clone())
        .await
        .map_err(issue)?;
    let Some(generation) = binding.active else {
        return Ok(None);
    };
    if binding.staged.is_some() {
        return Ok(Some(
            "Browser sign-in state is waiting for native restoration.",
        ));
    }
    if active
        .capture_view
        .as_ref()
        .is_none_or(|view| view.physical != generation.physical_id)
    {
        active.capture_view = None;
        active.capture_view = Some(CaptureView::open(app, &generation.physical_id)?);
    }
    let view = active
        .capture_view
        .as_ref()
        .ok_or("Native cookie observer is unavailable")?;
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
    let collected = collect::collect(
        app,
        &view.view,
        &generation.physical_id,
        previous,
        None,
        Limit::SingleEvent,
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
    let state = active
        .handle
        .observe_browser_profile(logical.clone(), generation.id, collected.observations)
        .await
        .map_err(issue)?;
    match state {
        BrowserCaptureState::NeedsImport => Ok(Some(
            "Incoming website sign-in changes are waiting for native restoration.",
        )),
        BrowserCaptureState::Queued => Ok(None),
        BrowserCaptureState::Clean => {
            let snapshot = active.handle.snapshot().await.map_err(issue)?;
            let document: Document = serde_json::from_slice(&snapshot)
                .map_err(|_| "Could not read the native workspace")?;
            // This adapter cannot vouch for another profile or storage area.
            if document
                .credentials
                .values()
                .all(|record| record.profile_id == logical)
            {
                active
                    .handle
                    .imports_applied(document.sequence)
                    .await
                    .map_err(issue)?;
            }
            Ok(None)
        }
    }
}
