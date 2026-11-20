//! What the page asks of the host about apps: whether a version is on this computer, getting one,
//! and the session every relayed SDK call is checked against.

use std::time::Duration;

use tauri::Webview;

use super::bundle;
use super::manifest::{AppManifest, Permission};
use super::mcp;
use super::program;
use super::permissions::{self, Kind};
use crate::project::person_window;

/// The most a bundle's zip may be.
const MAX_DOWNLOAD_BYTES: u64 = 256 << 20;

/// The manifest of an app version on this computer, or `None` when it has to be downloaded first.
#[tauri::command]
pub async fn space_app_bundle_manifest(
    webview: Webview,
    app_id: String,
    version: String,
) -> Result<Option<AppManifest>, String> {
    person_window(&webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        bundle::installed_manifest(&app_id, &version)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// A picture of a running app as the person sees it, for an agent working in it: the app's area of the window,
/// as WebKit draws it (a canvas or WebGPU app included). `x`, `y`, `width` and `height` are the frame's box in the
/// window's page. Elsewhere than macOS the page reads the app's own canvas instead.
#[tauri::command]
pub async fn space_app_snapshot(
    webview: Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<serde_json::Value, String> {
    person_window(&webview)?;
    #[cfg(target_os = "macos")]
    {
        crate::browser::pages::macos::capture_webview_region_sized(webview, x.max(0.0), y.max(0.0), width, height, 1280.0)
            .await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (webview, x, y, width, height);
        Err("Misty can't picture an app's window on this computer yet.".into())
    }
}

/// What a pasted GitHub link adds to a Space: the app's pinned build and whether Misty's catalog lists it, or why
/// it can't be added (`resolve`).
#[tauri::command]
pub async fn space_app_resolve(webview: Webview, link: String) -> Result<super::resolve::Resolved, String> {
    person_window(&webview)?;
    if link.len() > 512 {
        return Err("That link is too long.".into());
    }
    super::resolve::resolve(&link).await
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
    let bytes = download(&url, MAX_DOWNLOAD_BYTES).await?;
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

/// Downloads a release asset over https, following at most five redirects that stay on https, up to `max` bytes.
async fn download(url: &str, max: u64) -> Result<Vec<u8>, String> {
    let parsed = url::Url::parse(url).map_err(|_| "That isn't an address.".to_owned())?;
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
    if response.content_length().is_some_and(|length| length > max) {
        return Err("The app is larger than a bundle may be.".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "Couldn't download the app. Check your connection and try again.".to_owned())?;
    if bytes.len() as u64 > max {
        return Err("The app is larger than a bundle may be.".into());
    }
    Ok(bytes.to_vec())
}

/// Offers agents the tools of an installed app whose MCP server is its maker's own program (`mcp: binary`). Which
/// program, from where and with which checksum is read from the catalog Misty ships, never from the page: the
/// page only names the app and the version its Space installed. The program is downloaded the first time.
/// Returns how many tools it newly offered.
#[tauri::command]
pub async fn space_app_program_offer(webview: Webview, app_id: String, version: String) -> Result<usize, String> {
    person_window(&webview)?;
    let (spec, build) = program::pinned(&app_id, &version)?;
    let here = {
        let (app_id, version, spec) = (app_id.clone(), version.clone(), spec.clone());
        tauri::async_runtime::spawn_blocking(move || program::installed(&app_id, &version, &spec))
            .await
            .map_err(|error| error.to_string())??
    };
    let path = match here {
        Some(path) => path,
        None => {
            let archive = download(&build.url, program::MAX_ARCHIVE_BYTES).await?;
            let (app_id, version, spec) = (app_id.clone(), version.clone(), spec.clone());
            tauri::async_runtime::spawn_blocking(move || program::install(&app_id, &version, &spec, &build, &archive))
                .await
                .map_err(|error| error.to_string())??
        }
    };
    program::offer(&app_id, &version, &spec, &path).await
}

/// Takes an app's program tools down, such as when no Space open here has it any more.
#[tauri::command]
pub fn space_app_program_withdraw(webview: Webview, app_id: String) -> Result<(), String> {
    person_window(&webview)?;
    program::withdraw(&app_id);
    Ok(())
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
        // An app made only for other computers says so instead of opening to a broken page.
        if !manifest.runs_here() {
            return Err(format!("{} isn't made for this computer.", manifest.name));
        }
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

/// Offers an added app's screen tools while it isn't open, so an agent can open it and work there.
#[tauri::command]
pub fn space_app_tools_standby(webview: Webview, app_id: String, tools: Vec<serde_json::Value>) -> Result<usize, String> {
    person_window(&webview)?;
    mcp::register_standby(webview.label(), &app_id, &tools)
}

#[tauri::command]
pub fn space_app_tools_withdraw(webview: Webview, app_id: String) -> Result<(), String> {
    person_window(&webview)?;
    mcp::unregister_standby(webview.label(), &app_id);
    Ok(())
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
