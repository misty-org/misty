//! App quit and main-window close. Both wait while workspace saves exist only in
//! the renderer (they reached neither the recovery database nor its pending
//! slot): the main window retries them and asks before anything is lost.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Window, WindowEvent};

/// Set once the person chose to quit with unsaved changes.
static QUIT_CONFIRMED: AtomicBool = AtomicBool::new(false);
const UNSAVED_BEFORE_QUIT: &str = "misty://unsaved-before-quit";

fn must_ask() -> bool {
    !QUIT_CONFIRMED.load(Ordering::SeqCst) && crate::infra::workspace_recovery::unsaved_count() > 0
}

#[derive(Clone, serde::Serialize)]
struct UnsavedBeforeQuit {
    unsaved: usize,
    /// Only the main window is closing; the app keeps running.
    closing: bool,
}

/// Asks in the closing window, or when quitting in the last focused one.
fn ask(app: &AppHandle, closing: Option<&str>) {
    let unsaved = crate::infra::workspace_recovery::unsaved_count();
    let payload = UnsavedBeforeQuit {
        unsaved,
        closing: closing.is_some(),
    };
    match closing {
        Some(label) => {
            let _ = app.emit_to(label, UNSAVED_BEFORE_QUIT, payload);
        }
        None => {
            let _ = crate::infra::tray::show_main_window(app);
            crate::infra::space_windows::emit_to_primary(app, UNSAVED_BEFORE_QUIT, payload);
        }
    }
}

pub fn run_event(app: &AppHandle, event: RunEvent) {
    // Dock activation must work even if the frontend is still loading
    // or failed before it could report readiness.
    #[cfg(target_os = "macos")]
    if matches!(event, RunEvent::Reopen { .. }) {
        if let Err(error) = crate::infra::tray::show_main_window(app) {
            eprintln!("Could not reopen Misty: {error}");
        }
    }
    // Links other apps open with Misty go to the Space that claims their site; this
    // also covers the time no window is open to hear them.
    #[cfg(target_os = "macos")]
    if let RunEvent::Opened { urls } = &event {
        crate::infra::space_windows::route_app_links(
            app,
            urls.iter().map(|url| url.to_string()).collect(),
        );
    }
    if let RunEvent::ExitRequested { api, .. } = &event {
        if must_ask() && crate::infra::space_windows::primary(app).is_some() {
            api.prevent_exit();
            ask(app, None);
        } else {
            // The Spaces open now reopen at the next launch.
            crate::infra::space_windows::quitting();
        }
    }
    if matches!(event, RunEvent::Exit) {
        crate::infra::browser_sync::flush_before_exit();
        // Coding tools started for agents never outlive Misty.
        crate::agents::runners::registry::stop_all();
        crate::telemetry::shutdown();
    }
}

/// Closing the main window would take its unsaved changes with it.
pub fn window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if crate::infra::space_windows::is_person_window(window.label()) && must_ask() {
            api.prevent_close();
            ask(window.app_handle(), Some(window.label()));
        }
    }
}

/// Finishes the quit or close that was held: after the changes saved, or
/// because the person chose to go ahead without them.
#[tauri::command]
pub fn app_quit_confirmed(
    webview: tauri::Webview,
    app: AppHandle,
    closing: bool,
) -> Result<(), String> {
    if !crate::infra::space_windows::is_person_window(webview.label()) {
        return Err("Only the main workspace can confirm quitting".into());
    }
    if closing {
        // Destroying skips the close check; the app keeps running.
        return webview
            .window()
            .destroy()
            .map_err(|_| "Could not close the window".into());
    }
    QUIT_CONFIRMED.store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}
