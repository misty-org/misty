use std::{
    borrow::Cow,
    io::{self, Cursor, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

#[cfg(target_os = "macos")]
use std::sync::{Condvar, Mutex};

use sha2::{Digest, Sha256};
use tauri::{
    http::{header, Request, Response, StatusCode},
    UriSchemeContext, UriSchemeResponder, Wry,
};

use file_access::disk::CheckedFile as File;

use super::thumbnail_cache::ThumbnailCache;
use crate::app::trusted_windows::asset_protocol::{app_origin, requested_path, single_range};

pub const SCHEME: &str = "misty-disk";

const CONTENT_CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const RANGE_CHUNK: u64 = 1000 * 1024;
const MAX_THUMBNAIL_SOURCE: u64 = 64 * 1024 * 1024;
const SMALL_ORIGINAL: u64 = 512 * 1024;
const WHOLE_ANY: u64 = 8 * 1024 * 1024;
const WHOLE_PICTURE: u64 = 64 * 1024 * 1024;

type Served = Response<Cow<'static, [u8]>>;

static THUMBNAILS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);
#[cfg(target_os = "macos")]
static QUICK_LOOK: Turns = Turns::new(2);

#[cfg(target_os = "macos")]
struct Turns {
    busy: Mutex<usize>,
    freed: Condvar,
    most: usize,
}

#[cfg(target_os = "macos")]
struct Turn(&'static Turns);

#[cfg(target_os = "macos")]
impl Turns {
    const fn new(most: usize) -> Self {
        Self {
            busy: Mutex::new(0),
            freed: Condvar::new(),
            most,
        }
    }

    fn take(&'static self) -> Turn {
        let mut busy = self
            .busy
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while *busy >= self.most {
            busy = self
                .freed
                .wait(busy)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
        *busy += 1;
        Turn(self)
    }
}

#[cfg(target_os = "macos")]
impl Drop for Turn {
    fn drop(&mut self) {
        let mut busy = self
            .0
            .busy
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *busy = busy.saturating_sub(1);
        self.0.freed.notify_one();
    }
}

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
    let foreign = request
        .headers()
        .get(header::ORIGIN)
        .is_some_and(|seen| seen.to_str().map_or(true, |seen| seen != origin));
    if foreign {
        responder.respond(status(StatusCode::FORBIDDEN, &origin));
        return;
    }
    let Some((source, wanted)) = requested(request.uri()) else {
        responder.respond(status(StatusCode::FORBIDDEN, &origin));
        return;
    };
    let thumbnails = ThumbnailCache::of(&app);
    tauri::async_runtime::spawn(async move {
        let _turn = match wanted {
            Wanted::Thumbnail(_) => THUMBNAILS.acquire().await.ok(),
            Wanted::File => None,
        };
        let failed_origin = origin.clone();
        let response = tokio::task::spawn_blocking(move || {
            serve(&request, source, wanted, &origin, thumbnails.as_ref())
                .unwrap_or_else(|code| status(code, &origin))
        })
        .await
        .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR, &failed_origin));
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

#[derive(Clone, Copy, Debug, PartialEq)]
enum Wanted {
    Thumbnail(u32),
    File,
}

#[derive(Debug, PartialEq)]
enum Source {
    Disk(PathBuf),
    Drive { space: String, path: String },
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

fn not_found(error: io::Error) -> StatusCode {
    match error.kind() {
        io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
        _ => StatusCode::FORBIDDEN,
    }
}

enum Body {
    Disk(File),
    Drive {
        drive: space_drive::Drive,
        space: space_drive::SpaceId,
        path: String,
    },
}

struct Opened {
    body: Body,
    len: u64,
    named: PathBuf,
    key: Vec<u8>,
    quick_look: Option<PathBuf>,
}

impl Opened {
    fn read(&mut self, start: u64, count: u64) -> io::Result<Vec<u8>> {
        match &mut self.body {
            Body::Disk(file) => {
                file.seek(SeekFrom::Start(start))?;
                let mut body = Vec::with_capacity(usize::try_from(count).unwrap_or(0));
                Read::by_ref(file).take(count).read_to_end(&mut body)?;
                Ok(body)
            }
            Body::Drive { drive, space, path } => drive
                .content_range(space, path, start, count)
                .map(|(bytes, _)| bytes),
        }
    }
}

fn open(source: Source) -> Result<Opened, StatusCode> {
    match source {
        Source::Disk(path) => {
            let file = super::gated::open_read(&path).map_err(not_found)?;
            let meta = file.metadata().map_err(not_found)?;
            let modified = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |since| since.as_nanos());
            let mut key = path.as_os_str().as_encoded_bytes().to_vec();
            key.push(0);
            key.extend(meta.len().to_le_bytes());
            key.extend(modified.to_le_bytes());
            Ok(Opened {
                body: Body::Disk(file),
                len: meta.len(),
                quick_look: Some(path.clone()),
                named: path,
                key,
            })
        }
        Source::Drive { space, path } => {
            let drive = crate::spaces_drive::drive().map_err(|_| StatusCode::NOT_FOUND)?;
            let space = space_drive::SpaceId(space);
            let node = drive
                .node_at(&space, &path)
                .map_err(|_| StatusCode::NOT_FOUND)?
                .filter(|node| node.kind == space_drive::Kind::File)
                .ok_or(StatusCode::NOT_FOUND)?;
            let quick_look = drive.local_content(&space, &path).ok().flatten();
            let mut key = format!("drive\0{}\0{}\0", space.0, path).into_bytes();
            key.extend(node.sha256.as_deref().unwrap_or("").as_bytes());
            key.extend(node.mtime_ms.to_le_bytes());
            key.extend(node.size.to_le_bytes());
            Ok(Opened {
                len: node.size,
                named: PathBuf::from(&path),
                key,
                quick_look,
                body: Body::Drive { drive, space, path },
            })
        }
    }
}

fn serve(
    request: &Request<Vec<u8>>,
    source: Source,
    wanted: Wanted,
    origin: &str,
    thumbnails: Option<&ThumbnailCache>,
) -> Result<Served, StatusCode> {
    let mut opened = open(source)?;
    let base = Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff");
    match wanted {
        Wanted::Thumbnail(size) => {
            let (body, mime) = small_original(&mut opened, size)
                .or_else(|| cached_thumbnail(&mut opened, size, thumbnails))
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
            let mime = served_mime(&opened.named).ok_or(StatusCode::NOT_FOUND)?;
            let base = if mime == "application/pdf" {
                base
            } else {
                base.header(header::CONTENT_SECURITY_POLICY, CONTENT_CSP)
            };
            let range = request
                .headers()
                .get(header::RANGE)
                .and_then(|value| value.to_str().ok());
            file(&mut opened, mime, range, base)
        }
    }
}

fn small_original(opened: &mut Opened, size: u32) -> Option<(Vec<u8>, &'static str)> {
    if opened.len > SMALL_ORIGINAL {
        return None;
    }
    let body = opened.read(0, opened.len).ok()?;
    let mime = picture_mime(&body)?;
    let (width, height) = image::ImageReader::new(Cursor::new(&body))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()?;
    let most = size.saturating_mul(2);
    (width <= most && height <= most).then_some((body, mime))
}

fn cached_thumbnail(
    opened: &mut Opened,
    size: u32,
    cache: Option<&ThumbnailCache>,
) -> Option<(Vec<u8>, &'static str)> {
    let Some(cache) = cache else {
        return thumbnail(opened, size);
    };
    let kept = cache.dir.join(thumbnail_name(&opened.key, size));
    if let Ok(body) = file_access::fs::read(&kept) {
        if let Some(mime) = picture_mime(&body) {
            cache.touched(&kept);
            return Some((body, mime));
        }
    }
    let (body, mime) = thumbnail(opened, size)?;
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

fn thumbnail_name(key: &[u8], size: u32) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key);
    hasher.update([0]);
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

fn decoded(bytes: &[u8], size: u32) -> Option<(Vec<u8>, &'static str)> {
    let picture = image::ImageReader::new(Cursor::new(bytes))
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

#[cfg(target_os = "macos")]
fn quick_look(opened: &Opened, size: u32) -> Option<(Vec<u8>, &'static str)> {
    let path = opened.quick_look.as_deref()?;
    if let Body::Disk(_) = opened.body {
        let (folder, name) = super::gated::parent(path, file_access::Access::Read).ok()?;
        if !folder.metadata(&name).ok()?.is_file() {
            return None;
        }
    }
    let _turn = QUICK_LOOK.take();
    super::quick_look_thumbnail::thumbnail(path, size)
}

fn thumbnail(opened: &mut Opened, size: u32) -> Option<(Vec<u8>, &'static str)> {
    if opened.len <= MAX_THUMBNAIL_SOURCE {
        if let Ok(bytes) = opened.read(0, opened.len) {
            #[cfg(target_os = "macos")]
            if let Some(made) = super::system_thumbnail::thumbnail(&bytes, size) {
                return Some(made);
            }
            if let Some(made) = decoded(&bytes, size) {
                return Some(made);
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        quick_look(opened, size)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = &opened.quick_look;
        None
    }
}

fn is_media(mime: &str) -> bool {
    mime.starts_with("video/") || mime.starts_with("audio/")
}

fn file(
    opened: &mut Opened,
    mime: &'static str,
    range: Option<&str>,
    base: tauri::http::response::Builder,
) -> Result<Served, StatusCode> {
    let length = opened.len;
    let base = base
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes");
    let (start, end) = match range {
        None if length <= WHOLE_ANY || (!is_media(mime) && length <= WHOLE_PICTURE) => {
            let body = opened
                .read(0, length)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            return base
                .header(header::CONTENT_LENGTH, body.len())
                .body(Cow::Owned(body))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
        }
        None if is_media(mime) => (0, length - 1),
        None => return Err(StatusCode::PAYLOAD_TOO_LARGE),
        Some(range) => match single_range(range, length) {
            Some(found) => found,
            None => {
                return base
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{length}"))
                    .body(Cow::Borrowed(&[][..]))
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
            }
        },
    };
    let end = end.min(start.saturating_add(RANGE_CHUNK * 8) - 1);
    let count = end - start + 1;
    let body = opened
        .read(start, count)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if body.is_empty() {
        return Err(StatusCode::RANGE_NOT_SATISFIABLE);
    }
    let end = start + body.len() as u64 - 1;
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
    fn a_kept_thumbnail_is_named_for_its_image_and_size_and_never_by_its_path() {
        let key = b"/Users/me/misty-thumb-name.png\0".to_vec();
        let small = thumbnail_name(&key, 96);
        assert_eq!(small, thumbnail_name(&key, 96));
        assert_ne!(small, thumbnail_name(&key, 256));
        assert!(!small.contains("misty-thumb-name"));
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
        assert!(is_media("video/mp4") && !is_media("application/pdf"));
    }
}
