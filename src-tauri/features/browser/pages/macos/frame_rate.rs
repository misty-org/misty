use objc2::{
    msg_send,
    runtime::{AnyObject, Bool},
    sel,
};
use objc2_foundation::{NSArray, NSString};
use objc2_web_kit::WKWebView;

pub(crate) unsafe fn prefer_display_refresh_rate(view: &WKWebView) -> bool {
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
