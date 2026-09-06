use tauri::Webview;

#[cfg(target_os = "macos")]
pub(super) fn browser_requires_ephemeral_store() -> bool {
    use objc2_foundation::NSProcessInfo;

    // Named persistent WKWebsiteDataStore instances arrived in macOS 14.
    // Older releases use a nonpersistent store instead of sharing the Host's
    // default store. Tabs are therefore session-isolated on those releases.
    NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
        < 14
}

#[cfg(not(target_os = "macos"))]
pub(super) fn browser_requires_ephemeral_store() -> bool {
    false
}

#[cfg(target_os = "macos")]
pub(super) async fn evaluate_browser_async_javascript(
    webview: Webview,
    function_body: String,
) -> Result<String, String> {
    use block2::RcBlock;
    use objc2::{runtime::AnyObject, MainThreadMarker};
    use objc2_foundation::{NSError, NSString};
    use objc2_web_kit::{WKContentWorld, WKWebView};
    use std::sync::Mutex;
    use std::time::Duration;

    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    webview
        .with_webview(move |platform_webview| unsafe {
            let Some(mtm) = MainThreadMarker::new() else {
                if let Ok(mut sender) = sender.lock() {
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(Err(
                            "Browser capture must run on the main thread.".to_owned()
                        ));
                    }
                }
                return;
            };
            let view: &WKWebView = &*platform_webview.inner().cast();
            let world = WKContentWorld::pageWorld(mtm);
            let handler = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
                let result = if !error.is_null() {
                    Err("The Browser page could not render that capture.".to_owned())
                } else if value.is_null() {
                    Err("The Browser page returned no capture.".to_owned())
                } else if let Some(value) = (&*value).downcast_ref::<NSString>() {
                    Ok(value.to_string())
                } else {
                    Err("The Browser page returned an invalid capture.".to_owned())
                };
                if let Ok(mut sender) = sender.lock() {
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(result);
                    }
                }
            });
            view.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                &NSString::from_str(&function_body),
                None,
                None,
                &world,
                Some(&*handler),
            );
        })
        .map_err(|error| error.to_string())?;

    tokio::time::timeout(Duration::from_secs(15), receiver)
        .await
        .map_err(|_| "Browser capture timed out.".to_owned())?
        .map_err(|_| "Browser capture was canceled.".to_owned())?
}

#[cfg(target_os = "macos")]
pub(super) fn native_macos_safari_user_agent() -> Option<String> {
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
use super::browser_pointer_guard_macos::{
    install_main_webview_guard, refresh_browser_webview_guard, unregister_browser_webview,
};

#[cfg(target_os = "macos")]
pub(super) fn configure_main_webview_pointer_guard(webview: &Webview) -> Result<(), String> {
    use objc2_app_kit::NSView;
    webview
        .with_webview(|platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            install_main_webview_guard(view);
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
pub(super) fn configure_browser_webview(
    webview: &Webview,
    native_live_resize: bool,
) -> Result<(), String> {
    use objc2_app_kit::{NSAutoresizingMaskOptions, NSView};
    webview
        .with_webview(move |platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            disable_scroll_elasticity(view);
            // A responsive Browser page is pinned to the top-left of its
            // measured host. Let AppKit grow its width and height during the
            // native live-resize loop, when WebKit pauses renderer resize
            // events. Fixed device previews remain explicitly positioned by
            // the workspace because their horizontal margins must stay equal.
            view.setAutoresizingMask(if native_live_resize {
                NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable
            } else {
                NSAutoresizingMaskOptions::ViewNotSizable
            });
            configure_continuous_live_resize(view);
            if let Some(parent) = view.superview() {
                parent.setAutoresizesSubviews(true);
            }
            if let Some(window) = view.window() {
                // AppKit normally preserves cached window contents during a
                // user resize. That optimization produces a frozen WKWebView
                // snapshot, so make the window redraw its live hierarchy.
                window.setPreservesContentDuringLiveResize(false);
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
unsafe fn configure_continuous_live_resize(view: &objc2_app_kit::NSView) {
    use objc2_app_kit::NSViewLayerContentsRedrawPolicy;

    // WKWebView is a tree of AppKit/WebKit views. Applying the policy only to
    // its root still permits an internal tiled-content view to preserve a
    // stale frame until live resize ends.
    view.setLayerContentsRedrawPolicy(NSViewLayerContentsRedrawPolicy::DuringViewResize);
    view.setNeedsDisplay(true);
    for child in view.subviews().iter() {
        configure_continuous_live_resize(&child);
    }
}

/// Keep Wry unmodified and apply Misty's main-renderer pointer guard after
/// native geometry, visibility, or sibling-order changes.
#[cfg(target_os = "macos")]
pub(super) fn refresh_browser_cursor_ownership(webview: &Webview) -> Result<(), String> {
    use objc2_app_kit::NSView;
    webview
        .with_webview(|platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            refresh_browser_webview_guard(view);
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
pub(super) fn unregister_browser_cursor_ownership(webview: &Webview) -> Result<(), String> {
    use objc2_app_kit::NSView;
    webview
        .with_webview(|platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            unregister_browser_webview(view);
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
pub(super) fn reload_browser_webview(webview: &Webview) -> Result<(), String> {
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
pub(super) async fn evaluate_browser_async_javascript(
    _webview: Webview,
    _function_body: String,
) -> Result<String, String> {
    Err("Browser region capture is not available on this platform yet.".to_owned())
}

#[cfg(target_os = "macos")]
unsafe fn disable_scroll_elasticity(view: &objc2_app_kit::NSView) {
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSScrollElasticity, NSScrollView};

    let object: &AnyObject = view;
    if let Some(scroll_view) = object.downcast_ref::<NSScrollView>() {
        scroll_view.setHorizontalScrollElasticity(NSScrollElasticity::None);
        scroll_view.setVerticalScrollElasticity(NSScrollElasticity::None);
    }
    for child in view.subviews().iter() {
        disable_scroll_elasticity(&child);
    }
}

#[cfg(not(target_os = "macos"))]
pub(super) fn native_macos_safari_user_agent() -> Option<String> {
    None
}

#[cfg(not(target_os = "macos"))]
pub(super) fn configure_main_webview_pointer_guard(_webview: &Webview) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(super) fn configure_browser_webview(
    _webview: &Webview,
    _native_live_resize: bool,
) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(super) fn refresh_browser_cursor_ownership(_webview: &Webview) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(super) fn unregister_browser_cursor_ownership(_webview: &Webview) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(super) fn reload_browser_webview(webview: &Webview) -> Result<(), String> {
    webview.reload().map_err(|error| error.to_string())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::safari_user_agent;

    #[test]
    fn safari_identity_uses_the_installed_release_without_accepting_header_injection() {
        let user_agent = safari_user_agent("26.5.2").unwrap();
        assert!(user_agent.contains("Version/26.5.2 Safari/605.1.15"));
        assert!(safari_user_agent("26.5.2\r\nUnsafe: yes").is_none());
    }
}
