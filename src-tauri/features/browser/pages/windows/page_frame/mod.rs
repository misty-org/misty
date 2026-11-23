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
        BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLACK_BRUSH, BLENDFUNCTION, DIB_RGB_COLORS, HBRUSH,
        HRGN, RGN_DIFF,
    },
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        HiDpi::GetDpiForWindow,
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, GetAncestor, GetClientRect, RegisterClassW,
            SetWindowPos, ShowWindow, UpdateLayeredWindow, GA_ROOT, HWND_TOP, SWP_NOACTIVATE,
            SW_HIDE, SW_SHOWNA, ULW_ALPHA, WM_MOVE, WM_NCDESTROY, WM_SIZE, WNDCLASSW, WS_CHILD,
            WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TRANSPARENT,
        },
    },
};

mod corners;
use corners::*;

const SUBCLASS: usize = 0x4D50_4652;
const OVERLAY_CLASS: &str = "MistyPaneDim";

#[derive(Default)]
struct Frame {
    radii: [f64; 4],
    corner_color: Option<[u8; 3]>,
    caps: [Option<(isize, i32, [u8; 3])>; 4],
}

fn frames() -> &'static Mutex<HashMap<isize, Frame>> {
    static FRAMES: OnceLock<Mutex<HashMap<isize, Frame>>> = OnceLock::new();
    FRAMES.get_or_init(Default::default)
}

struct NoticeHoles {
    main: isize,
    radius: i32,
    boxes: Vec<[i32; 4]>,
}

fn notice_holes() -> &'static Mutex<HashMap<isize, NoticeHoles>> {
    static HOLES: OnceLock<Mutex<HashMap<isize, NoticeHoles>>> = OnceLock::new();
    HOLES.get_or_init(Default::default)
}

pub(in crate::browser) fn set_notice_holes(main: isize, radius: i32, boxes: Vec<[i32; 4]>) {
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

pub(in crate::browser) fn reapply(webview: &Webview) -> Result<(), String> {
    update(webview, true, |_| {})
}

pub(in crate::browser) fn set_corners(
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
                let before = (frame.radii, frame.corner_color);
                edit(frame);
                if fresh {
                    // SAFETY: a live window owned by this thread.
                    unsafe { SetWindowSubclass(host, Some(on_message), SUBCLASS, 0) };
                }
                fresh || before != (frame.radii, frame.corner_color)
            } else {
                false
            };
            if changed || force {
                apply(host);
            }
        })
        .map_err(|error| error.to_string())
}

fn has_notice_holes(host: HWND) -> bool {
    // SAFETY: a plain query on a live window.
    let root = unsafe { GetAncestor(host, GA_ROOT) } as isize;
    notice_holes()
        .lock()
        .map(|all| all.contains_key(&root))
        .unwrap_or(false)
}

unsafe fn cut_notice_holes(host: HWND, mut region: HRGN, width: i32, height: i32) -> HRGN {
    let root = GetAncestor(host, GA_ROOT) as isize;
    let Ok(all) = notice_holes().lock() else {
        return region;
    };
    let Some(holes) = all.get(&root) else {
        return region;
    };
    for &[left, top, right, bottom] in &holes.boxes {
        let mut corners = [
            POINT { x: left, y: top },
            POINT {
                x: right,
                y: bottom,
            },
        ];
        MapWindowPoints(holes.main as HWND, host, corners.as_mut_ptr(), 2);
        let [POINT { x: left, y: top }, POINT {
            x: right,
            y: bottom,
        }] = corners;
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
    apply_caps(host, frame, width, height, radii);
}

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
        WM_MOVE if has_notice_holes(window) => apply(window),
        WM_NCDESTROY => {
            if let Ok(mut frames) = frames().lock() {
                frames.remove(&(window as isize));
            }
            RemoveWindowSubclass(window, Some(on_message), SUBCLASS);
        }
        _ => {}
    }
    result
}

#[cfg(test)]
mod tests;
