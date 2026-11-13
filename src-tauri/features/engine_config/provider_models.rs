// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//
// Fetch models: probe a channel's `/v1/models`-style endpoint for the model list the channel
// dialog suggests. Relays answer in the OpenAI (`{ data: [{ id }] }`), bare-array or Anthropic
// (`{ models: [...] }`) shape, so the parser takes all three. The request goes only to the
// channel's own base URL, with its own key.

use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelList {
    pub models: Vec<String>,
    /// The candidate URL that answered — shown in the UI so the user can see
    /// which derivation of their base URL worked.
    pub endpoint: String,
}

fn push_unique_candidate(candidates: &mut Vec<String>, candidate: String) {
    if !candidate.trim().is_empty() && !candidates.contains(&candidate) {
        candidates.push(candidate);
    }
}

/// Candidate model-list URLs for a channel base URL, most specific first:
/// the URL itself + /v1/models, then derivations for the common conventions
/// (trailing /v1, trailing /anthropic, bare origin).
fn model_list_candidates(base_url: &str) -> Vec<String> {
    let base = base_url.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return Vec::new();
    }

    let mut candidates = Vec::new();
    push_unique_candidate(&mut candidates, format!("{base}/v1/models"));

    if base.ends_with("/v1") {
        push_unique_candidate(&mut candidates, format!("{base}/models"));
    }

    if let Some(stripped) = base.strip_suffix("/anthropic") {
        let stripped = stripped.trim_end_matches('/');
        if !stripped.is_empty() {
            push_unique_candidate(&mut candidates, format!("{stripped}/v1/models"));
        }
    }

    if let Ok(parsed) = reqwest::Url::parse(&base) {
        if let Some(host) = parsed.host_str() {
            let origin = match parsed.port() {
                Some(port) => format!("{}://{}:{}", parsed.scheme(), host, port),
                None => format!("{}://{}", parsed.scheme(), host),
            };
            push_unique_candidate(&mut candidates, format!("{origin}/v1/models"));
        }
    }

    candidates
}

fn push_model_id(models: &mut Vec<String>, value: &Value) {
    let candidate = match value {
        Value::String(value) => Some(value.as_str()),
        Value::Object(map) => map.get("id").and_then(Value::as_str),
        _ => None,
    };
    let Some(candidate) = candidate.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };
    if !models.iter().any(|model| model == candidate) {
        models.push(candidate.to_string());
    }
}

/// Model ids out of the OpenAI (`data`), bare-array, and Anthropic (`models`)
/// response shapes.
fn extract_model_ids(value: &Value) -> Vec<String> {
    let mut models = Vec::new();

    if let Some(data) = value.get("data").and_then(Value::as_array) {
        for item in data {
            push_model_id(&mut models, item);
        }
        return models;
    }

    if let Some(data) = value.as_array() {
        for item in data {
            push_model_id(&mut models, item);
        }
        return models;
    }

    if let Some(data) = value.get("models").and_then(Value::as_array) {
        for item in data {
            push_model_id(&mut models, item);
        }
    }

    models
}

/// GET the channel's model list. The key rides both auth headers — OpenAI
/// relays read `Authorization: Bearer`, Anthropic relays read `x-api-key`.
/// Used by the `engine_channels_models` command.
pub(crate) async fn fetch_provider_models_inner(
    base_url: String,
    api_key: String,
) -> Result<ProviderModelList, String> {
    if base_url.trim().is_empty() {
        return Err("Enter a base URL first.".to_string());
    }

    let client = super::proxy::apply_to_client(
        reqwest::Client::builder()
            .user_agent(concat!("Misty/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(15)),
    )
    .build()
    .map_err(|e| format!("build http client: {e}"))?;
    let api_key = api_key.trim().to_string();
    let mut last_error: Option<String> = None;

    for endpoint in model_list_candidates(&base_url) {
        let response = match client
            .get(&endpoint)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("x-api-key", api_key.as_str())
            .send()
            .await
        {
            Ok(response) => response,
            Err(e) => {
                last_error = Some(format!("{endpoint}: {e}"));
                continue;
            }
        };

        let status = response.status();
        if !status.is_success() {
            last_error = Some(format!("{endpoint} returned HTTP {status}"));
            continue;
        }

        let body = match response.text().await {
            Ok(body) => body,
            Err(e) => {
                last_error = Some(format!("{endpoint}: failed to read response body: {e}"));
                continue;
            }
        };

        let value = match serde_json::from_str::<Value>(&body) {
            Ok(value) => value,
            Err(e) => {
                last_error = Some(format!("{endpoint}: failed to parse JSON response: {e}"));
                continue;
            }
        };

        return Ok(ProviderModelList {
            models: extract_model_ids(&value),
            endpoint,
        });
    }

    Err(format!(
        "failed to fetch models: {}",
        last_error.unwrap_or_else(|| "no candidate endpoint succeeded".to_string())
    ))
}

/// The model list for a channel. With `id`, the saved channel's base URL and key are used (the
/// key never comes from or goes to the window); `base_url` and `api_key` override them while the
/// person is still editing.
#[tauri::command]
pub async fn engine_channels_models(
    engine: String,
    id: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
) -> Result<ProviderModelList, String> {
    let saved = match id.filter(|id| !id.trim().is_empty()) {
        Some(id) => {
            let engine = super::channels::checked_engine(&engine)?;
            Some(
                tauri::async_runtime::spawn_blocking(move || {
                    super::channels::probe_config(&engine, &id)
                })
                .await
                .map_err(|e| e.to_string())??,
            )
        }
        None => None,
    };
    let pick = |typed: Option<String>, stored: Option<String>| {
        typed
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or(stored)
            .unwrap_or_default()
    };
    let base_url = pick(base_url, saved.as_ref().and_then(|s| s.base_url.clone()));
    let api_key = pick(api_key, saved.and_then(|s| s.api_key));
    fetch_provider_models_inner(base_url, api_key).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidates_plain_base() {
        assert_eq!(
            model_list_candidates("https://api.example.com"),
            vec!["https://api.example.com/v1/models"]
        );
    }

    #[test]
    fn candidates_trailing_v1() {
        assert_eq!(
            model_list_candidates("https://api.example.com/v1"),
            vec![
                "https://api.example.com/v1/v1/models",
                "https://api.example.com/v1/models",
            ]
        );
    }

    #[test]
    fn candidates_trailing_anthropic() {
        assert_eq!(
            model_list_candidates("https://proxy.example.com/anthropic"),
            vec![
                "https://proxy.example.com/anthropic/v1/models",
                "https://proxy.example.com/v1/models",
            ]
        );
    }

    #[test]
    fn candidates_strip_slashes_and_add_origin() {
        assert_eq!(
            model_list_candidates(" https://localhost:8787/api/anthropic/// "),
            vec![
                "https://localhost:8787/api/anthropic/v1/models",
                "https://localhost:8787/api/v1/models",
                "https://localhost:8787/v1/models",
            ]
        );
    }

    #[test]
    fn extract_openai_shape() {
        let value = serde_json::json!({"data": [{"id": "a"}, {"id": "b"}, {"id": "a"}]});
        assert_eq!(extract_model_ids(&value), vec!["a", "b"]);
    }

    #[test]
    fn extract_bare_array_and_anthropic_models_shape() {
        let bare = serde_json::json!(["x", {"id": "y"}]);
        assert_eq!(extract_model_ids(&bare), vec!["x", "y"]);
        let anthropic = serde_json::json!({"models": [{"id": "m1"}]});
        assert_eq!(extract_model_ids(&anthropic), vec!["m1"]);
    }
}
