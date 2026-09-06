//! Isolated package views. Only the trusted host creates views and answers RPC.
//! The native WebView label, never a field supplied by JavaScript, is authority.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager, State, Webview, WebviewBuilder, WebviewUrl};
use tokio::sync::oneshot;
#[cfg(target_os = "macos")]
#[path = "mini_app_macos.rs"]
mod macos;
#[path = "mini_app_permissions.rs"]
pub mod permissions;
#[cfg(windows)]
#[path = "mini_app_windows.rs"]
mod windows;

const PREFIX: &str = "misty-mini-app-";
const MAX_MESSAGE: usize = 1_048_576;
const MAX_PENDING: usize = 32;
const CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src blob:; connect-src 'self' ipc: http://ipc.localhost https://ipc.localhost; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

#[derive(Default)]
pub struct MiniAppState(Mutex<HashMap<String, Instance>>);
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<MiniAppState>() {
        if let Ok(mut registry) = state.0.lock() {
            registry.clear();
        }
    }
}
struct Instance {
    root: PathBuf,
    permissions: permissions::PermissionSet,
    // A separate ephemeral browser profile per instance also covers WebView2.
    // Persistent app data is provided by the account/app-scoped capability API.
    _profile: Option<tempfile::TempDir>,
    pending: HashMap<String, oneshot::Sender<Result<Value, String>>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    pub source: String,
    pub bounds: Bounds,
    #[serde(default)]
    pub scope_limit: Option<Vec<String>>,
    #[serde(default)]
    pub owner: Option<NativeOwner>,
}
/// Supplied only by the compiled main Host, never by package RPC payloads.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeOwner {
    pub account_id: String,
    #[serde(default)]
    pub space_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetOpenRequest {
    pub root: String,
    #[serde(default)]
    pub scope_limit: Option<Vec<String>>,
    #[serde(default)]
    pub owner: Option<NativeOwner>,
}
impl NativeOwner {
    fn namespace(&self, root: &Path) -> Result<String, String> {
        let valid = |value: &str| {
            !value.is_empty()
                && value.len() <= 128
                && value
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        };
        if !valid(&self.account_id) || self.space_id.as_deref().is_some_and(|space| !valid(space)) {
            return Err("Invalid Host account or Space identity.".into());
        }
        use sha2::{Digest, Sha256};
        let mut digest = Sha256::new();
        // The canonical installation root distinguishes private/public packages
        // and installations. Length prefixes avoid concatenation ambiguity.
        for part in [
            root.to_string_lossy().as_bytes(),
            self.account_id.as_bytes(),
            self.space_id.as_deref().unwrap_or("").as_bytes(),
        ] {
            digest.update((part.len() as u64).to_le_bytes());
            digest.update(part);
        }
        Ok(hex::encode(digest.finalize()))
    }
}

#[derive(Clone, Deserialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
#[derive(Deserialize)]
pub struct HostViewport {
    width: f64,
    height: f64,
}

#[cfg(target_os = "macos")]
fn appkit_bounds(
    bounds: Bounds,
    viewport: HostViewport,
    host_width: f64,
    host_height: f64,
) -> Result<Bounds, String> {
    if !viewport.width.is_finite()
        || !viewport.height.is_finite()
        || viewport.width <= 0.0
        || viewport.height <= 0.0
    {
        return Err("Invalid Host viewport.".into());
    }
    let zoom = host_width / viewport.width;
    // WKWebView's automatic title-bar content inset is outside the DOM layout
    // viewport but inside its native frame. Child views have no such inset.
    let top = (host_height - viewport.height * zoom).max(0.0);
    let result = Bounds {
        x: bounds.x * zoom,
        y: top + bounds.y * zoom,
        width: bounds.width * zoom,
        height: bounds.height * zoom,
    };
    result.validate()?;
    Ok(result)
}
impl Bounds {
    fn validate(&self) -> Result<(), String> {
        if ![self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite())
            || self.x < 0.0
            || self.y < 0.0
            || self.width < 1.0
            || self.height < 1.0
            || self.width > 32768.0
            || self.height > 32768.0
        {
            return Err("Invalid App view bounds.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RpcEvent {
    instance: String,
    request_id: String,
    message: Value,
}

fn require_host(view: &Webview) -> Result<(), String> {
    if view.label() == "main" {
        Ok(())
    } else {
        Err("Only the Host can manage App views.".into())
    }
}

#[tauri::command]
pub async fn mini_app_open(
    app: AppHandle,
    webview: Webview,
    state: State<'_, MiniAppState>,
    request: OpenRequest,
) -> Result<String, String> {
    require_host(&webview)?;
    request.bounds.validate()?;
    let (root, entry, query) = package_source(&request.source)?;
    let mut permissions = permissions::PermissionSet::load(&root, request.scope_limit.as_deref())?;
    permissions.owner_namespace = request
        .owner
        .as_ref()
        .map(|owner| owner.namespace(&root))
        .transpose()?;
    let label = format!("{PREFIX}{}", uuid::Uuid::new_v4());
    let profile = tempfile::Builder::new()
        .prefix("misty-app-profile-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let profile_path = profile.path().to_owned();
    let mut url = url::Url::parse("misty-mini-app://localhost/").unwrap();
    url.set_path(&format!("/{label}/{entry}"));
    url.set_query(query.as_deref());
    #[cfg(windows)]
    let url = url::Url::parse(&url.as_str().replace(
        "misty-mini-app://localhost",
        "https://misty-mini-app.localhost",
    ))
    .map_err(|e| e.to_string())?;
    let own_label = label.clone();
    // Configure native permissions before any package JavaScript can execute.
    let builder = WebviewBuilder::new(&label, WebviewUrl::External("about:blank".parse().unwrap()))
        .incognito(true)
        .data_directory(profile_path)
        .use_https_scheme(true)
        .focused(false)
        .initialization_script(include_str!("mini_app_bridge.js"))
        .on_navigation(move |url| own_navigation(url, &own_label))
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_download(|_, _| false);
    let window = app
        .get_window("main")
        .ok_or("The Host window is unavailable.")?;
    state
        .0
        .lock()
        .map_err(|_| "App registry unavailable.")?
        .insert(
            label.clone(),
            Instance {
                root,
                permissions,
                _profile: Some(profile),
                pending: HashMap::new(),
            },
        );
    let bounds = request.bounds;
    let created = window.add_child(
        builder,
        tauri::LogicalPosition::new(bounds.x, bounds.y),
        tauri::LogicalSize::new(bounds.width, bounds.height),
    );
    let view = match created {
        Ok(view) => view,
        Err(error) => {
            state
                .0
                .lock()
                .map_err(|_| "App registry unavailable.")?
                .remove(&label);
            return Err(error.to_string());
        }
    };
    #[cfg(target_os = "macos")]
    if let Err(error) = macos::configure(&view).await {
        let _ = view.close();
        state
            .0
            .lock()
            .map_err(|_| "App registry unavailable.")?
            .remove(&label);
        return Err(error);
    }
    #[cfg(windows)]
    if let Err(error) = windows::configure(&view).await {
        let _ = view.close();
        state
            .0
            .lock()
            .map_err(|_| "App registry unavailable.")?
            .remove(&label);
        return Err(error);
    }
    if let Err(error) = view.navigate(url) {
        let _ = view.close();
        state
            .0
            .lock()
            .map_err(|_| "App registry unavailable.")?
            .remove(&label);
        return Err(error.to_string());
    }
    Ok(label)
}

/// Registers a host-rendered declarative widget with the same native grant
/// registry as isolated Apps, without creating any executable WebView.
#[tauri::command]
pub fn mini_widget_open(
    webview: Webview,
    state: State<'_, MiniAppState>,
    request: WidgetOpenRequest,
) -> Result<String, String> {
    require_host(&webview)?;
    let root = PathBuf::from(request.root)
        .canonicalize()
        .map_err(|_| "Widget package is unavailable.")?;
    if !root.is_dir() {
        return Err("Widget package is unavailable.".into());
    }
    let mut permissions = permissions::PermissionSet::load(&root, request.scope_limit.as_deref())?;
    permissions.owner_namespace = request
        .owner
        .as_ref()
        .map(|owner| owner.namespace(&root))
        .transpose()?;
    let label = format!("misty-widget-{}", uuid::Uuid::new_v4());
    state
        .0
        .lock()
        .map_err(|_| "App registry unavailable.")?
        .insert(
            label.clone(),
            Instance {
                root,
                permissions,
                _profile: None,
                pending: HashMap::new(),
            },
        );
    Ok(label)
}

#[tauri::command]
pub fn mini_app_layout(
    app: AppHandle,
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
    bounds: Bounds,
    visible: bool,
    viewport: Option<HostViewport>,
) -> Result<(), String> {
    require_host(&webview)?;
    bounds.validate()?;
    if !state
        .0
        .lock()
        .map_err(|_| "App registry unavailable.")?
        .contains_key(&instance)
    {
        return Err("App is closed.".into());
    }
    let view = app.get_webview(&instance).ok_or("App is closed.")?;
    #[cfg(target_os = "macos")]
    let bounds = if let Some(viewport) = viewport {
        let scale = webview
            .window()
            .scale_factor()
            .map_err(|error| error.to_string())?;
        let size = webview
            .size()
            .map_err(|error| error.to_string())?
            .to_logical::<f64>(scale);
        appkit_bounds(bounds, viewport, size.width, size.height)?
    } else {
        bounds
    };
    #[cfg(not(target_os = "macos"))]
    let _ = viewport;
    view.set_bounds(tauri::Rect {
        position: tauri::Position::Logical(tauri::LogicalPosition::new(bounds.x, bounds.y)),
        size: tauri::Size::Logical(tauri::LogicalSize::new(bounds.width, bounds.height)),
    })
    .map_err(|e| e.to_string())?;
    if visible { view.show() } else { view.hide() }.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mini_app_close(
    app: AppHandle,
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
) -> Result<(), String> {
    require_host(&webview)?;
    // Drop pending operations before closing, so late answers cannot cross instances.
    let removed = state
        .0
        .lock()
        .map_err(|_| "App registry unavailable.")?
        .remove(&instance);
    if removed.is_some() {
        if let Some(view) = app.get_webview(&instance) {
            view.close().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn mini_app_rpc(
    app: AppHandle,
    webview: Webview,
    state: State<'_, MiniAppState>,
    message: Value,
) -> Result<Value, String> {
    if serde_json::to_vec(&message)
        .map_err(|e| e.to_string())?
        .len()
        > MAX_MESSAGE
    {
        return Err("App request is too large.".into());
    }
    let instance = webview.label().to_owned();
    let request_id = uuid::Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    {
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let registered = registry
            .get_mut(&instance)
            .ok_or("App is not registered.")?;
        if registered.pending.len() >= MAX_PENDING {
            return Err("Too many pending App requests.".into());
        }
        registered.pending.insert(request_id.clone(), sender);
    }
    let event = RpcEvent {
        instance: instance.clone(),
        request_id: request_id.clone(),
        message,
    };
    let delivered = app.emit_to(
        tauri::EventTarget::webview("main"),
        "misty:mini-app-request",
        event,
    );
    let result = match delivered {
        Err(error) => Err(error.to_string()),
        // Permission review and OS pickers are interactive; network work has
        // its own shorter deadline inside the capability implementation.
        Ok(()) => match tokio::time::timeout(std::time::Duration::from_secs(300), receiver).await {
            Ok(Ok(result)) => result,
            _ => {
                let _ = app.emit_to(
                    tauri::EventTarget::webview("main"),
                    "misty:mini-app-request-cancelled",
                    serde_json::json!({ "instance": instance, "requestId": request_id }),
                );
                Err("App request expired or the App was closed.".into())
            }
        },
    };
    if let Ok(mut registry) = state.0.lock() {
        if let Some(registered) = registry.get_mut(&instance) {
            registered.pending.remove(&request_id);
        }
    }
    result
}

#[tauri::command]
pub fn mini_app_reply(
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
    request_id: String,
    result: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    require_host(&webview)?;
    if serde_json::to_vec(&result)
        .map_err(|e| e.to_string())?
        .len()
        > MAX_MESSAGE
    {
        return Err("App response is too large.".into());
    }
    let sender = state
        .0
        .lock()
        .map_err(|_| "App registry unavailable.")?
        .get_mut(&instance)
        .and_then(|item| item.pending.remove(&request_id));
    if let Some(sender) = sender {
        let _ = sender.send(match error {
            Some(error) => Err(error),
            None => Ok(result.unwrap_or(Value::Null)),
        });
    }
    Ok(())
}

#[tauri::command]
pub fn mini_app_post(
    app: AppHandle,
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
    message: Value,
) -> Result<(), String> {
    require_host(&webview)?;
    if !state
        .0
        .lock()
        .map_err(|_| "App registry unavailable.")?
        .contains_key(&instance)
    {
        return Err("App is closed.".into());
    }
    let json = serde_json::to_string(&message).map_err(|e| e.to_string())?;
    if json.len() > MAX_MESSAGE {
        return Err("App context is too large.".into());
    }
    let view = app.get_webview(&instance).ok_or("App is closed.")?;
    // The JSON is data, never executable package-provided source.
    view.eval(format!(
        "window.dispatchEvent(new MessageEvent('message', {{data: {json}, source: window}}));"
    ))
    .map_err(|e| e.to_string())
}

fn own_navigation(url: &url::Url, label: &str) -> bool {
    let local = (url.scheme() == "misty-mini-app" && url.host_str() == Some("localhost"))
        || (url.scheme() == "https" && url.host_str() == Some("misty-mini-app.localhost"));
    local && url.path().starts_with(&format!("/{label}/"))
}

fn package_source(source: &str) -> Result<(PathBuf, String, Option<String>), String> {
    let url = url::Url::parse(source).map_err(|_| "Invalid App package URL.")?;
    let local = (url.scheme() == "misty-extension" && url.host_str() == Some("localhost"))
        || (["http", "https"].contains(&url.scheme())
            && url.host_str() == Some("misty-extension.localhost"));
    if !local {
        return Err("Apps must be installed locally before opening a native view.".into());
    }
    let path = percent_encoding::percent_decode_str(url.path())
        .decode_utf8()
        .map_err(|_| "Invalid App path.")?;
    let segments: Vec<_> = path.trim_start_matches('/').split('/').collect();
    if segments.len() < 3
        || !["private", "public"].contains(&segments[0])
        || segments
            .iter()
            .any(|s| s.is_empty() || *s == "." || *s == ".." || s.contains(['\\', '\0', ':']))
    {
        return Err("Invalid App package path.".into());
    }
    let home = dirs::home_dir().ok_or("Home folder unavailable.")?;
    let base = home
        .join(".misty/plugins")
        .join(segments[0])
        .canonicalize()
        .map_err(|_| "App is not installed.")?;
    let root = base
        .join(segments[1])
        .canonicalize()
        .map_err(|_| "App is not installed.")?;
    if !root.starts_with(&base) || root == base {
        return Err("App package leaves its installation folder.".into());
    }
    let entry = segments[2..].join("/");
    confined_asset(&root, &entry)?;
    Ok((root, entry, url.query().map(str::to_owned)))
}

fn confined_asset(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty()
        || relative.contains(['\\', '\0', ':'])
        || Path::new(relative)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("Invalid App asset.".into());
    }
    let path = root
        .join(relative)
        .canonicalize()
        .map_err(|_| "App asset not found.")?;
    if !path.starts_with(root) || !path.is_file() {
        return Err("App asset leaves its package.".into());
    }
    Ok(path)
}

pub fn handle(
    context: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let result = (|| -> Result<(String, Vec<u8>), String> {
        if request.method() != "GET" {
            return Err("Method denied.".into());
        }
        let state = context.app_handle().state::<MiniAppState>();
        let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let label = context.webview_label();
        let registered = registry.get(label).ok_or("App is closed.")?;
        let path = percent_encoding::percent_decode_str(request.uri().path())
            .decode_utf8()
            .map_err(|_| "Invalid path.")?;
        let relative = path
            .strip_prefix(&format!("/{label}/"))
            .ok_or("App cannot load another App's assets.")?;
        let asset = confined_asset(&registered.root, relative)?;
        let mime = match asset.extension().and_then(|s| s.to_str()).unwrap_or("") {
            "html" => "text/html; charset=utf-8",
            "js" | "mjs" => "text/javascript; charset=utf-8",
            "css" => "text/css; charset=utf-8",
            "json" => "application/json",
            "svg" => "image/svg+xml",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            "woff2" => "font/woff2",
            "woff" => "font/woff",
            _ => "application/octet-stream",
        };
        let size = asset.metadata().map_err(|e| e.to_string())?.len();
        if size > 32 * 1024 * 1024 {
            return Err("App asset is too large.".into());
        }
        Ok((mime.into(), fs::read(asset).map_err(|e| e.to_string())?))
    })();
    let (status, mime, body) = match result {
        Ok((mime, body)) => (StatusCode::OK, mime, body),
        Err(_) => (
            StatusCode::FORBIDDEN,
            "text/plain".into(),
            b"App resource unavailable.".to_vec(),
        ),
    };
    Response::builder().status(status).header("Content-Type", mime)
        .header("Content-Security-Policy", CSP)
        .header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), display-capture=()")
        .header("X-Content-Type-Options", "nosniff").header("Cache-Control", "no-store")
        .header("Referrer-Policy", "no-referrer").body(body).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    #[test]
    fn child_layout_preserves_host_controls_across_titlebar_insets_and_zoom() {
        let bounds = Bounds {
            x: 0.,
            y: 131.,
            width: 900.,
            height: 617.,
        };
        let adjusted = appkit_bounds(
            bounds.clone(),
            HostViewport {
                width: 900.,
                height: 748.,
            },
            900.,
            780.,
        )
        .unwrap();
        assert_eq!(adjusted.y, 163.);
        assert_eq!(adjusted.y + adjusted.height, 780.);
        assert_eq!(
            appkit_bounds(
                bounds.clone(),
                HostViewport {
                    width: 900.,
                    height: 780.
                },
                900.,
                780.
            )
            .unwrap()
            .y,
            131.
        );
        let zoomed = appkit_bounds(
            bounds,
            HostViewport {
                width: 900.,
                height: 748.,
            },
            1125.,
            967.,
        )
        .unwrap();
        assert_eq!(zoomed.y, 195.75);
    }
    #[test]
    fn persistent_owner_is_bound_to_account_space_and_canonical_installation() {
        let namespace = |account: &str, space: Option<&str>, root: &str| {
            NativeOwner {
                account_id: account.into(),
                space_id: space.map(str::to_owned),
            }
            .namespace(Path::new(root))
        };
        let baseline = namespace("user-a", Some("space-a"), "/installed/private/backups").unwrap();
        for different in [
            namespace("user-b", Some("space-a"), "/installed/private/backups"),
            namespace("user-a", Some("space-b"), "/installed/private/backups"),
            namespace("user-a", None, "/installed/private/backups"),
            namespace("user-a", Some("space-a"), "/installed/public/backups"),
            namespace("user-a", Some("space-a"), "/installed/private/other"),
        ] {
            assert_ne!(baseline, different.unwrap());
        }
        for invalid in ["", "../user", "user:secret", "user\nother"] {
            assert!(namespace(invalid, None, "/installed/private/backups").is_err());
        }
        assert_eq!(baseline.len(), 64);
    }
    #[test]
    fn navigation_cannot_leave_instance() {
        for url in [
            "https://example.com/",
            "file:///etc/passwd",
            "tauri://localhost/",
            "misty-mini-app://localhost/other/index.html",
            "https://misty-mini-app.evil/a/index.html",
        ] {
            assert!(!own_navigation(&url::Url::parse(url).unwrap(), "a"));
        }
        assert!(own_navigation(
            &url::Url::parse("misty-mini-app://localhost/a/index.html").unwrap(),
            "a"
        ));
    }
    #[test]
    fn package_assets_reject_traversal_and_links_outside_root() {
        let root = tempfile::tempdir().unwrap();
        let canonical = root.path().canonicalize().unwrap();
        fs::write(root.path().join("index.html"), "hello").unwrap();
        assert!(confined_asset(&canonical, "index.html").is_ok());
        for path in [
            "../index.html",
            "/index.html",
            "..\\index.html",
            "C:secret",
            "",
        ] {
            assert!(confined_asset(&canonical, path).is_err());
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc/passwd", root.path().join("outside")).unwrap();
            assert!(confined_asset(&canonical, "outside").is_err());
        }
    }
    #[test]
    fn refuses_remote_or_host_document_sources() {
        for url in [
            "https://example.com/app.html",
            "file:///tmp/app.html",
            "tauri://localhost/index.html",
            "misty-extension://localhost/public/app/%2e%2e%2fsecret",
        ] {
            assert!(package_source(url).is_err());
        }
    }
}
