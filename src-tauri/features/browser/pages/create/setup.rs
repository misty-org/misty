use super::*;

pub(super) fn record_request(
    state: &BrowserSessionState,
    request: &BrowserWebviewCreateRequest,
    store_id: Option<String>,
    profile: &str,
) -> Result<(), String> {
    if let Some(session) = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable.")?
        .get_mut(&request.id)
    {
        session.origin_space_id = request.origin_space_id.clone();
        session.agent_run_id = request.agent_run_id.clone();
        if store_id.is_some() {
            session.store_id = store_id;
        }
        session.profile = Some(profile.to_owned());
    }
    Ok(())
}

pub(super) fn adopt_existing(
    app: &AppHandle,
    state: &BrowserSessionState,
    webview: Webview,
    request: &BrowserWebviewCreateRequest,
    position: LogicalPosition<f64>,
    size: LogicalSize<f64>,
) -> Result<(), String> {
    apply_macos_webview_theme(&webview)?;
    configure_browser_webview(&webview, request.native_live_resize)?;
    apply_shortcuts(&webview, state)?;
    apply_browser_pointer_tracking(&webview, renderer(webview.window().label()).tracking)?;
    set_webview_bounds_if_changed(app, &webview, position, size)?;
    present_macos_webview(&webview)
}
