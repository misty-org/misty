//! Extension popup windows. Chrome opens a `windows.create({ type: "popup" })`
//! request as a small window beside the browser; Misty gives that page a small
//! window of its own, reparenting the extension's tab into it. Misty's window
//! leaves the page's geometry and visibility alone while it is away (a hidden
//! page stops painting).
use super::super::space_windows;
use serde_json::json;
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Window};

const EVENT: &str = "misty://extension-popup";
/// Popup host windows: `misty-popup-<uuid>`.
pub const POPUP_PREFIX: &str = "misty-popup-";

/// Whether a browser webview sits in a popup host other than `caller`'s window.
/// The window it came from must not hide, move or resize it while it is away.
pub fn hosted_elsewhere(caller: &str, webview_window: &str) -> bool {
    webview_window.starts_with(POPUP_PREFIX) && webview_window != caller
}

fn browser_label(tab: &str) -> Result<String, String> {
    let valid = !tab.is_empty()
        && tab.len() <= 96
        && tab
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    valid
        .then(|| format!("misty-browser-{tab}"))
        .ok_or_else(|| "Browser tab identifier is invalid.".to_owned())
}

/// Sizes a reparented page to fill its host window.
fn fill_host(webview: &tauri::Webview) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return webview
        .with_webview(|platform| unsafe {
            use objc2_app_kit::{NSAutoresizingMaskOptions, NSView};
            let view: &NSView = &*platform.inner().cast();
            if let Some(parent) = view.superview() {
                view.setFrame(parent.bounds());
                view.setAutoresizingMask(
                    NSAutoresizingMaskOptions::ViewWidthSizable
                        | NSAutoresizingMaskOptions::ViewHeightSizable,
                );
                view.setHidden(false);
            }
        })
        .map_err(|e| e.to_string());
    #[cfg(windows)]
    {
        // WebView2 does not follow its parent's size; place the page now and
        // again whenever the host window resizes.
        let place = {
            let webview = webview.clone();
            move || -> Result<(), String> {
                let window = webview.window();
                let scale = window.scale_factor().map_err(|e| e.to_string())?;
                let size = window
                    .inner_size()
                    .map_err(|e| e.to_string())?
                    .to_logical::<f64>(scale);
                webview
                    .set_bounds(tauri::Rect {
                        position: tauri::LogicalPosition::new(0.0, 0.0).into(),
                        size: tauri::LogicalSize::new(size.width, size.height).into(),
                    })
                    .map_err(|e| e.to_string())
            }
        };
        place()?;
        webview.show().map_err(|e| e.to_string())?;
        webview.window().on_window_event(move |event| {
            if matches!(
                event,
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
            ) {
                let _ = place();
            }
        });
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = webview;
        Ok(())
    }
}

/// Open popup windows: host label to the tab's runtime id and the window it came from.
fn popups() -> &'static Mutex<HashMap<String, (String, String)>> {
    static POPUPS: OnceLock<Mutex<HashMap<String, (String, String)>>> = OnceLock::new();
    POPUPS.get_or_init(Default::default)
}

/// Moves an extension's tab, live, into a small window near Misty's top right.
#[tauri::command]
pub async fn extension_popup_open(
    window: Window,
    app: AppHandle,
    tab: String,
    title: String,
    width: f64,
    height: f64,
) -> Result<String, String> {
    if !space_windows::is_space_window(window.label()) {
        return Err("Only tabs in a Space window can open popups.".into());
    }
    let webview = app
        .get_webview(&browser_label(&tab)?)
        .ok_or("This tab is not ready yet.")?;
    if webview.window().label() != window.label() {
        return Err("This tab is already in its own window.".into());
    }
    let (width, height) = (width.clamp(240.0, 1000.0), height.clamp(200.0, 900.0));
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let origin = window
        .outer_position()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    let size = window
        .outer_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    let x = (origin.x + size.width - width - 60.0).max(origin.x);
    let label = format!("{POPUP_PREFIX}{}", uuid::Uuid::new_v4());
    let title: String = title.chars().take(200).collect();
    let host = WebviewWindowBuilder::new(
        &app,
        &label,
        // The page is the extension's; this one only holds the window open.
        WebviewUrl::External("about:blank".parse().map_err(|_| "about:blank")?),
    )
    .title(if title.is_empty() {
        "Extension".to_owned()
    } else {
        title
    })
    .inner_size(width, height)
    .min_inner_size(240.0, 200.0)
    .position(x, origin.y + 80.0)
    .parent(
        &app.get_webview_window(window.label())
            .ok_or("The Misty window is closed.")?,
    )
    .map_err(|e| e.to_string())?
    .build()
    .map_err(|e| e.to_string())?;
    popups()
        .lock()
        .map_err(|_| "extension_popup_unavailable")?
        .insert(label.clone(), (tab, window.label().to_owned()));
    // The popup belongs to its tab's Space: that Space's extension host owns the
    // page, and its events and new tabs stay in that Space.
    space_windows::adopt(&label, window.label());
    let closing = (app.clone(), label.clone());
    host.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = close(&closing.0, &closing.1);
        }
        tauri::WindowEvent::Destroyed => {
            if let Ok(mut popups) = popups().lock() {
                popups.remove(&closing.1);
            }
        }
        _ => {}
    });
    let target = app.get_window(&label).ok_or("The popup window closed.")?;
    if let Err(error) = webview.reparent(&target) {
        let _ = close(&app, &label);
        return Err(error.to_string());
    }
    fill_host(&webview)?;
    Ok(label)
}

/// Closes a popup window; its tab returns to Misty's window, which closes it.
#[tauri::command]
pub async fn extension_popup_close(
    window: Window,
    app: AppHandle,
    host: String,
) -> Result<(), String> {
    if !space_windows::is_space_window(window.label()) {
        return Err("Only a Space window can close extension popups.".into());
    }
    close(&app, &host)
}

fn close(app: &AppHandle, label: &str) -> Result<(), String> {
    let tab = popups()
        .lock()
        .map_err(|_| "extension_popup_unavailable")?
        .remove(label);
    let Some((tab, owner)) = tab else {
        return Ok(());
    };
    if let (Some(webview), Some(main)) = (
        app.get_webview(&browser_label(&tab)?),
        app.get_window(&owner),
    ) {
        if webview.window().label() == label {
            webview.reparent(&main).map_err(|e| e.to_string())?;
            let _ = webview.hide();
        }
    }
    if let Some(window) = app.get_window(label) {
        let _ = window.destroy();
    }
    let _ = app.emit_to(
        owner.as_str(),
        EVENT,
        json!({ "action": "closed", "id": label, "tab": tab }),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_person_s_window_leaves_popup_tabs_alone() {
        let label = format!("{POPUP_PREFIX}1");
        assert!(hosted_elsewhere("space-personal", &label));
        assert!(!hosted_elsewhere(&label, &label));
        assert!(!hosted_elsewhere("space-personal", "space-personal"));
    }
}
