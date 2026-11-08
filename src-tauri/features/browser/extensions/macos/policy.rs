// SPDX-License-Identifier: MIT
//! Whether a page or extension may go to an extension page: Misty's rule, kept in Rust so
//! it is the same for navigations and new windows.
use super::tabs::url_text;
use objc2_foundation::NSURL;
use objc2_web_kit::WKWebExtensionContext;
use std::sync::RwLock;

/// `(tab, url, source)`: `tab` is empty when no tab is moving.
pub type NavigationPolicy = fn(&str, &str, &str) -> bool;

static POLICY: RwLock<Option<NavigationPolicy>> = RwLock::new(None);

/// Without a policy, as in tests that link only this code, nothing is refused.
pub fn set_navigation_policy(policy: NavigationPolicy) {
    *POLICY.write().unwrap_or_else(|e| e.into_inner()) = Some(policy);
}

pub(super) fn navigation_allowed(tab: Option<&str>, url: &NSURL, source: Option<&NSURL>) -> bool {
    let policy = *POLICY.read().unwrap_or_else(|e| e.into_inner());
    let Some(policy) = policy else {
        return true;
    };
    policy(
        tab.unwrap_or_default(),
        &url_text(url),
        &source.map(url_text).unwrap_or_default(),
    )
}

/// Whether this extension may open `url`: anything that isn't an extension page, its own
/// pages, or another extension's page that one lists as open to it.
pub(super) fn may_open(context: &WKWebExtensionContext, url: &NSURL) -> bool {
    // SAFETY: reads the URL's scheme and host and the context's base address.
    let (scheme, host, base) = unsafe { (url.scheme(), url.host(), context.baseURL()) };
    if scheme.map(|s| s.to_string()).as_deref() != Some("webkit-extension") {
        return true;
    }
    let own = base.host().map(|h| h.to_string());
    if matches!((host.map(|h| h.to_string()), own), (Some(a), Some(b)) if a == b) {
        return true;
    }
    navigation_allowed(None, url, Some(&base))
}
