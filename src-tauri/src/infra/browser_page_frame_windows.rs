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
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

use tauri::Webview;
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM},
    Graphics::Gdi::{
        CombineRgn, CreateCompatibleDC, CreateDIBSection, CreateRectRgn, DeleteDC, DeleteObject,
        GetStockObject, SelectObject, SetWindowRgn, AC_SRC_ALPHA, AC_SRC_OVER, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, BLACK_BRUSH, BLENDFUNCTION, DIB_RGB_COLORS, HBRUSH, HRGN,
        RGN_DIFF,
    },
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        HiDpi::GetDpiForWindow,
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, GetClientRect, RegisterClassW,
            SetLayeredWindowAttributes, SetWindowPos, ShowWindow, UpdateLayeredWindow, HWND_TOP,
            LWA_ALPHA, SWP_NOACTIVATE, SW_HIDE, SW_SHOWNA, ULW_ALPHA, WM_NCDESTROY, WM_SIZE,
            WNDCLASSW, WS_CHILD, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TRANSPARENT,
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
    /// The chrome color around the page's rounded corners, when it is known.
    corner_color: Option<[u8; 3]>,
    /// Each corner's cap window and the radius and color it last painted.
    caps: [Option<(isize, i32, [u8; 3])>; 4],
}

fn frames() -> &'static Mutex<HashMap<isize, Frame>> {
    static FRAMES: OnceLock<Mutex<HashMap<isize, Frame>>> = OnceLock::new();
    FRAMES.get_or_init(Default::default)
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
            if changed {
                apply(host);
            }
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

/// Lays a cap over each rounded corner, above the page and its dim, or hides
/// it when the corner is square or its chrome color is unknown.
fn apply_caps(host: HWND, frame: &mut Frame, width: i32, height: i32, radii: [i32; 4]) {
    let radii = radii.map(|radius| radius.clamp(0, width.min(height).max(0) / 2));
    for (corner, radius) in radii.into_iter().enumerate() {
        let Some(color) = frame.corner_color.filter(|_| radius > 0) else {
            if let Some((cap, ..)) = frame.caps[corner] {
                // SAFETY: a cap window this module created.
                unsafe { ShowWindow(cap as HWND, SW_HIDE) };
            }
            continue;
        };
        let cap = match frame.caps[corner] {
            Some((cap, painted_radius, painted_color)) => {
                if painted_radius != radius || painted_color != color {
                    paint_cap(cap as HWND, corner, radius, color);
                    frame.caps[corner] = Some((cap, radius, color));
                }
                cap as HWND
            }
            None => {
                let Some(cap) = create_overlay(host) else {
                    continue;
                };
                paint_cap(cap, corner, radius, color);
                frame.caps[corner] = Some((cap as isize, radius, color));
                cap
            }
        };
        let x = if corner == 1 || corner == 2 {
            width - radius
        } else {
            0
        };
        let y = if corner >= 2 { height - radius } else { 0 };
        // SAFETY: as above; the caps go above the page's windows and its dim.
        unsafe {
            SetWindowPos(cap, HWND_TOP, x, y, radius, radius, SWP_NOACTIVATE);
            ShowWindow(cap, SW_SHOWNA);
        }
    }
}

/// How much of the pixel at (`x`, `y`) of a top-left corner square of side
/// `radius` lies inside the corner's arc, from 0 to 1.
fn arc_coverage(radius: i32, x: i32, y: i32) -> f32 {
    const SAMPLES: i32 = 8;
    let center = radius as f32;
    let mut inside = 0;
    for sample_y in 0..SAMPLES {
        for sample_x in 0..SAMPLES {
            let dx = center - (x as f32 + (sample_x as f32 + 0.5) / SAMPLES as f32);
            let dy = center - (y as f32 + (sample_y as f32 + 0.5) / SAMPLES as f32);
            if dx * dx + dy * dy <= center * center {
                inside += 1;
            }
        }
    }
    inside as f32 / (SAMPLES * SAMPLES) as f32
}

/// A pixel of `corner`'s cap in the top-left orientation `arc_coverage` uses.
fn top_left_pixel(corner: usize, radius: i32, x: i32, y: i32) -> (i32, i32) {
    let flip_x = corner == 1 || corner == 2;
    let flip_y = corner >= 2;
    (
        if flip_x { radius - 1 - x } else { x },
        if flip_y { radius - 1 - y } else { y },
    )
}

/// Paints the chrome `color` over the part of each pixel outside the arc.
fn paint_cap(cap: HWND, corner: usize, radius: i32, color: [u8; 3]) {
    if radius <= 0 {
        return;
    }
    // SAFETY: a DIB and memory DC created, used and released here.
    unsafe {
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: radius,
                // Negative: rows run top to bottom.
                biHeight: -radius,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..std::mem::zeroed()
            },
            ..std::mem::zeroed()
        };
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let bitmap = CreateDIBSection(
            std::ptr::null_mut(),
            &info,
            DIB_RGB_COLORS,
            &mut bits,
            std::ptr::null_mut(),
            0,
        );
        if bitmap.is_null() || bits.is_null() {
            return;
        }
        let pixels = std::slice::from_raw_parts_mut(bits.cast::<u32>(), (radius * radius) as usize);
        for y in 0..radius {
            for x in 0..radius {
                let (tx, ty) = top_left_pixel(corner, radius, x, y);
                let alpha = 1.0 - arc_coverage(radius, tx, ty);
                let premultiply = |channel: u8| (f32::from(channel) * alpha).round() as u32;
                // Premultiplied BGRA.
                pixels[(y * radius + x) as usize] = ((alpha * 255.0).round() as u32) << 24
                    | premultiply(color[0]) << 16
                    | premultiply(color[1]) << 8
                    | premultiply(color[2]);
            }
        }
        let source = CreateCompatibleDC(std::ptr::null_mut());
        let previous = SelectObject(source, bitmap);
        let size = SIZE {
            cx: radius,
            cy: radius,
        };
        let origin = POINT { x: 0, y: 0 };
        let blend = BLENDFUNCTION {
            BlendOp: AC_SRC_OVER as u8,
            BlendFlags: 0,
            SourceConstantAlpha: 255,
            AlphaFormat: AC_SRC_ALPHA as u8,
        };
        UpdateLayeredWindow(
            cap,
            std::ptr::null_mut(),
            std::ptr::null(),
            &size,
            source,
            &origin,
            0,
            &blend,
            ULW_ALPHA,
        );
        SelectObject(source, previous);
        DeleteDC(source);
        DeleteObject(bitmap);
    }
}

/// The client area minus the pixels wholly outside each rounded corner's arc,
/// or null (no clipping) when every corner is square. Pixels the arc crosses
/// stay, for the corner caps to smooth.
///
/// # Safety
/// Returns a region the caller must hand to the system or delete.
unsafe fn rounded_region(width: i32, height: i32, radii: [i32; 4]) -> HRGN {
    if radii.iter().all(|&radius| radius <= 0) || width <= 0 || height <= 0 {
        return std::ptr::null_mut();
    }
    let region = CreateRectRgn(0, 0, width, height);
    let radii = radii.map(|radius| radius.clamp(0, width.min(height) / 2));
    for (corner, radius) in radii.into_iter().enumerate() {
        for row in 0..radius {
            // Pixels wholly outside the arc, counted in from the outer edge.
            let cut = (0..radius)
                .take_while(|&x| arc_coverage(radius, x, row) == 0.0)
                .count() as i32;
            if cut == 0 {
                continue;
            }
            let (left, right) = if corner == 1 || corner == 2 {
                (width - cut, width)
            } else {
                (0, cut)
            };
            let top = if corner >= 2 { height - 1 - row } else { row };
            let strip = CreateRectRgn(left, top, right, top + 1);
            CombineRgn(region, region, strip, RGN_DIFF);
            DeleteObject(strip);
        }
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
    fn caps_cover_only_what_lies_outside_the_arc() {
        // The outer corner pixel is wholly outside, the arc's center wholly inside.
        assert_eq!(arc_coverage(12, 0, 0), 0.0);
        assert_eq!(arc_coverage(12, 11, 11), 1.0);
        // A pixel on the arc is partly covered, which is what the cap smooths.
        let edge = arc_coverage(12, 3, 3);
        assert!(edge > 0.0 && edge < 1.0, "{edge}");
        // Every corner maps its own outer pixel to the top-left outer pixel.
        assert_eq!(top_left_pixel(0, 12, 0, 0), (0, 0));
        assert_eq!(top_left_pixel(1, 12, 11, 0), (0, 0));
        assert_eq!(top_left_pixel(2, 12, 11, 11), (0, 0));
        assert_eq!(top_left_pixel(3, 12, 0, 11), (0, 0));
    }

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
