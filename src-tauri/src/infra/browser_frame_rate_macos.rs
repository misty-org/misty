//! Match page animation updates to the display instead of WebKit's 60 Hz preference.
use objc2::{
    msg_send,
    runtime::{AnyObject, Bool},
    sel,
};
use objc2_foundation::{NSArray, NSString};
use objc2_web_kit::WKWebView;

/// WebKit currently exposes this only through its feature SPI. Misty's macOS
/// build already opts into private WebKit APIs. Check availability and discover
/// the named feature; unsupported releases retain their default behavior.
/// Call on the main thread while configuring a newly created WKWebView, before
/// the first document commits. Changing it on a loaded page needs a navigation.
pub(super) unsafe fn prefer_display_refresh_rate(view: &WKWebView) -> bool {
    let preferences = view.configuration().preferences();
    let class = objc2::class!(WKPreferences);
    let available: bool = msg_send![class, respondsToSelector: sel!(_features)];
    let writable: bool =
        msg_send![&*preferences, respondsToSelector: sel!(_setEnabled:forFeature:)];
    if !available || !writable {
        return false;
    }
    let features: *const NSArray<AnyObject> = msg_send![class, _features];
    let Some(features) = features.as_ref() else {
        return false;
    };
    for feature in features.iter() {
        let key: *const NSString = msg_send![&*feature, key];
        if key
            .as_ref()
            .is_some_and(|key| key.to_string() == "PreferPageRenderingUpdatesNear60FPSEnabled")
        {
            let _: () = msg_send![&*preferences, _setEnabled: Bool::NO, forFeature: &*feature];
            return true;
        }
    }
    false
}
