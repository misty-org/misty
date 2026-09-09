use tauri::Webview;

#[cfg(target_os = "macos")]
#[path = "browser_frame_rate_macos.rs"]
mod frame_rate;

pub(super) fn configure_browser_frame_rate(webview: &Webview) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return webview
        .with_webview(|platform| unsafe {
            let view: &objc2_web_kit::WKWebView = &*platform.inner().cast();
            frame_rate::prefer_display_refresh_rate(view);
        })
        .map_err(|error| error.to_string());
    #[cfg(not(target_os = "macos"))]
    {
        let _ = webview;
        Ok(())
    }
}

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
pub(crate) async fn evaluate_browser_async_javascript(
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
    use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSViewLayerContentsRedrawPolicy};
    webview
        .with_webview(move |platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            // A responsive Browser page is pinned to the top-left of its
            // measured host. Let AppKit grow its width and height during the
            // native live-resize loop, when WebKit pauses renderer resize
            // events. Fixed device previews remain explicitly positioned by
            // the workspace because their horizontal margins must stay equal.
            let mask = if native_live_resize {
                NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable
            } else {
                NSAutoresizingMaskOptions::ViewNotSizable
            };
            if view.autoresizingMask() != mask {
                view.setAutoresizingMask(mask);
            }
            // Configure the backing hierarchy once. Reconciliation also calls
            // this function for unchanged bounds; it must not force a repaint.
            if view.layerContentsRedrawPolicy() != NSViewLayerContentsRedrawPolicy::DuringViewResize
            {
                configure_continuous_live_resize(view);
            }
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

#[cfg(target_os = "macos")]
pub(super) async fn remove_browser_data_store(
    app: &tauri::AppHandle,
    identifier: [u8; 16],
) -> Result<(), String> {
    use block2::RcBlock;
    use objc2::MainThreadMarker;
    use objc2_foundation::{NSDate, NSUUID};
    use objc2_web_kit::WKWebsiteDataStore;
    use std::sync::Mutex;
    let (sender, receiver) = tokio::sync::oneshot::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        let mtm = MainThreadMarker::new().expect("main thread");
        let sender = Mutex::new(Some(sender));
        unsafe {
            // WebKit may retain a just-closed WKWebView. Clearing the named store
            // works even then, whereas deleting its identifier reports "in use".
            // Never touch the default store or another account's identifier.
            let store =
                WKWebsiteDataStore::dataStoreForIdentifier(&NSUUID::from_bytes(identifier), mtm);
            let retained_store = store.clone();
            let handler = RcBlock::new(move || {
                let _keep_alive = &retained_store;
                if let Ok(mut sender) = sender.lock() {
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(Ok(()));
                    }
                }
            });
            store.removeDataOfTypes_modifiedSince_completionHandler(
                &WKWebsiteDataStore::allWebsiteDataTypes(mtm),
                &NSDate::distantPast(),
                &handler,
            );
        }
    })
    .map_err(|error| error.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(30), receiver)
        .await
        .map_err(|_| "Website account removal timed out. Retry removal.".to_owned())?
        .map_err(|_| "Website account removal was canceled.".to_owned())?
}
#[cfg(not(target_os = "macos"))]
pub(super) async fn remove_browser_data_store(
    _: &tauri::AppHandle,
    _: [u8; 16],
) -> Result<(), String> {
    Err("Website accounts require Misty on a Mac.".into())
}

/// WebKit owns rasterization; the shell does not need a second DOM renderer.
#[cfg(target_os = "macos")]
pub(crate) async fn capture_webview_region(
    webview: Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<serde_json::Value, String> {
    use base64::Engine;
    use block2::RcBlock;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError, NSNumber, NSPoint, NSRect, NSSize};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
    use std::{sync::Mutex, time::Duration};
    if ![x, y, width, height].iter().all(|n| n.is_finite())
        || x < 0.0
        || y < 0.0
        || width < 8.0
        || height < 8.0
        || width > 10_000.0
        || height > 10_000.0
    {
        return Err("Capture region is invalid.".into());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    webview.with_webview(move |platform| unsafe {
        let setup = || -> Result<(), String> {
            let _mtm = MainThreadMarker::new().ok_or("Capture must run on the main thread.")?;
            let view: &WKWebView = &*platform.inner().cast();
            let bounds = view.bounds();
            if x + width > bounds.size.width + 1.0 || y + height > bounds.size.height + 1.0 {
                return Err("The selected region is outside the current view.".into());
            }
            Ok(())
        };
        if let Err(error) = setup() {
            if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) { let _ = sender.send(Err(error)); }
            return;
        }
        let mtm = MainThreadMarker::new().unwrap();
        let view: &WKWebView = &*platform.inner().cast();
        let config = WKSnapshotConfiguration::new(mtm);
        config.setRect(NSRect::new(NSPoint::new(x,y), NSSize::new(width,height)));
        config.setSnapshotWidth(Some(&NSNumber::new_f64(width * (640.0 / width.max(height)).min(1.0))));
        config.setAfterScreenUpdates(true);
        let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
            let result = (|| -> Result<serde_json::Value, String> {
                if !error.is_null() || image.is_null() { return Err("WebKit could not capture that region.".into()); }
                let data = (&*image).TIFFRepresentation().ok_or("Capture returned no image.")?;
                let bitmap = NSBitmapImageRep::imageRepWithData(&data).ok_or("Capture image is unavailable.")?;
                let jpeg = bitmap.representationUsingType_properties(NSBitmapImageFileType::JPEG, &NSDictionary::new())
                    .ok_or("Capture could not be encoded.")?;
                Ok(serde_json::json!({"dataUrl":format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpeg.to_vec())),
                    "width":bitmap.pixelsWide(), "height":bitmap.pixelsHigh()}))
            })();
            if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) { let _ = sender.send(result); }
        });
        view.takeSnapshotWithConfiguration_completionHandler(Some(&config), &handler);
    }).map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(15), receiver)
        .await
        .map_err(|_| "Capture timed out.")?
        .map_err(|_| "Capture was cancelled.")?
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn host_webview_capture_region(
    webview: Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<serde_json::Value, String> {
    if webview.label() != "main" {
        return Err("Only the Host can capture its view.".into());
    }
    capture_webview_region(webview, x, y, width, height).await
}
