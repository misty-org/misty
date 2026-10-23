//! Sites agents may read but never act on (docs/agents/harness.md,
//! Page layer). Banking, brokerage, crypto and adult sites are blocked by default,
//! as Claude in Chrome does; the account can turn that off and add its own
//! sites. The device enforces this before any input reaches the page.
use serde::Deserialize;
use url::Url;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteBlocks {
    #[serde(default = "default_true")]
    pub sensitive: bool,
    #[serde(default)]
    pub sites: Vec<String>,
}

fn default_true() -> bool {
    true
}

impl Default for SiteBlocks {
    fn default() -> Self {
        Self {
            sensitive: true,
            sites: Vec::new(),
        }
    }
}

/// Top-level domains reserved for banks or adult content.
const SENSITIVE_TLDS: &[&str] = &["bank", "insurance", "xxx", "adult", "porn", "sex"];

/// Well-known banks, brokerages, payment and crypto services, and adult sites.
const SENSITIVE_DOMAINS: &[&str] = &[
    // Banks and brokerages
    "chase.com",
    "bankofamerica.com",
    "wellsfargo.com",
    "citi.com",
    "citibank.com",
    "usbank.com",
    "capitalone.com",
    "pnc.com",
    "truist.com",
    "tdbank.com",
    "schwab.com",
    "fidelity.com",
    "vanguard.com",
    "etrade.com",
    "robinhood.com",
    "interactivebrokers.com",
    "ally.com",
    "discover.com",
    "americanexpress.com",
    "sofi.com",
    "chime.com",
    "hsbc.com",
    "barclays.co.uk",
    "lloydsbank.com",
    "natwest.com",
    "santander.com",
    "rbc.com",
    "td.com",
    "scotiabank.com",
    "bmo.com",
    "cibc.com",
    "ing.com",
    "revolut.com",
    "monzo.com",
    "n26.com",
    "wise.com",
    // Payments
    "paypal.com",
    "venmo.com",
    "cash.app",
    "zellepay.com",
    "stripe.com",
    // Crypto exchanges and wallets
    "coinbase.com",
    "binance.com",
    "binance.us",
    "kraken.com",
    "crypto.com",
    "gemini.com",
    "bitstamp.net",
    "kucoin.com",
    "okx.com",
    "bybit.com",
    "bitfinex.com",
    "blockchain.com",
    "metamask.io",
    "uniswap.org",
    "opensea.io",
    "phantom.app",
    // Adult
    "pornhub.com",
    "xvideos.com",
    "xnxx.com",
    "xhamster.com",
    "onlyfans.com",
    "chaturbate.com",
    "redtube.com",
    "youporn.com",
];

/// A site the account listed: a bare host such as example.com, which also
/// covers its subdomains. Anything else is ignored rather than guessed at.
fn normalize(site: &str) -> Option<String> {
    let site = site.trim().trim_end_matches('.').to_ascii_lowercase();
    let host = site
        .strip_prefix("https://")
        .or_else(|| site.strip_prefix("http://"))
        .unwrap_or(&site)
        .split(['/', '?', '#'])
        .next()?
        .trim_start_matches("*.")
        .trim_start_matches("www.");
    let valid = host.len() <= 253
        && host.contains('.')
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        });
    valid.then(|| host.to_owned())
}

fn matches(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

/// Why an agent may not act on this page, or None when it may.
pub fn blocked(url: &Url, blocks: &SiteBlocks) -> Option<String> {
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host = url.host_str()?.trim_end_matches('.').to_ascii_lowercase();
    if let Some(site) = blocks
        .sites
        .iter()
        .filter_map(|site| normalize(site))
        .find(|site| matches(&host, site))
    {
        return Some(format!("browser_site_blocked: agents can't act on {site}; it is on this account's blocked sites. Ask the person to do this step."));
    }
    if blocks.sensitive {
        let tld = host.rsplit('.').next().unwrap_or("");
        if SENSITIVE_TLDS.contains(&tld)
            || SENSITIVE_DOMAINS
                .iter()
                .any(|domain| matches(&host, domain))
        {
            return Some(format!("browser_site_blocked: agents can read {host} but not act on banking, crypto, payment or adult sites. Ask the person to do this step."));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap()
    }

    #[test]
    fn sensitive_sites_are_blocked_by_default_and_can_be_allowed() {
        let blocks = SiteBlocks::default();
        for site in [
            "https://secure.chase.com/login",
            "https://www.coinbase.com",
            "https://anything.bank/",
            "https://pornhub.com/",
        ] {
            assert!(blocked(&url(site), &blocks).is_some(), "{site}");
        }
        for site in [
            "https://docs.google.com/spreadsheets",
            "https://notchase.com",
            "https://example.com",
            "file:///tmp/x",
        ] {
            assert!(blocked(&url(site), &blocks).is_none(), "{site}");
        }
        let allowed = SiteBlocks {
            sensitive: false,
            sites: Vec::new(),
        };
        assert!(blocked(&url("https://www.chase.com"), &allowed).is_none());
    }

    #[test]
    fn account_sites_cover_subdomains_and_ignore_junk() {
        let blocks = SiteBlocks {
            sensitive: false,
            sites: vec![
                "https://www.Example.com/path".into(),
                "*.intranet.corp".into(),
                "not a site".into(),
                "".into(),
            ],
        };
        assert!(blocked(&url("https://example.com"), &blocks).is_some());
        assert!(blocked(&url("https://mail.example.com/x"), &blocks).is_some());
        assert!(blocked(&url("https://wiki.intranet.corp"), &blocks).is_some());
        assert!(blocked(&url("https://example.org"), &blocks).is_none());
        assert!(blocked(&url("https://notexample.com"), &blocks).is_none());
    }
}
