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
        session.workspace_tab_id = request.workspace_tab_id.clone();
        session.origin_space_id = request.origin_space_id.clone();
        session.private = request.private;
        session.agent_run_id = request.agent_run_id.clone();
        if request.store_id.is_some() {
            session.store_id = request.store_id.clone();
        }
        // Temporary pages keep no profile in what the renderer and agents observe.
        session.profile = (!request.private).then(|| profile.to_owned());
    }
    Ok(())
}

/// A page whose webview already exists (the same tab reopened) is brought up to date.
pub(super) fn adopt_existing(
    app: &AppHandle,
    state: &BrowserSessionState,
    webview: Webview,
    request: &BrowserWebviewCreateRequest,
    position: LogicalPosition<f64>,
    size: LogicalSize<f64>,
) -> Result<(), String> {
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
