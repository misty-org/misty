//! The frame of a browser page on Windows: rounded corners where the page
//! meets a rounded workspace corner, and the dim over a pane that lost focus.
//!
//! WebView2 draws a page in windows under a host window Misty owns. The
//! corners clip that host window with a region; the dim is a black layered
//! window laid over the page inside it, which the mouse passes through, so
//! the page keeps working and nothing is injected into it. A subclass of the
//! host window reapplies both whenever it is resized, whichever path resized
//! it, and lets go of them when the window is destroyed.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

use tauri::Webview;
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    Graphics::Gdi::{
        CombineRgn, CreateEllipticRgn, CreateRectRgn, DeleteObject, GetStockObject, SetWindowRgn,
        BLACK_BRUSH, HBRUSH, HRGN, RGN_DIFF,
    },
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        HiDpi::GetDpiForWindow,
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, GetClientRect, RegisterClassW,
            SetLayeredWindowAttributes, SetWindowPos, ShowWindow, HWND_TOP, LWA_ALPHA,
            SWP_NOACTIVATE, SW_HIDE, SW_SHOWNA, WM_NCDESTROY, WM_SIZE, WNDCLASSW, WS_CHILD,
            WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TRANSPARENT,
        },
    },
};

const SUBCLASS: usize = 0x4D50_4652; // "MPFR"
const OVERLAY_CLASS: &str = "MistyPaneDim";

#[derive(Default)]
struct Frame {
    /// Top-left, top-right, bottom-right, bottom-left, in logical pixels.
    radii: [f64; 4],
    dim: f64,
    /// The dim window, once a dim has been shown.
    overlay: Option<isize>,
}

fn frames() -> &'static Mutex<HashMap<isize, Frame>> {
    static FRAMES: OnceLock<Mutex<HashMap<isize, Frame>>> = OnceLock::new();
    FRAMES.get_or_init(Default::default)
}

/// Rounds the page's corners by `radii` (logical pixels; zero is square).
pub(super) fn set_corners(webview: &Webview, radii: [f64; 4]) -> Result<(), String> {
    let radii = radii.map(|radius| {
        if radius.is_finite() {
            radius.max(0.0)
        } else {
            0.0
        }
    });
    change(webview, move |frame| frame.radii = radii)
}

/// Lays a dim of `strength` (0 to 1) over the page; zero removes it.
pub(super) fn set_dim(webview: &Webview, strength: f64) -> Result<(), String> {
    change(webview, move |frame| frame.dim = strength.clamp(0.0, 1.0))
}

/// Records a change for the page's host window and applies its frame, on
/// the window's own thread.
fn change(webview: &Webview, edit: impl FnOnce(&mut Frame) + Send + 'static) -> Result<(), String> {
    webview
        .with_webview(move |platform| {
            let mut host = Default::default();
            // SAFETY: the controller is live for this UI-thread callback.
            if unsafe { platform.controller().ParentWindow(&mut host) }.is_err() {
                return;
            }
            let host = host.0 as HWND;
            if let Ok(mut frames) = frames().lock() {
                let fresh = !frames.contains_key(&(host as isize));
                edit(frames.entry(host as isize).or_default());
                if fresh {
                    // SAFETY: a live window owned by this thread.
                    unsafe { SetWindowSubclass(host, Some(on_message), SUBCLASS, 0) };
                }
            }
            apply(host);
        })
        .map_err(|error| error.to_string())
}

/// Clips `host` to its rounded corners and fits its dim over it.
fn apply(host: HWND) {
    let Ok(mut frames) = frames().lock() else {
        return;
    };
    let Some(frame) = frames.get_mut(&(host as isize)) else {
        return;
    };
    let mut client = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    // SAFETY: a live window and a plain out-structure.
    unsafe { GetClientRect(host, &mut client) };
    let (width, height) = (client.right, client.bottom);
    // SAFETY: as above.
    let scale = f64::from(unsafe { GetDpiForWindow(host) }.max(96)) / 96.0;
    let radii = frame.radii.map(|radius| (radius * scale).round() as i32);
    // SAFETY: the system owns the region once set; a null region removes it.
    unsafe {
        let region = rounded_region(width, height, radii);
        SetWindowRgn(host, region, 1);
    }
    if frame.dim <= 0.0 {
        if let Some(overlay) = frame.overlay {
            // SAFETY: the dim window this module created.
            unsafe { ShowWindow(overlay as HWND, SW_HIDE) };
        }
        return;
    }
    let overlay = match frame.overlay {
        Some(overlay) => overlay as HWND,
        None => match create_overlay(host) {
            Some(overlay) => {
                frame.overlay = Some(overlay as isize);
                overlay
            }
            None => return,
        },
    };
    let alpha = (frame.dim * 255.0).round() as u8;
    // SAFETY: the dim window this module created. It goes on top of the
    // page's own windows, which WebView2 may recreate.
    unsafe {
        SetLayeredWindowAttributes(overlay, 0, alpha, LWA_ALPHA);
        SetWindowPos(overlay, HWND_TOP, 0, 0, width, height, SWP_NOACTIVATE);
        ShowWindow(overlay, SW_SHOWNA);
    }
}

/// The client area minus whatever lies outside each rounded corner, or null
/// (no clipping) when every corner is square.
///
/// # Safety
/// Returns a region the caller must hand to the system or delete.
unsafe fn rounded_region(width: i32, height: i32, radii: [i32; 4]) -> HRGN {
    if radii.iter().all(|&radius| radius <= 0) || width <= 0 || height <= 0 {
        return std::ptr::null_mut();
    }
    let region = CreateRectRgn(0, 0, width, height);
    let [top_left, top_right, bottom_right, bottom_left] =
        radii.map(|radius| radius.clamp(0, width.min(height) / 2));
    for (radius, x, y) in [
        (top_left, 0, 0),
        (top_right, width - top_right, 0),
        (bottom_right, width - bottom_right, height - bottom_right),
        (bottom_left, 0, height - bottom_left),
    ] {
        if radius <= 0 {
            continue;
        }
        // The corner square, minus the circle the corner's arc belongs to.
        let corner = CreateRectRgn(x, y, x + radius, y + radius);
        let (cx, cy) = (
            if x == 0 { 0 } else { width - 2 * radius },
            if y == 0 { 0 } else { height - 2 * radius },
        );
        let circle = CreateEllipticRgn(cx, cy, cx + 2 * radius + 1, cy + 2 * radius + 1);
        CombineRgn(corner, corner, circle, RGN_DIFF);
        CombineRgn(region, region, corner, RGN_DIFF);
        DeleteObject(corner);
        DeleteObject(circle);
    }
    region
}

/// A black layered child window that takes no clicks or focus.
fn create_overlay(host: HWND) -> Option<HWND> {
    static REGISTERED: OnceLock<bool> = OnceLock::new();
    let class: Vec<u16> = OVERLAY_CLASS.encode_utf16().chain([0]).collect();
    // SAFETY: registering a plain class once; the name outlives the call.
    let registered = *REGISTERED.get_or_init(|| unsafe {
        let class_info = WNDCLASSW {
            lpfnWndProc: Some(DefWindowProcW),
            hInstance: GetModuleHandleW(std::ptr::null()),
            hbrBackground: GetStockObject(BLACK_BRUSH) as HBRUSH,
            lpszClassName: class.as_ptr(),
            ..std::mem::zeroed()
        };
        RegisterClassW(&class_info) != 0
    });
    if !registered {
        return None;
    }
    // SAFETY: a child of a live window, created on its thread.
    let overlay = unsafe {
        CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE,
            class.as_ptr(),
            std::ptr::null(),
            WS_CHILD,
            0,
            0,
            0,
            0,
            host,
            std::ptr::null_mut(),
            GetModuleHandleW(std::ptr::null()),
            std::ptr::null(),
        )
    };
    (!overlay.is_null()).then_some(overlay)
}

unsafe extern "system" fn on_message(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    let result = DefSubclassProc(window, message, wparam, lparam);
    match message {
        WM_SIZE => apply(window),
        WM_NCDESTROY => {
            let overlay = frames()
                .lock()
                .ok()
                .and_then(|mut frames| frames.remove(&(window as isize)))
                .and_then(|frame| frame.overlay);
            if let Some(overlay) = overlay {
                DestroyWindow(overlay as HWND);
            }
            RemoveWindowSubclass(window, Some(on_message), SUBCLASS);
        }
        _ => {}
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::{
        Foundation::POINT,
        Graphics::Gdi::PtInRegion,
        UI::WindowsAndMessaging::{WindowFromPoint, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE},
    };

    #[test]
    fn corners_cut_only_outside_their_arcs() {
        // SAFETY: regions created and deleted here.
        unsafe {
            assert!(rounded_region(200, 100, [0; 4]).is_null());
            let region = rounded_region(200, 100, [20, 0, 10, 0]);
            assert_eq!(PtInRegion(region, 0, 0), 0, "top-left corner is cut");
            assert_ne!(PtInRegion(region, 20, 20), 0, "inside the arc stays");
            assert_ne!(PtInRegion(region, 199, 0), 0, "a square corner stays");
            assert_eq!(PtInRegion(region, 199, 99), 0, "bottom-right corner is cut");
            assert_ne!(PtInRegion(region, 100, 50), 0);
            DeleteObject(region);
        }
    }

    #[test]
    fn the_dim_lets_clicks_through_to_the_page() {
        let class: Vec<u16> = "STATIC".encode_utf16().chain([0]).collect();
        // SAFETY: windows created, used and destroyed on this thread.
        unsafe {
            // Topmost, so nothing else on the desktop lies over the point.
            let top = CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_NOACTIVATE,
                class.as_ptr(),
                std::ptr::null(),
                WS_POPUP | WS_VISIBLE,
                40,
                40,
                300,
                200,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            );
            // SS_NOTIFY: a static control otherwise lets clicks through itself.
            const SS_NOTIFY: u32 = 0x100;
            let page = CreateWindowExW(
                0,
                class.as_ptr(),
                std::ptr::null(),
                WS_CHILD | WS_VISIBLE | SS_NOTIFY,
                0,
                0,
                300,
                200,
                top,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            );
            let overlay = create_overlay(top).unwrap();
            SetLayeredWindowAttributes(overlay, 0, 128, LWA_ALPHA);
            SetWindowPos(overlay, HWND_TOP, 0, 0, 300, 200, SWP_NOACTIVATE);
            ShowWindow(overlay, SW_SHOWNA);
            let hit = WindowFromPoint(POINT { x: 140, y: 120 });
            DestroyWindow(top);
            assert_ne!(hit, overlay, "the dim must not take the click");
            assert_eq!(hit, page);
        }
    }
}
