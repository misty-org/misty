//! Search suggestions for the address bar, fetched from the selected engine.
//!
//! The webview cannot read these endpoints itself (they send no CORS headers),
//! so the host fetches them. Callers name an engine from the shared table and
//! pass the typed text; they never supply a URL, so this is not a general
//! fetch proxy. Requests carry no cookies, and any failure is an empty list:
//! suggestions are a convenience, never something the address bar waits on.

use serde::Deserialize;
use std::{sync::OnceLock, time::Duration};

const ENGINES: &str = include_str!("../../../src/shared/contracts/browser-search-engines.json");
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
    let template = engines().iter().find(|engine| engine.id == engine_id)?.suggest.as_deref()?;
    let query: String = url::form_urlencoded::byte_serialize(text.as_bytes()).collect();
    Some(template.replace("%s", &query))
}

/// OpenSearch suggestions: `["query", ["suggestion", ...], ...]`.
fn parse_open_search(body: &[u8], text: &str) -> Vec<String> {
    let Ok(serde_json::Value::Array(parts)) = serde_json::from_slice(body) else {
        return Vec::new();
    };
    let Some(serde_json::Value::Array(values)) = parts.get(1) else { return Vec::new() };
    let mut seen = std::collections::HashSet::new();
    values
        .iter()
        .filter_map(|value| value.as_str())
        .map(|value| value.trim().chars().take(MAX_TEXT_CHARS).collect::<String>())
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case(text))
        .filter(|value| seen.insert(value.to_lowercase()))
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
pub async fn browser_search_suggest(request: BrowserSearchSuggestRequest) -> Vec<String> {
    let text = request.text.trim();
    if text.is_empty() || text.chars().count() > MAX_TEXT_CHARS {
        return Vec::new();
    }
    let (Some(url), Some(client)) = (suggest_url(&request.engine, text), client()) else {
        return Vec::new();
    };
    let Ok(response) = client.get(url).send().await.and_then(|r| r.error_for_status()) else {
        return Vec::new();
    };
    if response.content_length().is_some_and(|length| length as usize > MAX_RESPONSE_BYTES) {
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
        let url = suggest_url("duckduckgo", "a&b c/?").unwrap();
        assert!(url.ends_with("q=a%26b+c%2F%3F"), "{url}");
        assert!(suggest_url("https://evil.invalid/?q=%s", "x").is_none());
    }

    #[test]
    fn parses_open_search_and_drops_echoes_duplicates_and_junk() {
        let body = br#"["mist",["mist","Misty","misty"," misty step ",7,""],[],{}]"#;
        assert_eq!(parse_open_search(body, "mist"), vec!["Misty", "misty step"]);
        assert!(parse_open_search(b"<html>", "mist").is_empty());
        assert!(parse_open_search(br#"{"items":[]}"#, "mist").is_empty());
    }
}
