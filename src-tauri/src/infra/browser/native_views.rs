//! Native webview theming, positioning and presentation per platform.

use super::*;

mod placement;
pub(super) use placement::*;

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

/// Returns keyboard focus to a page that lost it to the app view, so typing continues where
/// it stopped. The page keeps its own caret while it is unfocused.
#[tauri::command]
pub fn browser_webview_restore_focus(
    caller: Webview,
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    let Some(webview) = app.get_webview(&webview_label(&request.id)?) else {
        return Ok(());
    };
    if detached_from(&caller, &webview) {
        return Ok(());
    }
    #[cfg(windows)]
    return crate::infra::window_focus_windows::restore_page(&webview);
    #[cfg(not(windows))]
    Ok(())
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
