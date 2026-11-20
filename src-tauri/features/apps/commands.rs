//! What the page asks of the host about apps: whether a version is on this computer, getting one,
//! and the session every relayed SDK call is checked against.

use std::time::Duration;

use tauri::{AppHandle, Manager, Webview};

use super::bundle;
use super::manifest::{AppManifest, Permission};
use super::mcp;
use super::permissions::{self, Kind};
use crate::project::person_window;

/// The most a bundle's zip may be.
const MAX_DOWNLOAD_BYTES: u64 = 256 << 20;

/// Tells the host where Misty's own apps are shipped, once at launch. They are served from there as they are:
/// nothing is copied or installed.
pub fn use_shipped(app: &AppHandle) {
    let mut shipped: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        shipped.push(resources.join("apps"));
    }
    // A development build runs from a wrapper app without the bundled resources, so it reads them from the source tree.
    if cfg!(debug_assertions) {
        shipped.push(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join("apps"));
    }
    bundle::set_shipped(shipped);
}

/// The manifest of an app version on this computer, or `None` when it has to be downloaded first.
#[tauri::command]
pub async fn space_app_bundle_manifest(
    webview: Webview,
    app_id: String,
    version: String,
) -> Result<Option<AppManifest>, String> {
    person_window(&webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        // A built-in app (`bundled`) is always here, or this Misty doesn't carry it; a third-party version may
        // still have to be downloaded.
        bundle::installed_manifest(&app_id, &version)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Downloads an app version from the catalog and installs it, only if it matches the catalog's checksum.
/// The address must be https. With a `wrap`, the download is the maker's own release (the checksum is of that zip
/// as they published it) and Misty adds its manifest around it; without one, it is a bundle that has its own.
#[tauri::command]
pub async fn space_app_bundle_install(
    webview: Webview,
    app_id: String,
    version: String,
    url: String,
    sha256: String,
    wrap: Option<bundle::Wrap>,
) -> Result<AppManifest, String> {
    person_window(&webview)?;
    let parsed = url::Url::parse(&url).map_err(|_| "That isn't an address.".to_owned())?;
    if parsed.scheme() != "https" {
        return Err("Apps download only over https.".into());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(parsed)
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|_| "Couldn't download the app. Check your connection and try again.".to_owned())?;
    // Where a redirect ended must still be https.
    if response.url().scheme() != "https" {
        return Err("Apps download only over https.".into());
    }
    if response.content_length().is_some_and(|length| length > MAX_DOWNLOAD_BYTES) {
        return Err("The app is larger than a bundle may be.".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "Couldn't download the app. Check your connection and try again.".to_owned())?;
    if bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err("The app is larger than a bundle may be.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = bundle::cache_root()?;
        match &wrap {
            Some(wrap) => bundle::install_wrapped(&root, &app_id, &version, &bytes, &sha256, wrap),
            None => bundle::install_zip(&root, &app_id, &version, &bytes, &sha256),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Starts a running app's session and returns its id. `approved` is what the Space's mod approved at
/// install; it can't exceed what the app's manifest asks for.
#[tauri::command]
pub async fn space_app_session_open(
    webview: Webview,
    space_id: String,
    app_id: String,
    version: String,
    approved: Vec<Permission>,
) -> Result<String, String> {
    person_window(&webview)?;
    let label = webview.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let manifest = bundle::read_manifest(&app_id, &version)?;
        permissions::open(&manifest, &space_id, &label, &approved)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Checks one SDK call (`kind` "call") or subscription (`kind` "subscribe") before the page performs it.
#[tauri::command]
pub fn space_app_session_check(
    webview: Webview,
    session: String,
    kind: String,
    name: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let kind = match kind.as_str() {
        "call" => Kind::Call,
        "subscribe" => Kind::Subscribe,
        _ => return Err("That isn't a kind of call.".into()),
    };
    permissions::check(&session, webview.label(), kind, &name)
}

/// Offers the tools an app's MCP server listed to the agents' engines, for as long as its session runs.
/// Returns how many are on offer.
#[tauri::command]
pub fn space_app_mcp_register(
    webview: Webview,
    session: String,
    tools: Vec<serde_json::Value>,
) -> Result<usize, String> {
    person_window(&webview)?;
    mcp::register(&session, webview.label(), &tools)
}

#[tauri::command]
pub fn space_app_mcp_unregister(webview: Webview, session: String) -> Result<(), String> {
    person_window(&webview)?;
    mcp::unregister(&session, webview.label());
    Ok(())
}

#[tauri::command]
pub fn space_app_session_close(webview: Webview, session: String) -> Result<(), String> {
    person_window(&webview)?;
    mcp::unregister(&session, webview.label());
    permissions::close(&session, webview.label());
    Ok(())
}
