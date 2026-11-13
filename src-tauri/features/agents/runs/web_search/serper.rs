//! Serper (serper.dev) sells Google's result tabs as JSON, one endpoint per tab, with the key in
//! X-API-KEY. Each kind is one request.
use crate::js_json::JsValue;
use crate::text::js_trim;
use crate::tool_transport::{object, string};

use super::provider::{clip, compact_hit, field, google_recency, items, number, post_json, site_query, web_link, HitField, WebSearchAnswer, WebSearchFailed, WebSearchRequest};

pub(crate) const SERPER_BASE: &str = "https://google.serper.dev";

pub(crate) const KINDS: &[&str] = &["web", "news", "videos", "images", "places", "shopping", "scholar", "patents", "maps", "autocomplete"];

/// A kind's path and where its results sit.
fn endpoint(kind: &str) -> (&'static str, &'static str) {
    match kind {
        "news" => ("/news", "news"),
        "videos" => ("/videos", "videos"),
        "images" => ("/images", "images"),
        "places" => ("/places", "places"),
        "shopping" => ("/shopping", "shopping"),
        "scholar" => ("/scholar", "organic"),
        "patents" => ("/patents", "organic"),
        "maps" => ("/maps", "places"),
        // Autocomplete returns what people type, not pages: suggestions without links.
        "autocomplete" => ("/autocomplete", "suggestions"),
        _ => ("/search", "organic"),
    }
}

/// The request body: site: filters join the query, recency is tbs, and a map search can
/// center on coordinates ("@lat,lng,zoomz").
fn serper_query(request: &WebSearchRequest) -> JsValue {
    let mut body = object([
        ("q", string(site_query(&request.query, &request.domains))),
        ("num", JsValue::Number(f64::from(request.limit))),
    ]);
    if let Some(tbs) = google_recency(request.recency.as_deref()) {
        body = body.with_field("tbs", string(tbs));
    }
    if let Some(location) = request.location.as_deref().map(js_trim).filter(|location| !location.is_empty()) {
        body = body.with_field("location", string(location));
    }
    if let Some(near) = request.near.as_deref().map(js_trim).filter(|near| !near.is_empty()) {
        body = body.with_field("ll", string(near));
    }
    body
}

/// `encodeURIComponent`.
fn encode_uri_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// One result of any kind; a place without a website links to its map entry.
fn serper_hit(item: &JsValue) -> Option<JsValue> {
    let mut link = field(item, &["link", "website"]);
    let cid = field(item, &["cid"]);
    if link.is_empty() && !cid.is_empty() {
        link = format!("https://maps.google.com/?cid={}", encode_uri_component(&cid));
    }
    if !web_link(&link) {
        return None;
    }
    let text = |names: &[&str]| HitField::Text(field(item, names));
    let title = field(item, &["title"]);
    Some(compact_hit([
        ("title", HitField::Text(if title.is_empty() { link.clone() } else { title })),
        ("url", HitField::Text(link)),
        ("snippet", text(&["snippet", "description"])),
        ("published", text(&["date", "year", "publicationDate", "priorityDate"])),
        ("source", text(&["source"])),
        ("channel", text(&["channel"])),
        ("duration", text(&["duration"])),
        ("price", text(&["price"])),
        ("rating", HitField::Number(number(item, "rating"))),
        ("reviews", HitField::Number(number(item, "ratingCount").trunc())),
        ("address", text(&["address"])),
        ("phone", text(&["phoneNumber"])),
        ("category", text(&["category", "type"])),
        ("image", text(&["imageUrl"])),
        ("publication", text(&["publicationInfo"])),
        ("cited_by", HitField::Number(number(item, "citedBy").trunc())),
    ]))
}

/// Reads one kind's result list plus any direct answer.
fn serper_answer(body: &JsValue, list: &str, limit: u32) -> WebSearchAnswer {
    let mut answer = WebSearchAnswer::default();
    for item in items(body.get(list)) {
        let suggestion = if list == "suggestions" { field(item, &["value"]) } else { String::new() };
        let hit = if suggestion.is_empty() { serper_hit(item) } else { Some(object([("title", string(suggestion))])) };
        answer.results.extend(hit);
        if answer.results.len() >= limit as usize {
            break;
        }
    }
    let empty = JsValue::Object(Vec::new());
    let answer_box = body.get("answerBox").unwrap_or(&empty);
    let graph = body.get("knowledgeGraph").unwrap_or(&empty);
    let direct = [field(answer_box, &["answer"]), field(answer_box, &["snippet"]), field(graph, &["description"])];
    if let Some(direct) = direct.iter().find(|text| !text.is_empty()) {
        answer.answer = Some(clip(direct));
    }
    answer
}

pub(crate) async fn search(client: &reqwest::Client, base: &str, key: &str, request: &WebSearchRequest) -> Result<WebSearchAnswer, WebSearchFailed> {
    let (path, list) = endpoint(&request.kind);
    let headers = [("X-API-KEY", key.to_owned())];
    let body = post_json(client, "serper", &format!("{base}{path}"), &headers, &serper_query(request)).await?;
    Ok(serper_answer(&body, list, request.limit))
}
