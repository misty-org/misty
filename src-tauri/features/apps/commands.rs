use std::time::Duration;

use tauri::Webview;

use super::bundle;
use super::manifest::{AppManifest, Permission};
use super::mcp;
use super::permissions::{self, Kind};
use super::program;
use crate::project::person_window;

const MAX_DOWNLOAD_BYTES: u64 = 256 << 20;

#[tauri::command]
pub async fn space_app_bundle_manifest(
    webview: Webview,
    app_id: String,
    version: String,
) -> Result<Option<AppManifest>, String> {
    person_window(&webview)?;
    tauri::async_runtime::spawn_blocking(move || bundle::installed_manifest(&app_id, &version))
        .await
        .map_err(|error| error.to_string())?
}

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
        crate::browser::pages::macos::capture_webview_region_sized(
            webview,
            x.max(0.0),
            y.max(0.0),
            width,
            height,
            1280.0,
        )
        .await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (webview, x, y, width, height);
        Err("Misty can't picture an app's window on this computer yet.".into())
    }
}

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
    let mut wrap = wrap;
    if let Some(wrap) = wrap.as_mut() {
        for file in &mut wrap.add_files {
            if let Some(source) = &file.source {
                file.content = crate::registry::files::script(source).await?;
            }
        }
    }
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

pub(crate) async fn download(url: &str, max: u64) -> Result<Vec<u8>, String> {
    let parsed = url::Url::parse(url).map_err(|_| "That isn't an address.".to_owned())?;
    #[cfg(debug_assertions)]
    if parsed.scheme() == "file" {
        return crate::registry::local::read_build(&parsed, max);
    }
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
        .map_err(|_| {
            "Couldn't download the app. Check your connection and try again.".to_owned()
        })?;
    if response.url().scheme() != "https" {
        return Err("Apps download only over https.".into());
    }
    if response.content_length().is_some_and(|length| length > max) {
        return Err("The app is larger than a bundle may be.".into());
    }
    let bytes = response.bytes().await.map_err(|_| {
        "Couldn't download the app. Check your connection and try again.".to_owned()
    })?;
    if bytes.len() as u64 > max {
        return Err("The app is larger than a bundle may be.".into());
    }
    Ok(bytes.to_vec())
}

#[tauri::command]
pub async fn space_app_program_offer(
    webview: Webview,
    app_id: String,
    version: String,
) -> Result<usize, String> {
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
            tauri::async_runtime::spawn_blocking(move || {
                program::install(&app_id, &version, &spec, &build, &archive)
            })
            .await
            .map_err(|error| error.to_string())??
        }
    };
    program::offer(&app_id, &version, &spec, &path).await
}

#[tauri::command]
pub fn space_app_program_withdraw(webview: Webview, app_id: String) -> Result<(), String> {
    person_window(&webview)?;
    program::withdraw(&app_id);
    Ok(())
}

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
    let generation = permissions::window_generation(&label);
    tauri::async_runtime::spawn_blocking(move || {
        let manifest = match super::site::site_entry(&app_id).filter(|site| site.version == version)
        {
            Some(site) if site.runs_here() => site.manifest()?,
            Some(site) => return Err(format!("{} isn't made for this computer.", site.name)),
            None => bundle::read_manifest(&app_id, &version)?,
        };
        if !manifest.runs_here() {
            return Err(format!("{} isn't made for this computer.", manifest.name));
        }
        permissions::open_since(&manifest, &space_id, &label, &approved, generation)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(serde::Serialize)]
pub struct Refusal {
    denied: bool,
    message: String,
}

fn refused(message: String) -> Refusal {
    Refusal {
        denied: true,
        message,
    }
}

#[tauri::command]
pub fn space_app_session_check(
    webview: Webview,
    session: String,
    kind: String,
    name: String,
) -> Result<(), Refusal> {
    person_window(&webview).map_err(refused)?;
    let kind = match kind.as_str() {
        "call" => Kind::Call,
        "subscribe" => Kind::Subscribe,
        _ => return Err(refused("That isn't a kind of call.".into())),
    };
    permissions::check(&session, webview.label(), kind, &name).map_err(refused)
}

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
pub fn space_app_tools_standby(
    webview: Webview,
    app_id: String,
    space_id: Option<String>,
    tools: Vec<serde_json::Value>,
) -> Result<usize, String> {
    person_window(&webview)?;
    mcp::register_standby(webview.label(), &app_id, space_id.as_deref(), &tools)
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
