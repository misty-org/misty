use tauri::Webview;

#[cfg(target_os = "macos")]
pub(crate) fn native_macos_safari_user_agent() -> Option<String> {
    use objc2_foundation::{NSBundle, NSString};
    use std::sync::OnceLock;

    static USER_AGENT: OnceLock<Option<String>> = OnceLock::new();
    USER_AGENT
        .get_or_init(|| {
            let path = NSString::from_str("/Applications/Safari.app");
            let bundle = NSBundle::bundleWithPath(&path)?;
            let key = NSString::from_str("CFBundleShortVersionString");
            let version = bundle
                .objectForInfoDictionaryKey(&key)?
                .downcast::<NSString>()
                .ok()?;
            safari_user_agent(&version.to_string())
        })
        .clone()
}

#[cfg(target_os = "macos")]
fn safari_user_agent(version: &str) -> Option<String> {
    let version = version.trim();
    let valid = !version.is_empty()
        && version.len() <= 32
        && version
            .chars()
            .all(|character| character.is_ascii_digit() || matches!(character, '.' | '-' | '+'));
    valid.then(|| {
        format!(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
             AppleWebKit/605.1.15 (KHTML, like Gecko) \
             Version/{version} Safari/605.1.15"
        )
    })
}

#[cfg(target_os = "macos")]
use crate::browser::pages::macos::pointer_guard::{
    install_main_webview_guard, refresh_browser_webview_guard, unregister_browser_webview,
};

#[cfg(target_os = "macos")]
pub(crate) fn configure_main_webview_pointer_guard(webview: &Webview) -> Result<(), String> {
    use objc2_app_kit::NSView;
    webview
        .with_webview(|platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            install_main_webview_guard(view);
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
pub(crate) fn configure_browser_webview(
    webview: &Webview,
    native_live_resize: bool,
) -> Result<(), String> {
    kiri::engine::deny_permission_requests(webview)?;
    configure_page_view(webview, native_live_resize)
}

#[cfg(target_os = "macos")]
pub(crate) fn configure_page_view(
    webview: &Webview,
    native_live_resize: bool,
) -> Result<(), String> {
    use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSViewLayerContentsRedrawPolicy};
    webview
        .with_webview(move |platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            let mask = if native_live_resize {
                NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable
            } else {
                NSAutoresizingMaskOptions::ViewNotSizable
            };
            if view.autoresizingMask() != mask {
                view.setAutoresizingMask(mask);
            }
            if view.layerContentsRedrawPolicy() != NSViewLayerContentsRedrawPolicy::DuringViewResize
            {
                configure_continuous_live_resize(view);
            }
            if let Some(parent) = view.superview() {
                parent.setAutoresizesSubviews(true);
            }
            let rubber_banding = objc2::sel!(_setRubberBandingEnabled:);
            let supported: bool = objc2::msg_send![view, respondsToSelector: rubber_banding];
            if supported {
                let _: () = objc2::msg_send![view, _setRubberBandingEnabled: 0usize];
            }
            if let Some(window) = view.window() {
                window.setPreservesContentDuringLiveResize(false);
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
use crate::app::macos_window_effects::mac_rounded_corners::configure_continuous_live_resize;

#[cfg(target_os = "macos")]
pub(crate) fn refresh_browser_cursor_ownership(webview: &Webview) -> Result<(), String> {
    use objc2_app_kit::NSView;
    webview
        .with_webview(|platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            refresh_browser_webview_guard(view);
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
pub(crate) fn unregister_browser_cursor_ownership(webview: &Webview) -> Result<(), String> {
    use objc2_app_kit::NSView;
    webview
        .with_webview(|platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            unregister_browser_webview(view);
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
pub(crate) fn reload_browser_webview(webview: &Webview) -> Result<(), String> {
    use objc2::runtime::AnyObject;
    webview
        .with_webview(|platform_webview| unsafe {
            let view: &AnyObject = &*platform_webview.inner().cast();
            let _: () = objc2::msg_send![view, stopLoading];
            let _: *mut AnyObject = objc2::msg_send![view, reloadFromOrigin];
        })
        .map_err(|error| error.to_string())
}
#[cfg(not(target_os = "macos"))]
pub(crate) fn native_macos_safari_user_agent() -> Option<String> {
    None
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn configure_browser_webview(
    webview: &Webview,
    _native_live_resize: bool,
) -> Result<(), String> {
    kiri::engine::deny_permission_requests(webview)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn configure_page_view(
    _webview: &Webview,
    _native_live_resize: bool,
) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn refresh_browser_cursor_ownership(_webview: &Webview) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn unregister_browser_cursor_ownership(_webview: &Webview) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn reload_browser_webview(webview: &Webview) -> Result<(), String> {
    webview.reload().map_err(|error| error.to_string())
}

#[cfg(all(test, target_os = "macos"))]
mod tests;
