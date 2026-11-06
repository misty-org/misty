//! The frame of a browser page on Windows: rounded corners where the page
//! meets a rounded workspace corner, and the dim over a pane that lost focus.
//!
//! WebView2 draws a page in windows under a host window Misty owns. The
//! corners clip that host window with a region; the dim is a black layered
//! window laid over the page inside it, which the mouse passes through, so
//! the page keeps working and nothing is injected into it. A subclass of the
//! host window reapplies both whenever it is resized, whichever path resized
//! it, and lets go of them when the window is destroyed.
//!
//! A region keeps or cuts whole pixels, so on its own a curve comes out as a
//! staircase. The region therefore keeps every pixel the curve touches, and a
//! small layered window over each rounded corner paints the window chrome
//! over the part of those edge pixels that lies outside the curve, with
//! smooth alpha. Pixels wholly outside stay cut, so the renderer's own chrome
//! shows there and only the one-pixel fringe uses the reported color.
//!
//! The same region cuts out the renderer's notices. A window region stops the
//! mouse as well as drawing, so a notice shows and takes clicks in its own box
//! while the page around it stays on top and keeps working.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

use tauri::Webview;
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM},
    Graphics::Gdi::{
        CombineRgn, CreateCompatibleDC, CreateDIBSection, CreateRectRgn, DeleteDC, DeleteObject,
        GetStockObject, MapWindowPoints, SelectObject, SetWindowRgn, AC_SRC_ALPHA, AC_SRC_OVER,
        BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, BLACK_BRUSH, BLENDFUNCTION, DIB_RGB_COLORS, HBRUSH, HRGN,
        RGN_DIFF,
    },
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        HiDpi::GetDpiForWindow,
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, GetAncestor, GetClientRect,
            RegisterClassW, SetLayeredWindowAttributes, SetWindowPos, ShowWindow,
            UpdateLayeredWindow, GA_ROOT, HWND_TOP, LWA_ALPHA, SWP_NOACTIVATE, SW_HIDE, SW_SHOWNA,
            ULW_ALPHA, WM_MOVE, WM_NCDESTROY, WM_SIZE, WNDCLASSW, WS_CHILD, WS_EX_LAYERED,
            WS_EX_NOACTIVATE, WS_EX_TRANSPARENT,
        },
    },
};

mod corners;
use corners::*;

const SUBCLASS: usize = 0x4D50_4652; // "MPFR"
const OVERLAY_CLASS: &str = "MistyPaneDim";

#[derive(Default)]
struct Frame {
    /// Top-left, top-right, bottom-right, bottom-left, in logical pixels.
    radii: [f64; 4],
    dim: f64,
    /// The dim window, once a dim has been shown.
    overlay: Option<isize>,
    /// The chrome color around the page's rounded corners, when it is known.
    corner_color: Option<[u8; 3]>,
    /// Each corner's cap window and the radius and color it last painted.
    caps: [Option<(isize, i32, [u8; 3])>; 4],
}

fn frames() -> &'static Mutex<HashMap<isize, Frame>> {
    static FRAMES: OnceLock<Mutex<HashMap<isize, Frame>>> = OnceLock::new();
    FRAMES.get_or_init(Default::default)
}

/// One app window's notices: the renderer's host window, and the notices'
/// corner radius and boxes (left, top, right, bottom) in that host's pixels.
struct NoticeHoles {
    main: isize,
    radius: i32,
    boxes: Vec<[i32; 4]>,
}

/// Each app window's notices, by its top-level window. Pages read these when
/// they apply, so a new tab starts with its holes cut.
fn notice_holes() -> &'static Mutex<HashMap<isize, NoticeHoles>> {
    static HOLES: OnceLock<Mutex<HashMap<isize, NoticeHoles>>> = OnceLock::new();
    HOLES.get_or_init(Default::default)
}

/// Records where the renderer hosted in `main` draws its notices. Call
/// `reapply` on the window's pages afterwards.
pub(super) fn set_notice_holes(main: isize, radius: i32, boxes: Vec<[i32; 4]>) {
    // SAFETY: a plain query; a stale handle only returns null.
    let root = unsafe { GetAncestor(main as HWND, GA_ROOT) } as isize;
    if let Ok(mut all) = notice_holes().lock() {
        if boxes.is_empty() {
            all.remove(&root);
        } else {
            all.insert(
                root,
                NoticeHoles {
                    main,
                    radius,
                    boxes,
                },
            );
        }
    }
}

/// Applies the page's frame again, for a change kept outside it.
pub(super) fn reapply(webview: &Webview) -> Result<(), String> {
    update(webview, true, |_| {})
}

/// Rounds the page's corners by `radii` (logical pixels; zero is square),
/// smoothing them with `color`, the window chrome around them, when given.
pub(super) fn set_corners(
    webview: &Webview,
    radii: [f64; 4],
    color: Option<[u8; 3]>,
) -> Result<(), String> {
    let radii = radii.map(|radius| {
        if radius.is_finite() {
            radius.max(0.0)
        } else {
            0.0
        }
    });
    change(webview, move |frame| {
        frame.radii = radii;
        frame.corner_color = color;
    })
}

/// Lays a dim of `strength` (0 to 1) over the page; zero removes it.
pub(super) fn set_dim(webview: &Webview, strength: f64) -> Result<(), String> {
    change(webview, move |frame| frame.dim = strength.clamp(0.0, 1.0))
}

/// Records a change for the page's host window and applies its frame, on
/// the window's own thread.
fn change(webview: &Webview, edit: impl FnOnce(&mut Frame) + Send + 'static) -> Result<(), String> {
    update(webview, false, edit)
}

fn update(
    webview: &Webview,
    force: bool,
    edit: impl FnOnce(&mut Frame) + Send + 'static,
) -> Result<(), String> {
    webview
        .with_webview(move |platform| {
            let mut host = Default::default();
            // SAFETY: the controller is live for this UI-thread callback.
            if unsafe { platform.controller().ParentWindow(&mut host) }.is_err() {
                return;
            }
            let host = host.0 as HWND;
            let changed = if let Ok(mut frames) = frames().lock() {
                let fresh = !frames.contains_key(&(host as isize));
                let frame = frames.entry(host as isize).or_default();
                let before = (frame.radii, frame.dim, frame.corner_color);
                edit(frame);
                if fresh {
                    // SAFETY: a live window owned by this thread.
                    unsafe { SetWindowSubclass(host, Some(on_message), SUBCLASS, 0) };
                }
                fresh || before != (frame.radii, frame.dim, frame.corner_color)
            } else {
                false
            };
            // Every reconcile restates the frame; only a change is reapplied. A
            // resize reapplies it through the subclass.
            if changed || force {
                apply(host);
            }
        })
        .map_err(|error| error.to_string())
}

/// Whether any notice is cut out of the app window holding `host`.
fn has_notice_holes(host: HWND) -> bool {
    // SAFETY: a plain query on a live window.
    let root = unsafe { GetAncestor(host, GA_ROOT) } as isize;
    notice_holes()
        .lock()
        .map(|all| all.contains_key(&root))
        .unwrap_or(false)
}

/// `region` minus the notices that overlap `host`, creating it if it was null
/// (no clipping) and a notice overlaps.
///
/// # Safety
/// `region` is null or owned by the caller, who gets back a region to hand to
/// the system or delete.
unsafe fn cut_notice_holes(host: HWND, mut region: HRGN, width: i32, height: i32) -> HRGN {
    let root = GetAncestor(host, GA_ROOT) as isize;
    let Ok(all) = notice_holes().lock() else {
        return region;
    };
    let Some(holes) = all.get(&root) else {
        return region;
    };
    for &[left, top, right, bottom] in &holes.boxes {
        let mut corners = [POINT { x: left, y: top }, POINT { x: right, y: bottom }];
        MapWindowPoints(holes.main as HWND, host, corners.as_mut_ptr(), 2);
        let [POINT { x: left, y: top }, POINT { x: right, y: bottom }] = corners;
        if right <= 0 || bottom <= 0 || left >= width || top >= height {
            continue;
        }
        if region.is_null() {
            region = CreateRectRgn(0, 0, width, height);
        }
        let hole = notice_hole(left, top, right, bottom, holes.radius);
        CombineRgn(region, region, hole, RGN_DIFF);
        DeleteObject(hole);
    }
    region
}

/// Clips `host` to its rounded corners and notices and fits its dim over it.
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
        let region = cut_notice_holes(host, rounded_region(width, height, radii), width, height);
        SetWindowRgn(host, region, 1);
    }
    apply_dim(host, frame, width, height);
    apply_caps(host, frame, width, height, radii);
}

fn apply_dim(host: HWND, frame: &mut Frame, width: i32, height: i32) {
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
        // A notice stays put in the app window, so its hole shifts when the page moves.
        WM_MOVE if has_notice_holes(window) => apply(window),
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
mod tests;
