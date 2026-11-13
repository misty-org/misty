//! The editor's HTML preview: a file from a linked folder made into one document the panel shows
//! in a sandboxed frame, with the stylesheets, images and fonts it names beside it inlined.
//!
//! Adapted from desktop-cc-gui's preview_protocol.rs (MIT, Copyright (c) 2026
//! zhukunpenglinyutong). ccgui serves the page's folder over a custom protocol so relative
//! references resolve. Misty's windows may only navigate to its own bundled pages, and a frame's
//! navigation passes the same guard, so here the references are resolved natively instead, with
//! ccgui's rules: only inside the file's own folder, after following links, never a decoded
//! `/`, `\`, NUL or dot segment. The document carries a policy that forbids connections, posts and
//! frames, and the frame gets an opaque origin, so a page has nothing to reach and nowhere to
//! send. Its scripts don't run: the app's own policy applies to the frame.

use std::path::{Path, PathBuf};

use regex::Regex;

use super::files::data_url;
use super::{linked_path, person_window};

/// The page itself, as text.
const MAX_DOCUMENT_BYTES: u64 = 2 * 1024 * 1024;
/// One stylesheet, image or font.
const MAX_RESOURCE_BYTES: u64 = 5 * 1024 * 1024;
/// Everything inlined into one document.
const MAX_TOTAL_BYTES: usize = 24 * 1024 * 1024;

const PREVIEW_CSP: &str = "default-src 'none'; style-src 'unsafe-inline' data:; \
    img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; \
    form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'";

pub(crate) fn is_html(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("html" | "htm" | "xhtml")
    )
}

fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Decodes one `%XX`-escaped URL segment. A decoded `/`, `\`, NUL or dot segment would change
/// the path's shape, so it is refused rather than pointed at another file. On Windows a `:` would
/// name a drive or a data stream.
fn decode_segment(segment: &str) -> Option<String> {
    let mut bytes = Vec::with_capacity(segment.len());
    let mut input = segment.bytes();
    while let Some(byte) = input.next() {
        if byte == b'%' {
            let high = hex_digit(input.next()?)?;
            let low = hex_digit(input.next()?)?;
            bytes.push(high * 16 + low);
        } else {
            bytes.push(byte);
        }
    }
    let decoded = String::from_utf8(bytes).ok()?;
    if decoded.is_empty()
        || decoded.contains(['/', '\\', '\0'])
        || (cfg!(windows) && decoded.contains(':'))
        || matches!(decoded.as_str(), "." | "..")
    {
        return None;
    }
    Some(decoded)
}

/// A reference relative to `base` (a folder inside `root`), resolved and required to stay a file
/// inside `root`. Absolute URLs, `//host` and fragments are left alone (None).
fn resolve_reference(root: &Path, base: &Path, reference: &str) -> Option<PathBuf> {
    let reference = reference.trim();
    if reference.is_empty()
        || reference.starts_with('#')
        || reference.starts_with("//")
        || reference.starts_with('/')
        || reference.contains(':')
    {
        return None;
    }
    // The query and fragment never name a file.
    let path = reference.split(['?', '#']).next()?;
    let mut candidate = base.to_path_buf();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            // A step up is fine while it stays inside the root; the check below decides.
            ".." => {
                candidate.pop();
            }
            other => candidate.push(decode_segment(other)?),
        }
    }
    let resolved = file_access::fs::canonicalize(&candidate).ok()?;
    (resolved.starts_with(root) && file_access::fs::is_file(&resolved)).then_some(resolved)
}

/// By extension only; anything unlisted isn't inlined.
fn mime_for(path: &Path) -> Option<&'static str> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    Some(match extension.as_deref()? {
        "css" => "text/css",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => return None,
    })
}

struct Inliner {
    root: PathBuf,
    spent: usize,
}

impl Inliner {
    fn read(&mut self, path: &Path) -> Option<Vec<u8>> {
        let size = file_access::fs::metadata(path).ok()?.len();
        if size > MAX_RESOURCE_BYTES || self.spent + size as usize > MAX_TOTAL_BYTES {
            return None;
        }
        let bytes = file_access::fs::read(path).ok()?;
        self.spent += bytes.len();
        Some(bytes)
    }

    /// `reference` as a data URL, if it names an image or font inside the root.
    fn data_url_for(&mut self, base: &Path, reference: &str) -> Option<String> {
        let path = resolve_reference(&self.root, base, reference)?;
        let mime = mime_for(&path).filter(|mime| *mime != "text/css")?;
        let bytes = self.read(&path)?;
        Some(data_url(mime, &bytes))
    }

    /// A stylesheet with its own `url(...)` references inlined, relative to its folder.
    fn stylesheet(&mut self, css: &str, base: &Path) -> String {
        let pattern = Regex::new(r#"url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)"#).unwrap();
        pattern
            .replace_all(css, |captures: &regex::Captures| {
                let reference = captures
                    .get(1)
                    .or_else(|| captures.get(2))
                    .or_else(|| captures.get(3))
                    .map_or("", |found| found.as_str());
                match self.data_url_for(base, reference) {
                    Some(url) => format!("url(\"{url}\")"),
                    None => captures[0].to_string(),
                }
            })
            .into_owned()
    }

    fn linked_stylesheet(&mut self, base: &Path, reference: &str) -> Option<String> {
        let path = resolve_reference(&self.root, base, reference)?;
        if mime_for(&path) != Some("text/css") {
            return None;
        }
        let bytes = self.read(&path)?;
        let css = String::from_utf8_lossy(&bytes).into_owned();
        let folder = path.parent()?.to_path_buf();
        Some(self.stylesheet(&css, &folder))
    }
}

/// The value of `name="..."` (or single-quoted, or bare) in one tag's text.
fn attribute<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let pattern = Regex::new(&format!(
        r#"(?i)\s{name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#
    ))
    .ok()?;
    let captures = pattern.captures(tag)?;
    captures
        .get(1)
        .or_else(|| captures.get(2))
        .or_else(|| captures.get(3))
        .map(|found| found.as_str())
}

/// The document with its stylesheets, images and fonts from the file's folder inlined and the
/// preview's policy placed first in it.
pub(crate) fn build_document(file: &Path, html: &str) -> Result<String, String> {
    let root = file
        .parent()
        .ok_or("This file has no folder.")?
        .to_path_buf();
    let mut inliner = Inliner {
        root: root.clone(),
        spent: 0,
    };
    // <link rel="stylesheet" href="…"> becomes <style>…</style>.
    let links = Regex::new(r"(?is)<link\b[^>]*>").unwrap();
    let html = links.replace_all(html, |captures: &regex::Captures| {
        let tag = &captures[0];
        let stylesheet = attribute(tag, "rel").is_some_and(|rel| {
            rel.split_whitespace()
                .any(|word| word.eq_ignore_ascii_case("stylesheet"))
        });
        let inlined = attribute(tag, "href").and_then(|href| {
            if stylesheet {
                inliner
                    .linked_stylesheet(&root, href)
                    .map(|css| format!("<style>{css}</style>"))
            } else {
                // An icon or the like: its href becomes a data URL.
                inliner
                    .data_url_for(&root, href)
                    .map(|url| tag.replacen(href, &url, 1))
            }
        });
        inlined.unwrap_or_else(|| tag.to_string())
    });
    // <style> blocks may name images and fonts by url(...).
    let styles = Regex::new(r"(?is)(<style\b[^>]*>)(.*?)(</style>)").unwrap();
    let html = styles.replace_all(&html, |captures: &regex::Captures| {
        format!(
            "{}{}{}",
            &captures[1],
            inliner.stylesheet(&captures[2], &root),
            &captures[3]
        )
    });
    // src= on images and media, and inline style="…url(…)".
    let sources = Regex::new(r#"(?i)(\s(?:src|poster)\s*=\s*)(?:"([^"]*)"|'([^']*)')"#).unwrap();
    let html = sources.replace_all(&html, |captures: &regex::Captures| {
        let reference = captures
            .get(2)
            .or_else(|| captures.get(3))
            .map_or("", |found| found.as_str());
        match inliner.data_url_for(&root, reference) {
            Some(url) => format!("{}\"{url}\"", &captures[1]),
            None => captures[0].to_string(),
        }
    });
    let policy = format!(
        "<meta http-equiv=\"Content-Security-Policy\" content=\"{PREVIEW_CSP}\">\
         <meta name=\"referrer\" content=\"no-referrer\">"
    );
    // The policy goes before anything the page has, so nothing of its own runs ahead of it.
    let head = Regex::new(r"(?i)<head\b[^>]*>").unwrap();
    Ok(match head.find(&html) {
        Some(found) => format!("{}{policy}{}", &html[..found.end()], &html[found.end()..]),
        None => format!("{policy}{html}"),
    })
}

/// The HTML file at `path` as one self-contained document for the editor's preview frame.
#[tauri::command]
pub async fn project_html_preview_open(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
) -> Result<String, String> {
    person_window(&webview)?;
    let file = linked_path(&app, &account, &path).await?;
    tokio::task::spawn_blocking(move || {
        if !is_html(&file) || !file_access::fs::is_file(&file) {
            return Err("Only an HTML file can be previewed.".to_string());
        }
        let size = file_access::fs::metadata(&file)
            .map_err(|error| error.to_string())?
            .len();
        if size > MAX_DOCUMENT_BYTES {
            return Err("This page is too large to preview.".to_string());
        }
        let html = file_access::fs::read_to_string(&file).map_err(|error| error.to_string())?;
        build_document(&file, &html)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("misty-html-preview-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(std::fs::canonicalize(dir).unwrap())
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn decodes_segments_and_refuses_ones_that_change_the_path() {
        assert_eq!(decode_segment("a%20b.css").as_deref(), Some("a b.css"));
        assert_eq!(decode_segment("%2F"), None);
        assert_eq!(decode_segment("%5C"), None);
        assert_eq!(decode_segment("%00"), None);
        assert_eq!(decode_segment(".."), None);
        assert_eq!(decode_segment("%2e%2e"), None);
        assert_eq!(decode_segment("%zz"), None);
    }

    #[test]
    fn inlines_siblings_and_never_reaches_outside_the_folder() {
        let scratch = Scratch::new();
        let site = scratch.0.join("site");
        std::fs::create_dir_all(site.join("img")).unwrap();
        std::fs::write(site.join("draft.css"), "body{background:url(img/bg.png)}").unwrap();
        std::fs::write(site.join("img/bg.png"), [1, 2, 3]).unwrap();
        std::fs::write(site.join("img/logo.svg"), "<svg/>").unwrap();
        std::fs::write(scratch.0.join("secret.png"), [9]).unwrap();
        let page = site.join("index.html");
        let html = "<html><head><link rel=\"stylesheet\" href=\"draft.css\"></head>\
                    <body><img src=\"img/logo.svg\"><img src='../secret.png'>\
                    <img src=\"https://example.com/x.png\"></body></html>";
        let document = build_document(&page, html).unwrap();
        assert!(document
            .contains("<style>body{background:url(\"data:image/png;base64,AQID\")}</style>"));
        assert!(document.contains("src=\"data:image/svg+xml;base64,"));
        assert!(
            document.contains("src='../secret.png'"),
            "outside the folder stays a dead link"
        );
        assert!(document.contains("https://example.com/x.png"));
        let policy = document.find("Content-Security-Policy").unwrap();
        assert!(
            policy < document.find("<style>").unwrap(),
            "the policy comes first"
        );
        assert!(document.contains("connect-src 'none'"));
    }

    #[cfg(unix)]
    #[test]
    fn a_link_inside_the_folder_cannot_lead_out() {
        let scratch = Scratch::new();
        let site = scratch.0.join("site");
        std::fs::create_dir_all(&site).unwrap();
        std::fs::write(scratch.0.join("outside.png"), [7]).unwrap();
        std::os::unix::fs::symlink(scratch.0.join("outside.png"), site.join("in.png")).unwrap();
        let document = build_document(&site.join("index.html"), "<img src=\"in.png\">").unwrap();
        assert!(document.contains("src=\"in.png\""));
    }

    #[test]
    fn only_html_files_preview() {
        assert!(is_html(Path::new("/a/index.HTML")));
        assert!(is_html(Path::new("/a/page.xhtml")));
        assert!(!is_html(Path::new("/a/notes.md")));
    }
}
