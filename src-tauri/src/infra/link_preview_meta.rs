//! Reads a page's preview metadata (Open Graph, Twitter Card, `<title>`) from its HTML head.
use std::collections::HashMap;

/// What a page says about itself, before any image is fetched.
#[derive(Debug, Default, PartialEq)]
pub struct PageMeta {
    pub site_name: String,
    pub title: String,
    pub description: String,
    pub image_url: Option<String>,
}

/// The first value for each `property` or `name` of the page's `<meta>` tags, and its title.
pub fn parse(html: &str, base: &url::Url) -> PageMeta {
    let lower = html.to_ascii_lowercase();
    let head_end = lower.find("</head>").unwrap_or(lower.len());
    let mut tags: HashMap<String, String> = HashMap::new();
    let mut at = 0;
    while let Some(found) = lower[at..head_end].find("<meta") {
        let start = at + found;
        let Some(length) = lower[start..head_end].find('>') else {
            break;
        };
        let attributes = attributes(&html[start + 5..start + length]);
        let key = attributes
            .iter()
            .find(|(name, _)| name == "property" || name == "name")
            .map(|(_, value)| value.to_ascii_lowercase());
        let content = attributes
            .iter()
            .find(|(name, _)| name == "content")
            .map(|(_, value)| value.clone());
        if let (Some(key), Some(content)) = (key, content) {
            tags.entry(key).or_insert(content);
        }
        at = start + length;
    }
    let first = |keys: &[&str]| {
        keys.iter()
            .filter_map(|key| tags.get(*key))
            .map(|value| decode_entities(value).trim().to_string())
            .find(|value| !value.is_empty())
            .unwrap_or_default()
    };
    let mut title = first(&["og:title", "twitter:title"]);
    if title.is_empty() {
        title = title_tag(html, &lower).unwrap_or_default();
    }
    let site_name = first(&["og:site_name"]);
    let image = first(&[
        "og:image",
        "og:image:url",
        "twitter:image",
        "twitter:image:src",
    ]);
    PageMeta {
        site_name: clip(&site_name, 80),
        title: clip(&title, 200),
        description: clip(
            &first(&["og:description", "twitter:description", "description"]),
            300,
        ),
        image_url: base
            .join(&image)
            .ok()
            .filter(|url| !image.is_empty() && matches!(url.scheme(), "http" | "https"))
            .map(|url| url.to_string()),
    }
}

fn title_tag(html: &str, lower: &str) -> Option<String> {
    let open = lower.find("<title")?;
    let start = open + lower[open..].find('>')? + 1;
    let end = start + lower[start..].find("</title>")?;
    let text = decode_entities(&html[start..end]);
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    (!text.is_empty()).then_some(text)
}

/// `name="value"` pairs from the inside of a tag, names lowercased. Values may be quoted or bare.
fn attributes(tag: &str) -> Vec<(String, String)> {
    let bytes = tag.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        while i < bytes.len() && (bytes[i].is_ascii_whitespace() || bytes[i] == b'/') {
            i += 1;
        }
        let name_start = i;
        while i < bytes.len()
            && !bytes[i].is_ascii_whitespace()
            && bytes[i] != b'='
            && bytes[i] != b'/'
        {
            i += 1;
        }
        if name_start == i {
            break;
        }
        let name = tag[name_start..i].to_ascii_lowercase();
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b'=' {
            out.push((name, String::new()));
            continue;
        }
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        let value = match bytes.get(i) {
            Some(&quote) if quote == b'"' || quote == b'\'' => {
                let start = i + 1;
                let end = tag[start..]
                    .find(quote as char)
                    .map_or(bytes.len(), |n| start + n);
                i = (end + 1).min(bytes.len());
                &tag[start..end]
            }
            _ => {
                let start = i;
                while i < bytes.len() && !bytes[i].is_ascii_whitespace() {
                    i += 1;
                }
                &tag[start..i]
            }
        };
        out.push((name, value.to_string()));
    }
    out
}

fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        let decoded = rest.find(';').filter(|end| *end <= 10).and_then(|end| {
            let name = &rest[1..end];
            let character = match name {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                _ => name
                    .strip_prefix("#x")
                    .or_else(|| name.strip_prefix("#X"))
                    .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                    .or_else(|| name.strip_prefix('#').and_then(|n| n.parse().ok()))
                    .and_then(char::from_u32),
            };
            character.map(|c| (c, end))
        });
        match decoded {
            Some((character, end)) => {
                out.push(character);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn clip(text: &str, limit: usize) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= limit {
        return text;
    }
    let mut shortened: String = text.chars().take(limit.saturating_sub(1)).collect();
    shortened.push('…');
    shortened
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_open_graph_and_resolves_relative_images() {
        let base = url::Url::parse("https://example.com/a/b").unwrap();
        let meta = parse(
            r#"<html><head><title>Fallback</title>
            <meta property="og:title" content="Tom &amp; Jerry&#39;s">
            <meta property='og:site_name' content=Example>
            <meta name="description" content="A page.">
            <meta property="og:image" content="/img/cover.jpg"></head><body></body></html>"#,
            &base,
        );
        assert_eq!(meta.title, "Tom & Jerry's");
        assert_eq!(meta.site_name, "Example");
        assert_eq!(meta.description, "A page.");
        assert_eq!(
            meta.image_url.as_deref(),
            Some("https://example.com/img/cover.jpg")
        );
    }

    #[test]
    fn falls_back_to_the_title_tag_and_refuses_odd_image_schemes() {
        let base = url::Url::parse("https://example.com/").unwrap();
        let meta = parse(
            "<head><title>\n  Plain   page </title><meta property=\"og:image\" content=\"data:image/png;base64,AAAA\"></head>",
            &base,
        );
        assert_eq!(meta.title, "Plain page");
        assert_eq!(meta.image_url, None);
    }
}
