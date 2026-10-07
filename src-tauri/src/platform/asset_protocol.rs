//! The `asset:` protocol, served only to Misty's own windows.
//!
//! Tauri registers its built-in asset handler on every webview, including the
//! ones that show websites, and that handler ignores which webview asked. Any
//! page could then embed or probe files under Documents, Downloads and app
//! data. Registering this handler replaces the built-in one; it applies the
//! same configured scope but refuses requests from website views.
use std::{borrow::Cow, io::SeekFrom, path::PathBuf};

use tauri::{
    http::{header, Request, Response, StatusCode},
    path::SafePathBuf,
    utils::mime_type::MimeType,
    Manager, Runtime, UriSchemeContext, UriSchemeResponder,
};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

/// Open-ended range requests are answered in chunks of this size, like Tauri.
const RANGE_CHUNK: u64 = 1000 * 1024;

pub fn handle<R: Runtime>(
    context: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let origin = app_origin(context.app_handle());
    if super::navigation_guard::hosts_websites(context.webview_label()) {
        responder.respond(status(StatusCode::FORBIDDEN, &origin));
        return;
    }
    let scope = context.app_handle().asset_protocol_scope();
    tauri::async_runtime::spawn(async move {
        let response = serve(&request, &scope, &origin)
            .await
            .unwrap_or_else(|code| status(code, &origin));
        responder.respond(response);
    });
}

/// The origin Misty's own pages load from, for Access-Control-Allow-Origin.
fn app_origin<R: Runtime>(app: &tauri::AppHandle<R>) -> String {
    if cfg!(debug_assertions) {
        if let Some(dev) = app.config().build.dev_url.as_ref() {
            return dev.origin().ascii_serialization();
        }
    }
    if cfg!(windows) {
        "http://tauri.localhost".to_owned()
    } else {
        "tauri://localhost".to_owned()
    }
}

fn status(code: StatusCode, origin: &str) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(code)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
        .body(Cow::Borrowed(&[][..]))
        .expect("static response")
}

/// The local path a request names, if it is a valid, in-scope file path.
pub(crate) fn requested_path(uri_path: &str) -> Option<SafePathBuf> {
    let encoded = uri_path.strip_prefix('/')?;
    let decoded = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .ok()?;
    SafePathBuf::new(PathBuf::from(decoded.as_ref())).ok()
}

/// One satisfiable `bytes=start-end` range, clamped like Tauri's handler.
pub(crate) fn single_range(header: &str, length: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    if spec.contains(',') || length == 0 {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    let (start, end) = match (start.trim(), end.trim()) {
        ("", suffix) => {
            let suffix: u64 = suffix.parse().ok()?;
            (length.saturating_sub(suffix), length - 1)
        }
        (start, "") => {
            let start: u64 = start.parse().ok()?;
            (start, (start + RANGE_CHUNK - 1).min(length - 1))
        }
        (start, end) => (
            start.parse().ok()?,
            end.parse::<u64>().ok()?.min(length - 1),
        ),
    };
    (start <= end && start < length).then_some((start, end))
}

async fn serve(
    request: &Request<Vec<u8>>,
    scope: &tauri::scope::fs::Scope,
    origin: &str,
) -> Result<Response<Cow<'static, [u8]>>, StatusCode> {
    let path = requested_path(request.uri().path()).ok_or(StatusCode::FORBIDDEN)?;
    if !scope.is_allowed(&path) {
        return Err(StatusCode::FORBIDDEN);
    }
    let mut file = tokio::fs::File::open(&path)
        .await
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
            _ => StatusCode::FORBIDDEN,
        })?;
    let metadata = file.metadata().await.map_err(|_| StatusCode::FORBIDDEN)?;
    if !metadata.is_file() {
        return Err(StatusCode::FORBIDDEN);
    }
    let length = metadata.len();
    let mut magic = Vec::with_capacity(length.min(8192) as usize);
    (&mut file)
        .take(8192)
        .read_to_end(&mut magic)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mime = MimeType::parse(&magic, &path.as_ref().to_string_lossy());
    let response = Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
        .header(header::CONTENT_TYPE, mime)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::ACCEPT_RANGES, "bytes");
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());
    let Some(range) = range else {
        let mut body = magic;
        if length > body.len() as u64 {
            file.read_to_end(&mut body)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
        return response
            .header(header::CONTENT_LENGTH, body.len())
            .body(Cow::Owned(body))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
    };
    let Some((start, end)) = single_range(range, length) else {
        return Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
            .header(header::CONTENT_RANGE, format!("bytes */{length}"))
            .body(Cow::Borrowed(&[][..]))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
    };
    let count = end - start + 1;
    file.seek(SeekFrom::Start(start))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut body = Vec::with_capacity(count as usize);
    file.take(count)
        .read_to_end(&mut body)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    response
        .status(StatusCode::PARTIAL_CONTENT)
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

    #[test]
    fn paths_must_decode_to_files_without_parent_components() {
        assert_eq!(
            requested_path("/%2FUsers%2Fme%2FPictures%2Fa.png")
                .map(|path| path.as_ref().to_path_buf()),
            Some(PathBuf::from("/Users/me/Pictures/a.png"))
        );
        assert!(requested_path("/%2FUsers%2Fme%2F..%2F..%2Fetc%2Fpasswd").is_none());
        assert!(requested_path("/%FF").is_none());
        assert!(requested_path("relative").is_none());
    }

    #[test]
    fn ranges_are_single_and_clamped() {
        assert_eq!(single_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(single_range("bytes=900-5000", 1000), Some((900, 999)));
        assert_eq!(single_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(
            single_range("bytes=10-", 5_000_000),
            Some((10, 10 + RANGE_CHUNK - 1))
        );
        assert_eq!(single_range("bytes=1000-", 1000), None);
        assert_eq!(single_range("bytes=5-1", 1000), None);
        assert_eq!(single_range("bytes=0-1,4-5", 1000), None);
        assert_eq!(single_range("items=0-1", 1000), None);
        assert_eq!(single_range("bytes=0-0", 0), None);
    }
}
