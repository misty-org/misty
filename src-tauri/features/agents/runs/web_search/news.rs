//! Recent news for a notebook that follows something (a company, a ticker, a topic), on this
//! device's search provider and the person's own search key. The app asks for it directly, not
//! through a run: it's the same request a `web.search` of kind "news" makes, and nothing of it
//! reaches Misty's server.
use std::time::Duration;

use crate::js_json::JsValue;

use super::{
    decodo::{self, DECODO_ENDPOINT},
    provider::{field, SearchProviderId, WebSearchRequest},
    serper::{self, SERPER_BASE},
};

const TIMEOUT_MS: u64 = 15_000;
/// The most news items one call returns.
pub const MAX_NEWS: u32 = 20;

/// One news story, as the provider listed it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NewsHit {
    pub title: String,
    pub url: String,
    pub source: Option<String>,
    /// The provider's own date text ("2 hours ago", "Nov 12, 2026"), unparsed.
    pub published: Option<String>,
    pub snippet: Option<String>,
}

/// Why a news search failed. It never carries the provider's body or the key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NewsSearchError {
    /// The provider named isn't one Misty searches with.
    UnknownProvider,
    /// The provider refused the key (401 or 403).
    KeyRefused,
    /// Anything else: the network, a timeout, another status.
    Failed,
}

/// Searches news on `provider` ("decodo" or "serper") with the person's key. `recency` is "day",
/// "week", "month" or "year"; anything else searches without a date limit.
pub async fn device_news(
    client: &reqwest::Client,
    provider: &str,
    api_key: &str,
    query: &str,
    recency: Option<&str>,
    limit: u32,
) -> Result<Vec<NewsHit>, NewsSearchError> {
    let provider = match provider {
        "decodo" => SearchProviderId::Decodo,
        "serper" => SearchProviderId::Serper,
        _ => return Err(NewsSearchError::UnknownProvider),
    };
    let limit = limit.clamp(1, MAX_NEWS);
    let request = WebSearchRequest {
        query: query.to_owned(),
        kind: "news".to_owned(),
        domains: Vec::new(),
        recency: recency.map(str::to_owned),
        location: None,
        near: None,
        limit,
    };
    let call = async {
        match provider {
            SearchProviderId::Decodo => {
                decodo::search(client, DECODO_ENDPOINT, api_key, &request).await
            }
            SearchProviderId::Serper => {
                serper::search(client, SERPER_BASE, api_key, &request).await
            }
        }
    };
    let answer = tokio::time::timeout(Duration::from_millis(TIMEOUT_MS), call)
        .await
        .map_err(|_| NewsSearchError::Failed)?
        .map_err(|failure| {
            if failure.status == 401 || failure.status == 403 {
                NewsSearchError::KeyRefused
            } else {
                NewsSearchError::Failed
            }
        })?;
    Ok(answer
        .results
        .iter()
        .filter_map(news_hit)
        .take(limit as usize)
        .collect())
}

/// A search hit as a news story; a hit without a link isn't one.
fn news_hit(hit: &JsValue) -> Option<NewsHit> {
    let url = field(hit, &["url"]);
    if url.is_empty() {
        return None;
    }
    let optional = |name: &str| Some(field(hit, &[name])).filter(|text| !text.is_empty());
    let title = field(hit, &["title"]);
    Some(NewsHit {
        title: if title.is_empty() { url.clone() } else { title },
        url,
        source: optional("source"),
        published: optional("published"),
        snippet: optional("snippet"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool_transport::{object, string};

    #[test]
    fn a_hit_becomes_a_story_with_only_the_fields_it_has() {
        let hit = object([
            ("title", string("Nvidia shares fall")),
            ("url", string("https://example.com/story")),
            ("snippet", string("Shares fell 5%.")),
            ("published", string("2 hours ago")),
        ]);
        assert_eq!(
            news_hit(&hit),
            Some(NewsHit {
                title: "Nvidia shares fall".into(),
                url: "https://example.com/story".into(),
                source: None,
                published: Some("2 hours ago".into()),
                snippet: Some("Shares fell 5%.".into()),
            })
        );
    }

    #[test]
    fn a_hit_without_a_link_is_dropped_and_one_without_a_title_uses_its_link() {
        assert_eq!(news_hit(&object([("title", string("No link"))])), None);
        let story = news_hit(&object([("url", string("https://example.com/a"))])).unwrap();
        assert_eq!(story.title, "https://example.com/a");
    }

    #[tokio::test]
    async fn an_unknown_provider_is_refused_before_any_call() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::new();
        assert_eq!(
            device_news(&client, "bing", "key", "nvda", None, 5).await,
            Err(NewsSearchError::UnknownProvider)
        );
    }
}
