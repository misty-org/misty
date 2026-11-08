//! Whether LaunchServices opens web links with this app, and asking macOS to make it so.

use block2::RcBlock;
use objc2::rc::autoreleasepool;
use objc2_app_kit::NSWorkspace;
use objc2_foundation::{NSBundle, NSError, NSString, NSURL};

/// Whether LaunchServices currently opens web links with this app.
pub(crate) fn is_current() -> bool {
    autoreleasepool(|_| {
        let workspace = NSWorkspace::sharedWorkspace();
        let probe = NSURL::URLWithString(&NSString::from_str("https://example.com"));
        let app = probe.and_then(|probe| workspace.URLForApplicationToOpenURL(&probe));
        let current = app
            .and_then(|app| NSBundle::bundleWithURL(&app))
            .and_then(|bundle| bundle.bundleIdentifier());
        let own = NSBundle::mainBundle().bundleIdentifier();
        match (current, own) {
            (Some(current), Some(own)) => current
                .to_string()
                .to_lowercase()
                .eq(&own.to_string().to_lowercase()),
            _ => false,
        }
    })
}

/// Asks macOS to make this app the default for http and https. macOS shows its own
/// confirmation; the caller re-reads the status when the window regains focus.
pub(crate) fn request() {
    autoreleasepool(|_| {
        if NSBundle::mainBundle().bundleIdentifier().is_none() {
            return;
        }
        let workspace = NSWorkspace::sharedWorkspace();
        let bundle = NSBundle::mainBundle().bundleURL();
        for scheme in ["http", "https"] {
            let done = RcBlock::new(|_error: *mut NSError| {});
            workspace.setDefaultApplicationAtURL_toOpenURLsWithScheme_completionHandler(
                &bundle,
                &NSString::from_str(scheme),
                Some(&done),
            );
        }
    });
}
