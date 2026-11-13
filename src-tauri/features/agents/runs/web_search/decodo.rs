//! Decodo's Web Scraping API returns Google's results as parsed JSON, with the key as a bearer token.
//! Every kind is the google_search target, with google_tbm picking the tab.
use crate::js_json::JsValue;
use crate::text::js_trim;
use crate::tool_transport::{object, string};

use super::provider::{clip, compact_hit, field, google_recency, items, number, post_json, site_query, web_link, HitField, WebSearchAnswer, WebSearchFailed, WebSearchRequest};

pub(crate) const DECODO_ENDPOINT: &str = "https://data.decodo.com/v1/scrape";

pub(crate) const KINDS: &[&str] = &["web", "news", "videos", "images"];

fn tab(kind: &str) -> Option<&'static str> {
    match kind {
        "news" => Some("nws"),
        "videos" => Some("vid"),
        "images" => Some("isch"),
        _ => None,
    }
}

// Where each kind's results sit in the parsed page (seen live 2026-11-01): news under main,
// videos under organic_videos.
fn lists(kind: &str) -> &'static [&'static str] {
    match kind {
        "news" => &["main", "organic"],
        "videos" => &["organic_videos", "organic"],
        _ => &["organic"],
    }
}

pub(crate) fn decodo_body(request: &WebSearchRequest) -> JsValue {
    let mut body = object([
        ("target", string("google_search")),
        ("query", string(site_query(&request.query, &request.domains))),
        ("parse", JsValue::Bool(true)),
        ("page_count", JsValue::Number(1.0)),
    ]);
    if let Some(tab) = tab(&request.kind) {
        body = body.with_field("google_tbm", string(tab));
    }
    if let Some(tbs) = google_recency(request.recency.as_deref()) {
        body = body.with_field("google_tbs", string(tbs));
    }
    if let Some(location) = request.location.as_deref().map(js_trim).filter(|location| !location.is_empty()) {
        body = body.with_field("geo", string(location));
    }
    body
}

fn decodo_hit(item: &JsValue) -> Option<JsValue> {
    let link = field(item, &["url", "link"]);
    if !web_link(&link) {
        return None;
    }
    let text = |names: &[&str]| HitField::Text(field(item, names));
    let title = field(item, &["title"]);
    Some(compact_hit([
        ("title", HitField::Text(if title.is_empty() { link.clone() } else { title })),
        ("url", HitField::Text(link)),
        ("snippet", text(&["desc", "description", "snippet"])),
        ("published", text(&["relative_publish_date", "date"])),
        ("source", text(&["source", "domain"])),
        ("channel", text(&["channel", "author"])),
        ("duration", text(&["duration"])),
        ("image", text(&["high_res_image", "image"])),
        ("rating", HitField::Number(number(item, "rating"))),
    ]))
}

/// Reads results[0].content.results.results: the first list that has results, and for a
/// web search Google's AI overview as the direct answer.
pub(crate) fn decodo_answer(body: &JsValue, kind: &str, limit: u32) -> WebSearchAnswer {
    let mut answer = WebSearchAnswer::default();
    let empty = JsValue::Object(Vec::new());
    let page = items(body.get("results"))
        .first()
        .and_then(|first| first.get("content"))
        .and_then(|content| content.get("results"))
        .and_then(|results| results.get("results"))
        .unwrap_or(&empty);
    for list in lists(kind) {
        let found = items(page.get(list));
        if found.is_empty() {
            continue;
        }
        for item in found {
            answer.results.extend(decodo_hit(item));
            if answer.results.len() >= limit as usize {
                break;
            }
        }
        break;
    }
    if kind == "web" {
        if let Some(overview) = items(page.get("ai_overviews")).first() {
            let text = field(overview, &["answer_text"]);
            if !text.is_empty() {
                answer.answer = Some(clip(&text));
            }
        }
    }
    answer
}

pub(crate) async fn search(client: &reqwest::Client, endpoint: &str, key: &str, request: &WebSearchRequest) -> Result<WebSearchAnswer, WebSearchFailed> {
    let headers = [("Authorization", format!("Bearer {key}")), ("Accept", "application/json".to_owned())];
    let body = post_json(client, "decodo", endpoint, &headers, &decodo_body(request)).await?;
    Ok(decodo_answer(&body, &request.kind, request.limit))
}
