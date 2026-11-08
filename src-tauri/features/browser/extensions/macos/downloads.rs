// SPDX-License-Identifier: MIT
//! downloads.download: a download in a browser tab, so Misty saves and lists it.
use super::{
    host::MistyExtensionHost,
    support::{string, text, truthy},
    tabs::MistyExtensionTab,
};
use block2::RcBlock;
use objc2::{
    class, msg_send,
    rc::Retained,
    runtime::{NSObject, ProtocolObject},
    sel,
};

use objc2_foundation::{NSMutableURLRequest, NSObjectProtocol, NSURL};
use objc2_web_kit::{WKDownload, WKNavigationAction, WKNavigationDelegate, WKWebExtensionContext};
use serde_json::Value;

use std::ptr::NonNull;

/// Headers the web platform keeps for the browser, as Chrome's downloads API does. With them a
/// download could pass as another site's own request or carry someone else's cookies.
pub fn download_header_allowed(name: &str) -> bool {
    let lower = name.to_lowercase();
    if lower.starts_with("proxy-") || lower.starts_with("sec-") {
        return false;
    }
    ![
        "accept-charset",
        "accept-encoding",
        "access-control-request-headers",
        "access-control-request-method",
        "connection",
        "content-length",
        "cookie",
        "cookie2",
        "date",
        "dnt",
        "expect",
        "host",
        "keep-alive",
        "origin",
        "referer",
        "set-cookie",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "via",
    ]
    .contains(&lower.as_str())
}

impl MistyExtensionHost {
    /// Starts a download in a browser tab of the matching privacy, so Misty's own download
    /// handling saves it and lists it. Returns an error message on failure.
    pub(super) fn start_download(
        &self,
        options: &Value,
        context: &WKWebExtensionContext,
    ) -> Option<String> {
        if !options.is_object() {
            return Some("A download needs a URL.".into());
        }
        let url = text(options, "url").and_then(|url| NSURL::URLWithString(&string(url)));
        let scheme = url
            .as_ref()
            .and_then(|url| url.scheme())
            .map(|s| s.to_string().to_lowercase());
        let (Some(url), true) = (
            url,
            scheme
                .as_deref()
                .is_some_and(|s| ["http", "https", "data"].contains(&s)),
        ) else {
            return Some("Only http, https and data URLs can be downloaded.".into());
        };
        let incognito = truthy(options.get("incognito").unwrap_or(&Value::Null));
        // SAFETY: reads the private-data grant.
        if incognito && !unsafe { context.hasAccessToPrivateData() } {
            return Some("Private access is disabled.".into());
        }
        let in_kind = |tab: &MistyExtensionTab| {
            tab.view().is_some() && tab.window().is_some_and(|w| w.is_private() == incognito)
        };
        let tab = self
            .active_tab()
            .filter(|tab| in_kind(tab))
            .or_else(|| self.all_tabs().into_iter().find(|tab| in_kind(tab)));
        let Some(view) = tab.and_then(|tab| tab.view()) else {
            return Some("Open a browser tab to download files.".into());
        };
        // SAFETY: builds a request from validated pieces.
        let request = NSMutableURLRequest::requestWithURL(&url);
        {
            if text(options, "method") == Some("POST") {
                request.setHTTPMethod(&string("POST"));
                if let Some(body) = text(options, "body") {
                    request
                        .setHTTPBody(Some(&objc2_foundation::NSData::with_bytes(body.as_bytes())));
                }
            }
            for header in options
                .get("headers")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let (Some(name), Some(value)) = (text(header, "name"), text(header, "value"))
                else {
                    continue;
                };
                if !download_header_allowed(name) {
                    return Some(format!("Unsafe download header: {name}"));
                }
                request.setValue_forHTTPHeaderField(Some(&string(value)), &string(name));
            }
        }
        let weak = objc2::rc::Weak::new(&*view);
        let adopt = RcBlock::new(move |download: NonNull<WKDownload>| {
            let Some(view) = weak.load() else {
                return;
            };
            // SAFETY: WebKit passes a live download.
            unsafe {
                let Some(delegate) = view.navigationDelegate() else {
                    return;
                };
                // wry adopts downloads here; its handler ignores the action argument.
                if delegate.respondsToSelector(sel!(webView:navigationAction:didBecomeDownload:)) {
                    let action: Retained<WKNavigationAction> =
                        msg_send![class!(WKNavigationAction), new];
                    let delegate: &ProtocolObject<dyn WKNavigationDelegate> = &delegate;
                    let delegate: &NSObject = &*(delegate as *const _ as *const NSObject);
                    let _: () = msg_send![delegate, webView: &*view, navigationAction: &*action, didBecomeDownload: download.as_ref()];
                }
            }
        });
        // SAFETY: the handler is retained by WebKit until called.
        unsafe { view.startDownloadUsingRequest_completionHandler(&request, &adopt) };
        None
    }
}
