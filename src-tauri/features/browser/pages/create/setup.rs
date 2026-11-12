//! Recording a new page's request in its session, adopting a page that already exists,
//! and the debug-only ephemeral session for benchmark runs.
use super::*;

/// Stores what the request says about the page in its session.
pub(super) fn record_request(
    state: &BrowserSessionState,
    request: &BrowserWebviewCreateRequest,
    profile: &str,
) -> Result<(), String> {
    if let Some(session) = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable.")?
        .get_mut(&request.id)
    {
        session.workspace_tab_id = if request.preview_only {
            None
        } else {
            request.workspace_tab_id.clone()
        };
        session.origin_space_id = request.origin_space_id.clone();
        session.provider_id = request.provider_id.clone();
        session.private = request.private;
        session.agent_run_id = request.agent_run_id.clone();
        if request.store_id.is_some() {
            session.store_id = request.store_id.clone();
        }
        // Temporary pages keep no profile in what the renderer and agents observe.
        session.profile = (!request.private).then(|| profile.to_owned());
        if request.profile_provider_id.is_some() || request.provider_id.is_some() {
            session.profile_provider = request
                .profile_provider_id
                .clone()
                .or(request.provider_id.clone());
        }
    }
    Ok(())
}

/// A page whose webview already exists (a popup waiting for its tab, or the
/// same tab reopened) is moved into the window and brought up to date.
pub(super) fn adopt_existing(
    app: &AppHandle,
    state: &BrowserSessionState,
    window: &tauri::Window,
    webview: Webview,
    request: &BrowserWebviewCreateRequest,
    position: LogicalPosition<f64>,
    size: LogicalSize<f64>,
) -> Result<(), String> {
    if state
        .pending_popups
        .lock()
        .map_err(|_| "Browser popup state is unavailable.")?
        .remove(&request.id)
    {
        let staging = webview.window();
        webview
            .reparent(window)
            .map_err(|error| error.to_string())?;
        // The popup's view and opener survive; only its empty staging window closes.
        staging.destroy().map_err(|error| error.to_string())?;
        if let Ok(url) = webview.url() {
            let _ = app.emit_to(
                browser_owner_label(app, &request.id).as_str(),
                "misty://browser-page",
                BrowserPageEvent {
                    id: request.id.clone(),
                    url: url.to_string(),
                    phase: "finished",
                },
            );
        }
    }
    apply_macos_webview_theme(&webview, &request.theme)?;
    configure_browser_webview(&webview, request.native_live_resize)?;
    apply_shortcuts(&webview, state)?;
    apply_browser_pointer_tracking(&webview, renderer(webview.window().label()).tracking)?;
    set_webview_bounds_if_changed(app, &webview, position, size)?;
    present_macos_webview(&webview)
}

/// Debug builds only: with `MISTY_EVAL_EPHEMERAL_PAGES=1` every page opens in one temporary
/// session for this run of the app, so benchmarks browse the live web with no saved
/// sign-ins while the app itself stays signed in.
pub(super) fn eval_ephemeral_session() -> Option<String> {
    let enabled = cfg!(debug_assertions)
        && std::env::var("MISTY_EVAL_EPHEMERAL_PAGES").is_ok_and(|value| value == "1");
    enabled.then(|| format!("eval-ephemeral#{}", std::process::id()))
}
