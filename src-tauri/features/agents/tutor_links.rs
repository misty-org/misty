//! Tutor's link sources, read on this computer so a notebook keeps their text: a web page through
//! the confined page reader, a PDF through the confined document worker, and a YouTube video as its
//! caption track. Every request goes through `web_fetch`, so only public addresses are contacted,
//! with no cookies or sign-ins. Nothing reaches Misty's server.
use agent_runs::PageReader;
use serde::Serialize;

use crate::agents::web_fetch::fetch_raw;
use crate::browser::page_text::host::ConfinedPageReader;

const PAGE_BYTES: usize = 4 << 20;
const PDF_BYTES: usize = 40 << 20;
const TEXT_LIMIT: usize = 400_000;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadLink {
    pub title: String,
    pub text: String,
    /// "page", "pdf" or "video".
    pub kind: &'static str,
    pub truncated: bool,
}

/// Reads a link's text. Fails with a sentence for the person when the link can't be read.
#[tauri::command]
pub async fn tutor_read_link(webview: tauri::Webview, url: String) -> Result<ReadLink, String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only Misty's own windows can read sources.".into());
    }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let parsed = url::Url::parse(url.trim()).map_err(|_| "That isn't a web address.".to_owned())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only web addresses can be read.".into());
    }
    if let Some(id) = youtube_id(&parsed) {
        return video(&id).await;
    }
    page(&parsed).await
}

fn readable_type(content_type: &str) -> bool {
    content_type.is_empty()
        || content_type.starts_with("text/")
        || content_type.starts_with("application/xhtml+xml")
        || content_type.starts_with("application/xml")
        || content_type.starts_with("application/json")
        || content_type.starts_with("application/pdf")
}

async fn page(address: &url::Url) -> Result<ReadLink, String> {
    let response = fetch_raw(
        address.as_str(),
        "text/html,application/xhtml+xml,application/pdf;q=0.9,text/*;q=0.8,*/*;q=0.1",
        PDF_BYTES.max(PAGE_BYTES),
        readable_type,
    )
    .await
    .map_err(|_| "Misty couldn't reach that page.".to_owned())?;
    if response.status >= 400 {
        return Err(format!(
            "The page answered with an error ({}).",
            response.status
        ));
    }
    if response.content_type.starts_with("application/pdf") {
        return pdf(&response.body, address).await;
    }
    if response.body.len() > PAGE_BYTES {
        return Err("That page is too large to read.".into());
    }
    let html = String::from_utf8_lossy(&response.body);
    let read = ConfinedPageReader
        .read(&html, &response.content_type, "", TEXT_LIMIT)
        .await
        .map_err(|_| "Misty couldn't read that page's text.".to_owned())?;
    if read.text.trim().is_empty() {
        return Err("That page has no text Misty can read; it may need a sign-in.".into());
    }
    Ok(ReadLink {
        title: read.title,
        text: read.text,
        kind: "page",
        truncated: read.truncated || response.truncated,
    })
}

/// A PDF from the web, parsed by the confined document worker from a temporary copy.
async fn pdf(bytes: &[u8], address: &url::Url) -> Result<ReadLink, String> {
    let folder = tempfile::tempdir().map_err(|error| error.to_string())?;
    let path = folder.path().join("source.pdf");
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|error| error.to_string())?;
    let document = documents::prepare_document(path, crate::app::embedded_workers::builtin_worker)
        .await
        .map_err(|_| "Misty couldn't read that PDF.".to_owned())?;
    let text = document
        .sections
        .iter()
        .map(|section| {
            if section.locator.is_empty() {
                section.text.clone()
            } else {
                format!("[{}]\n{}", section.locator, section.text)
            }
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let title = address
        .path_segments()
        .and_then(|mut segments| segments.next_back().map(str::to_owned))
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| address.host_str().unwrap_or("PDF").to_owned());
    Ok(ReadLink {
        title,
        text,
        kind: "pdf",
        truncated: document.truncated,
    })
}

/// A file dropped on a notebook: its bytes come as the request body and its name in a header, so
/// the window hands over only what the person dropped, never a path. Parsed by the confined
/// document worker from a temporary copy.
#[tauri::command]
pub async fn tutor_read_dropped(
    webview: tauri::Webview,
    request: tauri::ipc::Request<'_>,
) -> Result<documents::PreparedAgentDocument, String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only Misty's own windows can read sources.".into());
    }
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("The file didn't arrive.".into());
    };
    if bytes.len() as u64 > documents::MAX_AGENT_DOCUMENT_BYTES {
        return Err("That file is larger than Misty reads (50 MB).".into());
    }
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|value| value.to_str().ok())
        .map(|value| percent_decode(value))
        .unwrap_or_else(|| "Dropped file".to_owned());
    let extension = std::path::Path::new(&name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| value.len() <= 8 && value.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or_else(|| "txt".to_owned());
    let folder = tempfile::tempdir().map_err(|error| error.to_string())?;
    let path = folder.path().join(format!("source.{extension}"));
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|error| error.to_string())?;
    let mut document =
        documents::prepare_document(path, crate::app::embedded_workers::builtin_worker)
            .await
            .map_err(|_| format!("Misty couldn't read {name}."))?;
    document.display_name = name;
    Ok(document)
}

/// Saves something Tutor made (a video overview, an infographic) to the file the person chose in the
/// system's save dialog, which granted that one path. The bytes come as the body, the path in a
/// header; any other path is refused by the file gate.
#[tauri::command]
pub async fn tutor_save_export(
    webview: tauri::Webview,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only Misty's own windows can save.".into());
    }
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Nothing arrived to save.".into());
    };
    let path = request
        .headers()
        .get("x-path")
        .and_then(|value| value.to_str().ok())
        .map(percent_decode_path)
        .ok_or_else(|| "Choose where to save first.".to_owned())?;
    let bytes = bytes.clone();
    tokio::task::spawn_blocking(move || file_access::fs::write(&path, bytes))
        .await
        .map_err(|_| "Saving stopped.".to_owned())?
        .map_err(|_| "Misty couldn't save there.".to_owned())
}

/// A percent-encoded path, decoded byte for byte (no name cleanup: it must match the grant).
fn percent_decode_path(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out)
        .chars()
        .filter(|c| !c.is_control())
        .take(200)
        .collect()
}

/// The video id of a YouTube watch, short, embed or youtu.be link.
pub(crate) fn youtube_id(url: &url::Url) -> Option<String> {
    let host = url
        .host_str()?
        .trim_start_matches("www.")
        .trim_start_matches("m.");
    let id = match host {
        "youtu.be" => url.path_segments()?.next()?.to_owned(),
        "youtube.com" | "music.youtube.com" => {
            let mut segments = url.path_segments()?;
            match segments.next()? {
                "watch" => url
                    .query_pairs()
                    .find(|(key, _)| key == "v")?
                    .1
                    .into_owned(),
                "shorts" | "embed" | "live" => segments.next()?.to_owned(),
                _ => return None,
            }
        }
        _ => return None,
    };
    let valid = !id.is_empty()
        && id.len() <= 20
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    valid.then_some(id)
}

/// A video as its captions, one line per caption with its time.
async fn video(id: &str) -> Result<ReadLink, String> {
    let watch = format!("https://www.youtube.com/watch?v={id}&hl=en");
    let response = fetch_raw(&watch, "text/html", PAGE_BYTES, readable_type)
        .await
        .map_err(|_| "Misty couldn't reach YouTube.".to_owned())?;
    let html = String::from_utf8_lossy(&response.body);
    let title = page_title(&html).unwrap_or_else(|| "YouTube video".to_owned());
    let Some(track) = caption_track(&html) else {
        return Err("This video has no captions Misty can read.".into());
    };
    let captions = fetch_raw(
        &track,
        "text/xml,application/xml",
        PAGE_BYTES,
        readable_type,
    )
    .await
    .map_err(|_| "Misty couldn't fetch the video's captions.".to_owned())?;
    let lines = caption_lines(&String::from_utf8_lossy(&captions.body));
    if lines.is_empty() {
        return Err("YouTube didn't hand over this video's captions.".into());
    }
    Ok(ReadLink {
        title,
        text: lines.join("\n"),
        kind: "video",
        truncated: captions.truncated,
    })
}

fn page_title(html: &str) -> Option<String> {
    let start = html.find("<title>")? + "<title>".len();
    let end = start + html[start..].find("</title>")?;
    let title = decode_entities(html[start..end].trim());
    let title = title.trim_end_matches(" - YouTube").trim().to_owned();
    (!title.is_empty()).then_some(title)
}

/// The caption track to read from the watch page's player data: English when there is one,
/// written captions before automatic ones, else the first.
pub(crate) fn caption_track(html: &str) -> Option<String> {
    let at = html.find("\"captionTracks\":")? + "\"captionTracks\":".len();
    let rest = &html[at..];
    // The array ends at its matching bracket.
    let mut depth = 0usize;
    let mut end = None;
    let mut in_string = false;
    let mut escaped = false;
    for (index, character) in rest.char_indices() {
        if in_string {
            match character {
                _ if escaped => escaped = false,
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match character {
            '"' => in_string = true,
            '[' => depth += 1,
            ']' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    end = Some(index + 1);
                    break;
                }
            }
            _ => {}
        }
    }
    let tracks: Vec<serde_json::Value> = serde_json::from_str(&rest[..end?]).ok()?;
    let language = |track: &serde_json::Value| {
        track
            .get("languageCode")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_owned()
    };
    let automatic = |track: &serde_json::Value| {
        track.get("kind").and_then(|value| value.as_str()) == Some("asr")
    };
    let pick = tracks
        .iter()
        .find(|track| language(track).starts_with("en") && !automatic(track))
        .or_else(|| {
            tracks
                .iter()
                .find(|track| language(track).starts_with("en"))
        })
        .or_else(|| tracks.iter().find(|track| !automatic(track)))
        .or_else(|| tracks.first())?;
    let base = pick.get("baseUrl")?.as_str()?;
    let parsed = url::Url::parse(base).ok()?;
    let host = parsed.host_str()?;
    (host == "www.youtube.com" || host == "youtube.com").then(|| base.to_owned())
}

/// "[m:ss] words" lines from a timedtext XML document.
pub(crate) fn caption_lines(xml: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let mut rest = xml;
    while let Some(open) = rest.find("<text") {
        let after = &rest[open..];
        let Some(close_tag) = after.find('>') else {
            break;
        };
        let attributes = &after[..close_tag];
        let Some(end) = after.find("</text>") else {
            break;
        };
        let body = &after[close_tag + 1..end];
        let start = attributes
            .split("start=\"")
            .nth(1)
            .and_then(|value| value.split('"').next())
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap_or(0.0);
        let text = decode_entities(&decode_entities(body)).replace('\n', " ");
        let text = text.trim();
        if !text.is_empty() {
            let seconds = start as u64;
            lines.push(format!("[{}:{:02}] {}", seconds / 60, seconds % 60, text));
        }
        rest = &after[end + "</text>".len()..];
    }
    lines
}

fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        let Some(semi) = tail.find(';').filter(|semi| *semi <= 10) else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let name = &tail[1..semi];
        let decoded = match name {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ if name.starts_with("#x") => u32::from_str_radix(&name[2..], 16)
                .ok()
                .and_then(char::from_u32),
            _ if name.starts_with('#') => name[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match decoded {
            Some(character) => {
                out.push(character);
                rest = &tail[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_a_dropped_file_name() {
        assert_eq!(
            percent_decode("Notes%20on%20cells.pdf"),
            "Notes on cells.pdf"
        );
        assert_eq!(percent_decode("caf%C3%A9.txt"), "café.txt");
        assert_eq!(percent_decode("100%"), "100%");
    }

    #[test]
    fn finds_a_video_id_in_every_kind_of_youtube_link() {
        let id = |address: &str| youtube_id(&url::Url::parse(address).unwrap());
        assert_eq!(
            id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10"),
            Some("dQw4w9WgXcQ".into())
        );
        assert_eq!(
            id("https://youtu.be/dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".into())
        );
        assert_eq!(
            id("https://m.youtube.com/shorts/abc_DEF-123"),
            Some("abc_DEF-123".into())
        );
        assert_eq!(id("https://www.youtube.com/@channel"), None);
        assert_eq!(id("https://example.com/watch?v=x"), None);
    }

    #[test]
    fn picks_english_written_captions_from_the_player_data() {
        let html = r#"var x = {"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=1&lang=de","languageCode":"de"},{"baseUrl":"https://www.youtube.com/api/timedtext?v=1&lang=en&kind=asr","languageCode":"en","kind":"asr"},{"baseUrl":"https://www.youtube.com/api/timedtext?v=1&lang=en","languageCode":"en","name":{"simpleText":"English [CC]"}}],"audioTracks":[]}"#;
        assert_eq!(
            caption_track(html).as_deref(),
            Some("https://www.youtube.com/api/timedtext?v=1&lang=en")
        );
        let elsewhere =
            r#"{"captionTracks":[{"baseUrl":"https://evil.example/x","languageCode":"en"}]}"#;
        assert_eq!(caption_track(elsewhere), None);
    }

    #[test]
    fn reads_timed_captions_with_their_times_and_entities() {
        let xml = r#"<?xml version="1.0"?><transcript><text start="0.5" dur="2">Hello &amp;amp; welcome</text><text start="75.2" dur="1">it&amp;#39;s &lt;fine&gt;</text><text start="80" dur="1"> </text></transcript>"#;
        assert_eq!(
            caption_lines(xml),
            vec!["[0:00] Hello & welcome", "[1:15] it's <fine>"]
        );
    }
}
