use agent_runs::PageReader;
use serde::Serialize;

use crate::agents::web_fetch::fetch_raw;
use crate::browser::page_text::host::ConfinedPageReader;

#[path = "tutor_youtube.rs"]
mod youtube;

use youtube::{video, youtube_id};

const PAGE_BYTES: usize = 4 << 20;
const PDF_BYTES: usize = 40 << 20;
const TEXT_LIMIT: usize = 400_000;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadLink {
    pub title: String,
    pub text: String,
    pub kind: &'static str,
    pub truncated: bool,
}

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

async fn pdf(bytes: &[u8], address: &url::Url) -> Result<ReadLink, String> {
    let folder = tempfile::Builder::new()
        .prefix("misty-")
        .tempdir()
        .map_err(|error| error.to_string())?;
    let path = folder.path().join("source.pdf");
    file_access::fs_async::write(&path, bytes)
        .await
        .map_err(|error| error.to_string())?;
    let document = documents::prepare_document(path, crate::app::workers::program)
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

const PICTURE_BYTES: usize = 8 << 20;

fn picture_type(content_type: &str) -> bool {
    matches!(
        content_type.split(';').next().unwrap_or("").trim(),
        "image/png" | "image/jpeg" | "image/webp" | "image/gif"
    )
}

#[tauri::command]
pub async fn tutor_picture(webview: tauri::Webview, url: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only Misty's own windows can show pictures.".into());
    }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let parsed = url::Url::parse(url.trim()).map_err(|_| "That isn't a web address.".to_owned())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only web addresses can be shown.".into());
    }
    let response = fetch_raw(
        parsed.as_str(),
        "image/webp,image/png,image/jpeg,image/gif;q=0.9",
        PICTURE_BYTES,
        picture_type,
    )
    .await
    .map_err(|_| "Misty couldn't reach that picture.".to_owned())?;
    let kind = response
        .content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_owned();
    if response.status >= 400
        || response.truncated
        || !picture_type(&kind)
        || response.body.is_empty()
    {
        return Err("That isn't a picture Misty can show.".into());
    }
    Ok(format!(
        "data:{kind};base64,{}",
        STANDARD.encode(&response.body)
    ))
}

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
        .map(percent_decode)
        .unwrap_or_else(|| "Dropped file".to_owned());
    let extension = std::path::Path::new(&name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| value.len() <= 8 && value.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or_else(|| "txt".to_owned());
    let folder = tempfile::Builder::new()
        .prefix("misty-")
        .tempdir()
        .map_err(|error| error.to_string())?;
    let path = folder.path().join(format!("source.{extension}"));
    file_access::fs_async::write(&path, bytes)
        .await
        .map_err(|error| error.to_string())?;
    let mut document = documents::prepare_document(path, crate::app::workers::program)
        .await
        .map_err(|_| format!("Misty couldn't read {name}."))?;
    document.display_name = name;
    Ok(document)
}

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
}
