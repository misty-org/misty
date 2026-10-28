//! Placing a page's native view: its position, stacking and rounded corners.
use super::*;

#[cfg(target_os = "macos")]
pub(in crate::infra::browser) fn position_macos_webview(
    webview: &Webview,
    reveal: bool,
) -> Result<(), String> {
    use objc2_app_kit::{NSView, NSWindow, NSWindowOrderingMode};
    let own_renderer = renderer(webview.window().label());
    webview
        .with_webview(move |platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            if reveal && view.isHidden() {
                view.setHidden(false);
            }
            let parent = view.superview().or_else(|| {
                let window: &NSWindow = &*platform_webview.ns_window().cast();
                window.contentView()
            });
            if let Some(parent) = parent {
                let main_view = own_renderer.native;
                let below_main = browser_child_should_be_below_renderer(own_renderer.overlay);
                if main_view == 0
                    || browser_stacking_is_correct(&parent, view, main_view, below_main)
                {
                    return;
                }
                let main_view: &NSView = &*(main_view as *const NSView);
                // The external page owns its measured rectangle normally. Misty's
                // renderer moves above it only while app UI needs those pixels.
                parent.addSubview_positioned_relativeTo(
                    view,
                    if below_main {
                        NSWindowOrderingMode::Below
                    } else {
                        NSWindowOrderingMode::Above
                    },
                    Some(main_view),
                );
            }
        })
        .map_err(|error| error.to_string())?;
    refresh_browser_cursor_ownership(webview)
}

/// The page sits above the app renderer, so CSS cannot clip it. Mask its
/// layer to match the workspace corners it reaches.
#[cfg(target_os = "macos")]
pub(in crate::infra::browser) fn round_macos_webview_corners(
    webview: &Webview,
    radii: [f64; 4],
) -> Result<(), String> {
    use objc2::runtime::AnyObject;
    webview
        .with_webview(move |platform_webview| unsafe {
            let view: &AnyObject = &*platform_webview.inner().cast();
            let _: () = objc2::msg_send![view, setWantsLayer: true];
            let layer: *mut AnyObject = objc2::msg_send![view, layer];
            let Some(layer) = layer.as_ref() else {
                return;
            };
            // CACornerMask names corners by layer coordinates; minimum Y is the
            // top edge only when the layer's contents are flipped.
            let flipped: bool = objc2::msg_send![layer, contentsAreFlipped];
            let (top, bottom) = if flipped { (0usize, 2usize) } else { (2, 0) };
            let [top_left, top_right, bottom_right, bottom_left] = radii;
            let mut mask = 0usize;
            for (radius, bit) in [
                (top_left, 1usize << top),
                (top_right, 2usize << top),
                (bottom_right, 2usize << bottom),
                (bottom_left, 1usize << bottom),
            ] {
                if radius > 0.0 {
                    mask |= bit;
                }
            }
            let radius = radii.into_iter().fold(0.0_f64, f64::max);
            let _: () = objc2::msg_send![layer, setCornerRadius: radius];
            let _: () = objc2::msg_send![layer, setMaskedCorners: mask];
            let _: () = objc2::msg_send![layer, setMasksToBounds: mask != 0];
        })
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
pub(in crate::infra::browser) fn position_windows_webview(
    webview: &Webview,
    reveal: bool,
    below_renderer: bool,
) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, HWND},
        UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
        },
    };

    if reveal {
        webview.show().map_err(|error| error.to_string())?;
    }
    let own_renderer = renderer(webview.window().label());
    let failure = std::sync::Arc::new(AtomicU32::new(0));
    let callback_failure = failure.clone();
    webview
        .with_webview(move |platform_webview| {
            let mut child = Default::default();
            if unsafe { platform_webview.controller().ParentWindow(&mut child) }.is_err() {
                callback_failure.store(u32::MAX, Ordering::Release);
                return;
            }
            let main = own_renderer.native;
            if main == 0 {
                callback_failure.store(u32::MAX, Ordering::Release);
                return;
            }
            let insert_after = if below_renderer {
                main as HWND
            } else {
                HWND_TOP
            };
            let positioned = unsafe {
                SetWindowPos(
                    child.0 as HWND,
                    insert_after,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOOWNERZORDER | SWP_NOSIZE,
                )
            };
            if positioned == 0 {
                callback_failure.store(unsafe { GetLastError() }, Ordering::Release);
            }
        })
        .map_err(|error| error.to_string())?;
    match failure.load(Ordering::Acquire) {
        0 => refresh_browser_cursor_ownership(webview),
        u32::MAX => Err("A WebView2 window handle is unavailable.".to_owned()),
        code => Err(format!(
            "Could not update Browser stacking (Windows error {code})."
        )),
    }
}
