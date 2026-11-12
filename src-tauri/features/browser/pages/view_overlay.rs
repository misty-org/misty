//! Telling the pages when the renderer draws over them, and what the companion shows.
use crate::browser::*;

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
        // Only the stacking changes: the renderer is already transparent, so
        // the page reads the same above or below it.
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
                // Stacked tabs stay beneath everything, overlay or not.
                if is_stacked(&webview) {
                    continue;
                }
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

/// Where the renderer's notices are: left, top, right and bottom in its points, so a notice
/// doesn't hold the page. On macOS the page sits beneath and clicks past a notice reach it; on
/// Windows the page stays on top with the notice's box cut out of it. Linux still holds the page.
#[tauri::command]
pub fn browser_webviews_set_notice_rects(
    caller: Webview,
    app: AppHandle,
    rects: Vec<[f64; 4]>,
    radius: f64,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        remember_main_macos_webview(&app, caller.window().label())?;
        let window = caller.window();
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        // Rounded inward: a pixel the notice only partly covers stays the page's, or what's
        // behind the page would show along the edge.
        let holes = rects
            .iter()
            .map(|[left, top, right, bottom]| {
                [
                    (left * scale).ceil() as i32,
                    (top * scale).ceil() as i32,
                    (right * scale).floor() as i32,
                    (bottom * scale).floor() as i32,
                ]
            })
            .collect();
        crate::browser::pages::windows::page_frame::set_notice_holes(
            renderer(window.label()).native as isize,
            (radius * scale).round() as i32,
            holes,
        );
        let mut errors = Vec::new();
        for (label, webview) in app.webviews() {
            if label.starts_with("misty-browser-") && webview.window().label() == window.label() {
                if let Err(error) = crate::browser::pages::windows::page_frame::reapply(&webview) {
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
    #[cfg(target_os = "macos")]
    {
        let _ = (app, radius);
        caller
            .with_webview(move |platform_webview| unsafe {
                let view: &objc2_app_kit::NSView = &*platform_webview.inner().cast();
                crate::browser::pages::macos::pointer_guard::set_notice_rects(view, rects);
            })
            .map_err(|error| error.to_string())
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (caller, app, rects, radius);
        Ok(())
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
