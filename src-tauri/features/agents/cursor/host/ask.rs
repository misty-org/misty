//! Tutor's text box: tap Control twice and a small box opens beside the pointer, for typing a
//! question instead of saying it. It takes the keyboard while open and hands it back to the app
//! that was in front when it closes. What's typed goes to the main window as a turn of Tutor's
//! spoken conversation (`misty://cursor-ask`), so the answer is spoken and captioned there.
//!
//! While the box is open, the rest of the screen is for pictures, as Claude's own quick entry
//! does it: the cursor overlays take the pointer, a drag anywhere captures that part of the
//! screen (`cursor_companion_ask_shot`) and the picture goes with the question, and a click that
//! doesn't drag closes the box. The box sits above the overlays, so its own clicks stay its own.
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use permissions::Permission;
use tauri::{WebviewUrl, WebviewWindowBuilder};

pub(super) const ASK_LABEL: &str = "misty-tutor-ask";
const WIDTH: f64 = 640.0;
const HEIGHT: f64 = 64.0;
/// The most pictures one question takes.
const MOST_SHOTS: usize = 4;
/// A picture's longest side as it's sent, and the most one may weigh as a data URL.
const SHOT_SIDE: f64 = 1568.0;
const SHOT_BYTES: usize = 12_000_000;
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

/// How long the app noted as the pointer reached Misty stands for the one in front: long enough
/// for the click on her that opens the box.
#[cfg(target_os = "macos")]
const NOTED_FOR: Duration = Duration::from_secs(10);
#[cfg(target_os = "macos")]
thread_local! {
    /// The app in front as the pointer reached Misty (main thread only). A click on her may bring
    /// Misty forward before the box opens, so the box hands the keyboard back to this one.
    static NOTED: std::cell::RefCell<Option<(objc2::rc::Retained<objc2_app_kit::NSRunningApplication>, Instant)>> =
        const { std::cell::RefCell::new(None) };
}

/// Notes the app in front now, as the pointer reaches Misty, for a box a click on her opens.
pub(super) fn note_front(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.run_on_main_thread(|| {
        let front = objc2_app_kit::NSWorkspace::sharedWorkspace()
            .frontmostApplication()
            .filter(|app| app.processIdentifier() != std::process::id() as i32);
        if let Some(front) = front {
            NOTED.with(|noted| *noted.borrow_mut() = Some((front, Instant::now())));
        }
    });
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

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
        None => {
            WebviewWindowBuilder::new(app, ASK_LABEL, WebviewUrl::App("companion.html#ask".into()))
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
                .map_err(|e| e.to_string())?
        }
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
    // Over the cursor overlays (level 1000), which take the pointer while the box is open.
    #[cfg(target_os = "macos")]
    if let Ok(native) = window.ns_window() {
        // SAFETY: a live NSWindow of this app, on the main thread.
        unsafe { (*(native as *mut objc2_app_kit::NSWindow)).setLevel(1001) };
    }
    window.set_focus().map_err(|e| e.to_string())?;
    let _ = window.emit("misty://tutor-ask-open", ());
    capturing(app, true);
    Ok(())
}

/// While the box is open, the overlays are up over every display and take the pointer, so a
/// drag anywhere captures that part of the screen; once it closes they hand it back to the apps
/// underneath, and go again unless Tutor is showing something.
fn capturing(app: &AppHandle, on: bool) {
    host_state(app).asking.store(on, Ordering::SeqCst);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Nothing may have shown at the cursor yet, so its overlays may not be built.
        if on && !OVERLAYS_WANTED.swap(true, Ordering::SeqCst) {
            let _ = rebuild(&app).await;
        }
        let _ = on_main(&app, |app| {
            let state = host_state(&app);
            // The box may have closed (or opened) again meanwhile: what holds now is what counts.
            let on = state.asking.load(Ordering::SeqCst);
            let showing = state.data.lock().is_ok_and(|data| shown(&data.presentation));
            for (label, window) in app.webview_windows() {
                if !label.starts_with(PREFIX) || label == "misty-cursor-controls" {
                    continue;
                }
                if on {
                    platform::show_overlay(&window);
                } else if !showing {
                    let _ = window.hide();
                }
                let _ = platform::take_pointer(&window.as_ref().window(), on);
                let _ = window.emit("misty://tutor-ask-capture", json!({ "on": on }));
            }
            Ok(())
        })
        .await;
    });
}

/// Hides the box and hands the pointer and the keyboard back.
fn close(app: &AppHandle) {
    capturing(app, false);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window(ASK_LABEL) {
            let _ = window.hide();
        }
        restore_front();
    });
}

/// A click on the screen that didn't drag out a picture: the box closes, as clicking away does.
#[tauri::command]
pub fn cursor_companion_ask_dismiss(webview: Webview, app: AppHandle) -> Result<(), String> {
    require_overlay(&webview)?;
    close(&app);
    Ok(())
}

/// A picture of part of this overlay's display, dragged out while the box is open, for the box
/// to send with the question. The rectangle is in the display's own units (points on macOS).
#[tauri::command]
pub async fn cursor_companion_ask_shot(
    webview: Webview,
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    require_overlay(&webview)?;
    if !host_state(&app).asking.load(Ordering::SeqCst) {
        return Err("Tutor's text box isn't open.".into());
    }
    if ![x, y, width, height].iter().all(|value| value.is_finite()) || width < 8.0 || height < 8.0
    {
        return Err("Drag out a larger part of the screen.".into());
    }
    let display_id: u32 = webview
        .label()
        .strip_prefix(PREFIX)
        .and_then(|id| id.parse().ok())
        .ok_or("That display isn't known.")?;
    if !permissions::ensure_async(&app, Permission::ScreenCapture).await {
        return Err(super::capture::SCREEN_CAPTURE_OFF.into());
    }
    let shot = tauri::async_runtime::spawn_blocking(move || {
        platform::screen_access()?;
        let monitor = xcap::Monitor::all()
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|m| m.id().ok() == Some(display_id))
            .ok_or("Display disconnected")?;
        capture_region(&monitor, (x, y, width, height), SHOT_SIDE)
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = app.emit_to(
        ASK_LABEL,
        "misty://tutor-ask-shot",
        json!({
            "dataUrl": format!("data:image/jpeg;base64,{}", STANDARD.encode(&shot.bytes)),
            "width": shot.width,
            "height": shot.height,
        }),
    );
    // The keyboard is the box's again, for the question.
    if let Some(window) = app.get_webview_window(ASK_LABEL) {
        let _ = window.set_focus();
    }
    Ok(())
}

/// Closes the text box. With words, they go to Tutor as a typed question, with any pictures taken
/// while it was open; empty, it only closes.
#[tauri::command]
pub fn cursor_companion_ask_close(
    webview: Webview,
    app: AppHandle,
    text: String,
    images: Option<Vec<String>>,
) -> Result<(), String> {
    if webview.label() != ASK_LABEL {
        return Err("Only Tutor's text box can send to it.".into());
    }
    close(&app);
    let images: Vec<String> = images
        .unwrap_or_default()
        .into_iter()
        .filter(|image| image.starts_with("data:image/") && image.len() <= SHOT_BYTES)
        .take(MOST_SHOTS)
        .collect();
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
        json!({"turn": turn, "text": text, "images": images}),
    );
    Ok(())
}

#[cfg(target_os = "macos")]
fn remember_front() {
    let front = objc2_app_kit::NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .filter(|app| app.processIdentifier() != std::process::id() as i32)
        // Misty itself is in front after a click on her: the app noted a moment before stands.
        .or_else(|| {
            NOTED.with(|noted| {
                noted
                    .borrow_mut()
                    .take()
                    .filter(|(_, at)| at.elapsed() <= NOTED_FOR)
                    .map(|(app, _)| app)
            })
        });
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
