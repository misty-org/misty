use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Window, WindowEvent};

static QUIT_CONFIRMED: AtomicBool = AtomicBool::new(false);
const UNSAVED_BEFORE_QUIT: &str = "misty://unsaved-before-quit";

fn must_ask() -> bool {
    !QUIT_CONFIRMED.load(Ordering::SeqCst)
        && crate::browser::app_windows::workspace_recovery::unsaved_count() > 0
}

#[derive(Clone, serde::Serialize)]
struct UnsavedBeforeQuit {
    unsaved: usize,
    closing: bool,
}

fn ask(app: &AppHandle, closing: Option<&str>) {
    let unsaved = crate::browser::app_windows::workspace_recovery::unsaved_count();
    let payload = UnsavedBeforeQuit {
        unsaved,
        closing: closing.is_some(),
    };
    match closing {
        Some(label) => {
            let _ = app.emit_to(label, UNSAVED_BEFORE_QUIT, payload);
        }
        None => {
            let _ = crate::app::tray::show_main_window(app);
            crate::browser::app_windows::emit_to_primary(app, UNSAVED_BEFORE_QUIT, payload);
        }
    }
}

pub fn run_event(app: &AppHandle, event: RunEvent) {
    #[cfg(target_os = "macos")]
    if matches!(event, RunEvent::Reopen { .. }) {
        if let Err(error) = crate::app::tray::show_main_window(app) {
            eprintln!("Could not reopen Misty: {error}");
        }
    }
    if let RunEvent::ExitRequested { code, api, .. } = &event {
        if code.is_none() && !crate::app::tray::hidden() {
            api.prevent_exit();
        } else if must_ask() && crate::browser::app_windows::primary(app).is_some() {
            api.prevent_exit();
            ask(app, None);
        } else {
            crate::browser::app_windows::quitting();
        }
    }
    if matches!(event, RunEvent::Exit) {
        crate::agents::run_control::stop();
        crate::project::terminal::close_all();
        tauri::async_runtime::block_on(crate::engines::shutdown());
        crate::engine_config::shutdown();
        crate::spaces_drive::shutdown();
    }
}

pub fn window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if crate::browser::app_windows::is_person_window(window.label()) && must_ask() {
            api.prevent_close();
            ask(window.app_handle(), Some(window.label()));
        }
    }
}

#[tauri::command]
pub fn app_relaunch(webview: tauri::Webview, app: AppHandle) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only the main workspace can restart Misty".into());
    }
    app.restart()
}

#[tauri::command]
pub fn app_quit_confirmed(
    webview: tauri::Webview,
    app: AppHandle,
    closing: bool,
) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only the main workspace can confirm quitting".into());
    }
    if closing {
        return webview
            .window()
            .destroy()
            .map_err(|_| "Could not close the window".into());
    }
    QUIT_CONFIRMED.store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}
