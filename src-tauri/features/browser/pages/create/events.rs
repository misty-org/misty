//! What a new page's webview does when it asks for a window and as it loads.
use super::*;

/// Answers a page's request for a new window: it opens in the page's own view.
pub(super) fn new_window(
    popup_app: &AppHandle,
    popup_id: &str,
    url: Url,
    features: tauri::webview::NewWindowFeatures,
) -> NewWindowResponse<tauri::Wry> {
    open_popup_in_place(popup_app, popup_id, &url, features)
}

/// Follows a page through a load: input locks, the agent ring, shortcuts and
/// the events the workspace shows.
pub(super) fn page_load(
    page_app: &AppHandle,
    page_id: &str,
    webview: Webview,
    payload: tauri::webview::PageLoadPayload<'_>,
) {
    let locked = page_app
        .state::<BrowserSessionState>()
        .sessions
        .lock()
        .ok()
        .and_then(|sessions| {
            sessions
                .get(page_id)
                .map(|session| session.agent_input_locked)
        })
        .unwrap_or(false);
    let _ = apply_agent_input_lock(&webview, locked);
    // An agent's page answers its cookie banner as it loads (browser_page/mod.rs).
    if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
        && page_app
            .state::<BrowserSessionState>()
            .sessions
            .lock()
            .ok()
            .and_then(|sessions| sessions.get(page_id).map(agent_controls_page))
            .unwrap_or(false)
    {
        crate::browser::agent_pages::page_agent::answer_consent_after_load(webview.clone());
    }
    #[cfg(not(target_os = "macos"))]
    if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
        let controlled = page_app
            .state::<BrowserSessionState>()
            .sessions
            .lock()
            .ok()
            .and_then(|sessions| sessions.get(page_id).map(agent_controls_page))
            .unwrap_or(false);
        if controlled {
            draw_agent_ring(&webview, true);
        }
    }
    let _ = apply_browser_pointer_tracking(&webview, renderer(webview.window().label()).tracking);
    if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
        if let Some(state) = page_app.try_state::<BrowserSessionState>() {
            if let Ok(mut sessions) = state.sessions.lock() {
                if let Some(session) = sessions.get_mut(page_id) {
                    session.snapshot_generation = session.snapshot_generation.wrapping_add(1);
                    session.element_targets.clear();
                }
            }
            let _ = apply_shortcuts(&webview, &state);
        }
        #[cfg(target_os = "macos")]
        crate::browser::kiri_link::host_messages::forget_page_background(page_id);
    }
    let phase = match payload.event() {
        tauri::webview::PageLoadEvent::Started => "started",
        tauri::webview::PageLoadEvent::Finished => "finished",
    };
    let _ = webview.eval(browser_status_update_script(
        &json!({ "loading": phase == "started" }),
    ));
    let generation = next_load_generation(page_id);
    if phase == "started" {
        watch_load(page_app, page_id, generation);
    }
    let _ = page_app.emit_to(
        browser_owner_label(page_app, page_id).as_str(),
        "misty://browser-page",
        BrowserPageEvent {
            id: page_id.to_owned(),
            url: payload.url().to_string(),
            phase,
        },
    );
    if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
        crate::browser::finish_first_paint_load(page_app, page_id);
        if let Some(state) = page_app.try_state::<BrowserSessionState>() {
            let _ = apply_shortcuts(&webview, &state);
        }
        let _ = webview.eval("window.__MISTY_REPORT_BACKGROUND__?.()");
        request_browser_favicon(&webview, page_app, page_id);
        request_browser_compatibility(&webview, page_app, page_id);
    }
}
