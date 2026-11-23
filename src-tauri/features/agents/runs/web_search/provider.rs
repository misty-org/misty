use futures_util::StreamExt;

use crate::js_json::{number_text, JsValue};
use crate::text::{js_len, js_trim};

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

    pub(crate) fn kinds(self) -> &'static [&'static str] {
        match self {
            Self::Decodo => super::decodo::KINDS,
            Self::Serper => super::serper::KINDS,
        }
    }
}

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

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct WebSearchAnswer {
    pub(crate) results: Vec<JsValue>,
    pub(crate) answer: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("{provider} search failed ({})", if *.status == 0 { "network".to_owned() } else { .status.to_string() })]
pub(crate) struct WebSearchFailed {
    pub(crate) provider: &'static str,
    pub(crate) status: u16,
}

const MAX_BODY: usize = 1 << 20;
const MAX_BODY_BYTES: usize = MAX_BODY * 3;

pub(crate) async fn post_json(
    client: &reqwest::Client,
    provider: &'static str,
    url: &str,
    headers: &[(&str, String)],
    body: &JsValue,
) -> Result<JsValue, WebSearchFailed> {
    let failed = |status: u16| WebSearchFailed { provider, status };
    let mut request = client
        .post(url)
        .header("Content-Type", "application/json")
        .body(body.stringify());
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

pub(crate) fn site_query(query: &str, domains: &[String]) -> String {
    let sites: Vec<String> = domains
        .iter()
        .map(|domain| js_trim(domain))
        .filter(|domain| !domain.is_empty())
        .map(|domain| format!("site:{domain}"))
        .collect();
    if sites.is_empty() {
        query.to_owned()
    } else {
        format!("{query} ({})", sites.join(" OR "))
    }
}

pub(crate) fn google_recency(recency: Option<&str>) -> Option<&'static str> {
    match recency? {
        "day" => Some("qdr:d"),
        "week" => Some("qdr:w"),
        "month" => Some("qdr:m"),
        "year" => Some("qdr:y"),
        _ => None,
    }
}

pub(crate) fn field(item: &JsValue, names: &[&str]) -> String {
    for name in names {
        match item.get(name) {
            Some(JsValue::String(text)) if !js_trim(text).is_empty() => {
                return js_trim(text).to_owned()
            }
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

pub(crate) fn items(value: Option<&JsValue>) -> Vec<&JsValue> {
    value
        .and_then(JsValue::as_array)
        .unwrap_or_default()
        .iter()
        .filter(|entry| entry.is_object())
        .collect()
}

pub(crate) fn web_link(link: &str) -> bool {
    link.starts_with("https://") || link.starts_with("http://")
}

pub(crate) enum HitField {
    Text(String),
    Number(f64),
}

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

pub(crate) fn clip(text: &str) -> String {
    const LIMIT: usize = 600;
    if text.chars().count() <= LIMIT {
        return text.to_owned();
    }
    let kept: String = text.chars().take(LIMIT - 1).collect();
    format!("{}…", js_trim(&kept))
}
