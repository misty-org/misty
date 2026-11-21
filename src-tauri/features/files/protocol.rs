//! The `misty-disk:` protocol: Files' grid cards, info panel and Quick Look load a picture of a
//! file, or the file itself, by URL, so the bytes never travel through IPC.
//!
//! A URL is `misty-disk://localhost/<percent-encoded absolute path>?kind=thumbnail&size=N&v=…`
//! (on Windows `http://misty-disk.localhost/...`). As with `misty-file:`, only a person's own
//! window may ask (website views share the protocol and are refused), and the path must decode
//! without `..`. Every read passes the disk gate. `kind=thumbnail` serves a small PNG or JPEG of an
//! image and refuses anything else; `kind=file` serves an image, a video, audio or a PDF with its
//! type, in ranges for players, and refuses any other kind of file, so no page is ever served.
use std::{
    borrow::Cow,
    io::{BufReader, Cursor, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

use file_access::disk::fs_disk;
use tauri::{
    http::{header, Request, Response, StatusCode},
    UriSchemeContext, UriSchemeResponder, Wry,
};

use crate::app::trusted_windows::asset_protocol::{app_origin, requested_path, single_range};

pub const SCHEME: &str = "misty-disk";

/// What is served is a picture or a player's media, and nothing else: an SVG opened on its own
/// runs no script and reaches nothing. PDFs go without it, since their viewer needs to run.
const CONTENT_CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
/// Open-ended range requests are answered in chunks of this size, like the asset protocol.
const RANGE_CHUNK: u64 = 1000 * 1024;
/// Larger images aren't decoded for a thumbnail.
const MAX_THUMBNAIL_SOURCE: u64 = 64 * 1024 * 1024;

type Served = Response<Cow<'static, [u8]>>;

pub fn handle(
    context: UriSchemeContext<'_, Wry>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = context.app_handle().clone();
    let origin = app_origin(&app);
    if !crate::browser::app_windows::is_person_window(context.webview_label()) {
        responder.respond(status(StatusCode::FORBIDDEN, &origin));
        return;
    }
    tauri::async_runtime::spawn(async move {
        let response = tokio::task::spawn_blocking(move || {
            serve(&request, &origin).unwrap_or_else(|code| status(code, &origin))
        })
        .await
        .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR, &app_origin(&app)));
        responder.respond(response);
    });
}

fn status(code: StatusCode, origin: &str) -> Served {
    Response::builder()
        .status(code)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
        .body(Cow::Borrowed(&[][..]))
        .expect("static response")
}

#[derive(Debug, PartialEq)]
enum Wanted {
    Thumbnail(u32),
    File,
}

/// The path and what is wanted of it, if the request names both and the path has no `..`.
fn requested(uri: &tauri::http::Uri) -> Option<(PathBuf, Wanted)> {
    let path = requested_path(uri.path())?;
    let path = super::asked_path(path.as_ref().to_str()?).ok()?;
    let query: Vec<(String, String)> = url::form_urlencoded::parse(uri.query()?.as_bytes())
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    let value = |name: &str| query.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_str());
    let wanted = match value("kind")? {
        "thumbnail" => {
            let size = value("size").and_then(|size| size.parse::<u32>().ok()).unwrap_or(256);
            Wanted::Thumbnail(size.clamp(16, 1024))
        }
        "file" => Wanted::File,
        _ => return None,
    };
    Some((path, wanted))
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// The type of a file Files may serve whole: pictures, video, audio and PDFs only.
fn served_mime(path: &Path) -> Option<&'static str> {
    Some(match extension(path).as_str() {
        "png" | "apng" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "tif" | "tiff" => "image/tiff",
        "svg" => "image/svg+xml",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "ogv" => "video/ogg",
        "mp3" => "audio/mpeg",
        "m4a" | "aac" => "audio/mp4",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "aif" | "aiff" => "audio/aiff",
        "pdf" => "application/pdf",
        _ => return None,
    })
}

fn not_found(error: std::io::Error) -> StatusCode {
    match error.kind() {
        std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
        _ => StatusCode::FORBIDDEN,
    }
}

fn serve(request: &Request<Vec<u8>>, origin: &str) -> Result<Served, StatusCode> {
    let (path, wanted) = requested(request.uri()).ok_or(StatusCode::FORBIDDEN)?;
    let meta = fs_disk::metadata(&path).map_err(not_found)?;
    if !meta.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    let base = Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        // The URL carries the file's modified time, so a change on disk is a new URL; the old
        // bytes are never kept.
        .header(header::CACHE_CONTROL, "no-store");
    match wanted {
        Wanted::Thumbnail(size) => {
            if meta.len() > MAX_THUMBNAIL_SOURCE {
                return Err(StatusCode::NOT_FOUND);
            }
            let (body, mime) = thumbnail(&path, size).ok_or(StatusCode::NOT_FOUND)?;
            base.header(header::CONTENT_TYPE, mime)
                .header(header::CONTENT_SECURITY_POLICY, CONTENT_CSP)
                .header(header::CONTENT_LENGTH, body.len())
                .body(Cow::Owned(body))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
        }
        Wanted::File => {
            let mime = served_mime(&path).ok_or(StatusCode::NOT_FOUND)?;
            // A PDF opens in the system's viewer inside its frame, which a sandbox would stop.
            let base = if mime == "application/pdf" {
                base
            } else {
                base.header(header::CONTENT_SECURITY_POLICY, CONTENT_CSP)
            };
            let range = request
                .headers()
                .get(header::RANGE)
                .and_then(|value| value.to_str().ok());
            file(&path, meta.len(), mime, range, base)
        }
    }
}

/// A small picture of an image, at most `size` pixels on its longer side: a PNG when it has
/// transparency, else a JPEG. Anything the image reader can't decode gets none.
fn thumbnail(path: &Path, size: u32) -> Option<(Vec<u8>, &'static str)> {
    let file = fs_disk::open(path).ok()?;
    let picture = image::ImageReader::new(BufReader::new(file))
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()?;
    let small = if picture.width() > size || picture.height() > size {
        picture.thumbnail(size, size)
    } else {
        picture
    };
    let mut body = Cursor::new(Vec::new());
    if small.color().has_alpha() {
        small.write_to(&mut body, image::ImageFormat::Png).ok()?;
        Some((body.into_inner(), "image/png"))
    } else {
        image::DynamicImage::ImageRgb8(small.to_rgb8())
            .write_to(&mut body, image::ImageFormat::Jpeg)
            .ok()?;
        Some((body.into_inner(), "image/jpeg"))
    }
}

/// The file itself, whole or in the one range a player asked for.
fn file(
    path: &Path,
    length: u64,
    mime: &'static str,
    range: Option<&str>,
    base: tauri::http::response::Builder,
) -> Result<Served, StatusCode> {
    let mut opened = fs_disk::open(path).map_err(not_found)?;
    let base = base
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes");
    let Some(range) = range else {
        let mut body = Vec::with_capacity(usize::try_from(length).unwrap_or(0));
        opened
            .read_to_end(&mut body)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        return base
            .header(header::CONTENT_LENGTH, body.len())
            .body(Cow::Owned(body))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
    };
    let Some((start, end)) = single_range(range, length) else {
        return base
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{length}"))
            .body(Cow::Borrowed(&[][..]))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
    };
    // An open-ended range is answered a chunk at a time, as the asset protocol does.
    let end = end.min(start.saturating_add(RANGE_CHUNK * 8) - 1);
    let count = end - start + 1;
    opened
        .seek(SeekFrom::Start(start))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut body = Vec::with_capacity(usize::try_from(count).unwrap_or(0));
    Read::by_ref(&mut opened)
        .take(count)
        .read_to_end(&mut body)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    base.status(StatusCode::PARTIAL_CONTENT)
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "content-range")
        .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{length}"))
        .header(header::CONTENT_LENGTH, body.len())
        .body(Cow::Owned(body))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uri(text: &str) -> tauri::http::Uri {
        text.parse().unwrap()
    }

    #[test]
    fn a_request_names_an_absolute_path_and_what_is_wanted() {
        assert_eq!(
            requested(&uri("misty-disk://localhost/%2FUsers%2Fme%2Fa%20b.png?kind=thumbnail&size=96&v=3")),
            Some((PathBuf::from("/Users/me/a b.png"), Wanted::Thumbnail(96)))
        );
        assert_eq!(
            requested(&uri("http://misty-disk.localhost/%2FUsers%2Fme%2Fclip.mov?v=1&kind=file"))
                .map(|(_, wanted)| wanted),
            Some(Wanted::File)
        );
        assert_eq!(
            requested(&uri("misty-disk://localhost/%2Fa.png?kind=thumbnail&size=99999"))
                .map(|(_, wanted)| wanted),
            Some(Wanted::Thumbnail(1024))
        );
        assert!(requested(&uri("misty-disk://localhost/%2FUsers%2Fme%2Fa.png")).is_none());
        assert!(requested(&uri("misty-disk://localhost/%2FUsers%2Fme%2Fa.png?kind=page")).is_none());
        assert!(requested(&uri("misty-disk://localhost/%2Fa%2F..%2Fetc%2Fpasswd?kind=file")).is_none());
        assert!(requested(&uri("misty-disk://localhost/relative.png?kind=file")).is_none());
    }

    #[test]
    fn only_pictures_media_and_pdfs_are_served_whole() {
        assert_eq!(served_mime(Path::new("/a/Clip.MOV")), Some("video/quicktime"));
        assert_eq!(served_mime(Path::new("/a/book.pdf")), Some("application/pdf"));
        assert_eq!(served_mime(Path::new("/a/page.html")), None);
        assert_eq!(served_mime(Path::new("/a/script.js")), None);
    }
}
