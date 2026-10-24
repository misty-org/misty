//! The overlay windows, one per display, rebuilt when the displays change.

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::{host_state, on_main, platform, Display, OVERLAYS_WANTED, PREFIX};

pub(super) fn displays() -> Result<Vec<Display>, String> {
    xcap::Monitor::all()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|m| {
            Ok(Display {
                id: m.id().map_err(|e| e.to_string())?,
                x: m.x().map_err(|e| e.to_string())? as f64,
                y: m.y().map_err(|e| e.to_string())? as f64,
                width: m.width().map_err(|e| e.to_string())? as f64,
                height: m.height().map_err(|e| e.to_string())? as f64,
                scale: m.scale_factor().map_err(|e| e.to_string())? as f64,
            })
        })
        .collect()
}
pub(super) async fn rebuild(app: &AppHandle) -> Result<(), String> {
    if !host_state(app).enabled.load(Ordering::SeqCst) {
        return Ok(());
    }
    // Enumerating monitors makes GDI calls per display (on Windows each
    // property query opens a device context). Never do that on the UI thread:
    // this runs every two seconds and on every reload or sign-out.
    let frames = tauri::async_runtime::spawn_blocking(displays)
        .await
        .map_err(|e| e.to_string())??;
    // Reloads, sign-out and the topology poll can overlap; build one set at a time.
    static REBUILD: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _serialized = REBUILD.lock().await;
    let state = host_state(app);
    if !state.enabled.load(Ordering::SeqCst) || !OVERLAYS_WANTED.load(Ordering::SeqCst) {
        return Ok(());
    }
    let old = state
        .data
        .lock()
        .map_err(|_| "Companion unavailable")?
        .displays
        .clone();
    if old == frames
        && frames.iter().all(|d| {
            app.get_webview_window(&format!("{PREFIX}{}", d.id))
                .is_some()
        })
    {
        return Ok(());
    }
    // Create the webviews here, off the UI thread. WebView2 creation needs the
    // UI thread's message loop to run; building from inside a task on that
    // thread waits on itself and freezes the app on Windows. The build call
    // hands the work to the UI thread and waits for it from a worker instead.
    for (label, window) in app.webview_windows() {
        if label.starts_with(PREFIX) && label != "misty-cursor-controls" {
            let _ = window.destroy();
        }
    }
    for d in &frames {
        WebviewWindowBuilder::new(
            app,
            format!("{PREFIX}{}", d.id),
            WebviewUrl::App("companion.html".into()),
        )
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .title("Misty cursor")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .visible(false)
        .focused(false)
        .focusable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;
    }
    on_main(app, move |app| {
        let state = host_state(&app);
        for d in &frames {
            let Some(window) = app.get_webview_window(&format!("{PREFIX}{}", d.id)) else {
                continue;
            };
            #[cfg(target_os = "macos")]
            platform::position_overlay(&window, d)?;
            #[cfg(windows)]
            {
                window
                    .set_position(tauri::PhysicalPosition::new(d.x as i32, d.y as i32))
                    .map_err(|e| e.to_string())?;
                window
                    .set_size(tauri::PhysicalSize::new(d.width as u32, d.height as u32))
                    .map_err(|e| e.to_string())?;
            }
            platform::configure_overlay(&window)?;
            if state.data.lock().unwrap().presentation["visible"]
                .as_bool()
                .unwrap_or(true)
                && !state.capture.load(Ordering::SeqCst)
            {
                platform::show_overlay(&window);
            }
        }
        state
            .data
            .lock()
            .map_err(|_| "Companion unavailable")?
            .displays = frames;
        let _ = crate::infra::space_windows::emit_to_primary(
            &app,
            "misty://cursor-displays-changed",
            (),
        );
        Ok(())
    })
    .await
}
