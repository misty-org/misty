//! Built-in ad and tracker blocking. One list of known ad and tracking hosts,
//! blocked only when a page loads them from another site, never as the page
//! itself. WebKit engines get it as a compiled content rule list; WebView2
//! checks each request against the same rules.

use std::sync::{
    atomic::{AtomicU64, Ordering},
    RwLock,
};
use url::Url;

/// Hosts whose only job is ads or tracking. A request to one of these, or to a
/// subdomain, is blocked when it comes from another site's page.
const BLOCKED_HOSTS: &str = include_str!("content_filter/hosts.txt");

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FilterConfig {
    pub enabled: bool,
    /// Sites (hosts) where blocking is turned off, including their subdomains.
    pub allowed_sites: Vec<String>,
}

static CONFIG: RwLock<FilterConfig> = RwLock::new(FilterConfig {
    enabled: false,
    allowed_sites: Vec::new(),
});
static GENERATION: AtomicU64 = AtomicU64::new(1);

fn blocked_hosts() -> impl Iterator<Item = &'static str> {
    BLOCKED_HOSTS
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
}

fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'-'))
}

/// Replaces the configuration. Returns whether anything changed, in which case
/// engines must reinstall their filters.
pub fn configure(enabled: bool, allowed_sites: impl IntoIterator<Item = String>) -> bool {
    let mut allowed: Vec<String> = allowed_sites
        .into_iter()
        .map(|site| site.trim().trim_start_matches("www.").to_ascii_lowercase())
        .filter(|site| valid_host(site))
        .collect();
    allowed.sort();
    allowed.dedup();
    let next = FilterConfig {
        enabled,
        allowed_sites: allowed,
    };
    let Ok(mut config) = CONFIG.write() else {
        return false;
    };
    if *config == next {
        return false;
    }
    *config = next;
    GENERATION.fetch_add(1, Ordering::SeqCst);
    true
}

pub fn config() -> FilterConfig {
    CONFIG
        .read()
        .map(|config| config.clone())
        .unwrap_or_default()
}

/// Changes whenever the configuration does; engines cache compiled rules by it.
pub fn generation() -> u64 {
    GENERATION.load(Ordering::SeqCst)
}

fn matches_domain(host: &str, domain: &str) -> bool {
    host == domain
        || host
            .strip_suffix(domain)
            .is_some_and(|prefix| prefix.ends_with('.'))
}

/// The registrable domain ("site"), so `a.example.co.uk` and `b.example.co.uk`
/// are the same party.
fn site(host: &str) -> String {
    psl::domain_str(host).unwrap_or(host).to_owned()
}

/// Whether a subresource request should be blocked on a page. The page itself
/// (`is_document`) is never blocked, so visiting a listed site still works.
pub fn should_block(request: &str, page: Option<&str>, is_document: bool) -> bool {
    if is_document {
        return false;
    }
    let config = config();
    if !config.enabled {
        return false;
    }
    let Some(request_host) = Url::parse(request)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https" | "ws" | "wss"))
        .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
    else {
        return false;
    };
    let page_host = page
        .and_then(|page| Url::parse(page).ok())
        .and_then(|url| url.host_str().map(str::to_ascii_lowercase));
    if let Some(page_host) = &page_host {
        if config
            .allowed_sites
            .iter()
            .any(|allowed| matches_domain(page_host, allowed))
            || site(page_host) == site(&request_host)
        {
            return false;
        }
    }
    blocked_hosts().any(|domain| matches_domain(&request_host, domain))
}

fn regex_escape(host: &str) -> String {
    host.replace('.', "\\.")
}

/// The WebKit content blocker JSON for the current configuration, or `None`
/// when blocking is off and engines should remove their rules.
pub fn webkit_rules() -> Option<String> {
    let config = config();
    if !config.enabled {
        return None;
    }
    let mut rules: Vec<serde_json::Value> = blocked_hosts()
        .map(|host| {
            serde_json::json!({
                "trigger": {
                    "url-filter": format!("^[a-z][a-z0-9.+-]*://([^/:]+\\.)?{}[/:]", regex_escape(host)),
                    "load-type": ["third-party"],
                },
                "action": { "type": "block" },
            })
        })
        .collect();
    if !config.allowed_sites.is_empty() {
        rules.push(serde_json::json!({
            "trigger": {
                "url-filter": ".*",
                "if-domain": config
                    .allowed_sites
                    .iter()
                    .map(|site| format!("*{site}"))
                    .collect::<Vec<_>>(),
            },
            "action": { "type": "ignore-previous-rules" },
        }));
    }
    Some(serde_json::Value::Array(rules).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_listed_hosts_only_as_third_party_subresources() {
        configure(true, Vec::new());
        assert!(should_block(
            "https://securepubads.g.doubleclick.net/tag.js",
            Some("https://news.example/"),
            false
        ));
        assert!(!should_block(
            "https://doubleclick.net/",
            Some("https://doubleclick.net/"),
            false
        ));
        assert!(!should_block("https://doubleclick.net/", None, true));
        assert!(!should_block(
            "https://cdn.example/app.js",
            Some("https://news.example/"),
            false
        ));
        configure(true, vec!["news.example".to_owned()]);
        assert!(!should_block(
            "https://securepubads.g.doubleclick.net/tag.js",
            Some("https://www.news.example/"),
            false
        ));
        configure(false, Vec::new());
        assert!(webkit_rules().is_none());
    }
}
