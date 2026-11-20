//! The `misty-app:` scheme: a sandboxed app frame loads its bundle from here and from nowhere else.
//!
//! A URL is `misty-app://<id>/<version>/<path>`, so each app is an origin of its own (on Windows, where a custom
//! scheme is served over http and has one host, `http://misty-app.localhost/<id>/<version>/<path>`; a path-style
//! `misty-app://localhost/<id>/...` is accepted too). Only the app's own windows may ask (website views share the scheme and are refused), the path must be
//! plain parts that stay inside the installed bundle, and every file goes out under a policy that lets the
//! app reach only its own files: scripts and styles from the bundle, no network, no frames, no plugins.

use std::borrow::Cow;

use tauri::{
    http::{header, Request, Response, StatusCode},
    UriSchemeContext, UriSchemeResponder, Wry,
};

use super::bundle::{self, FileError};
use crate::app::trusted_windows::asset_protocol::app_origin;

pub const SCHEME: &str = "misty-app";

/// The scheme's own sources, which differ on Windows, where a custom scheme is served over http.
const OWN_SOURCES: &str = if cfg!(windows) {
    "'self' http://misty-app.localhost"
} else {
    "'self' misty-app:"
};

/// The policy every file is served with. `wasm-unsafe-eval` is for WebAssembly only; `unsafe-eval` is
/// never allowed, and inline scripts only for an app whose manifest says it is one static page. The way out of the
/// frame is the SDK channel, which is not a network request, and the hosts the app's manifest lists (`network`),
/// over https only, which a mod saw before adding it.
fn policy(frame_parent: &str, inline_scripts: bool, hosts: &[String]) -> String {
    let inline = if inline_scripts { " 'unsafe-inline'" } else { "" };
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

/// Misty's Space-files shim (`shim.js`), served beside an app that asks for it, from a path no bundle can hold.
const SHIM: &str = include_str!("shim.js");
const SHIM_PATH: &str = "/__misty/shim.js";
const SHIM_TAG: &str = r#"<script src="/__misty/shim.js"></script>"#;

/// Misty's screen helper (`screen.js`), added to every app's entry page so an agent can work in the app the
/// person has open, over a channel of its own. Served, like the shim, from a path no bundle can hold.
const SCREEN: &str = include_str!("screen.js");
const SCREEN_PATH: &str = "/__misty/screen.js";
const SCREEN_TAG: &str = r#"<script src="/__misty/screen.js"></script>"#;

/// The page with the shim's script first in its head, so it is in place before the app's own scripts run.
/// The file on disk is untouched.
pub(crate) fn with_shim(html: &[u8]) -> Vec<u8> {
    with_tag(html, SHIM_TAG)
}

/// The page with a script of Misty's first in its head.
fn with_tag(html: &[u8], tag: &str) -> Vec<u8> {
    let lower = html.to_ascii_lowercase();
    let at = lower
        .windows(5)
        .position(|window| window == b"<head")
        .and_then(|start| lower[start..].iter().position(|byte| *byte == b'>').map(|end| start + end + 1))
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
    let origin = app_origin(context.app_handle());
    if !crate::browser::app_windows::is_person_window(context.webview_label()) {
        responder.respond(status(StatusCode::FORBIDDEN));
        return;
    }
    tauri::async_runtime::spawn(async move {
        let response = serve(&request, &origin).await.unwrap_or_else(status);
        responder.respond(response);
    });
}

fn status(code: StatusCode) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(code)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(Cow::Borrowed(&[][..]))
        .expect("static response")
}

/// What a request names: Misty's shim, or a file of an app. An empty file means the app's entry page.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Target {
    Shim,
    Screen,
    App { id: String, version: String, file: String },
}

pub(crate) fn requested(uri: &tauri::http::Uri) -> Option<Target> {
    let path = uri.path();
    if path == SHIM_PATH {
        return Some(Target::Shim);
    }
    if path == SCREEN_PATH {
        return Some(Target::Screen);
    }
    let rest = path.strip_prefix('/')?;
    // An app's own origin names it in the host; the shared hosts (`localhost`, and Windows' one) name it first in the path.
    let (id, rest) = match uri.host() {
        Some("localhost" | "misty-app.localhost") | None => rest.split_once('/').unwrap_or((rest, "")),
        Some(host) => (host, rest),
    };
    let (version, file) = rest.split_once('/').unwrap_or((rest, ""));
    if id.is_empty() || version.is_empty() {
        return None;
    }
    let decoded = percent_encoding::percent_decode_str(file).decode_utf8().ok()?;
    Some(Target::App { id: id.to_owned(), version: version.to_owned(), file: decoded.into_owned() })
}

pub(crate) fn mime_of(path: &str) -> &'static str {
    let extension = path.rsplit_once('.').map(|(_, extension)| extension.to_ascii_lowercase());
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

async fn serve(request: &Request<Vec<u8>>, frame_parent: &str) -> Result<Response<Cow<'static, [u8]>>, StatusCode> {
    let target = requested(request.uri()).ok_or(StatusCode::FORBIDDEN)?;
    let (id, version, requested_file) = match target {
        Target::Shim => return reply(SHIM.as_bytes().to_vec(), "text/javascript; charset=utf-8", policy(frame_parent, false, &[])),
        Target::Screen => return reply(SCREEN.as_bytes().to_vec(), "text/javascript; charset=utf-8", policy(frame_parent, false, &[])),
        Target::App { id, version, file } => (id, version, file),
    };
    let (mime, body, inline_scripts, hosts) = tokio::task::spawn_blocking(move || {
        let dir = bundle::locate(&id, &version).map_err(|_| StatusCode::NOT_FOUND)?;
        let manifest = bundle::manifest_in(&dir, &id, &version)
            .ok()
            .flatten()
            .ok_or(StatusCode::NOT_FOUND)?;
        let file = if requested_file.is_empty() { manifest.entry.clone() } else { requested_file };
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
        // Every app's entry page gets the screen helper, so an agent can work in the app the person has open; an app
        // whose tools come from an adapter (misty-apps') gets that script too, from inside its own bundle.
        if file == manifest.entry {
            if let (Some(super::manifest::McpKind::Adapter), Some(adapter)) = (manifest.mcp, manifest.adapter.as_deref()) {
                let up = "../".repeat(manifest.entry.matches('/').count());
                body = with_tag(&body, &format!(r#"<script src="{up}{adapter}"></script>"#));
            }
            body = with_tag(&body, SCREEN_TAG);
        }
        let hosts: Vec<String> = manifest.network.iter().map(|entry| entry.host.clone()).collect();
        Ok::<_, StatusCode>((mime_of(&file), body, manifest.inline_scripts, hosts))
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;
    reply(body, mime, policy(frame_parent, inline_scripts, &hosts))
}

fn reply(body: Vec<u8>, mime: &'static str, policy: String) -> Result<Response<Cow<'static, [u8]>>, StatusCode> {
    Response::builder()
        // Module scripts load cross-origin from a frame with no origin of its own; the files are the
        // app's public bundle, and only Misty's own windows can ask for them.
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
mod tests {
    use super::*;

    fn uri(text: &str) -> tauri::http::Uri {
        text.parse().unwrap()
    }

    fn app(id: &str, version: &str, file: &str) -> Option<Target> {
        Some(Target::App { id: id.into(), version: version.into(), file: file.into() })
    }

    #[test]
    fn a_request_names_an_app_a_version_and_a_file() {
        // An app's own origin names it in the host.
        assert_eq!(requested(&uri("misty-app://photocraft/1.2.0/assets/a%20b.wasm")), app("photocraft", "1.2.0", "assets/a b.wasm"));
        assert_eq!(requested(&uri("misty-app://docs/1.0.0/")), app("docs", "1.0.0", ""));
        // The shared hosts name it in the path.
        assert_eq!(requested(&uri("misty-app://localhost/docs/1.0.0/a.js")), app("docs", "1.0.0", "a.js"));
        assert_eq!(requested(&uri("http://misty-app.localhost/docs/1.0.0/")), app("docs", "1.0.0", ""));
        assert_eq!(requested(&uri("misty-app://docs/")), None);
        assert_eq!(requested(&uri("misty-app://localhost/docs")), None);
        // The shim is Misty's, under any host.
        assert_eq!(requested(&uri("misty-app://photocraft/__misty/shim.js")), Some(Target::Shim));
        assert_eq!(requested(&uri("misty-app://localhost/__misty/screen.js")), Some(Target::Screen));
    }

    #[test]
    fn the_shim_goes_first_in_the_head_and_the_page_is_otherwise_unchanged() {
        let page = b"<!DOCTYPE html><HTML><head data-x=\"1\"><title>t</title></head><body>b</body></HTML>";
        let out = String::from_utf8(with_shim(page)).unwrap();
        assert!(out.contains("<head data-x=\"1\"><script src=\"/__misty/shim.js\"></script><title>t</title>"));
        assert_eq!(out.replace(SHIM_TAG, "").as_bytes(), page);
        // A page with no head gets it first.
        assert!(String::from_utf8(with_shim(b"<p>x</p>")).unwrap().starts_with(SHIM_TAG));
    }

    #[test]
    fn files_have_their_types_and_the_policy_has_no_network_or_eval() {
        assert_eq!(mime_of("a/app.wasm"), "application/wasm");
        assert_eq!(mime_of("x.MJS"), "text/javascript; charset=utf-8");
        assert_eq!(mime_of("noext"), "application/octet-stream");
        let policy = policy("tauri://localhost", false, &[]);
        assert!(policy.contains("default-src 'none'") && policy.contains("frame-ancestors tauri://localhost"));
        assert!(!policy.contains("'unsafe-eval'") && !policy.contains("https:") && !policy.contains("unsafe-inline'; style"));
        assert!(self::policy("x", true, &[]).contains("'wasm-unsafe-eval' 'unsafe-inline'"));
        // Only the hosts the manifest names open, over https, and a bad one is left out.
        let open = self::policy("x", false, &["api.example.com".into(), "http://evil".into()]);
        assert!(open.contains(" https://api.example.com wss://api.example.com"));
        assert!(!open.contains("evil"));
    }

    #[tokio::test]
    async fn an_installed_app_is_served_with_its_entry_and_policy() {
        let cache = std::env::temp_dir().join(format!("misty-apps-scheme-{}", uuid::Uuid::new_v4()));
        let dir = cache.join("demo").join("1.0.0");
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::write(
            dir.join("misty-app.json"),
            r#"{"id":"demo","name":"Demo","version":"1.0.0","logo":"logo.svg","entry":"index.html","permissions":[]}"#,
        )
        .unwrap();
        std::fs::write(dir.join("index.html"), "<html>hi</html>").unwrap();
        std::fs::write(dir.join("logo.svg"), "<svg/>").unwrap();
        std::fs::write(dir.join("assets/app.js"), "1").unwrap();
        *bundle::TEST_CACHE.lock().unwrap() = Some(cache.clone());

        let get = |path: &str| Request::builder().uri(format!("misty-app://localhost{path}")).body(Vec::new()).unwrap();
        // The folder itself opens the manifest's entry page, under the policy that keeps the app in its frame.
        let page = serve(&get("/demo/1.0.0/"), "tauri://localhost").await.unwrap();
        assert_eq!(page.body().as_ref(), format!("{SCREEN_TAG}<html>hi</html>").as_bytes());
        assert_eq!(page.headers()[header::CONTENT_TYPE], "text/html; charset=utf-8");
        let policy = page.headers()[header::CONTENT_SECURITY_POLICY].to_str().unwrap();
        assert!(policy.contains("default-src 'none'") && policy.contains("frame-ancestors tauri://localhost"));
        let script = serve(&get("/demo/1.0.0/assets/app.js"), "tauri://localhost").await.unwrap();
        assert_eq!(script.headers()[header::CONTENT_TYPE], "text/javascript; charset=utf-8");
        assert_eq!(script.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
        // An app on its own origin that is one static page and wants the Space-files shim: the page comes
        // with the shim first in its head and a policy that allows its inline script, from the file as it is.
        let own = cache.join("pc").join("2.0.0");
        std::fs::create_dir_all(&own).unwrap();
        std::fs::write(
            own.join("misty-app.json"),
            r#"{"id":"pc","name":"Pc","version":"2.0.0","logo":"logo.svg","entry":"index.html","permissions":["files"],"own_origin":true,"inline_scripts":true,"shim":true}"#,
        )
        .unwrap();
        std::fs::write(own.join("index.html"), "<html><head></head><body><script>1</script></body></html>").unwrap();
        std::fs::write(own.join("logo.svg"), "<svg/>").unwrap();
        let get_own = |path: &str| Request::builder().uri(format!("misty-app://pc{path}")).body(Vec::new()).unwrap();
        let own_page = serve(&get_own("/2.0.0/"), "tauri://localhost").await.unwrap();
        let html = String::from_utf8(own_page.body().to_vec()).unwrap();
        assert!(html.starts_with(&format!("<html><head>{SCREEN_TAG}{SHIM_TAG}</head>")));
        assert!(own_page.headers()[header::CONTENT_SECURITY_POLICY].to_str().unwrap().contains("'unsafe-inline'; style-src"));
        // A page that didn't ask for it gets neither.
        assert!(!String::from_utf8(page.body().to_vec()).unwrap().contains("shim.js"));
        assert!(!page.headers()[header::CONTENT_SECURITY_POLICY].to_str().unwrap().contains("'unsafe-inline'; style-src"));
        // Every entry page gets the screen helper, and it is served from Misty's own path.
        assert!(String::from_utf8(page.body().to_vec()).unwrap().contains("/__misty/screen.js"));
        let screen = serve(&get("/__misty/screen.js"), "tauri://localhost").await.unwrap();
        assert!(String::from_utf8(screen.body().to_vec()).unwrap().contains("misty:screen"));
        let shim = serve(&get_own("/__misty/shim.js"), "tauri://localhost").await.unwrap();
        assert!(String::from_utf8(shim.body().to_vec()).unwrap().contains("files.pick"));
        // An app that isn't here, and a path that climbs out of the folder, are refused.
        assert_eq!(serve(&get("/nothing/1.0.0/"), "x").await.unwrap_err(), StatusCode::NOT_FOUND);
        assert_eq!(serve(&get("/demo/1.0.0/missing.js"), "x").await.unwrap_err(), StatusCode::NOT_FOUND);
        assert_eq!(serve(&get("/demo/1.0.0/a/../../x"), "x").await.unwrap_err(), StatusCode::FORBIDDEN);
        *bundle::TEST_CACHE.lock().unwrap() = None;
        std::fs::remove_dir_all(&cache).unwrap();
    }
}
