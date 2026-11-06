//! What part of each website's data can sync. An item this computer cannot store exactly is
//! skipped here, never deleted for other computers, and reported. Reports carry only site hosts
//! and fixed reasons: never cookie names, values, storage keys or their contents.
use misty_browser_sync::document::credentials::Cookie;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SkipReason {
    /// Partitioned (CHIPS) cookies have no portable partition key.
    Partitioned,
    /// Engine attributes (ports, unknown policies) that would be lost or changed by copying.
    UnsupportedAttributes,
    /// Data another computer synced that this computer's browser cannot hold. It is kept for
    /// the other computers rather than deleted.
    NotSupportedHere,
    Malformed,
    Duplicate,
    TooLarge,
}

/// The site a cookie domain or an HTTP(S) origin belongs to.
pub(crate) fn site(domain_or_origin: &str) -> String {
    url::Url::parse(domain_or_origin)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_else(|| {
            domain_or_origin
                .trim_start_matches('.')
                .to_ascii_lowercase()
        })
}

type CookieIdentity = (String, String, bool, String);
fn identity(cookie: &Cookie) -> CookieIdentity {
    (
        cookie.name.clone(),
        cookie.domain.trim_start_matches('.').to_ascii_lowercase(),
        cookie.host_only,
        cookie.path.clone(),
    )
}

/// Cookies read from an engine: the exactly representable ones, and the site
/// and reason of each one skipped.
#[derive(Default)]
pub(crate) struct CookieRead {
    pub cookies: Vec<Cookie>,
    pub skipped: Vec<(String, SkipReason)>,
}

impl CookieRead {
    /// Keep each valid cookie once, up to the shared model's limit. An engine
    /// alias of an identity already kept is skipped instead of failing the read.
    pub fn accept(
        items: impl IntoIterator<Item = Result<Cookie, (String, SkipReason)>>,
        limit: usize,
    ) -> Self {
        let mut read = Self::default();
        let mut seen = BTreeSet::new();
        for item in items {
            match item {
                Ok(cookie) if cookie.validate().is_err() => read
                    .skipped
                    .push((site(&cookie.domain), SkipReason::Malformed)),
                Ok(cookie) if !seen.insert(identity(&cookie)) => read
                    .skipped
                    .push((site(&cookie.domain), SkipReason::Duplicate)),
                Ok(cookie) if read.cookies.len() >= limit => read
                    .skipped
                    .push((site(&cookie.domain), SkipReason::TooLarge)),
                Ok(cookie) => read.cookies.push(cookie),
                Err(skip) => read.skipped.push(skip),
            }
        }
        read
    }
}

#[cfg(test)]
mod tests;
