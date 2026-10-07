// SPDX-License-Identifier: MIT
#[cfg(target_os = "macos")]
use objc2_web_kit::WKWebView;
#[cfg(target_os = "macos")]
use wry::{Error, Result};

// Exercise the production URL reader, including its Objective-C calls.
#[cfg(target_os = "macos")]
#[path = "../vendor/wry/src/wkwebview/current_url.rs"]
mod current_url;

#[cfg(target_os = "macos")]
fn main() {
    use objc2::{MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::NSApplication;
    use objc2_foundation::{ns_string, NSDate, NSRect, NSRunLoop, NSURLRequest, NSURL};
    use objc2_web_kit::{WKWebViewConfiguration, WKWebsiteDataStore};
    use std::time::{Duration, Instant};

    let mtm = MainThreadMarker::new().expect("native test must run on the main thread");
    let _application = NSApplication::sharedApplication(mtm);
    unsafe {
        let configuration = WKWebViewConfiguration::new(mtm);
        configuration.setWebsiteDataStore(&WKWebsiteDataStore::nonPersistentDataStore(mtm));
        let view = WKWebView::initWithFrame_configuration(
            WKWebView::alloc(mtm),
            NSRect::ZERO,
            &configuration,
        );
        assert!(
            view.URL().is_none(),
            "fixture must reproduce the unloaded WebKit state"
        );
        assert!(matches!(
            current_url::url_from_webview(&view),
            Err(Error::UrlNotAvailable)
        ));

        let url = NSURL::URLWithString(ns_string!("about:blank")).unwrap();
        view.loadRequest(&NSURLRequest::requestWithURL(&url));
        let deadline = Instant::now() + Duration::from_secs(10);
        while view.URL().is_none() && Instant::now() < deadline {
            NSRunLoop::mainRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.01));
        }
        assert_eq!(current_url::url_from_webview(&view).unwrap(), "about:blank");
    }
    println!("PASS: unloaded WKWebView returns an error; navigated WKWebView returns its real URL");
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("SKIP: the WKWebView URL regression requires macOS");
}
