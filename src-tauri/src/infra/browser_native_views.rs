//! Native webview theming, positioning and presentation per platform.

use super::*;

#[cfg(target_os = "macos")]
pub(super) fn apply_macos_webview_theme(webview: &Webview, _value: &str) -> Result<(), String> {
    use objc2_app_kit::{NSAppearanceCustomization, NSView};
    webview
        .with_webview(move |platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            view.setAppearance(None);
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
pub(super) fn remember_main_macos_webview(
    app: &AppHandle,
    window_label: &str,
) -> Result<(), String> {
    use objc2_app_kit::NSView;
    let main_webview = app
        .get_webview(window_label)
        .ok_or_else(|| "Misty's main webview is unavailable.".to_owned())?;
    let renderer_label = window_label.to_owned();
    main_webview
        .with_webview(move |platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            if let Ok(mut map) = renderers().lock() {
                map.entry(renderer_label.clone()).or_default().native =
                    view as *const NSView as usize;
            }
        })
        .map_err(|error| error.to_string())?;
    if crate::infra::space_windows::is_app_window(window_label) {
        configure_main_webview_pointer_guard(&main_webview)?;
    }
    // Configure the renderer's native background once, before the Browser
    // child is first presented. Reapplying this during every popup transition
    // clears WKWebView's backing layer and produces a dark compositor frame.
    if !renderer(window_label).transparent {
        if let Err(error) = main_webview.set_background_color(Some(Color(0, 0, 0, 0))) {
            return Err(error.to_string());
        }
    }
    if let Ok(mut map) = renderers().lock() {
        map.entry(window_label.to_owned()).or_default().transparent = true;
    }
    Ok(())
}

#[cfg(windows)]
pub(super) fn remember_main_macos_webview(
    app: &AppHandle,
    window_label: &str,
) -> Result<(), String> {
    use windows_sys::Win32::{Foundation::HWND, UI::WindowsAndMessaging::FindWindowExW};

    let main_webview = app
        .get_webview(window_label)
        .ok_or_else(|| "Misty's main webview is unavailable.".to_owned())?;
    if renderer(window_label).native == 0 {
        let window = main_webview.window();
        let parent = window.hwnd().map_err(|error| error.to_string())?;
        let class = "WRY_WEBVIEW\0".encode_utf16().collect::<Vec<_>>();
        let hwnd = unsafe {
            FindWindowExW(
                parent.0 as HWND,
                std::ptr::null_mut(),
                class.as_ptr(),
                std::ptr::null(),
            )
        };
        if let Ok(mut map) = renderers().lock() {
            map.entry(window_label.to_owned()).or_default().native = hwnd as usize;
        }
    }
    if renderer(window_label).native == 0 {
        return Err("Misty's main WebView2 window is unavailable.".to_owned());
    }
    // Make the renderer transparent once, when the first page is created and
    // before any is on screen, and leave it that way. Popovers, menus and
    // dialogs then only move the pages beneath the renderer and back, which
    // lands in one frame. Changing WebView2's background per overlay instead
    // reaches the screen frames after the pages move, so the renderer's fill
    // flashed over the page every time one opened or closed. The window
    // itself is painted the theme color behind the renderer
    // (`DesktopWindowReady`), so nothing shows through where no page is.
    if !renderer(window_label).transparent {
        main_webview
            .set_background_color(Some(Color(0, 0, 0, 0)))
            .map_err(|error| error.to_string())?;
        engine_menu::install(&main_webview, true);
        if let Ok(mut map) = renderers().lock() {
            map.entry(window_label.to_owned()).or_default().transparent = true;
        }
    }
    Ok(())
}

pub(super) fn browser_child_should_be_below_renderer(overlay_active: bool) -> bool {
    overlay_active
}

#[cfg(not(any(target_os = "macos", windows)))]
pub(super) fn remember_main_macos_webview(
    _app: &AppHandle,
    _window_label: &str,
) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub(super) fn position_macos_webview(webview: &Webview, reveal: bool) -> Result<(), String> {
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
pub(super) fn round_macos_webview_corners(
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
pub(super) fn position_windows_webview(
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

/// Whether `view` already sits on the correct side of the app renderer inside
/// `parent`. Restacking is only needed when this is false.
#[cfg(target_os = "macos")]
pub(super) unsafe fn browser_stacking_is_correct(
    parent: &objc2_app_kit::NSView,
    view: &objc2_app_kit::NSView,
    main_view: usize,
    below_main: bool,
) -> bool {
    use objc2_app_kit::NSView;
    let subviews = parent.subviews();
    let mut view_index = None;
    let mut main_index = None;
    for (index, child) in subviews.iter().enumerate() {
        let child: *const NSView = &*child;
        if std::ptr::eq(child, view) {
            view_index = Some(index);
        }
        if main_view != 0 && std::ptr::eq(child, main_view as *const NSView) {
            main_index = Some(index);
        }
    }
    // A detached child always needs reinserting.
    let Some(view_index) = view_index else {
        return false;
    };
    match main_index {
        Some(main_index) if below_main => view_index < main_index,
        Some(main_index) => view_index > main_index,
        // Without the app renderer as a reference point, "topmost" is the only
        // ordering the caller can ask for.
        None => view_index + 1 == subviews.count(),
    }
}

#[cfg(target_os = "macos")]
pub(super) fn present_macos_webview(webview: &Webview) -> Result<(), String> {
    position_macos_webview(webview, true)
}

/// Whether the page exists but is still parked for its first paint. The
/// frontend keeps the previous page up until this turns false.
#[tauri::command]
pub fn browser_webview_held(request: BrowserWebviewIdRequest) -> bool {
    is_held_id(&request.id)
}

#[cfg(windows)]
pub(super) fn present_macos_webview(webview: &Webview) -> Result<(), String> {
    if is_held_view(webview) {
        return park_windows_webview(webview);
    }
    wake(webview);
    position_windows_webview(
        webview,
        true,
        browser_child_should_be_below_renderer(renderer(webview.window().label()).overlay),
    )
}

#[cfg(not(any(target_os = "macos", windows)))]
pub(super) fn present_macos_webview(webview: &Webview) -> Result<(), String> {
    webview.show().map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
pub(super) fn apply_macos_webview_theme(_webview: &Webview, _value: &str) -> Result<(), String> {
    Ok(())
}
