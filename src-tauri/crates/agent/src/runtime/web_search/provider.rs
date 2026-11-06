//! web.search runs here, on the person's device, on the search key they keep in Settings › Models
//! (docs/agents/runtime.md). One provider is chosen per device; every provider takes the same request
//! and answers with the same hits, and says which kinds of search it offers. The Misty server holds
//! no search key, makes no search call and counts no searches.
use futures_util::StreamExt;

use crate::runtime::{
    js_json::{number_text, JsValue},
    text::{js_len, js_trim},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SearchProviderId {
    Decodo,
    Serper,
}

impl SearchProviderId {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Decodo => "decodo",
            Self::Serper => "serper",
        }
    }

    /// The kinds this provider offers, web first.
    pub(crate) fn kinds(self) -> &'static [&'static str] {
        match self {
            Self::Decodo => super::decodo::KINDS,
            Self::Serper => super::serper::KINDS,
        }
    }
}

/// One search, the same for every provider.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WebSearchRequest {
    pub(crate) query: String,
    pub(crate) kind: String,
    pub(crate) domains: Vec<String>,
    pub(crate) recency: Option<String>,
    pub(crate) location: Option<String>,
    pub(crate) near: Option<String>,
    pub(crate) limit: u32,
}

/// One result is an object in the order its provider lists its fields, which is the order the model
/// reads them in; fields past the snippet appear only for the kinds that have them.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct WebSearchAnswer {
    pub(crate) results: Vec<JsValue>,
    /// Google's direct answer or overview text, when there is one.
    pub(crate) answer: Option<String>,
}

/// A provider call that failed; it never holds the provider's body or the key.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("{provider} search failed ({})", if *.status == 0 { "network".to_owned() } else { .status.to_string() })]
pub(crate) struct WebSearchFailed {
    pub(crate) provider: &'static str,
    pub(crate) status: u16,
}

const MAX_BODY: usize = 1 << 20;
/// A UTF-16 unit takes at most three bytes, so a body past this is over `MAX_BODY` units for sure.
/// The limit is on the decoded text, as in the TypeScript, but reading stops here rather than
/// holding whatever a provider sends.
const MAX_BODY_BYTES: usize = MAX_BODY * 3;

/// POSTs JSON and reads at most 1 MiB of JSON back.
pub(crate) async fn post_json(client: &reqwest::Client, provider: &'static str, url: &str, headers: &[(&str, String)], body: &JsValue) -> Result<JsValue, WebSearchFailed> {
    let failed = |status: u16| WebSearchFailed { provider, status };
    let mut request = client.post(url).header("Content-Type", "application/json").body(body.stringify());
    for (name, value) in headers {
        request = request.header(*name, value);
    }
    let response = request.send().await.map_err(|_| failed(0))?;
    let status = response.status().as_u16();
    if status != 200 {
        return Err(failed(status));
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        bytes.extend_from_slice(&chunk.map_err(|_| failed(0))?);
        if bytes.len() > MAX_BODY_BYTES {
            return Err(failed(status));
        }
    }
    let text = String::from_utf8_lossy(&bytes);
    if js_len(&text) > MAX_BODY {
        return Err(failed(status));
    }
    JsValue::parse(&text).ok_or_else(|| failed(status))
}

/// Adds the site: filters every Google-backed provider understands.
pub(crate) fn site_query(query: &str, domains: &[String]) -> String {
    let sites: Vec<String> = domains.iter().map(|domain| js_trim(domain)).filter(|domain| !domain.is_empty()).map(|domain| format!("site:{domain}")).collect();
    if sites.is_empty() {
        query.to_owned()
    } else {
        format!("{query} ({})", sites.join(" OR "))
    }
}

/// Google's tbs value for a recency.
pub(crate) fn google_recency(recency: Option<&str>) -> Option<&'static str> {
    match recency? {
        "day" => Some("qdr:d"),
        "week" => Some("qdr:w"),
        "month" => Some("qdr:m"),
        "year" => Some("qdr:y"),
        _ => None,
    }
}

/// The first named field that holds text (or a number, written out).
pub(crate) fn field(item: &JsValue, names: &[&str]) -> String {
    for name in names {
        match item.get(name) {
            Some(JsValue::String(text)) if !js_trim(text).is_empty() => return js_trim(text).to_owned(),
            Some(JsValue::Number(value)) if value.is_finite() => return number_text(*value),
            _ => {}
        }
    }
    String::new()
}

pub(crate) fn number(item: &JsValue, name: &str) -> f64 {
    match item.get(name) {
        Some(JsValue::Number(value)) if value.is_finite() => *value,
        _ => 0.0,
    }
}

/// The objects in a list.
pub(crate) fn items(value: Option<&JsValue>) -> Vec<&JsValue> {
    value.and_then(JsValue::as_array).unwrap_or_default().iter().filter(|entry| entry.is_object()).collect()
}

pub(crate) fn web_link(link: &str) -> bool {
    link.starts_with("https://") || link.starts_with("http://")
}

/// One field of a hit, before empty ones go.
pub(crate) enum HitField {
    Text(String),
    Number(f64),
}

/// Keeps a hit's filled fields only, as the tool has always answered.
pub(crate) fn compact_hit<const N: usize>(fields: [(&str, HitField); N]) -> JsValue {
    JsValue::Object(
        fields
            .into_iter()
            .filter_map(|(name, value)| {
                let value = match value {
                    HitField::Text(text) if !text.is_empty() => JsValue::String(text),
                    HitField::Number(value) if value != 0.0 => JsValue::Number(value),
                    _ => return None,
                };
                Some((name.to_owned(), value))
            })
            .collect(),
    )
}

/// A direct answer is at most 600 characters.
pub(crate) fn clip(text: &str) -> String {
    const LIMIT: usize = 600;
    if text.chars().count() <= LIMIT {
        return text.to_owned();
    }
    let kept: String = text.chars().take(LIMIT - 1).collect();
    format!("{}…", js_trim(&kept))
}
