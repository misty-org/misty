//! Native-only cookie observations. The read lease spans the engine callback and
//! durable acceptance, so an account switch cannot publish into its successor.
use super::*;
use misty_browser_sync::{
    document::credentials::Area,
    store::{BrowserCaptureState, BrowserObservation},
};

pub(super) struct CaptureView {
    physical: String,
    pub(super) view: tauri::Webview,
}
impl Drop for CaptureView {
    fn drop(&mut self) {
        let _ = self.view.close();
    }
}
impl CaptureView {
    pub(super) fn open(app: &tauri::AppHandle, physical: &str) -> Result<Self, String> {
        let owner = app
            .get_window("main")
            .ok_or("The main browser workspace is unavailable")?;
        let builder = tauri::WebviewBuilder::new(
            format!("misty-browser-capture-{}", uuid::Uuid::new_v4()),
            tauri::WebviewUrl::External("about:blank".parse().map_err(|_| "Invalid capture URL")?),
        );
        #[cfg(target_os = "macos")]
        let builder = builder.data_store_identifier(
            super::super::browser_profile::data_store_identifier(Some(physical))?,
        );
        #[cfg(windows)]
        let builder = builder.data_directory(super::super::browser::browser_data_directory(
            app,
            Some(physical),
        )?);
        let view = owner
            .add_child(
                builder,
                tauri::LogicalPosition::new(-10000., -10000.),
                tauri::LogicalSize::new(1., 1.),
            )
            .map_err(|_| "Could not open the native cookie observer")?;
        let result = Self {
            physical: physical.into(),
            view,
        };
        result
            .view
            .hide()
            .map_err(|_| "Could not hide the native cookie observer")?;
        Ok(result)
    }
}

pub(super) fn spawn(app: tauri::AppHandle, expected: String) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(2));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            let _lifecycle = browser_lifecycle().write().await;
            let mut current = session().lock().await;
            let Some(active) = current.as_mut().filter(|active| active.id == expected) else {
                break;
            };
            if matches!(
                active.handle.status.borrow().phase,
                misty_browser_sync::worker::Phase::Stopped
                    | misty_browser_sync::worker::Phase::Attention
            ) {
                continue;
            }
            let result = reconcile(&app, active).await;
            let issue = match result {
                Ok(issue) => issue,
                Err(error) => {
                    let _ = active.handle.invalidate_browser_readiness().await;
                    Some(capture_issue(&error))
                }
            };
            if issue != active.credential_issue {
                active.credential_issue = issue;
                let _ = app.emit_to(
                    "main",
                    "misty:browser-sync-changed",
                    &active.scope.workspace_id,
                );
            }
        }
    })
}
// Only known, static diagnostics cross into the renderer. Platform errors and
// website storage/cookie values must never be included in status messages.
fn capture_issue(error: &str) -> &'static str {
    match error {
        "Website profile could not be verified" => "Website storage could not verify this browser profile. Retrying automatically.",
        "Website navigated during sync" | "Website changed origin during sync" => "A website navigated during capture. Retrying automatically.",
        "This website's storage could not be transferred" => "A website's storage could not be read. Retrying automatically.",
        "Website storage connection timed out" | "Website storage preparation timed out" => "Website storage preparation timed out. Retrying automatically.",
        "Unsupported website storage" | "Website storage exceeds the sync limit" => "A website's storage is unsupported or exceeds the sync limit. Existing data has been preserved.",
        "Could not capture this browser's cookie attributes without losing information." | "Native cookie observation failed" => "Website cookies could not be captured without losing their attributes. Existing data has been preserved.",
        _ => "Browser sign-in changes could not be captured. Existing data has been preserved.",
    }
}

async fn reconcile(
    app: &tauri::AppHandle,
    active: &mut Session,
) -> Result<Option<&'static str>, String> {
    if !handoff::supported() {
        return Ok(Some(
            "Website sign-in sync requires macOS 14 or newer, or Windows.",
        ));
    }
    let status = active.handle.status.borrow().clone();
    let connected = matches!(
        status.phase,
        misty_browser_sync::worker::Phase::Ready | misty_browser_sync::worker::Phase::CatchingUp
    ) && status.applied_sequence >= status.head_sequence
        && status.pending_changes == 0;
    let logical = default_profile_id(&active.scope)?;
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
    if binding.active.is_none()
        || binding.staged.is_some()
        || journal.pending.is_some()
        || journal.quarantined
    {
        if !connected {
            return Ok(None);
        }
        let document: Document =
            serde_json::from_slice(&active.handle.snapshot().await.map_err(issue)?)
                .map_err(|_| "Could not read the workspace")?;
        if document.records.is_empty() {
            return Ok(None);
        }
        if document
            .credentials
            .values()
            .any(|record| record.profile_id == logical)
        {
            handoff::restore_current(app, active).await?;
        } else {
            handoff::capture_current(app, active).await?;
        }
        return Ok(None);
    }
    let result = observe(app, active).await?;
    if result.is_some() && connected {
        handoff::restore_current(app, active).await?;
        return Ok(None);
    }
    Ok(result)
}

async fn observe(
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
    let observed = super::super::browser_cookie_store::read(&view.view, &generation.physical_id)
        .await
        .map_err(|_| "Native cookie observation failed")?;
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
    let mut observations = super::super::browser_website_storage::capture(
        app,
        &generation.physical_id,
        previous,
        None,
    )
    .await?;
    observations.push(BrowserObservation {
        area: Area::Cookies,
        payload: serde_json::to_value(observed).map_err(|_| "Could not encode native cookies")?,
    });
    let state = active
        .handle
        .observe_browser_profile(logical.clone(), generation.id, observations)
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
