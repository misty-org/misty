use serde::{Deserialize, Serialize};
use std::{sync::OnceLock, time::Duration};

const SUGGEST_URL: &str =
    "https://suggestqueries.google.com/complete/search?client=chrome&ie=utf-8&oe=utf-8&q=";
const MAX_TEXT_CHARS: usize = 200;
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_SUGGESTIONS: usize = 6;
const TIMEOUT: Duration = Duration::from_millis(1_500);

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

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SearchSuggestion {
    Query { text: String },
    Site { text: String, url: String },
}

fn clean(value: &str) -> String {
    value.trim().chars().take(MAX_TEXT_CHARS).collect()
}

fn site_url(value: &str) -> Option<String> {
    let value = value.trim();
    let candidate = if value.contains("://") {
        value.to_string()
    } else {
        format!("https://{value}")
    };
    let parsed = url::Url::parse(&candidate).ok()?;
    (matches!(parsed.scheme(), "http" | "https")
        && parsed.host_str().is_some_and(|host| host.contains('.')))
    .then(|| parsed.to_string())
}

fn parse(body: &[u8], text: &str) -> Vec<SearchSuggestion> {
    let Ok(serde_json::Value::Array(parts)) = serde_json::from_slice(body) else {
        return Vec::new();
    };
    let Some(serde_json::Value::Array(values)) = parts.get(1) else {
        return Vec::new();
    };
    let titles = parts.get(2).and_then(|value| value.as_array());
    let kinds = parts
        .get(4)
        .and_then(|meta| meta.get("google:suggesttype"))
        .and_then(|value| value.as_array());
    let mut seen = std::collections::HashSet::new();
    values
        .iter()
        .enumerate()
        .filter_map(|(index, value)| {
            let value = value.as_str()?;
            let site = kinds
                .and_then(|kinds| kinds.get(index))
                .and_then(|kind| kind.as_str())
                == Some("NAVIGATION");
            if site {
                let url = site_url(value)?;
                let title = titles
                    .and_then(|titles| titles.get(index))
                    .and_then(|title| title.as_str())
                    .map(clean)
                    .filter(|title| !title.is_empty())
                    .unwrap_or_else(|| clean(value));
                return Some(SearchSuggestion::Site { text: title, url });
            }
            Some(SearchSuggestion::Query { text: clean(value) })
        })
        .filter(|suggestion| match suggestion {
            SearchSuggestion::Query { text: value } => {
                !value.is_empty() && !value.eq_ignore_ascii_case(text)
            }
            SearchSuggestion::Site { .. } => true,
        })
        .filter(|suggestion| {
            seen.insert(match suggestion {
                SearchSuggestion::Query { text } => text.to_lowercase(),
                SearchSuggestion::Site { url, .. } => url.to_lowercase(),
            })
        })
        .take(MAX_SUGGESTIONS)
        .collect()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSearchSuggestRequest {
    pub text: String,
}

#[tauri::command]
pub async fn browser_search_suggest(request: BrowserSearchSuggestRequest) -> Vec<SearchSuggestion> {
    let text = request.text.trim();
    if text.is_empty() || text.chars().count() > MAX_TEXT_CHARS {
        return Vec::new();
    }
    let Some(client) = client() else {
        return Vec::new();
    };
    let query: String = url::form_urlencoded::byte_serialize(text.as_bytes()).collect();
    let Ok(response) = client
        .get(format!("{SUGGEST_URL}{query}"))
        .send()
        .await
        .and_then(|response| response.error_for_status())
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
        Ok(body) if body.len() <= MAX_RESPONSE_BYTES => parse(&body, text),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_echoes_duplicates_and_junk() {
        let body = br#"["mist",["mist","Misty","misty"," misty step ",7,""],[],{}]"#;
        assert_eq!(
            parse(body, "mist"),
            vec![
                SearchSuggestion::Query { text: "Misty".into() },
                SearchSuggestion::Query { text: "misty step".into() }
            ]
        );
        assert!(parse(b"<html>", "mist").is_empty());
    }

    #[test]
    fn navigational_suggestions_carry_the_site() {
        let body = br#"["leet",["leetcode","https://leetcode.com/"],["","LeetCode"],[],{"google:suggesttype":["QUERY","NAVIGATION"]}]"#;
        assert_eq!(
            parse(body, "leet"),
            vec![
                SearchSuggestion::Query { text: "leetcode".into() },
                SearchSuggestion::Site {
                    text: "LeetCode".into(),
                    url: "https://leetcode.com/".into()
                },
            ]
        );
    }
}
