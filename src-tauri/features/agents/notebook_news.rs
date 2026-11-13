//! A notebook's news, fetched on this computer from the person's search provider (Decodo or
//! Serper) on their own search key, read here from the keychain and sent only to that provider. The
//! renderer gets the stories, never the key, and nothing reaches Misty's server.
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::Manager;

use crate::agents::models::{header, KEY_SERVICE};
use crate::app::runtime::MistyRuntime;

const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_QUERY: usize = 200;

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NewsItem {
    pub title: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
}

fn person_window(webview: &tauri::Webview, refusal: &str) -> Result<(), String> {
    if crate::browser::app_windows::is_person_window(webview.label()) {
        Ok(())
    } else {
        Err(refusal.to_owned())
    }
}

fn client() -> Result<reqwest::Client, ()> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    agent_runs::runtime_client_builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|_| ())
}

/// Recent news about `query` on the person's search provider and key. `recency` is "day", "week"
/// or "month".
#[tauri::command]
pub async fn notebook_news(
    webview: tauri::Webview,
    query: String,
    recency: Option<String>,
) -> Result<Vec<NewsItem>, String> {
    person_window(&webview, "Only Misty's own windows can read news.")?;
    let query = query.trim().to_owned();
    if query.is_empty() || query.chars().count() > MAX_QUERY || query.chars().any(char::is_control)
    {
        return Err("Name what to follow in a few words.".into());
    }
    if recency
        .as_deref()
        .is_some_and(|recency| !matches!(recency, "day" | "week" | "month"))
    {
        return Err("That isn't a news period.".into());
    }
    const NO_SEARCH: &str = "Add a search key in Settings › Models to follow news.";
    let runtime = webview
        .app_handle()
        .try_state::<MistyRuntime>()
        .ok_or(NO_SEARCH)?;
    let document = runtime
        .settings
        .document()
        .await
        .map_err(|_| NO_SEARCH.to_owned())?;
    let section = document.get("models").cloned().unwrap_or(Value::Null);
    let saved = tokio::task::spawn_blocking(move || {
        header::search(&section, &|provider| {
            crate::account::credential_store::load(KEY_SERVICE, provider)
                .ok()
                .flatten()
        })
    })
    .await
    .map_err(|_| NO_SEARCH.to_owned())?
    .ok_or(NO_SEARCH)?;
    let provider = saved
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let api_key = saved
        .get("apiKey")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let client = client().map_err(|_| "The news search didn't work. Try again.".to_owned())?;
    let hits = agent_runs::device_news(
        &client,
        &provider,
        &api_key,
        &query,
        recency.as_deref(),
        agent_runs::MAX_NEWS,
    )
    .await
    .map_err(|error| match error {
        agent_runs::NewsSearchError::KeyRefused => {
            "The search service didn't accept the search key. Check it in Settings › Models."
                .to_owned()
        }
        agent_runs::NewsSearchError::UnknownProvider => NO_SEARCH.to_owned(),
        agent_runs::NewsSearchError::Failed => "The news search didn't work. Try again.".to_owned(),
    })?;
    Ok(hits
        .into_iter()
        .map(|hit| NewsItem {
            title: hit.title,
            url: hit.url,
            source: hit.source,
            published: hit.published,
            snippet: hit.snippet,
        })
        .collect())
}
