use std::sync::OnceLock;

use super::ForegroundWindow;
use crate::agents::desktop_control::linux::{overlay, wayland_session, x11};

fn xcap_scale() -> f64 {
    static SCALE: OnceLock<f64> = OnceLock::new();
    *SCALE.get_or_init(|| {
        xcap::Monitor::all()
            .ok()
            .and_then(|monitors| monitors.first()?.scale_factor().ok())
            .map(f64::from)
            .filter(|scale| *scale > 0.0)
            .unwrap_or(1.0)
    })
}

pub fn cursor() -> Option<(f64, f64)> {
    if wayland_session() {
        return None;
    }
    let (x, y) = x11::pointer()?;
    let scale = xcap_scale();
    Some((x / scale, y / scale))
}

pub fn foreground_window(ignored: &[isize]) -> Option<ForegroundWindow> {
    if wayland_session() {
        return None;
    }
    let window = x11::active_window()?;
    let scale = xcap_scale();
    super::usable_foreground(
        ForegroundWindow {
            handle: window.id as isize,
            x: window.x / scale,
            y: window.y / scale,
            width: window.width / scale,
            height: window.height / scale,
            app: window.app,
            title: window.title,
            monitor: None,
        },
        ignored,
    )
}

pub fn x11_window_id(window: &tauri::WebviewWindow) -> Option<isize> {
    use gtk::{glib::translate::ToGlibPtr, prelude::*};
    extern "C" {
        fn gdk_x11_window_get_xid(window: *mut gtk::gdk::ffi::GdkWindow) -> std::ffi::c_ulong;
    }
    let gdk_window = window.gtk_window().ok()?.window()?;
    if !gdk_window.display().type_().name().contains("X11") {
        return None;
    }
    // SAFETY: a live GdkWindow of the X11 backend.
    let id = unsafe { gdk_x11_window_get_xid(gdk_window.to_glib_none().0) };
    (id != 0).then_some(id as isize)
}

pub fn position_overlay(
    window: &tauri::WebviewWindow,
    display: &super::super::Display,
) -> Result<(), String> {
    overlay::prepare(window)?;
    let to_gtk = display.scale.max(0.01) / overlay::scale(window);
    overlay::place(
        window,
        display.x * to_gtk,
        display.y * to_gtk,
        display.width * to_gtk,
        display.height * to_gtk,
    );
    Ok(())
}
