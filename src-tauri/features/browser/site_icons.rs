use base64::Engine;

use regex::Regex;
use std::{collections::HashSet, sync::OnceLock};

use crate::agents::web_fetch::{fetch_raw, RawResponse};

const ICON_BYTES: usize = 512 * 1024;
const MAX_CANDIDATES: usize = 4;

fn may_be_icon(content_type: &str) -> bool {
    content_type.is_empty()
        || content_type.starts_with("image/")
        || content_type.contains("octet-stream")
        || content_type.contains("xml")
        || content_type.starts_with("text/plain")
}

fn image_kind(body: &[u8]) -> Option<&'static str> {
    if body.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if body.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("image/jpeg");
    }
    if body.starts_with(b"GIF8") {
        return Some("image/gif");
    }
    if body.starts_with(&[0, 0, 1, 0]) {
        return Some("image/x-icon");
    }
    if body.starts_with(b"BM") {
        return Some("image/bmp");
    }
    if body.len() >= 12 && body.starts_with(b"RIFF") && &body[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    let start = &body[..body.len().min(1024)];
    let text = String::from_utf8_lossy(start);
    let text = text.trim_start_matches('\u{feff}').trim_start();
    if text.starts_with("<svg") || (text.starts_with("<?xml") && text.contains("<svg")) {
        return Some("image/svg+xml");
    }
    None
}

fn may_be_icon_or_page(content_type: &str) -> bool {
    may_be_icon(content_type) || is_page(content_type)
}

fn is_page(content_type: &str) -> bool {
    content_type.contains("text/html") || content_type.contains("application/xhtml")
}

fn encoded(response: &RawResponse) -> Option<String> {
    if response.status >= 400 || response.truncated || response.body.is_empty() {
        return None;
    }
    let kind = image_kind(&response.body)?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&response.body);
    Some(format!("data:{kind};base64,{encoded}"))
}

fn link_pattern(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid pattern"))
}

fn declared_icons(body: &[u8], base: &url::Url) -> Vec<url::Url> {
    static LINK: OnceLock<Regex> = OnceLock::new();
    static REL: OnceLock<Regex> = OnceLock::new();
    static HREF: OnceLock<Regex> = OnceLock::new();
    let link = link_pattern(&LINK, r"(?is)<link\b[^>]*>");
    let rel = link_pattern(
        &REL,
        r#"(?is)\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#,
    );
    let href = link_pattern(
        &HREF,
        r#"(?is)\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#,
    );
    let text = String::from_utf8_lossy(body);
    let mut icons = Vec::new();
    let mut touch = Vec::new();
    let value = |captures: regex::Captures<'_>| {
        captures
            .get(1)
            .or_else(|| captures.get(2))
            .or_else(|| captures.get(3))
            .map(|found| found.as_str().trim().replace("&amp;", "&"))
    };
    for tag in link.find_iter(&text) {
        let tag = tag.as_str();
        let Some(kinds) = rel.captures(tag).and_then(value) else {
            continue;
        };
        let kinds = kinds.to_ascii_lowercase();
        let Some(address) = href.captures(tag).and_then(value) else {
            continue;
        };
        let Ok(address) = base.join(&address) else {
            continue;
        };
        if !matches!(address.scheme(), "http" | "https" | "data") {
            continue;
        }
        let words: Vec<&str> = kinds.split_whitespace().collect();
        if words.contains(&"icon") {
            icons.push(address);
        } else if words
            .iter()
            .any(|word| word.starts_with("apple-touch-icon"))
        {
            touch.push(address);
        }
    }
    icons.extend(touch);
    icons
}

fn inline_icon(address: &url::Url) -> Option<String> {
    let text = address.as_str();
    (text.starts_with("data:image/") && text.len() <= ICON_BYTES * 4 / 3).then(|| text.to_owned())
}

async fn icon_at(address: &url::Url) -> Option<String> {
    if address.scheme() == "data" {
        return inline_icon(address);
    }
    let response = fetch_raw(
        address.as_str(),
        "image/*,*/*;q=0.5",
        ICON_BYTES,
        may_be_icon,
    )
    .await
    .ok()?;
    encoded(&response)
}

#[tauri::command]
pub async fn browser_site_icon(url: String) -> Result<String, String> {
    let response = fetch_raw(
        &url,
        "image/*,text/html;q=0.9,*/*;q=0.5",
        ICON_BYTES,
        may_be_icon_or_page,
    )
    .await?;
    if let Some(icon) = encoded(&response) {
        return Ok(icon);
    }
    let mut candidates = if is_page(&response.content_type) {
        declared_icons(&response.body, &response.final_url)
    } else {
        Vec::new()
    };
    if let Ok(fallback) = response.final_url.join("/favicon.ico") {
        candidates.push(fallback);
    }
    let mut seen = HashSet::from([response.final_url.to_string()]);
    for candidate in candidates
        .into_iter()
        .filter(|candidate| seen.insert(candidate.to_string()))
        .take(MAX_CANDIDATES)
    {
        if let Some(icon) = icon_at(&candidate).await {
            return Ok(icon);
        }
    }
    Err("no_icon".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_an_image_by_its_bytes() {
        assert_eq!(image_kind(b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(image_kind(&[0xff, 0xd8, 0xff, 0xe0]), Some("image/jpeg"));
        assert_eq!(image_kind(&[0, 0, 1, 0, 1, 0]), Some("image/x-icon"));
        assert_eq!(image_kind(b"GIF89a"), Some("image/gif"));
        assert_eq!(image_kind(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(
            image_kind(b"  <svg xmlns='x'></svg>"),
            Some("image/svg+xml")
        );
        assert_eq!(
            image_kind(b"<?xml version='1.0'?><svg></svg>"),
            Some("image/svg+xml")
        );
    }

    #[test]
    fn finds_the_icons_a_page_declares() {
        let base = url::Url::parse("https://example.com/a/b").unwrap();
        let page = br#"<head><link rel="stylesheet" href="/s.css"><link rel="apple-touch-icon" href="/touch.png"><LINK REL='shortcut icon' HREF='/fav.png?a=1&amp;b=2'><link rel=mask-icon href=/mask.svg><link href="//cdn.example.com/i.svg" rel="icon"></head>"#;
        let found: Vec<String> = declared_icons(page, &base)
            .into_iter()
            .map(|url| url.to_string())
            .collect();
        assert_eq!(
            found,
            vec![
                "https://example.com/fav.png?a=1&b=2",
                "https://cdn.example.com/i.svg",
                "https://example.com/touch.png",
            ]
        );
    }

    #[test]
    fn refuses_what_is_not_an_image() {
        assert_eq!(image_kind(b""), None);
        assert_eq!(image_kind(b"<!doctype html><html></html>"), None);
        assert_eq!(image_kind(b"<?xml version='1.0'?><rss></rss>"), None);
        assert!(!may_be_icon("text/html; charset=utf-8"));
        assert!(may_be_icon("image/vnd.microsoft.icon"));
        assert!(may_be_icon("application/octet-stream"));
        assert!(may_be_icon(""));
    }
}
