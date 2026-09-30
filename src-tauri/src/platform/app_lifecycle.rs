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

fn ask(app: &AppHandle, closing: bool) {
    let _ = crate::infra::tray::show_main_window(app);
    let unsaved = crate::infra::workspace_recovery::unsaved_count();
    let _ = app.emit_to(
        "main",
        UNSAVED_BEFORE_QUIT,
        UnsavedBeforeQuit { unsaved, closing },
    );
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
    if let RunEvent::ExitRequested { api, .. } = &event {
        if must_ask() && app.get_webview_window("main").is_some() {
            api.prevent_exit();
            ask(app, false);
        }
    }
    if matches!(event, RunEvent::Exit) {
        #[cfg(desktop)]
        super::mini_app::shutdown(app);
        crate::telemetry::shutdown();
    }
}

/// Closing the main window would take its unsaved changes with it.
pub fn window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" && must_ask() {
            api.prevent_close();
            ask(window.app_handle(), true);
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
    if webview.label() != "main" {
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
