// SPDX-License-Identifier: MIT
//! Which extension pages a website, or another extension, may open.
//!
//! Browsers let a page reach an extension's page only when the manifest lists it under
//! `web_accessible_resources`. The engine checks that for frames and for a navigation that stays
//! in one view. Misty moves a tab between views when it crosses into an extension, and opens new
//! tabs as its own request, and the engine sees neither as coming from the page. So the same rule
//! is kept here. Otherwise any site could open an extension's settings or popup page in a tab,
//! with an address of its choosing, in that extension's full authority.
use super::*;
use crate::infra::file_access::fs;
use std::time::{Duration, Instant};

/// Each running extension's `web_accessible_resources`, by page host.
fn resources() -> &'static std::sync::RwLock<BTreeMap<String, Value>> {
    static RESOURCES: OnceLock<std::sync::RwLock<BTreeMap<String, Value>>> = OnceLock::new();
    RESOURCES.get_or_init(Default::default)
}

/// Reads what an extension's package lets pages reach, when it loads.
pub(super) fn remember(host: String, runtime: &Path) {
    let listed = fs::read(runtime.join("manifest.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .map(|manifest| manifest["web_accessible_resources"].clone())
        .unwrap_or(Value::Null);
    if let Ok(mut resources) = resources().write() {
        resources.insert(host, listed);
    }
}

/// Navigations Misty itself asked for, by tab: the address bar, a bookmark, an extension's own
/// `tabs.update` once checked. Each is good once, and only briefly.
fn trusted() -> &'static std::sync::Mutex<BTreeMap<String, (url::Url, Instant)>> {
    static TRUSTED: OnceLock<std::sync::Mutex<BTreeMap<String, (url::Url, Instant)>>> =
        OnceLock::new();
    TRUSTED.get_or_init(Default::default)
}

const TRUST_LASTS: Duration = Duration::from_secs(30);

/// Says the next navigation of `tab` to `url` is Misty's own. Only extension addresses are ever
/// looked up, so nothing else is kept.
pub(crate) fn trust_navigation(tab: &str, url: &url::Url) {
    if url.scheme() != EXTENSION_SCHEME {
        return;
    }
    if let Ok(mut trusted) = trusted().lock() {
        trusted.retain(|_, (_, at)| at.elapsed() < TRUST_LASTS);
        trusted.insert(tab.to_owned(), (url.clone(), Instant::now()));
    }
}

fn take_trust(tab: &str, url: &url::Url) -> bool {
    let Ok(mut trusted) = trusted().lock() else {
        return false;
    };
    let matches = trusted
        .get(tab)
        .is_some_and(|(wanted, at)| wanted == url && at.elapsed() < TRUST_LASTS);
    if matches {
        trusted.remove(tab);
    }
    matches
}

/// The native host's question: may this tab, showing `source`, go to `target`?
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn navigation_allowed(
    tab: Option<&str>,
    target: &url::Url,
    source: Option<&url::Url>,
) -> bool {
    tab.is_some_and(|tab| take_trust(tab, target)) || page_may_open(target, source)
}

/// Whether a page showing `source` may open `target`, by navigating or with `window.open`. An
/// extension's own pages may always open each other; a content script's `window.open` counts as
/// the website it runs in.
pub(crate) fn page_may_open(target: &url::Url, source: Option<&url::Url>) -> bool {
    if target.scheme() != EXTENSION_SCHEME {
        return true;
    }
    let same_extension = source.is_some_and(|source| {
        source.scheme() == EXTENSION_SCHEME && source.host_str() == target.host_str()
    });
    if same_extension {
        return true;
    }
    let (Some(host), Some(source)) = (target.host_str(), source) else {
        return false;
    };
    resources()
        .read()
        .ok()
        .and_then(|resources| resources.get(host).cloned())
        .is_some_and(|listed| web_accessible(&listed, target.path(), source))
}

/// The manifest's rule. Manifest V2 lists paths; V3 lists paths with the pages that may reach them.
/// Another extension counts only where a V3 entry opens to every extension.
fn web_accessible(listed: &Value, path: &str, source: &url::Url) -> bool {
    let path = path.trim_start_matches('/');
    let lists_path = |paths: &Value| {
        paths.as_array().is_some_and(|paths| {
            paths
                .iter()
                .filter_map(Value::as_str)
                .any(|pattern| glob(pattern.trim_start_matches('/'), path))
        })
    };
    listed.as_array().is_some_and(|entries| {
        entries.iter().any(|entry| match entry {
            Value::String(pattern) => glob(pattern.trim_start_matches('/'), path),
            Value::Object(entry) => {
                let from_page =
                    entry
                        .get("matches")
                        .and_then(Value::as_array)
                        .is_some_and(|matches| {
                            matches
                                .iter()
                                .filter_map(Value::as_str)
                                .any(|pattern| matches_page(pattern, source))
                        });
                let from_extension = source.scheme() == EXTENSION_SCHEME
                    && entry
                        .get("extension_ids")
                        .and_then(Value::as_array)
                        .is_some_and(|ids| ids.iter().any(|id| id == "*"));
                (from_page || from_extension) && entry.get("resources").is_some_and(lists_path)
            }
            _ => false,
        })
    })
}

/// A match pattern against a web page's address.
fn matches_page(pattern: &str, page: &url::Url) -> bool {
    if !matches!(page.scheme(), "http" | "https") {
        return false;
    }
    if pattern == "<all_urls>" {
        return true;
    }
    let Some((scheme, rest)) = pattern.split_once("://") else {
        return false;
    };
    let Some((host, path)) = rest.split_once('/') else {
        return false;
    };
    let host_matches = page.host_str().is_some_and(|name| {
        host == "*"
            || host == name
            || host
                .strip_prefix("*.")
                .is_some_and(|base| name == base || name.ends_with(&format!(".{base}")))
    });
    (scheme == "*" || scheme == page.scheme())
        && host_matches
        && glob(path, page.path().trim_start_matches('/'))
}

/// `*` matches any run of characters; everything else matches itself.
fn glob(pattern: &str, text: &str) -> bool {
    let (mut pending, mut rest) = (pattern.split('*'), text);
    let Some(first) = pending.next() else {
        return text.is_empty();
    };
    let Some(after) = rest.strip_prefix(first) else {
        return false;
    };
    rest = after;
    let parts: Vec<&str> = pending.collect();
    let Some((last, middle)) = parts.split_last() else {
        return rest.is_empty();
    };
    for part in middle {
        let Some(found) = rest.find(part) else {
            return false;
        };
        rest = &rest[found + part.len()..];
    }
    rest.ends_with(last)
}

#[cfg(test)]
mod tests;
