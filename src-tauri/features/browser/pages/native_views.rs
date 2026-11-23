use crate::browser::*;

mod placement;
pub(in crate::browser) use placement::*;

#[cfg(target_os = "macos")]
pub(in crate::browser) fn apply_macos_webview_theme(webview: &Webview) -> Result<(), String> {
    use objc2_app_kit::{NSAppearanceCustomization, NSView};
    webview
        .with_webview(move |platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            view.setAppearance(None);
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
pub(in crate::browser) fn remember_main_macos_webview(
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
    if crate::browser::app_windows::is_app_window(window_label) {
        configure_main_webview_pointer_guard(&main_webview)?;
    }
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
pub(in crate::browser) fn remember_main_macos_webview(
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
    if !renderer(window_label).transparent {
        main_webview
            .set_background_color(Some(Color(0, 0, 0, 0)))
            .map_err(|error| error.to_string())?;
        crate::browser::menus::engine_menu::install(&main_webview, true);
        if let Ok(mut map) = renderers().lock() {
            map.entry(window_label.to_owned()).or_default().transparent = true;
        }
    }
    Ok(())
}

pub(in crate::browser) fn browser_child_should_be_below_renderer(overlay_active: bool) -> bool {
    overlay_active
}

#[cfg(not(any(target_os = "macos", windows)))]
pub(in crate::browser) fn remember_main_macos_webview(
    _app: &AppHandle,
    _window_label: &str,
) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub(in crate::browser) unsafe fn browser_stacking_is_correct(
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
    let Some(view_index) = view_index else {
        return false;
    };
    match main_index {
        Some(main_index) if below_main => view_index < main_index,
        Some(main_index) => view_index > main_index,
        None => view_index + 1 == subviews.count(),
    }
}

#[cfg(target_os = "macos")]
pub(in crate::browser) fn present_macos_webview(webview: &Webview) -> Result<(), String> {
    position_macos_webview(webview, true)
}

#[tauri::command]
pub fn browser_webview_held(request: BrowserWebviewIdRequest) -> bool {
    is_held_id(&request.id)
}

#[cfg(windows)]
pub(in crate::browser) fn present_macos_webview(webview: &Webview) -> Result<(), String> {
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
pub(in crate::browser) fn present_macos_webview(webview: &Webview) -> Result<(), String> {
    webview.show().map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
pub(in crate::browser) fn apply_macos_webview_theme(_webview: &Webview) -> Result<(), String> {
    Ok(())
}
