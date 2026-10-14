//! Search suggestions for the address bar, fetched from the selected engine.
//!
//! The webview cannot read these endpoints itself (they send no CORS headers),
//! so the host fetches them. Callers name an engine from the shared table and
//! pass the typed text; they never supply a URL, so this is not a general
//! fetch proxy. Requests carry no cookies, and any failure is an empty list:
//! suggestions are a convenience, never something the address bar waits on.

use serde::{Deserialize, Serialize};
use std::{sync::OnceLock, time::Duration};

const ENGINES: &str = include_str!("../../../src/shared/schemas/browser-search-engines.json");
const MAX_TEXT_CHARS: usize = 200;
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_SUGGESTIONS: usize = 8;
const TIMEOUT: Duration = Duration::from_millis(1_500);

#[derive(Deserialize)]
struct Engine {
    id: String,
    suggest: Option<String>,
}

fn engines() -> &'static [Engine] {
    static TABLE: OnceLock<Vec<Engine>> = OnceLock::new();
    TABLE.get_or_init(|| serde_json::from_str(ENGINES).expect("valid search engine table"))
}

fn client() -> Option<&'static reqwest::Client> {
    static CLIENT: OnceLock<Option<reqwest::Client>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .timeout(TIMEOUT)
                .redirect(reqwest::redirect::Policy::limited(2))
                .build()
                .ok()
        })
        .as_ref()
}

fn suggest_url(engine_id: &str, text: &str) -> Option<String> {
    let template = engines()
        .iter()
        .find(|engine| engine.id == engine_id)?
        .suggest
        .as_deref()?;
    let query: String = url::form_urlencoded::byte_serialize(text.as_bytes()).collect();
    Some(template.replace("%s", &query))
}

/// One suggestion. A navigational one (Google's `NAVIGATION` type) names the site itself.
#[derive(Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Suggestion {
    Query(String),
    Site { text: String, url: String },
}

fn clean(value: &str) -> String {
    value.trim().chars().take(MAX_TEXT_CHARS).collect()
}

/// An http(s) address from a navigational suggestion, which may omit the scheme.
fn site_url(value: &str) -> Option<String> {
    let value = value.trim();
    let candidate = if value.contains("://") {
        value.to_string()
    } else {
        format!("https://{value}")
    };
    let parsed = url::Url::parse(&candidate).ok()?;
    (matches!(parsed.scheme(), "http" | "https")
        && parsed.host_str().is_some_and(|h| h.contains('.')))
    .then(|| parsed.to_string())
}

/// OpenSearch suggestions: `["query", ["suggestion", ...], ["title", ...], [], {metadata}]`.
/// Google's metadata marks which entries are sites (`google:suggesttype`).
fn parse_open_search(body: &[u8], text: &str) -> Vec<Suggestion> {
    let Ok(serde_json::Value::Array(parts)) = serde_json::from_slice(body) else {
        return Vec::new();
    };
    let Some(serde_json::Value::Array(values)) = parts.get(1) else {
        return Vec::new();
    };
    let titles = parts.get(2).and_then(|v| v.as_array());
    let kinds = parts
        .get(4)
        .and_then(|meta| meta.get("google:suggesttype"))
        .and_then(|v| v.as_array());
    let mut seen = std::collections::HashSet::new();
    values
        .iter()
        .enumerate()
        .filter_map(|(index, value)| {
            let value = value.as_str()?;
            let is_site = kinds
                .and_then(|kinds| kinds.get(index))
                .and_then(|kind| kind.as_str())
                == Some("NAVIGATION");
            if is_site {
                let url = site_url(value)?;
                let title = titles
                    .and_then(|titles| titles.get(index))
                    .and_then(|title| title.as_str())
                    .map(clean)
                    .filter(|title| !title.is_empty())
                    .unwrap_or_else(|| clean(value));
                return Some(Suggestion::Site { text: title, url });
            }
            Some(Suggestion::Query(clean(value)))
        })
        .filter(|suggestion| match suggestion {
            Suggestion::Query(value) => !value.is_empty() && !value.eq_ignore_ascii_case(text),
            Suggestion::Site { .. } => true,
        })
        .filter(|suggestion| {
            seen.insert(match suggestion {
                Suggestion::Query(value) => value.to_lowercase(),
                Suggestion::Site { url, .. } => url.to_lowercase(),
            })
        })
        .take(MAX_SUGGESTIONS)
        .collect()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSearchSuggestRequest {
    pub engine: String,
    pub text: String,
}

#[tauri::command]
pub async fn browser_search_suggest(request: BrowserSearchSuggestRequest) -> Vec<Suggestion> {
    let text = request.text.trim();
    if text.is_empty() || text.chars().count() > MAX_TEXT_CHARS {
        return Vec::new();
    }
    let (Some(url), Some(client)) = (suggest_url(&request.engine, text), client()) else {
        return Vec::new();
    };
    let Ok(response) = client
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
    else {
        return Vec::new();
    };
    if response
        .content_length()
        .is_some_and(|length| length as usize > MAX_RESPONSE_BYTES)
    {
        return Vec::new();
    }
    match response.bytes().await {
        Ok(body) if body.len() <= MAX_RESPONSE_BYTES => parse_open_search(&body, text),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_engine_has_an_https_suggest_endpoint_with_a_query_slot() {
        for engine in engines() {
            let template = engine.suggest.as_deref().expect("suggest endpoint");
            assert!(template.starts_with("https://"), "{}", engine.id);
            assert_eq!(template.matches("%s").count(), 1, "{}", engine.id);
        }
    }

    #[test]
    fn suggest_url_encodes_the_query_and_rejects_unknown_engines() {
        let url = suggest_url("google", "a&b c/?").unwrap();
        assert!(url.ends_with("q=a%26b+c%2F%3F"), "{url}");
        assert!(suggest_url("https://evil.invalid/?q=%s", "x").is_none());
    }

    #[test]
    fn parses_open_search_and_drops_echoes_duplicates_and_junk() {
        let body = br#"["mist",["mist","Misty","misty"," misty step ",7,""],[],{}]"#;
        assert_eq!(
            parse_open_search(body, "mist"),
            vec![
                Suggestion::Query("Misty".into()),
                Suggestion::Query("misty step".into())
            ]
        );
        assert!(parse_open_search(b"<html>", "mist").is_empty());
        assert!(parse_open_search(br#"{"items":[]}"#, "mist").is_empty());
    }

    #[test]
    fn google_navigational_suggestions_carry_the_site() {
        let body = br#"["leet",["leetcode","https://leetcode.com/","leetcode.com"],["","LeetCode","LeetCode"],[],{"google:suggesttype":["QUERY","NAVIGATION","NAVIGATION"]}]"#;
        assert_eq!(
            parse_open_search(body, "leet"),
            vec![
                Suggestion::Query("leetcode".into()),
                Suggestion::Site {
                    text: "LeetCode".into(),
                    url: "https://leetcode.com/".into()
                },
            ]
        );
    }
}
