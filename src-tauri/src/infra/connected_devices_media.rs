//! A local HTTP gateway that streams media from paired devices in ranges, so
//! previews can play and seek without downloading whole files.

use super::*;

#[derive(Clone)]
pub(super) struct PeerMediaGateway {
    pub(super) base_url: String,
    pub(super) grants: Arc<Mutex<HashMap<String, PeerMediaGrant>>>,
}

#[derive(Clone)]
pub(super) struct PeerMediaState {
    pub(super) service: ConnectedDevicesService,
    pub(super) grants: Arc<Mutex<HashMap<String, PeerMediaGrant>>>,
}

#[derive(Clone)]
pub(super) struct PeerMediaGrant {
    pub(super) device_id: String,
    pub(super) path: String,
    pub(super) snapshot: String,
    pub(super) size_bytes: u64,
    pub(super) expires_at: i64,
}

pub(super) async fn peer_media_handler(
    axum::extract::State(state): axum::extract::State<PeerMediaState>,
    axum::extract::Path(token): axum::extract::Path<String>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    use axum::{
        body::Body,
        http::{header, Response, StatusCode},
    };
    let grant = state.grants.lock().ok().and_then(|mut grants| {
        grants.retain(|_, grant| grant.expires_at > unix_now());
        grants.get(&token).cloned()
    });
    let Some(grant) = grant else {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::empty())
            .unwrap();
    };
    let range = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());
    let (start, end, partial) = match parse_http_range(range, grant.size_bytes) {
        Ok(value) => value,
        Err(()) => {
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(
                    header::CONTENT_RANGE,
                    format!("bytes */{}", grant.size_bytes),
                )
                .body(Body::empty())
                .unwrap()
        }
    };
    let content_length = if grant.size_bytes == 0 {
        0
    } else {
        end.saturating_sub(start).saturating_add(1)
    };
    let service = state.service.clone();
    let stream_grant = grant.clone();
    let stream = async_stream::stream! {
        let mut offset = start;
        const CHUNK: u64 = 1024 * 1024;
        while stream_grant.size_bytes > 0 && offset <= end {
            let length = CHUNK.min(end - offset + 1);
            let result = service.read_file(PeerReadRequest {
                device_id: stream_grant.device_id.clone(),
                path: stream_grant.path.clone(),
                offset,
                length: Some(length),
                expected_snapshot: Some(stream_grant.snapshot.clone()),
            }).await;
            match result {
                Ok(bytes) => {
                    offset += bytes.len() as u64;
                    yield Ok::<_, std::io::Error>(axum::body::Bytes::from(bytes));
                }
                Err(error) => {
                    yield Err::<axum::body::Bytes, _>(std::io::Error::other(error.to_string()));
                    break;
                }
            }
        }
    };
    let mut response = Response::builder()
        .status(if partial {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        })
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, content_length)
        .header(header::CACHE_CONTROL, "private, no-store")
        .header(header::CONTENT_TYPE, peer_content_type(&grant.path));
    if partial {
        response = response.header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{}", grant.size_bytes),
        );
    }
    response.body(Body::from_stream(stream)).unwrap()
}

pub(super) fn parse_http_range(header: Option<&str>, size: u64) -> Result<(u64, u64, bool), ()> {
    if size == 0 {
        return Ok((0, 0, false));
    }
    let Some(value) = header else {
        return Ok((0, size - 1, false));
    };
    let range = value.strip_prefix("bytes=").ok_or(())?;
    if range.contains(',') {
        return Err(());
    }
    let (start, end) = range.split_once('-').ok_or(())?;
    if start.is_empty() {
        let suffix: u64 = end.parse().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        let start = size.saturating_sub(suffix.min(size));
        return Ok((start, size - 1, true));
    }
    let start: u64 = start.parse().map_err(|_| ())?;
    if start >= size {
        return Err(());
    }
    let end = if end.is_empty() {
        size - 1
    } else {
        end.parse::<u64>().map_err(|_| ())?.min(size - 1)
    };
    if end < start {
        return Err(());
    }
    Ok((start, end, true))
}

pub(super) fn peer_content_type(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        "heic" | "heif" => "image/heic",
        "jpeg" | "jpg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}
