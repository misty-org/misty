use std::{
    borrow::Cow,
    io::{BufReader, Cursor, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use file_access::{disk::fs_disk, fs::File};
use sha2::{Digest, Sha256};
use tauri::{
    http::{header, Request, Response, StatusCode},
    UriSchemeContext, UriSchemeResponder, Wry,
};

use super::thumbnail_cache::ThumbnailCache;
use crate::app::trusted_windows::asset_protocol::{app_origin, requested_path, single_range};

pub const SCHEME: &str = "misty-disk";

const CONTENT_CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const RANGE_CHUNK: u64 = 1000 * 1024;
const MAX_THUMBNAIL_SOURCE: u64 = 64 * 1024 * 1024;

type Served = Response<Cow<'static, [u8]>>;

pub fn handle(
    context: UriSchemeContext<'_, Wry>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = context.app_handle().clone();
    let origin = app_origin(&app);
    let thumbnails = super::thumbnail_cache::ThumbnailCache::of(&app);
    if !crate::browser::app_windows::is_person_window(context.webview_label()) {
        responder.respond(status(StatusCode::FORBIDDEN, &origin));
        return;
    }
    tauri::async_runtime::spawn(async move {
        let response = tokio::task::spawn_blocking(move || {
            serve(&request, &origin, thumbnails.as_ref())
                .unwrap_or_else(|code| status(code, &origin))
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

#[derive(Debug, PartialEq)]
enum Source {
    Disk(PathBuf),
    Drive { space: String, path: String },
}

type Opener = fn(&Path) -> std::io::Result<File>;

fn open_disk(path: &Path) -> std::io::Result<File> {
    fs_disk::open(path)
}

fn open_own(path: &Path) -> std::io::Result<File> {
    File::open(path)
}

fn requested(uri: &tauri::http::Uri) -> Option<(Source, Wanted)> {
    let path = requested_path(uri.path())?;
    let query: Vec<(String, String)> = url::form_urlencoded::parse(uri.query()?.as_bytes())
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    let value = |name: &str| {
        query
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    };
    let path = match value("space") {
        Some(space) if !space.is_empty() && space.len() <= 128 => {
            let path = path.as_ref().to_str()?;
            path.starts_with('/').then(|| Source::Drive {
                space: space.to_owned(),
                path: path.to_owned(),
            })?
        }
        Some(_) => return None,
        None => Source::Disk(super::asked_path(path.as_ref().to_str()?).ok()?),
    };
    let wanted = match value("kind")? {
        "thumbnail" => {
            let size = value("size")
                .and_then(|size| size.parse::<u32>().ok())
                .unwrap_or(256);
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

fn serve(
    request: &Request<Vec<u8>>,
    origin: &str,
    thumbnails: Option<&ThumbnailCache>,
) -> Result<Served, StatusCode> {
    let (source, wanted) = requested(request.uri()).ok_or(StatusCode::FORBIDDEN)?;
    let (path, named, meta, open): (PathBuf, PathBuf, std::fs::Metadata, Opener) = match source {
        Source::Disk(path) => {
            let meta = fs_disk::metadata(&path).map_err(not_found)?;
            (path.clone(), path, meta, open_disk as Opener)
        }
        Source::Drive {
            space,
            path: in_drive,
        } => {
            let drive = crate::spaces_drive::drive().map_err(|_| StatusCode::NOT_FOUND)?;
            let cached = drive
                .local_content(&space_drive::SpaceId(space), &in_drive)
                .map_err(|_| StatusCode::NOT_FOUND)?
                .ok_or(StatusCode::NOT_FOUND)?;
            let meta = file_access::fs::metadata(&cached).map_err(not_found)?;
            (cached, PathBuf::from(in_drive), meta, open_own as Opener)
        }
    };
    if !meta.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    let base = Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff");
    match wanted {
        Wanted::Thumbnail(size) => {
            if meta.len() > MAX_THUMBNAIL_SOURCE {
                return Err(StatusCode::NOT_FOUND);
            }
            let (body, mime) = cached_thumbnail(&path, &meta, size, thumbnails, open)
                .ok_or(StatusCode::NOT_FOUND)?;
            base.header(
                header::CACHE_CONTROL,
                "private, max-age=31536000, immutable",
            )
            .header(header::CONTENT_TYPE, mime)
            .header(header::CONTENT_SECURITY_POLICY, CONTENT_CSP)
            .header(header::CONTENT_LENGTH, body.len())
            .body(Cow::Owned(body))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
        }
        Wanted::File => {
            let base = base.header(header::CACHE_CONTROL, "no-store");
            let mime = served_mime(&named).ok_or(StatusCode::NOT_FOUND)?;
            let base = if mime == "application/pdf" {
                base
            } else {
                base.header(header::CONTENT_SECURITY_POLICY, CONTENT_CSP)
            };
            let range = request
                .headers()
                .get(header::RANGE)
                .and_then(|value| value.to_str().ok());
            file(&path, meta.len(), mime, range, base, open)
        }
    }
}

fn cached_thumbnail(
    path: &Path,
    meta: &std::fs::Metadata,
    size: u32,
    cache: Option<&ThumbnailCache>,
    open: Opener,
) -> Option<(Vec<u8>, &'static str)> {
    let Some(cache) = cache else {
        return thumbnail(path, size, open);
    };
    let kept = cache.dir.join(thumbnail_name(path, meta, size));
    if let Ok(body) = file_access::fs::read(&kept) {
        if let Some(mime) = picture_mime(&body) {
            cache.touched(&kept);
            return Some((body, mime));
        }
    }
    let (body, mime) = thumbnail(path, size, open)?;
    let partial = kept.with_extension(format!("{}.part", std::process::id()));
    let saved = file_access::fs::create_dir_all(&cache.dir)
        .and_then(|()| file_access::fs::write(&partial, &body))
        .and_then(|()| file_access::fs::rename(&partial, &kept));
    if saved.is_ok() {
        cache.added(body.len() as u64);
    } else {
        let _ = file_access::fs::remove_file(&partial);
    }
    Some((body, mime))
}

fn thumbnail_name(path: &Path, meta: &std::fs::Metadata, size: u32) -> String {
    let modified = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_nanos());
    let mut hasher = Sha256::new();
    hasher.update(path.as_os_str().as_encoded_bytes());
    hasher.update([0]);
    hasher.update(meta.len().to_le_bytes());
    hasher.update(modified.to_le_bytes());
    hasher.update(size.to_le_bytes());
    hex::encode(hasher.finalize())
}

fn picture_mime(body: &[u8]) -> Option<&'static str> {
    if body.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if body.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else {
        None
    }
}

fn thumbnail(path: &Path, size: u32, open: Opener) -> Option<(Vec<u8>, &'static str)> {
    let file = open(path).ok()?;
    #[cfg(target_os = "macos")]
    if let Some(made) = super::system_thumbnail::thumbnail(path, size) {
        return Some(made);
    }
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

fn file(
    path: &Path,
    length: u64,
    mime: &'static str,
    range: Option<&str>,
    base: tauri::http::response::Builder,
    open: Opener,
) -> Result<Served, StatusCode> {
    let mut opened = open(path).map_err(not_found)?;
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
        .header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{length}"),
        )
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
            requested(&uri(
                "misty-disk://localhost/%2FUsers%2Fme%2Fa%20b.png?kind=thumbnail&size=96&v=3"
            )),
            Some((
                Source::Disk(PathBuf::from("/Users/me/a b.png")),
                Wanted::Thumbnail(96)
            ))
        );
        assert_eq!(
            requested(&uri(
                "http://misty-disk.localhost/%2FUsers%2Fme%2Fclip.mov?v=1&kind=file"
            ))
            .map(|(_, wanted)| wanted),
            Some(Wanted::File)
        );
        assert_eq!(
            requested(&uri(
                "misty-disk://localhost/%2Fa.png?kind=thumbnail&size=99999"
            ))
            .map(|(_, wanted)| wanted),
            Some(Wanted::Thumbnail(1024))
        );
        assert!(requested(&uri("misty-disk://localhost/%2FUsers%2Fme%2Fa.png")).is_none());
        assert!(requested(&uri(
            "misty-disk://localhost/%2FUsers%2Fme%2Fa.png?kind=page"
        ))
        .is_none());
        assert!(requested(&uri(
            "misty-disk://localhost/%2Fa%2F..%2Fetc%2Fpasswd?kind=file"
        ))
        .is_none());
        assert!(requested(&uri("misty-disk://localhost/relative.png?kind=file")).is_none());
        assert_eq!(
            requested(&uri(
                "misty-disk://localhost/%2FDesign%2Fa.png?kind=thumbnail&size=96&space=spc_1"
            ))
            .map(|(source, _)| source),
            Some(Source::Drive {
                space: "spc_1".into(),
                path: "/Design/a.png".into()
            })
        );
        assert!(requested(&uri(
            "misty-disk://localhost/%2FDesign%2F..%2Fa.png?kind=file&space=spc_1"
        ))
        .is_none());
        assert!(requested(&uri(
            "misty-disk://localhost/%2FDesign%2Fa.png?kind=file&space="
        ))
        .is_none());
    }

    #[test]
    #[allow(clippy::disallowed_methods)]
    fn a_kept_thumbnail_is_named_for_its_image_and_size_and_never_by_its_path() {
        let file =
            std::env::temp_dir().join(format!("misty-thumb-name-{}.png", std::process::id()));
        std::fs::write(&file, b"x").unwrap();
        let meta = std::fs::metadata(&file).unwrap();
        let small = thumbnail_name(&file, &meta, 96);
        assert_eq!(small, thumbnail_name(&file, &meta, 96));
        assert_ne!(small, thumbnail_name(&file, &meta, 256));
        assert!(!small.contains("misty-thumb-name"));
        std::fs::remove_file(&file).unwrap();
        assert_eq!(picture_mime(b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(picture_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(picture_mime(b"<svg"), None);
    }

    #[test]
    fn only_pictures_media_and_pdfs_are_served_whole() {
        assert_eq!(
            served_mime(Path::new("/a/Clip.MOV")),
            Some("video/quicktime")
        );
        assert_eq!(
            served_mime(Path::new("/a/book.pdf")),
            Some("application/pdf")
        );
        assert_eq!(served_mime(Path::new("/a/page.html")), None);
        assert_eq!(served_mime(Path::new("/a/script.js")), None);
    }
}
