//! Which provider a pasted key belongs to, and the models a provider offers. A key's prefix
//! names its likely provider; listing that provider's models with the key confirms it, and the
//! list is what Settings › Models offers to pick from.
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    /// `<provider>/<model>`, as the model settings store it.
    pub id: String,
    pub label: String,
    pub embedding: bool,
}

/// The providers a key may be for, most likely first, from its prefix. Ollama Cloud keys have
/// no prefix of their own, so anything unrecognized is tried there.
pub fn candidates(key: &str) -> Vec<&'static str> {
    let key = key.trim();
    let table: [(&str, &str); 8] = [
        ("sk-ant-", "anthropic"),
        ("sk-or-", "openrouter"),
        ("sk-proj-", "openai"),
        ("sk-svcacct-", "openai"),
        ("sk-", "openai"),
        ("AIza", "google"),
        ("nvapi-", "nvidia"),
        ("vck_", "gateway"),
    ];
    match table.iter().find(|(prefix, _)| key.starts_with(prefix)) {
        Some((_, provider)) => vec![provider],
        None if key.starts_with("sk_") => Vec::new(), // ElevenLabs: a voice key
        None => vec!["ollama-cloud"],
    }
}

pub fn label(provider: &str) -> &'static str {
    match provider {
        "openai" => "OpenAI",
        "anthropic" => "Anthropic",
        "google" => "Google",
        "openrouter" => "OpenRouter",
        "gateway" => "Vercel AI Gateway",
        "nvidia" => "NVIDIA",
        "ollama" => "Ollama",
        "ollama-cloud" => "Ollama Cloud",
        "openai-compatible" => "the OpenAI-compatible server",
        "chatgpt" => "ChatGPT",
        _ => "that provider",
    }
}

pub enum Auth {
    Bearer,
    Header(&'static str),
}

/// Where a provider lists its models, and how the key is sent.
pub struct Listing {
    pub url: String,
    pub auth: Auth,
    pub headers: Vec<(&'static str, &'static str)>,
    /// A route that checks the key when the list itself is public.
    pub verify: Option<String>,
}

/// `base` is the device's address for Ollama and OpenAI-compatible servers.
pub fn listing(provider: &str, base: Option<&str>) -> Option<Listing> {
    let simple = |url: &str| Listing {
        url: url.into(),
        auth: Auth::Bearer,
        headers: Vec::new(),
        verify: None,
    };
    Some(match provider {
        "openai" | "chatgpt" => simple("https://api.openai.com/v1/models"),
        "anthropic" => Listing {
            url: "https://api.anthropic.com/v1/models?limit=100".into(),
            auth: Auth::Header("x-api-key"),
            headers: vec![("anthropic-version", "2023-06-01")],
            verify: None,
        },
        "google" => Listing {
            url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200".into(),
            auth: Auth::Header("x-goog-api-key"),
            headers: Vec::new(),
            verify: None,
        },
        "openrouter" => Listing {
            verify: Some("https://openrouter.ai/api/v1/key".into()),
            ..simple("https://openrouter.ai/api/v1/models")
        },
        "gateway" => simple("https://ai-gateway.vercel.sh/v1/models"),
        "nvidia" => simple("https://integrate.api.nvidia.com/v1/models"),
        "ollama-cloud" => simple("https://ollama.com/api/tags"),
        "ollama" => simple(&format!(
            "{}/api/tags",
            base?.trim_end_matches('/').trim_end_matches("/v1")
        )),
        "openai-compatible" => simple(&format!("{}/models", base?.trim_end_matches('/'))),
        _ => return None,
    })
}

fn embedding_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.contains("embed")
}

/// The models in a provider's list reply, in the order it gave them.
pub fn parse(provider: &str, body: &Value) -> Vec<ModelInfo> {
    let rows = |key: &str| body[key].as_array().cloned().unwrap_or_default();
    let model = |name: &str, label: &str, embedding: bool| ModelInfo {
        id: format!("{provider}/{name}"),
        label: if label.is_empty() {
            name.to_owned()
        } else {
            label.to_owned()
        },
        embedding,
    };
    let text = |row: &Value, key: &str| row[key].as_str().unwrap_or_default().to_owned();
    let mut models: Vec<ModelInfo> = match provider {
        "chatgpt" => rows("models")
            .iter()
            .filter(|row| row["visibility"].as_str() == Some("list"))
            .map(|row| model(&text(row, "slug"), &text(row, "display_name"), false))
            .collect(),
        "google" => rows("models")
            .iter()
            .filter_map(|row| {
                let name = text(row, "name");
                let name = name.strip_prefix("models/").unwrap_or(&name).to_owned();
                let methods: Vec<&str> = row["supportedGenerationMethods"]
                    .as_array()?
                    .iter()
                    .filter_map(Value::as_str)
                    .collect();
                let embedding = methods.contains(&"embedContent");
                (embedding || methods.contains(&"generateContent"))
                    .then(|| model(&name, &text(row, "displayName"), embedding))
            })
            .collect(),
        "ollama" | "ollama-cloud" => rows("models")
            .iter()
            .map(|row| {
                let name = text(row, "name");
                model(&name, "", embedding_name(&name))
            })
            .collect(),
        _ => rows("data")
            .iter()
            .map(|row| {
                let name = text(row, "id");
                let embedding = row["type"].as_str() == Some("embedding") || embedding_name(&name);
                let label = [text(row, "display_name"), text(row, "name")]
                    .into_iter()
                    .find(|l| !l.is_empty());
                model(&name, &label.unwrap_or_default(), embedding)
            })
            .collect(),
    };
    models.retain(|model| model.id.len() > provider.len() + 1);
    models
}

#[derive(Debug, PartialEq)]
pub enum ListError {
    Rejected,
    Unreachable,
}

fn request(
    http: &reqwest::Client,
    url: &str,
    listing: &Listing,
    key: &str,
) -> reqwest::RequestBuilder {
    let mut builder = http.get(url);
    if !key.is_empty() {
        builder = match listing.auth {
            Auth::Bearer => builder.bearer_auth(key),
            Auth::Header(name) => builder.header(name, key),
        };
    }
    for (name, value) in &listing.headers {
        builder = builder.header(*name, *value);
    }
    builder
}

/// The models `key` can use at `listing`; a refused key is `Rejected`.
pub async fn list(
    http: &reqwest::Client,
    provider: &str,
    listing: &Listing,
    key: &str,
) -> Result<Vec<ModelInfo>, ListError> {
    let refused = |status: reqwest::StatusCode| matches!(status.as_u16(), 400 | 401 | 403);
    if let Some(verify) = &listing.verify {
        let response = request(http, verify, listing, key)
            .send()
            .await
            .map_err(|_| ListError::Unreachable)?;
        if refused(response.status()) {
            return Err(ListError::Rejected);
        }
    }
    let response = request(http, &listing.url, listing, key)
        .send()
        .await
        .map_err(|_| ListError::Unreachable)?;
    let status = response.status();
    if refused(status) {
        return Err(ListError::Rejected);
    }
    if !status.is_success() {
        return Err(ListError::Unreachable);
    }
    let body: Value = response.json().await.map_err(|_| ListError::Unreachable)?;
    Ok(parse(provider, &body))
}

#[cfg(test)]
#[path = "catalog_tests.rs"]
mod tests;
