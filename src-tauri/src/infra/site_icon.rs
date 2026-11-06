//! A site's icon, fetched by the app instead of an image tag in its windows. Sites such as X and
//! Gmail send `Cross-Origin-Resource-Policy`, so WebKit refuses to show their icons in any other
//! origin's page. The fetch sends no cookies and takes the same checks as a link preview: the
//! address comes from the page, so every hop must be public. The answer is decided from the bytes,
//! never the site's content type.
use base64::Engine;

use super::agents::web_fetch::fetch_raw;

const ICON_BYTES: usize = 512 * 1024;

/// Sites serve icons under many content types, some of them wrong. A web page never is one.
fn may_be_icon(content_type: &str) -> bool {
    content_type.is_empty()
        || content_type.starts_with("image/")
        || content_type.contains("octet-stream")
        || content_type.contains("xml")
        || content_type.starts_with("text/plain")
}

/// The image type these bytes are, or None when they aren't an image.
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

/// The icon at this address as a data URL. Fails with `private_address` for a site on this
/// computer or network, which the window may still reach itself.
#[tauri::command]
pub async fn browser_site_icon(url: String) -> Result<String, String> {
    let response = fetch_raw(&url, "image/*,*/*;q=0.5", ICON_BYTES, may_be_icon).await?;
    if response.status >= 400 || response.truncated || response.body.is_empty() {
        return Err("no_icon".into());
    }
    let kind = image_kind(&response.body).ok_or_else(|| "no_icon".to_string())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&response.body);
    Ok(format!("data:{kind};base64,{encoded}"))
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
