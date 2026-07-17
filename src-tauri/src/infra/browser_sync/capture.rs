//! Native-only cookie observations. The read lease spans the engine callback and
//! durable acceptance, so an account switch cannot publish into its successor.
use super::super::browser_data_budget::Limit;
use super::*;
use misty_browser_sync::store::BrowserCaptureState;

pub(super) struct CaptureView {
    pub(super) physical: String,
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
        )
        .focused(false);
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
        let mut retry = CaptureRetry::default();
        loop {
            tick.tick().await;
            if !retry.ready(std::time::Instant::now()) {
                continue;
            }
            // The read side keeps the account from changing under the pass
            // while pages still open; only loading or switching the store
            // (which closes pages) takes the write side.
            let lifecycle = browser_lifecycle().read().await;
            let pass = {
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
                // Workspaces keep sign-in data per device; legacy workspaces
                // keep one set for the whole workspace.
                if workspaces::workspace_mode(&active.handle.workspaces.borrow()) {
                    device_signin::prepare(&app, active).await
                } else {
                    Ok(device_signin::Pass::Exclusive)
                }
            };
            let result = match pass {
                Ok(device_signin::Pass::Done(issue)) => Ok(issue),
                Err(error) => Err(error),
                Ok(device_signin::Pass::Capture(plan)) => {
                    // Website storage is read with the session unlocked.
                    let collected = plan.collect(&app).await;
                    let mut current = session().lock().await;
                    let Some(active) = current.as_mut().filter(|active| active.id == expected)
                    else {
                        break;
                    };
                    let result = device_signin::finish(active, plan, collected).await;
                    report(&app, active, &mut retry, result).await;
                    continue;
                }
                Ok(device_signin::Pass::Exclusive) => {
                    drop(lifecycle);
                    let _lifecycle = browser_lifecycle().write().await;
                    let mut current = session().lock().await;
                    let Some(active) = current.as_mut().filter(|active| active.id == expected)
                    else {
                        break;
                    };
                    let result = if workspaces::workspace_mode(&active.handle.workspaces.borrow()) {
                        device_signin::reconcile(&app, active).await
                    } else {
                        reconcile(&app, active).await
                    };
                    report(&app, active, &mut retry, result).await;
                    continue;
                }
            };
            let mut current = session().lock().await;
            let Some(active) = current.as_mut().filter(|active| active.id == expected) else {
                break;
            };
            report(&app, active, &mut retry, result).await;
        }
    })
}

/// Records a pass's outcome and tells the renderer when its issue changed.
async fn report(
    app: &tauri::AppHandle,
    active: &mut Session,
    retry: &mut CaptureRetry,
    result: Result<Option<&'static str>, String>,
) {
    retry.finished(result.is_ok(), std::time::Instant::now());
    let issue = match result {
        Ok(issue) => issue.map(Cow::Borrowed),
        Err(error) => {
            let _ = active.handle.invalidate_browser_readiness().await;
            if retry.failures < SURFACE_AFTER_FAILURES {
                return;
            }
            Some(capture_issue(error))
        }
    };
    if issue != active.credential_issue {
        active.credential_issue = issue;
        let _ = app.emit_to(
            "main",
            "misty:browser-sync-changed",
            &active.scope.vault_id,
        );
    }
}

/// One failed pass is routine (a page navigating, the engine busy) and the next
/// retry usually succeeds, so only failures that persist reach the renderer.
const SURFACE_AFTER_FAILURES: u32 = 3;

// Recovery runs quietly at a bounded rate. It cannot replace open pages.
#[derive(Default)]
struct CaptureRetry {
    failures: u32,
    after: Option<std::time::Instant>,
}
impl CaptureRetry {
    fn ready(&self, now: std::time::Instant) -> bool {
        self.after.is_none_or(|after| now >= after)
    }
    fn finished(&mut self, success: bool, now: std::time::Instant) {
        if success {
            *self = Self::default();
        } else {
            let seconds = (30u64 << self.failures.min(4)).min(300);
            self.failures = self.failures.saturating_add(1);
            self.after = Some(now + std::time::Duration::from_secs(seconds));
        }
    }
}

#[cfg(test)]
mod retry_tests {
    use super::*;
    #[test]
    fn repeated_restore_failures_back_off_and_success_resets_capture() {
        let mut retry = CaptureRetry::default();
        let mut now = std::time::Instant::now();
        for seconds in [30, 60, 120, 240, 300, 300] {
            assert!(retry.ready(now));
            retry.finished(false, now);
            assert!(!retry.ready(now + std::time::Duration::from_millis(1)));
            now += std::time::Duration::from_secs(seconds);
            assert!(retry.ready(now));
        }
        retry.finished(true, now);
        assert!(retry.ready(now));
        retry.finished(false, now);
        assert!(retry.ready(now + std::time::Duration::from_secs(30)));
    }

    #[test]
    fn cookie_failures_name_the_step_that_failed() {
        let timeout = capture_issue(format!("{}: Timeout", collect::COOKIES_UNREADABLE));
        assert!(timeout.contains("timed out"));
        let profile = capture_issue(format!("{}: Profile", collect::COOKIES_UNREADABLE));
        assert!(profile.contains("browser profile"));
        let other = capture_issue(format!("{}: Unavailable", collect::COOKIES_UNREADABLE));
        assert!(other.starts_with("Website cookies could not be read"));
    }
}
// Only authored diagnostics cross into the renderer: every error on these
// paths is fixed text or a sanitized `issue()`. Platform errors and website
// storage/cookie values must never be included in status messages.
fn capture_issue(error: String) -> Cow<'static, str> {
    if let Some(kind) = error
        .strip_prefix(collect::COOKIES_UNREADABLE)
        .and_then(|rest| rest.strip_prefix(": "))
    {
        return Cow::Borrowed(match kind {
            "Timeout" => "Reading website cookies from this browser profile timed out. Retrying automatically; existing data has been preserved.",
            "Profile" => "The cookie reader did not open this device's browser profile. Retrying automatically; existing data has been preserved.",
            "Unsupported" => "This device's web engine cannot read website cookies. Update it to sync website sign-ins; existing data has been preserved.",
            "TooLarge" => "This browser profile has more cookies than sync can read at once. Existing data has been preserved.",
            "Invalid" => "The web engine returned cookies sync could not read. Retrying automatically; existing data has been preserved.",
            _ => "Website cookies could not be read from this browser profile. Retrying automatically; existing data has been preserved.",
        });
    }
    Cow::Borrowed(match error.as_str() {
        handoff::RESTORE_DEFERRED => handoff::RESTORE_DEFERRED,
        "Website profile could not be verified" => "Website storage could not verify this browser profile. Retrying automatically.",
        "Website navigated during sync" | "Website changed origin during sync" => "A website navigated during capture. Retrying automatically.",
        "This website's storage could not be transferred" => "A website's storage could not be read. Retrying automatically.",
        "Website storage connection timed out" | "Website storage preparation timed out" => "Website storage preparation timed out. Retrying automatically.",
        "Unsupported website storage" | "Website storage exceeds the sync limit" => "A website's storage is unsupported or exceeds the sync limit. Existing data has been preserved.",
        // Say what actually failed rather than a generic catch-all.
        _ => return Cow::Owned(error),
    })
}

async fn reconcile(
    app: &tauri::AppHandle,
    active: &mut Session,
) -> Result<Option<&'static str>, String> {
    if !super::full_sync_enabled(active) {
        active.capture_view = None;
        return Ok(None);
    }
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
    let document: Document =
        serde_json::from_slice(&active.handle.snapshot().await.map_err(issue)?)
            .map_err(|_| "Could not read the workspace")?;
    if !super::may_capture(&document, active) {
        active.capture_view = None;
        if !connected {
            return Ok(None);
        }
        let target: Vec<_> = document
            .credentials
            .values()
            .filter(|v| v.profile_id == logical)
            .collect();
        let imported = journal.applied.as_ref().is_some_and(|receipt| {
            receipt.credentials.len() == target.len()
                && target.iter().all(|record| {
                    receipt.credentials.iter().any(|old| {
                        old.area.key(&logical).ok() == record.area.key(&logical).ok()
                            && old.sequence == record.sequence
                    })
                })
        });
        if !target.is_empty()
            && (!imported
                || binding.active.is_none()
                || binding.staged.is_some()
                || journal.pending.is_some()
                || journal.quarantined)
        {
            handoff::restore_current(app, active, handoff::RestoreMode::Background).await?;
        } else {
            active
                .handle
                .imports_applied(document.sequence)
                .await
                .map_err(issue)?;
        }
        return Ok(None);
    }
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
            handoff::restore_current(app, active, handoff::RestoreMode::Background).await?;
        } else {
            handoff::capture_current(app, active).await?;
        }
        return Ok(None);
    }
    let result = observe(app, active).await?;
    if result.is_some() && connected {
        handoff::restore_current(app, active, handoff::RestoreMode::Background).await?;
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
