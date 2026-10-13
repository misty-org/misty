//! Moving a page's view between windows: fill its host, then hand it back.
#[cfg(target_os = "macos")]
use super::macos::{misty_agent_dock_fill, misty_agent_dock_page_returned};

/// Sizes a reparented page to its host window, leaving `top` points for a bar.
pub(in crate::infra) fn fill_host(webview: &tauri::Webview, top: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return webview
        .with_webview(move |platform| unsafe { misty_agent_dock_fill(platform.inner(), top) })
        .map_err(|e| e.to_string());
    #[cfg(windows)]
    {
        // WebView2 does not follow its parent's size; place the page under the
        // bar now and again whenever the host window resizes.
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
                        position: tauri::LogicalPosition::new(0.0, top).into(),
                        size: tauri::LogicalSize::new(size.width, (size.height - top).max(0.0))
                            .into(),
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
        let _ = (webview, top);
        Ok(())
    }
}

/// The page is back in the person's window: WebKit may judge its visibility again.
pub(in crate::infra) fn page_returned(webview: &tauri::Webview) {
    #[cfg(target_os = "macos")]
    let _ = webview
        .with_webview(|platform| unsafe { misty_agent_dock_page_returned(platform.inner()) });
    #[cfg(not(target_os = "macos"))]
    let _ = webview;
}
