//! A static file server for previewing a project in a Misty tab.
//!
//! It listens on loopback only, answers only requests addressed to its own
//! loopback host (so a web page can't reach it through DNS rebinding), never
//! follows symlinks, never serves Git's folder or secret files, and never
//! lists folders.
use std::{
    collections::HashMap,
    io::Read,
    net::Ipv4Addr,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use axum::{
    body::Body,
    http::{header, HeaderMap, HeaderValue, Response, StatusCode, Uri},
    Router,
};

use crate::beneath;

const MAX_SERVED_BYTES: u64 = 64 * 1024 * 1024;

struct Server {
    root: PathBuf,
    site: PathBuf,
    port: u16,
    task: tokio::task::JoinHandle<()>,
}

#[derive(Default, Clone)]
pub struct Previews {
    servers: Arc<Mutex<HashMap<String, Server>>>,
}

pub fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .as_deref()
    {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js" | "mjs" | "cjs") => "text/javascript; charset=utf-8",
        Some("json" | "map") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("pdf") => "application/pdf",
        Some("wasm") => "application/wasm",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        Some("xml") => "application/xml",
        _ => "application/octet-stream",
    }
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn respond(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Body> {
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_str(content_type).unwrap_or(HeaderValue::from_static("text/plain")));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    headers.insert("cross-origin-resource-policy", HeaderValue::from_static("same-origin"));
    response
}

fn not_found() -> Response<Body> {
    respond(StatusCode::NOT_FOUND, "text/plain; charset=utf-8", b"Not found in this project.\n".to_vec())
}

/// The bytes for one request path inside the site folder `site` of the
/// project at `root`, trying `index.html` for folders and `.html` for
/// extensionless paths. Every request reopens the site folder without
/// following symlinks, so swapping it for a link leads nowhere.
pub fn resolve(root: &Path, site: &Path, request_path: &str) -> Option<(PathBuf, Vec<u8>)> {
    let decoded = percent_decode(request_path.split(['?', '#']).next().unwrap_or(""))?;
    let relative = beneath::clean_relative(&decoded).ok()?;
    if beneath::protected(&relative).is_some()
        || relative
            .components()
            .any(|part| part.as_os_str().to_string_lossy().starts_with('.'))
    {
        return None;
    }
    let project = beneath::open_root(root).ok()?;
    let root_dir = beneath::open_dir(&project, site).ok()?;
    let mut candidates = Vec::new();
    if relative.as_os_str().is_empty() {
        candidates.push(PathBuf::from("index.html"));
    } else {
        candidates.push(relative.clone());
        candidates.push(relative.join("index.html"));
        if relative.extension().is_none() {
            candidates.push(relative.with_extension("html"));
        }
    }
    for candidate in candidates {
        if let Ok(file) = beneath::open_file(&root_dir, &candidate) {
            if file.metadata().ok()?.len() > MAX_SERVED_BYTES {
                return None;
            }
            let mut bytes = Vec::new();
            file.take(MAX_SERVED_BYTES).read_to_end(&mut bytes).ok()?;
            return Some((candidate, bytes));
        }
    }
    None
}

fn host_allowed(headers: &HeaderMap, port: u16) -> bool {
    let Some(host) = headers.get(header::HOST).and_then(|value| value.to_str().ok()) else {
        return false;
    };
    [format!("127.0.0.1:{port}"), format!("localhost:{port}")]
        .iter()
        .any(|allowed| host.eq_ignore_ascii_case(allowed))
}

impl Previews {
    /// The preview address for a site folder of a project, starting its
    /// server if needed. One server per site folder.
    pub async fn serve(&self, scope_id: &str, root: &Path, site: &Path) -> std::io::Result<u16> {
        let key = format!("{scope_id}\u{0}{}", site.display());
        if let Some(server) = self.servers.lock().ok().and_then(|servers| {
            servers
                .get(&key)
                .filter(|server| server.root == root && server.site == site && !server.task.is_finished())
                .map(|server| server.port)
        }) {
            return Ok(server);
        }
        if let Ok(servers) = self.servers.lock() {
            let count = servers.keys().filter(|id| id.starts_with(&format!("{scope_id}\u{0}"))).count();
            if count >= 4 {
                drop(servers);
                self.stop(Some(scope_id));
            }
        }
        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
        let port = listener.local_addr()?.port();
        let served_root = root.to_path_buf();
        let served_site = site.to_path_buf();
        let app = Router::new().fallback(move |uri: Uri, headers: HeaderMap| {
            let root = served_root.clone();
            let site = served_site.clone();
            async move {
                if !host_allowed(&headers, port) {
                    return respond(StatusCode::MISDIRECTED_REQUEST, "text/plain", b"Wrong host.\n".to_vec());
                }
                let path = uri.path().to_owned();
                match tokio::task::spawn_blocking(move || resolve(&root, &site, &path)).await {
                    Ok(Some((path, bytes))) => respond(StatusCode::OK, content_type(&path), bytes),
                    _ => not_found(),
                }
            }
        });
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        if let Ok(mut servers) = self.servers.lock() {
            if let Some(old) = servers.insert(
                key,
                Server {
                    root: root.to_path_buf(),
                    site: site.to_path_buf(),
                    port,
                    task,
                },
            ) {
                old.task.abort();
            }
        }
        Ok(port)
    }

    pub fn stop(&self, scope_id: Option<&str>) {
        if let Ok(mut servers) = self.servers.lock() {
            servers.retain(|id, server| {
                let keep = scope_id.is_some_and(|scope| !id.starts_with(&format!("{scope}\u{0}")));
                if !keep {
                    server.task.abort();
                }
                keep
            });
        }
    }
}
