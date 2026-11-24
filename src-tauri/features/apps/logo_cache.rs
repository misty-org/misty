use std::{
    borrow::Cow,
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{
    http::{header, HeaderMap, Request, Response, StatusCode},
    AppHandle, Manager, UriSchemeContext, UriSchemeResponder, Wry,
};

use crate::app::trusted_windows::asset_protocol::app_origin;

pub const SCHEME: &str = "misty-logo";

const CONTENT_CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const MAX_LOGO_BYTES: usize = 2 << 20;
const CHECK_AT_MOST_EVERY_SECS: u64 = 24 * 60 * 60;

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
    let Some(remote) = requested(request.uri()) else {
        responder.respond(status(StatusCode::BAD_REQUEST, &origin));
        return;
    };
    let Some(dir) = cache_dir(&app) else {
        responder.respond(status(StatusCode::INTERNAL_SERVER_ERROR, &origin));
        return;
    };
    tauri::async_runtime::spawn(async move {
        let response = match logo(&dir, &remote).await {
            Some((body, mime)) => served(body, mime, &origin),
            None => status(StatusCode::BAD_GATEWAY, &origin),
        };
        responder.respond(response);
    });
}

fn cache_dir(app: &AppHandle) -> Option<PathBuf> {
    let runtime = app.try_state::<crate::app::runtime::MistyRuntime>()?;
    Some(runtime.environment.cache_dir().join("logos"))
}

fn requested(uri: &tauri::http::Uri) -> Option<String> {
    let remote = url::form_urlencoded::parse(uri.query()?.as_bytes())
        .find(|(key, _)| key == "u")
        .map(|(_, value)| value.into_owned())?;
    let parsed = url::Url::parse(&remote).ok()?;
    (parsed.scheme() == "https" && parsed.host_str().is_some()).then_some(remote)
}

fn kept_path(dir: &Path, remote: &str) -> PathBuf {
    dir.join(hex::encode(Sha256::digest(remote.as_bytes())))
}

#[derive(Serialize, Deserialize, Default)]
struct Kept {
    etag: Option<String>,
    last_modified: Option<String>,
    fresh_until: u64,
}

impl Kept {
    fn read(kept: &Path) -> Self {
        file_access::fs::read(kept.with_extension("json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }
}

struct Fetched {
    status: reqwest::StatusCode,
    headers: HeaderMap,
    body: Vec<u8>,
}

static REVALIDATING: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

async fn logo(dir: &Path, remote: &str) -> Option<(Vec<u8>, &'static str)> {
    let kept = kept_path(dir, remote);
    if let Ok(body) = file_access::fs::read(&kept) {
        if let Some(mime) = image_mime(&body) {
            let meta = Kept::read(&kept);
            if now() >= meta.fresh_until {
                revalidate_later(dir.to_path_buf(), remote.to_owned(), meta);
            }
            return Some((body, mime));
        }
        let _ = file_access::fs::remove_file(&kept);
    }
    let fetched = fetch(remote, None).await?;
    if !fetched.status.is_success() {
        return None;
    }
    let mime = image_mime(&fetched.body)?;
    keep(dir, &kept, &fetched, Kept::default());
    Some((fetched.body, mime))
}

fn revalidate_later(dir: PathBuf, remote: String, meta: Kept) {
    {
        let mut running = REVALIDATING
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !running.insert(remote.clone()) {
            return;
        }
    }
    tauri::async_runtime::spawn(async move {
        let kept = kept_path(&dir, &remote);
        if let Some(fetched) = fetch(&remote, Some(&meta)).await {
            if fetched.status == reqwest::StatusCode::NOT_MODIFIED {
                keep_meta(&kept, &fetched.headers, meta);
            } else if fetched.status.is_success() && image_mime(&fetched.body).is_some() {
                keep(&dir, &kept, &fetched, Kept::default());
            }
        }
        REVALIDATING
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&remote);
    });
}

fn keep(dir: &Path, kept: &Path, fetched: &Fetched, previous: Kept) {
    if fresh_for(&fetched.headers).is_none() || file_access::fs::create_dir_all(dir).is_err() {
        return;
    }
    if write_whole(kept, &fetched.body) {
        keep_meta(kept, &fetched.headers, previous);
    }
}

fn keep_meta(kept: &Path, headers: &HeaderMap, previous: Kept) {
    let Some(lifetime) = fresh_for(headers) else {
        let _ = file_access::fs::remove_file(kept);
        let _ = file_access::fs::remove_file(kept.with_extension("json"));
        return;
    };
    let text = |name: header::HeaderName| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
    };
    let meta = Kept {
        etag: text(header::ETAG).or(previous.etag),
        last_modified: text(header::LAST_MODIFIED).or(previous.last_modified),
        fresh_until: now().saturating_add(lifetime.max(CHECK_AT_MOST_EVERY_SECS)),
    };
    if let Ok(bytes) = serde_json::to_vec(&meta) {
        write_whole(&kept.with_extension("json"), &bytes);
    }
}

fn write_whole(path: &Path, bytes: &[u8]) -> bool {
    let partial = path.with_extension("part");
    if file_access::fs::write(&partial, bytes).is_ok()
        && file_access::fs::rename(&partial, path).is_ok()
    {
        return true;
    }
    let _ = file_access::fs::remove_file(&partial);
    false
}

fn fresh_for(headers: &HeaderMap) -> Option<u64> {
    let text = |name: header::HeaderName| headers.get(name).and_then(|value| value.to_str().ok());
    let date = |name: header::HeaderName| {
        text(name).and_then(|value| httpdate::parse_http_date(value).ok())
    };
    let age = text(header::AGE)
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(0);
    let mut max_age = None;
    for directive in text(header::CACHE_CONTROL).unwrap_or("").split(',') {
        let directive = directive.trim().to_ascii_lowercase();
        if directive == "no-store" {
            return None;
        }
        if directive == "no-cache" {
            max_age = Some(0);
        } else if let Some(seconds) = directive.strip_prefix("max-age=") {
            max_age = max_age.or_else(|| seconds.trim_matches('"').parse::<u64>().ok());
        }
    }
    let served = date(header::DATE).unwrap_or_else(SystemTime::now);
    let lifetime = max_age
        .or_else(|| {
            let expires = date(header::EXPIRES)?;
            Some(
                expires
                    .duration_since(served)
                    .map_or(0, |left| left.as_secs()),
            )
        })
        .or_else(|| {
            let modified = date(header::LAST_MODIFIED)?;
            Some(
                served
                    .duration_since(modified)
                    .map_or(0, |since| since.as_secs() / 10),
            )
        })
        .unwrap_or(0);
    Some(lifetime.saturating_sub(age))
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_secs())
}

async fn fetch(remote: &str, validators: Option<&Kept>) -> Option<Fetched> {
    let client = crate::engine_config::support::http_client().ok()?;
    let mut request = client.get(remote);
    if let Some(validators) = validators {
        if let Some(etag) = validators.etag.as_deref() {
            request = request.header(reqwest::header::IF_NONE_MATCH, etag);
        }
        if let Some(modified) = validators.last_modified.as_deref() {
            request = request.header(reqwest::header::IF_MODIFIED_SINCE, modified);
        }
    }
    let response = request.send().await.ok()?;
    if response
        .content_length()
        .is_some_and(|length| length as usize > MAX_LOGO_BYTES)
    {
        return None;
    }
    let status = response.status();
    let headers = response.headers().clone();
    let body = response.bytes().await.ok()?;
    (body.len() <= MAX_LOGO_BYTES).then(|| Fetched {
        status,
        headers,
        body: body.to_vec(),
    })
}

fn image_mime(body: &[u8]) -> Option<&'static str> {
    if body.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if body.starts_with(b"\xff\xd8\xff") {
        return Some("image/jpeg");
    }
    if body.starts_with(b"GIF87a") || body.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if body.len() >= 12 && &body[..4] == b"RIFF" && &body[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if body.len() >= 12 && &body[4..12] == b"ftypavif" {
        return Some("image/avif");
    }
    if body.starts_with(b"\x00\x00\x01\x00") {
        return Some("image/x-icon");
    }
    let head = String::from_utf8_lossy(&body[..body.len().min(512)]).to_ascii_lowercase();
    head.contains("<svg").then_some("image/svg+xml")
}

fn served(body: Vec<u8>, mime: &'static str, origin: &str) -> Served {
    Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_SECURITY_POLICY, CONTENT_CSP)
        .header(header::CONTENT_LENGTH, body.len())
        .body(Cow::Owned(body))
        .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR, origin))
}

fn status(code: StatusCode, origin: &str) -> Served {
    Response::builder()
        .status(code)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
        .body(Cow::Borrowed(&[][..]))
        .expect("static response")
}
