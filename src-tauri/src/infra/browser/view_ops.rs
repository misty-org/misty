//! Per-page commands: bounds, navigation, zoom, overlay, companion and hide.

use super::*;

mod visibility;
pub use visibility::*;

#[tauri::command]
pub fn browser_webview_set_bounds(
    caller: Webview,
    app: AppHandle,
    request: BrowserWebviewBoundsRequest,
) -> Result<(), String> {
    let webview = app
        .get_webview(&webview_label(&request.id)?)
        .ok_or_else(|| "Browser tab is not running.".to_owned())?;
    if detached_from(&caller, &webview) {
        return Ok(());
    }
    let (position, size) = logical_bounds(request.x, request.y, request.width, request.height);
    configure_browser_webview(&webview, request.native_live_resize)?;
    set_webview_bounds_if_changed(&app, &webview, position, size)?;
    pane_dim::apply(&webview, &request.id)
}

#[tauri::command]
pub async fn browser_webview_preview_document(
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserWebviewIdRequest,
) -> Result<Value, String> {
    if tab_is_private(&state, &request.id) {
        return Err("Private tabs have no previews.".into());
    }
    let view = app
        .get_webview(&webview_label(&request.id)?)
        .ok_or("Browser page is unavailable.")?;
    #[cfg(target_os = "macos")]
    let size = view
        .size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(view.window().scale_factor().map_err(|e| e.to_string())?);
    #[cfg(target_os = "macos")]
    let image = super::super::browser_macos::capture_webview_region_sized(
        view.clone(),
        0.0,
        0.0,
        size.width,
        size.height,
        2560.0,
    )
    .await;
    #[cfg(windows)]
    let image = super::capture_windows::capture(view.clone()).await;
    #[cfg(not(any(target_os = "macos", windows)))]
    let image: Result<Value, String> = Err("Native preview images are unavailable.".into());
    let mut result = serde_json::json!({
        "url": view.url().map_or_else(|_| "".into(), |u| u.to_string()),
        "dataUrl": Value::Null,
        "width": Value::Null,
        "height": Value::Null,
        "document": Value::Null,
    });
    if let Ok(image) = image {
        result["dataUrl"] = image["dataUrl"].clone();
        result["width"] = image["width"].clone();
        result["height"] = image["height"].clone();
    } else {
        let source = include_str!("../../../../src/features/workspace/pageSnapshot.js")
            .replace("export function snapshotPage", "function snapshotPage");
        if let Ok(html_result) = evaluate_browser_async_javascript(view, format!("{source}\nif (document.readyState !== 'complete') throw new Error('Page is still loading'); return JSON.stringify({{ url: location.href, document: snapshotPage(document.documentElement) }});")).await {
            if let Ok(parsed) = serde_json::from_str::<Value>(&html_result) {
                result["document"] = parsed["document"].clone();
                if let Some(url) = parsed.get("url").and_then(Value::as_str) {
                    result["url"] = url.into();
                }
            }
        }
    }
    if result["document"].is_null() && result["dataUrl"].is_null() {
        return Err("Preview is unavailable.".into());
    }
    Ok(result)
}

/// `#rrggbb` as its channels.
#[cfg(windows)]
fn hex_color(value: &str) -> Option<[u8; 3]> {
    let hex = value.strip_prefix('#')?;
    if hex.len() != 6 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |start: usize| u8::from_str_radix(&hex[start..start + 2], 16).ok();
    Some([channel(0)?, channel(2)?, channel(4)?])
}

#[tauri::command]
pub fn browser_webview_reconcile(
    caller: Webview,
    app: AppHandle,
    request: BrowserWebviewBoundsRequest,
) -> Result<bool, String> {
    let Some(webview) = app.get_webview(&webview_label(&request.id)?) else {
        return Ok(false);
    };
    // Still running, in the agent's own window; never recreate it here.
    if detached_from(&caller, &webview) {
        return Ok(true);
    }
    let (position, size) = logical_bounds(request.x, request.y, request.width, request.height);
    configure_browser_webview(&webview, request.native_live_resize)?;
    // A tab loaded in the background drops beneath the renderer before it
    // moves into place, so it never shows over the tab on screen.
    #[cfg(windows)]
    if request.beneath && !is_held_view(&webview) {
        place_beneath(&webview)?;
    }
    set_webview_bounds_if_changed(&app, &webview, position, size)?;
    pane_dim::apply(&webview, &request.id)?;
    #[cfg(target_os = "macos")]
    round_macos_webview_corners(&webview, request.corner_radii.unwrap_or_default())?;
    #[cfg(windows)]
    page_frame_windows::set_corners(
        &webview,
        request.corner_radii.unwrap_or_default(),
        request.corner_color.as_deref().and_then(hex_color),
    )?;
    // Reconciliation owns geometry, visibility, and sibling order so a stale
    // frontend cache cannot leave the page detached from its Browser host. A
    // page placed beneath stays there until its tab shows it.
    if !request.beneath {
        present_macos_webview(&webview)?;
    }
    // A reloaded shell forgot the page's color; the page will not resend it.
    #[cfg(target_os = "macos")]
    host_messages::replay_page_background(&app, &request.id);
    Ok(true)
}

#[tauri::command]
pub fn browser_webview_navigate(
    app: AppHandle,
    request: BrowserNavigateRequest,
) -> Result<(), String> {
    let url = external_url(&request.url)?;
    let state = app.state::<BrowserSessionState>();
    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "Browser session is unavailable.")?;
        let session = sessions
            .get_mut(&request.id)
            .ok_or("Browser session is unavailable.")?;
        session.oauth_callback = request
            .oauth_callback
            .map(|callback| (callback, std::time::Instant::now()));
    }
    with_webview(&app, &request.id, |webview| {
        webview.navigate(url).map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn browser_webview_set_theme(
    caller: Webview,
    app: AppHandle,
    request: BrowserThemeRequest,
) -> Result<(), String> {
    let window = caller.window();
    let theme = browser_theme(&request.theme)?;
    // Windows has no Misty-controlled browser theme. Calling set_theme(None)
    // still forwards a theme reset to WebView2, which can repaint its native
    // scrollbar after the page has already rendered. Only apply an explicit
    // theme when this platform supplies one.
    if let Some(theme) = theme {
        window
            .set_theme(Some(theme))
            .map_err(|error| error.to_string())?;
    }
    for (label, webview) in app.webviews() {
        if label.starts_with("misty-browser-") && webview.window().label() == window.label() {
            // Update reused views as well as newly created ones. A transparent
            // document must not inherit Misty's dark toolbar canvas.
            // A page that already reported its color keeps it; resetting it to
            // the default canvas flashes white when the tab is shown again.
            #[cfg(any(target_os = "macos", windows))]
            let reported = label
                .strip_prefix("misty-browser-")
                .and_then(host_messages::reported_page_background);
            #[cfg(not(any(target_os = "macos", windows)))]
            let reported: Option<String> = None;
            #[cfg(any(target_os = "macos", windows))]
            if let Some(hex) = reported {
                host_messages::apply_page_background(&webview, hex);
            }
            webview
                .eval("document.getElementById('__misty_pane_dim__')?.remove();")
                .map_err(|error| error.to_string())?;
            apply_macos_webview_theme(&webview, &request.theme)?;
        }
    }
    Ok(())
}

/// The tab is in an extension popup, not the caller's window: the window it
/// came from must leave its geometry and visibility alone until it returns.
pub(super) fn detached_from(caller: &Webview, webview: &Webview) -> bool {
    super::super::extensions::popup::hosted_elsewhere(
        caller.window().label(),
        webview.window().label(),
    )
}

pub(super) fn with_webview(
    app: &AppHandle,
    id: &str,
    action: impl FnOnce(Webview) -> Result<(), String>,
) -> Result<(), String> {
    let webview = app
        .get_webview(&webview_label(id)?)
        .ok_or_else(|| "Browser tab is not running.".to_owned())?;
    action(webview)
}

#[tauri::command]
pub fn browser_webview_back(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    with_webview(&app, &request.id, |webview| {
        webview.eval("history.back()").map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn browser_webview_forward(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    with_webview(&app, &request.id, |webview| {
        webview.eval("history.forward()").map_err(|e| e.to_string())
    })
}

pub(crate) fn apply_page_zoom_policy(webview: &Webview, app: &AppHandle, id: &str) {
    let state = app.state::<BrowserSessionState>();
    let sessions = state.sessions.lock().ok();
    let session = sessions.as_ref().and_then(|sessions| sessions.get(id));
    let factor = super::super::site_settings::zoom::page_factor(
        webview,
        session.map(|s| (s.private, s.zoom_factor)),
    );
    let _ = webview.set_zoom(factor);
}

#[tauri::command]
pub fn browser_webview_set_zoom(app: AppHandle, request: BrowserZoomRequest) -> Result<(), String> {
    if !request.factor.is_finite() || !(0.25..=5.0).contains(&request.factor) {
        return Err("Page zoom must be between 25% and 500%.".into());
    }
    with_webview(&app, &request.id, |webview| {
        webview
            .set_zoom(request.factor)
            .map_err(|error| error.to_string())?;
        let state = app.state::<BrowserSessionState>();
        let Ok(mut sessions) = state.sessions.lock() else {
            return Err("Browser state is unavailable.".into());
        };
        let private = sessions.get_mut(&request.id).is_some_and(|session| {
            session.zoom_factor = Some(request.factor);
            session.private
        });
        super::super::site_settings::zoom::remember_unless_private(
            &webview,
            private,
            request.factor,
        );
        Ok(())
    })
}
