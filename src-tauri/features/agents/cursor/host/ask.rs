//! Tutor's text box: tap Control twice and a small box opens beside the pointer, for typing a
//! question instead of saying it. It takes the keyboard while open and hands it back to the app
//! that was in front when it closes. What's typed goes to the main window as a turn of Tutor's
//! spoken conversation (`misty://cursor-ask`), so the answer is spoken and captioned there.
use super::*;
use tauri::{WebviewUrl, WebviewWindowBuilder};

pub(super) const ASK_LABEL: &str = "misty-tutor-ask";
const WIDTH: f64 = 440.0;
const HEIGHT: f64 = 64.0;
/// How far from the pointer the box opens, so it doesn't sit under it.
const OFFSET: f64 = 18.0;
const MOST_CHARACTERS: usize = 4_000;

#[cfg(target_os = "macos")]
thread_local! {
    /// The app in front when the box opened (main thread only).
    static BEFORE: std::cell::RefCell<Option<objc2::rc::Retained<objc2_app_kit::NSRunningApplication>>> =
        const { std::cell::RefCell::new(None) };
}
#[cfg(windows)]
static BEFORE: Mutex<isize> = Mutex::new(0);

/// Opens the box beside the pointer (on the main thread).
pub(super) fn open(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(message) = show(&handle) {
            eprintln!("[companion] text box: {message}");
        }
    });
}

fn show(app: &AppHandle) -> Result<(), String> {
    remember_front();
    let window = match app.get_webview_window(ASK_LABEL) {
        Some(window) => window,
        None => WebviewWindowBuilder::new(app, ASK_LABEL, WebviewUrl::App("companion.html#ask".into()))
            .title("Ask Misty")
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .inner_size(WIDTH, HEIGHT)
            .build()
            .map_err(|e| e.to_string())?,
    };
    if let Some((x, y)) = platform::cursor() {
        // macOS reports the pointer in points, Windows in pixels.
        #[cfg(target_os = "macos")]
        let _ = window.set_position(tauri::LogicalPosition::new(x + OFFSET, y + OFFSET));
        #[cfg(not(target_os = "macos"))]
        let _ = window.set_position(tauri::PhysicalPosition::new(
            (x + OFFSET) as i32,
            (y + OFFSET) as i32,
        ));
    }
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    let _ = window.emit("misty://tutor-ask-open", ());
    Ok(())
}

/// Closes the text box. With words, they go to Tutor as a typed question; empty, it only closes.
#[tauri::command]
pub fn cursor_companion_ask_close(
    webview: Webview,
    app: AppHandle,
    text: String,
) -> Result<(), String> {
    if webview.label() != ASK_LABEL {
        return Err("Only Tutor's text box can send to it.".into());
    }
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window(ASK_LABEL) {
            let _ = window.hide();
        }
        restore_front();
    });
    let text: String = text.trim().chars().take(MOST_CHARACTERS).collect();
    let state = host_state(&app);
    if text.is_empty() || !state.enabled.load(Ordering::SeqCst) {
        return Ok(());
    }
    // A typed question is a turn of its own: nothing drawn for an earlier one goes with it.
    state.trail.lock().unwrap().clear();
    let turn = state.turn.fetch_add(1, Ordering::SeqCst) + 1;
    let _ = crate::browser::app_windows::emit_to_primary(
        &app,
        "misty://cursor-ask",
        json!({"turn": turn, "text": text}),
    );
    Ok(())
}

#[cfg(target_os = "macos")]
fn remember_front() {
    let front = objc2_app_kit::NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .filter(|app| app.processIdentifier() != std::process::id() as i32);
    BEFORE.with(|before| *before.borrow_mut() = front);
}

#[cfg(target_os = "macos")]
fn restore_front() {
    BEFORE.with(|before| {
        if let Some(app) = before.borrow_mut().take() {
            app.activateWithOptions(objc2_app_kit::NSApplicationActivationOptions::empty());
        }
    });
}

#[cfg(windows)]
fn remember_front() {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    *BEFORE.lock().unwrap() = unsafe { GetForegroundWindow() } as isize;
}

#[cfg(windows)]
fn restore_front() {
    use windows_sys::Win32::UI::WindowsAndMessaging::SetForegroundWindow;
    let hwnd = std::mem::take(&mut *BEFORE.lock().unwrap());
    if hwnd != 0 {
        unsafe { SetForegroundWindow(hwnd as _) };
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn remember_front() {}

#[cfg(not(any(target_os = "macos", windows)))]
fn restore_front() {}
