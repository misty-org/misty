use std::borrow::Cow;

use tauri::{
    http::{header, Request, Response, StatusCode},
    UriSchemeContext, UriSchemeResponder, Wry,
};

use super::bundle::{self, FileError};
use super::frames;

pub const SCHEME: &str = "misty-app";

const OWN_SOURCES: &str = if cfg!(windows) {
    "'self'"
} else {
    "'self' misty-app:"
};

fn policy(frame_parent: &str, inline_scripts: bool, hosts: &[String]) -> String {
    let inline = if inline_scripts {
        " 'unsafe-inline'"
    } else {
        ""
    };
    let network: String = hosts
        .iter()
        .filter(|host| super::manifest::valid_host(host))
        .map(|host| format!(" https://{host} wss://{host}"))
        .collect();
    format!(
        "default-src 'none'; script-src {own} 'wasm-unsafe-eval'{inline}; style-src {own} 'unsafe-inline'; \
         img-src {own} data: blob:{network}; font-src {own} data:; media-src {own} blob: data:{network}; \
         connect-src {own} data: blob:{network}; worker-src {own} blob:; child-src blob:; frame-src 'none'; \
         object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors {frame_parent}",
        own = OWN_SOURCES
    )
}

const SHIM: &str = include_str!("shim.js");
const SHIM_PATH: &str = "/__misty/shim.js";
const SHIM_TAG: &str = r#"<script src="/__misty/shim.js"></script>"#;

const SCREEN: &str = include_str!("screen.js");
const SDK_PATH: &str = "/__misty/sdk.js";
const SDK_TAG: &str = r#"<script src="/__misty/sdk.js"></script>"#;
const SCREEN_PATH: &str = "/__misty/screen.js";
const SCREEN_TAG: &str = r#"<script src="/__misty/screen.js"></script>"#;

pub(crate) fn with_shim(html: &[u8]) -> Vec<u8> {
    with_tag(html, SHIM_TAG)
}

fn with_tag(html: &[u8], tag: &str) -> Vec<u8> {
    let lower = html.to_ascii_lowercase();
    let at = lower
        .windows(5)
        .position(|window| window == b"<head")
        .and_then(|start| {
            lower[start..]
                .iter()
                .position(|byte| *byte == b'>')
                .map(|end| start + end + 1)
        })
        .unwrap_or(0);
    let mut out = Vec::with_capacity(html.len() + tag.len());
    out.extend_from_slice(&html[..at]);
    out.extend_from_slice(tag.as_bytes());
    out.extend_from_slice(&html[at..]);
    out
}

pub fn handle(
    context: UriSchemeContext<'_, Wry>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let label = context.webview_label().to_owned();
    if !frames::is_app_page(&label) {
        responder.respond(status(StatusCode::FORBIDDEN));
        return;
    }
    tauri::async_runtime::spawn(async move {
        let response = serve_page(&request, &label, NOT_FRAMED).await;
        responder.respond(response.unwrap_or_else(status));
    });
}

const NOT_FRAMED: &str = "'none'";

async fn serve_page(
    request: &Request<Vec<u8>>,
    label: &str,
    frame_parent: &str,
) -> Result<Response<Cow<'static, [u8]>>, StatusCode> {
    let mount = frames::mount_of(label).ok_or(StatusCode::FORBIDDEN)?;
    match requested(request.uri()).ok_or(StatusCode::FORBIDDEN)? {
        Target::Bytes(reference) => page_bytes(request, mount, &reference),
        Target::Shim | Target::Screen | Target::Sdk if frames::serves(label, None) => {
            serve(request, frame_parent).await
        }
        Target::App { id, version, .. } if frames::runs(mount, &id, &version) => {
            serve(request, frame_parent).await
        }
        _ => Err(StatusCode::FORBIDDEN),
    }
}

fn page_bytes(
    request: &Request<Vec<u8>>,
    mount: &str,
    reference: &str,
) -> Result<Response<Cow<'static, [u8]>>, StatusCode> {
    let token = request
        .headers()
        .get(frames::TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .filter(|token| frames::page_token(mount, token))
        .ok_or(StatusCode::FORBIDDEN)?;
    let quiet = |code: StatusCode, body: Vec<u8>| {
        Response::builder()
            .status(code)
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .header(header::CONTENT_LENGTH, body.len())
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            .header(header::CACHE_CONTROL, "no-store")
            .body(Cow::Owned(body))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
    };
    match *request.method() {
        tauri::http::Method::GET => frames::take_bytes(mount, Some(token), reference)
            .ok_or(StatusCode::NOT_FOUND)
            .and_then(|body| quiet(StatusCode::OK, body)),
        tauri::http::Method::POST => {
            frames::put_bytes(mount, Some(token), reference, request.body().clone())
                .map_err(|_| StatusCode::FORBIDDEN)?;
            quiet(StatusCode::NO_CONTENT, Vec::new())
        }
        tauri::http::Method::DELETE => {
            frames::take_bytes(mount, Some(token), reference);
            quiet(StatusCode::NO_CONTENT, Vec::new())
        }
        _ => Err(StatusCode::METHOD_NOT_ALLOWED),
    }
}

fn status(code: StatusCode) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(code)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(Cow::Borrowed(&[][..]))
        .expect("static response")
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Target {
    Shim,
    Screen,
    Sdk,
    Bytes(String),
    App {
        id: String,
        version: String,
        file: String,
    },
}

pub(crate) fn requested(uri: &tauri::http::Uri) -> Option<Target> {
    let path = uri.path();
    if path == SHIM_PATH {
        return Some(Target::Shim);
    }
    if path == SCREEN_PATH {
        return Some(Target::Screen);
    }
    if path == SDK_PATH {
        return Some(Target::Sdk);
    }
    if let Some(reference) = path.strip_prefix(frames::BYTES_PATH) {
        return Some(Target::Bytes(reference.to_owned()));
    }
    let rest = path.strip_prefix('/')?;
    let (id, rest) = match uri.host() {
        Some("localhost" | "misty-app.localhost") | None => {
            rest.split_once('/').unwrap_or((rest, ""))
        }
        Some(host) => (app_host(host), rest),
    };
    let (version, file) = rest.split_once('/').unwrap_or((rest, ""));
    if id.is_empty() || version.is_empty() {
        return None;
    }
    let decoded = percent_encoding::percent_decode_str(file)
        .decode_utf8()
        .ok()?;
    Some(Target::App {
        id: id.to_owned(),
        version: version.to_owned(),
        file: decoded.into_owned(),
    })
}

fn app_host(host: &str) -> &str {
    let host = host.strip_prefix("misty-app.").unwrap_or(host);
    host.strip_suffix(".localhost").unwrap_or(host)
}

pub(crate) fn mime_of(path: &str) -> &'static str {
    let extension = path
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase());
    match extension.as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json" | "map") => "application/json",
        Some("wasm") => "application/wasm",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("txt") => "text/plain; charset=utf-8",
        Some("mp3") => "audio/mpeg",
        Some("ogg") => "audio/ogg",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        _ => "application/octet-stream",
    }
}

async fn serve(
    request: &Request<Vec<u8>>,
    frame_parent: &str,
) -> Result<Response<Cow<'static, [u8]>>, StatusCode> {
    let target = requested(request.uri()).ok_or(StatusCode::FORBIDDEN)?;
    let (id, version, requested_file) = match target {
        Target::Shim => {
            return reply(
                SHIM.as_bytes().to_vec(),
                "text/javascript; charset=utf-8",
                policy(frame_parent, false, &[]),
            )
        }
        Target::Screen => {
            return reply(
                SCREEN.as_bytes().to_vec(),
                "text/javascript; charset=utf-8",
                policy(frame_parent, false, &[]),
            )
        }
        Target::Sdk => {
            return reply(
                super::frames::SDK_SCRIPT.as_bytes().to_vec(),
                "text/javascript; charset=utf-8",
                policy(frame_parent, false, &[]),
            )
        }
        Target::Bytes(_) => return Err(StatusCode::FORBIDDEN),
        Target::App { id, version, file } => (id, version, file),
    };
    let (mime, body, inline_scripts, hosts) = tokio::task::spawn_blocking(move || {
        let dir = bundle::locate(&id, &version).map_err(|_| StatusCode::NOT_FOUND)?;
        let manifest = bundle::manifest_in(&dir, &id, &version)
            .ok()
            .flatten()
            .ok_or(StatusCode::NOT_FOUND)?;
        let file = if requested_file.is_empty() {
            manifest.entry.clone()
        } else {
            requested_file
        };
        let path = bundle::resolve_file_in(&dir, &file).map_err(|error| match error {
            FileError::Invalid => StatusCode::FORBIDDEN,
            FileError::NotFound => StatusCode::NOT_FOUND,
        })?;
        let mut body = file_access::fs::read(&path).map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
            _ => StatusCode::FORBIDDEN,
        })?;
        if manifest.shim && file == manifest.entry {
            body = with_shim(&body);
        }
        if file == manifest.entry {
            let adapts = manifest.mcp == Some(super::manifest::McpKind::Adapter)
                || manifest.collab == Some(super::manifest::CollabKind::Adapter);
            if let (true, Some(adapter)) = (adapts, manifest.adapter.as_deref()) {
                let up = "../".repeat(manifest.entry.matches('/').count());
                body = with_tag(&body, &format!(r#"<script src="{up}{adapter}"></script>"#));
                if manifest.collab == Some(super::manifest::CollabKind::Adapter) {
                    body = with_tag(&body, SDK_TAG);
                }
            }
            body = with_tag(&body, SCREEN_TAG);
        }
        let hosts: Vec<String> = manifest
            .network
            .iter()
            .map(|entry| entry.host.clone())
            .collect();
        Ok::<_, StatusCode>((mime_of(&file), body, manifest.inline_scripts, hosts))
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;
    reply(body, mime, policy(frame_parent, inline_scripts, &hosts))
}

fn reply(
    body: Vec<u8>,
    mime: &'static str,
    policy: String,
) -> Result<Response<Cow<'static, [u8]>>, StatusCode> {
    Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_LENGTH, body.len())
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CONTENT_SECURITY_POLICY, policy)
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Cow::Owned(body))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[cfg(test)]
mod tests;
