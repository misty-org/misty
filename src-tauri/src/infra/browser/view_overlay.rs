//! Telling the pages when the renderer draws over them, and what the companion shows.
use super::*;

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
