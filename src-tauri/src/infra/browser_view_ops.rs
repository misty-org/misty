//! Per-page commands: bounds, navigation, zoom, overlay, companion and hide.

use super::*;

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
    let image = super::super::browser_capture_windows::capture(view.clone()).await;
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
        let source = include_str!("../../../src/features/workspace/pageSnapshot.js")
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

#[tauri::command]
pub async fn browser_webview_capture_region(
    app: AppHandle,
    request: BrowserCaptureRegionRequest,
) -> Result<Value, String> {
    if !request.x.is_finite()
        || !request.y.is_finite()
        || !request.width.is_finite()
        || !request.height.is_finite()
        || request.x < 0.0
        || request.y < 0.0
        || request.width < 8.0
        || request.height < 8.0
        || request.width > 10_000.0
        || request.height > 10_000.0
    {
        return Err("Capture region is invalid.".to_owned());
    }
    let webview = app
        .get_webview(&webview_label(&request.id)?)
        .ok_or_else(|| "Browser page is unavailable.".to_owned())?;
    #[cfg(target_os = "macos")]
    {
        // Hide only Misty's overlay; WebKit captures the actual rendered page.
        evaluate_browser_async_javascript(webview.clone(), "const e = document.getElementById('misty-native-companion'); if (e) { e.dataset.mistyCaptureDisplay = e.style.display; e.style.display = 'none'; } return '';".into()).await?;
        let result = super::super::browser_macos::capture_webview_region(
            webview.clone(),
            request.x,
            request.y,
            request.width,
            request.height,
        )
        .await;
        let _ = evaluate_browser_async_javascript(webview, "const e = document.getElementById('misty-native-companion'); if (e) { e.style.display = e.dataset.mistyCaptureDisplay || ''; delete e.dataset.mistyCaptureDisplay; } return '';".into()).await;
        result
    }
    #[cfg(windows)]
    {
        super::super::browser_capture_windows::capture_region(
            webview,
            super::super::browser_capture_windows::Region {
                x: request.x,
                y: request.y,
                width: request.width,
                height: request.height,
            },
        )
        .await
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = webview;
        Err("Capture region is not available on this platform.".to_owned())
    }
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
    set_webview_bounds_if_changed(&app, &webview, position, size)?;
    pane_dim::apply(&webview, &request.id)?;
    #[cfg(target_os = "macos")]
    round_macos_webview_corners(&webview, request.corner_radii.unwrap_or_default())?;
    #[cfg(windows)]
    page_frame::set_corners(&webview, request.corner_radii.unwrap_or_default())?;
    // Reconciliation owns geometry, visibility, and sibling order so a stale
    // frontend cache cannot leave the page detached from its Browser host.
    present_macos_webview(&webview)?;
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
    window
        .set_theme(browser_theme(&request.theme)?)
        .map_err(|error| error.to_string())?;
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
            match reported {
                #[cfg(any(target_os = "macos", windows))]
                Some(hex) => host_messages::apply_page_background(&webview, hex),
                _ => webview
                    .set_background_color(Some(browser_background(&request.theme)))
                    .map_err(|error| error.to_string())?,
            }
            webview
                .eval("document.getElementById('__misty_pane_dim__')?.remove();")
                .map_err(|error| error.to_string())?;
            apply_macos_webview_theme(&webview, &request.theme)?;
        }
    }
    Ok(())
}

/// The tab is in an agent's dock host, not the caller's window: the window it
/// came from must leave its geometry and visibility alone until it returns.
pub(super) fn detached_from(caller: &Webview, webview: &Webview) -> bool {
    super::super::agent_dock::hosted_elsewhere(caller.window().label(), webview.window().label())
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
    let factor =
        super::super::browser_site_zoom::page_factor(webview, session.map(|s| (s.private, s.zoom_factor)));
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
        super::super::browser_site_zoom::remember_unless_private(&webview, private, request.factor);
        Ok(())
    })
}

#[tauri::command]
pub fn browser_webview_reload(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    with_webview(&app, &request.id, |webview| {
        reload_browser_webview(&webview)
    })
}

#[tauri::command]
pub fn browser_webview_show(
    caller: Webview,
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    super::super::extensions::native::tab_event(&app, &request.id, "activate");
    with_webview(&app, &request.id, |webview| {
        if detached_from(&caller, &webview) {
            return Ok(());
        }
        present_macos_webview(&webview)
    })
}

#[tauri::command]
pub fn browser_webviews_set_overlay_active(
    caller: Webview,
    app: AppHandle,
    active: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        remember_main_macos_webview(&app, caller.window().label())?;
        if let Ok(mut map) = renderers().lock() {
            map.entry(caller.window().label().to_owned())
                .or_default()
                .overlay = active;
        }
        let mut errors = Vec::new();
        for (label, webview) in app.webviews() {
            if label.starts_with("misty-browser-")
                && webview.window().label() == caller.window().label()
            {
                if let Err(error) = position_macos_webview(&webview, false) {
                    errors.push(error);
                }
            }
        }
        return if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        };
    }
    #[cfg(windows)]
    {
        remember_main_macos_webview(&app, caller.window().label())?;
        set_windows_renderer_transparency(&app, caller.window().label(), active)?;
        if let Ok(mut map) = renderers().lock() {
            map.entry(caller.window().label().to_owned())
                .or_default()
                .overlay = active;
        }
        let mut errors = Vec::new();
        for (label, webview) in app.webviews() {
            if label.starts_with("misty-browser-")
                && webview.window().label() == caller.window().label()
            {
                if let Err(error) = position_windows_webview(&webview, false, active) {
                    errors.push(error);
                }
            }
        }
        return if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        };
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        // WebKitGTK does not expose sibling z-order through Tauri. Park
        // external pages while renderer-owned popovers are open; the frontend
        // reconciles the active page when the overlay closes.
        if active {
            browser_webviews_hide_all(caller, app)
        } else {
            Ok(())
        }
    }
}

#[tauri::command]
pub fn browser_webviews_set_pointer_tracking(
    caller: Webview,
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    if let Ok(mut map) = renderers().lock() {
        map.entry(caller.window().label().to_owned())
            .or_default()
            .tracking = enabled;
    }
    let mut errors = Vec::new();
    for (label, webview) in app.webviews() {
        if label.starts_with("misty-browser-")
            && webview.window().label() == caller.window().label()
        {
            if let Err(error) = apply_browser_pointer_tracking(&webview, enabled) {
                errors.push(error);
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

/// Shows or hides the hovered-link and loading bubble in every browser page.
#[tauri::command]
pub fn browser_webviews_set_status_bubble(app: AppHandle, enabled: bool) -> Result<(), String> {
    set_status_bubble_enabled(enabled);
    let script = browser_status_update_script(&json!({ "enabled": enabled }));
    for (label, webview) in app.webviews() {
        if label.starts_with("misty-browser-") {
            let _ = webview.eval(&script);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn browser_webviews_set_companion(
    app: AppHandle,
    request: BrowserCompanionStateRequest,
) -> Result<(), String> {
    let mut errors = Vec::new();
    for (label, webview) in app.webviews() {
        if !label.starts_with("misty-browser-") {
            continue;
        }
        let runtime_id = label.trim_start_matches("misty-browser-");
        let mut state = serde_json::to_value(&request).map_err(|error| error.to_string())?;
        state["visible"] = Value::Bool(request.visible && runtime_id == request.target_id);
        let script = format!(
            "window.__MISTY_SET_COMPANION__?.({});",
            serde_json::to_string(&state).map_err(|error| error.to_string())?
        );
        if let Err(error) = webview.eval(&script) {
            errors.push(error.to_string());
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

#[tauri::command]
pub fn browser_webview_hide(
    caller: Webview,
    app: AppHandle,
    request: BrowserWebviewHideRequest,
) -> Result<(), String> {
    let Some(webview) = app.get_webview(&webview_label(&request.id)?) else {
        return Ok(());
    };
    // A hidden page stops painting; the agent's own window keeps it shown.
    if detached_from(&caller, &webview) {
        return Ok(());
    }
    // Switching tabs parks the page offscreen on Windows instead of hiding it.
    // WebView2 drops its render surface when hidden and paints its default
    // color until the first new frame, which flashes on the next switch back.
    #[cfg(windows)]
    park_windows_webview(&webview)?;
    #[cfg(not(windows))]
    {
        if request.keep_live {
            // A hidden view has no window for the system to return a floating video to. Out of
            // sight, but still in the window, it keeps one. Reconciling its bounds brings it back.
            webview
                .set_position(tauri::LogicalPosition::new(-32_000.0, -32_000.0))
                .map_err(|error| error.to_string())?;
        } else {
            webview.hide().map_err(|error| error.to_string())?;
        }
    }
    refresh_browser_cursor_ownership(&webview)
}
