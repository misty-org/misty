//! Misty's maximize button as Windows sees it, so Snap Layouts opens under it.
//!
//! Windows anchors the Snap Layouts flyout to the spot where a window's hit
//! test answers `HTMAXBUTTON`. Misty draws its caption buttons in the page,
//! and the page's pointer input belongs to the engine's own windows, in
//! another process, so no window of Misty's ever answers for that spot. An
//! invisible window of Misty's own sits over the button and answers
//! `HTMAXBUTTON` there itself, and the main window answers the same for that
//! spot, for whichever one Windows asks. (Passing the hit test down with
//! `HTTRANSPARENT` does not work: it only reaches windows on the same thread,
//! and the engine's window beneath is not one, so the button went dead.)
//! The pointer over the button is then that window's non-client input:
//! hovering reaches the page as an event (for its hover look) and a click
//! reaches it as another, which maximizes or restores through the page's
//! usual path. Nothing else about the page changes.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Webview};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
    Graphics::Gdi::ScreenToClient,
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT},
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, GetParent, RegisterClassW, SetLayeredWindowAttributes,
            SetWindowPos, ShowWindow, HTMAXBUTTON, HWND_TOP, LWA_ALPHA, SWP_NOACTIVATE, SW_HIDE,
            SW_SHOWNA, WM_NCDESTROY, WM_NCHITTEST, WM_NCLBUTTONDBLCLK, WM_NCLBUTTONDOWN,
            WM_NCLBUTTONUP, WM_NCMOUSELEAVE, WM_NCMOUSEMOVE, WNDCLASSW, WS_CHILD, WS_EX_LAYERED,
            WS_EX_NOACTIVATE,
        },
    },
};

mod messages;
use messages::{on_main, on_target};

const MAIN_SUBCLASS: usize = 0x4D53_4E4D; // "MSNM"
const TARGET_CLASS: &str = "MistySnapTarget";

#[derive(Default)]
struct Target {
    label: String,
    /// The button, in the main window's client pixels; none while hidden.
    rect: Option<RECT>,
    target: isize,
    subclassed: bool,
    hovering: bool,
    pressed: bool,
}

/// Keyed by the main window's handle.
fn targets() -> &'static Mutex<HashMap<isize, Target>> {
    static TARGETS: OnceLock<Mutex<HashMap<isize, Target>>> = OnceLock::new();
    TARGETS.get_or_init(Default::default)
}

fn app_handle() -> &'static OnceLock<AppHandle> {
    static APP: OnceLock<AppHandle> = OnceLock::new();
    &APP
}

#[derive(Debug, Deserialize)]
pub struct MaximizeButtonRect {
    /// Physical pixels from the top-left of the window's client area.
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

/// Places (or, with `rect` absent, removes) the native maximize target for
/// the calling window's maximize button.
#[tauri::command]
pub fn window_set_maximize_button(
    app: AppHandle,
    webview: Webview,
    rect: Option<MaximizeButtonRect>,
) -> Result<(), String> {
    let window = webview.window();
    if !crate::infra::space_windows::is_space_window(window.label()) {
        return Ok(());
    }
    let _ = app_handle().set(app);
    let main = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
    let label = window.label().to_owned();
    let rect = rect
        .filter(|rect| rect.width > 0 && rect.height > 0)
        .map(|rect| RECT {
            left: rect.x,
            top: rect.y,
            right: rect.x + rect.width,
            bottom: rect.y + rect.height,
        });
    window
        .run_on_main_thread(move || place(main, label, rect))
        .map_err(|error| error.to_string())
}

/// On the window's thread: subclasses the main window once, creates the
/// target once, and fits the target over the button, above the renderer.
fn place(main: isize, label: String, rect: Option<RECT>) {
    let Ok(mut targets) = targets().lock() else {
        return;
    };
    let entry = targets.entry(main).or_default();
    entry.label = label;
    if !entry.subclassed {
        // SAFETY: a live window owned by this thread.
        unsafe { SetWindowSubclass(main as HWND, Some(on_main), MAIN_SUBCLASS, 0) };
        entry.subclassed = true;
    }
    if entry.target == 0 {
        entry.target = create_target(main as HWND).map_or(0, |target| target as isize);
    }
    entry.rect = rect;
    let target = entry.target as HWND;
    if target.is_null() {
        return;
    }
    // SAFETY: the target this module created.
    unsafe {
        match rect {
            Some(rect) => {
                SetWindowPos(
                    target,
                    HWND_TOP,
                    rect.left,
                    rect.top,
                    rect.right - rect.left,
                    rect.bottom - rect.top,
                    SWP_NOACTIVATE,
                );
                ShowWindow(target, SW_SHOWNA);
            }
            None => {
                ShowWindow(target, SW_HIDE);
            }
        }
    }
}

/// An almost invisible child window over the button. It must be hit-testable
/// (a fully transparent layered window is not), so it keeps an alpha of 1.
fn create_target(main: HWND) -> Option<HWND> {
    static REGISTERED: OnceLock<bool> = OnceLock::new();
    let class: Vec<u16> = TARGET_CLASS.encode_utf16().chain([0]).collect();
    // SAFETY: registering a plain class once; the name outlives the call.
    let registered = *REGISTERED.get_or_init(|| unsafe {
        let info = WNDCLASSW {
            lpfnWndProc: Some(on_target),
            hInstance: GetModuleHandleW(std::ptr::null()),
            lpszClassName: class.as_ptr(),
            ..std::mem::zeroed()
        };
        RegisterClassW(&info) != 0
    });
    if !registered {
        return None;
    }
    // SAFETY: a child of a live window, created on its thread.
    unsafe {
        let target = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_NOACTIVATE,
            class.as_ptr(),
            std::ptr::null(),
            WS_CHILD,
            0,
            0,
            0,
            0,
            main,
            std::ptr::null_mut(),
            GetModuleHandleW(std::ptr::null()),
            std::ptr::null(),
        );
        if target.is_null() {
            return None;
        }
        SetLayeredWindowAttributes(target, 0, 1, LWA_ALPHA);
        Some(target)
    }
}

/// Whether the screen point in `lparam` lies on `main`'s maximize button.
fn over_button(main: HWND, lparam: LPARAM) -> bool {
    let mut point = POINT {
        x: (lparam & 0xFFFF) as i16 as i32,
        y: ((lparam >> 16) & 0xFFFF) as i16 as i32,
    };
    // SAFETY: a live window and a plain in/out structure.
    unsafe { ScreenToClient(main, &mut point) };
    targets()
        .lock()
        .ok()
        .and_then(|targets| targets.get(&(main as isize)).and_then(|target| target.rect))
        .is_some_and(|rect| {
            point.x >= rect.left
                && point.x < rect.right
                && point.y >= rect.top
                && point.y < rect.bottom
        })
}

fn emit(main: HWND, event: &str, payload: bool) {
    let label = targets().lock().ok().and_then(|targets| {
        targets
            .get(&(main as isize))
            .map(|target| target.label.clone())
    });
    if let (Some(app), Some(label)) = (app_handle().get(), label) {
        let _ = app.emit_to(label, event, payload);
    }
}

fn set_flag(main: HWND, edit: impl FnOnce(&mut Target) -> bool) -> bool {
    targets()
        .lock()
        .ok()
        .and_then(|mut targets| targets.get_mut(&(main as isize)).map(edit))
        .unwrap_or(false)
}
