use std::time::Duration;

use crate::js_json::JsValue;

use super::{
    decodo::{self, DECODO_ENDPOINT},
    provider::{field, SearchProviderId, WebSearchRequest},
    serper::{self, SERPER_BASE},
};

const TIMEOUT_MS: u64 = 15_000;
pub const MAX_NEWS: u32 = 20;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NewsHit {
    pub title: String,
    pub url: String,
    pub source: Option<String>,
    pub published: Option<String>,
    pub snippet: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NewsSearchError {
    UnknownProvider,
    KeyRefused,
    Failed,
}

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
