//! Link previews, fetched on the person's device the way Discord's unfurler does on its server:
//! read the page's own preview metadata (YouTube through its oEmbed), then fetch and shrink the
//! image. Every request goes through `web_fetch`, so only public addresses are contacted, without
//! cookies or sign-ins, and the image comes back as a small data URL the page can show without
//! contacting the site again. The renderer keeps results in the encrypted local cache.
use base64::Engine;
use serde::Serialize;

use super::link_preview_meta::{self, PageMeta};
use super::web_fetch::fetch_raw;

const PAGE_BYTES: usize = 256 * 1024;
const OEMBED_BYTES: usize = 64 * 1024;
const IMAGE_BYTES: usize = 3 * 1024 * 1024;
const THUMBNAIL_EDGE: u32 = 360;
/// A source image that can't be shrunk is sent as it is only when it is this small.
const RAW_IMAGE_BYTES: usize = 200 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkPreview {
    pub url: String,
    pub site_name: String,
    pub title: String,
    pub description: String,
    /// A small JPEG or the original image, as a data URL.
    pub image: Option<String>,
}

/// None when the page offers nothing worth a card.
#[tauri::command]
pub async fn link_preview_fetch(url: String) -> Result<Option<LinkPreview>, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    Ok(preview(&url).await)
}

async fn preview(address: &str) -> Option<LinkPreview> {
    let parsed = url::Url::parse(address.trim()).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return None;
    }
    let (meta, final_url) = match youtube(&parsed).await {
        Some(meta) => (meta, parsed.clone()),
        None => page(&parsed).await?,
    };
    if meta.title.is_empty() && meta.image_url.is_none() {
        return None;
    }
    let image = match &meta.image_url {
        Some(source) => thumbnail(source).await,
        None => None,
    };
    let site_name = if meta.site_name.is_empty() {
        host_label(&final_url)
    } else {
        meta.site_name
    };
    Some(LinkPreview {
        url: final_url.to_string(),
        site_name,
        title: meta.title,
        description: meta.description,
        image,
    })
}

fn host_label(url: &url::Url) -> String {
    url.host_str()
        .unwrap_or_default()
        .trim_start_matches("www.")
        .to_string()
}

fn html(content_type: &str) -> bool {
    content_type.is_empty()
        || content_type.starts_with("text/html")
        || content_type.starts_with("application/xhtml+xml")
}

fn json(content_type: &str) -> bool {
    content_type.starts_with("application/json") || content_type.starts_with("text/json")
}

fn image_type(content_type: &str) -> bool {
    ["image/jpeg", "image/png", "image/webp", "image/gif"]
        .iter()
        .any(|kind| content_type.starts_with(kind))
}

async fn page(address: &url::Url) -> Option<(PageMeta, url::Url)> {
    let response = fetch_raw(
        address.as_str(),
        "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        PAGE_BYTES,
        html,
    )
    .await
    .ok()?;
    if response.status >= 400 {
        return None;
    }
    let text = String::from_utf8_lossy(&response.body);
    Some((
        link_preview_meta::parse(&text, &response.final_url),
        response.final_url,
    ))
}

/// YouTube answers oEmbed with the title and channel, and its thumbnails follow one pattern, so
/// a video needs no page fetch. The 16:9 thumbnail has no letterbox bars, unlike the one oEmbed
/// names.
async fn youtube(address: &url::Url) -> Option<PageMeta> {
    let host = address
        .host_str()?
        .trim_start_matches("www.")
        .trim_start_matches("m.");
    if host != "youtube.com" && host != "youtu.be" {
        return None;
    }
    let mut endpoint = url::Url::parse("https://www.youtube.com/oembed").ok()?;
    endpoint
        .query_pairs_mut()
        .append_pair("format", "json")
        .append_pair("url", address.as_str());
    let response = fetch_raw(endpoint.as_str(), "application/json", OEMBED_BYTES, json)
        .await
        .ok()?;
    if response.status >= 400 {
        return None;
    }
    let data: serde_json::Value = serde_json::from_slice(&response.body).ok()?;
    let text = |key: &str| {
        data.get(key)
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string()
    };
    let image_url = data
        .get("thumbnail_url")
        .and_then(|value| value.as_str())
        .and_then(|source| url::Url::parse(source).ok())
        .and_then(|source| {
            let mut segments = source.path_segments()?;
            (segments.next()? == "vi")
                .then(|| segments.next().map(str::to_string))
                .flatten()
        })
        .map(|id| format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg"))
        .or_else(|| {
            data.get("thumbnail_url")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        });
    Some(PageMeta {
        site_name: "YouTube".into(),
        title: text("title"),
        description: text("author_name"),
        image_url,
    })
}

async fn thumbnail(address: &str) -> Option<String> {
    let response = fetch_raw(
        address,
        "image/webp,image/png,image/jpeg,image/gif;q=0.8,*/*;q=0.1",
        IMAGE_BYTES,
        image_type,
    )
    .await
    .ok()?;
    if response.status >= 400 || response.truncated {
        return None;
    }
    let content_type = response
        .content_type
        .split(';')
        .next()
        .unwrap_or("image/jpeg")
        .trim()
        .to_string();
    let bytes = response.body;
    tokio::task::spawn_blocking(move || {
        shrink(&bytes)
            .map(|jpeg| data_url("image/jpeg", &jpeg))
            .or_else(|| (bytes.len() <= RAW_IMAGE_BYTES).then(|| data_url(&content_type, &bytes)))
    })
    .await
    .ok()
    .flatten()
}

fn shrink(bytes: &[u8]) -> Option<Vec<u8>> {
    let decoded = image::load_from_memory(bytes).ok()?;
    let small = decoded.thumbnail(THUMBNAIL_EDGE, THUMBNAIL_EDGE).to_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80)
        .encode_image(&small)
        .ok()?;
    Some(out)
}

fn data_url(content_type: &str, bytes: &[u8]) -> String {
    format!(
        "data:{content_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}
