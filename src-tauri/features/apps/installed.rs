use std::collections::HashSet;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Webview};

use super::app_server;
use super::bundle;
use super::commands::install_bundle;
use super::manifest::{valid_id, valid_version, Permission};
use super::program;
use crate::app::runtime::MistyRuntime;
use crate::project::person_window;

pub const CHANGED_EVENT: &str = "misty://apps-changed";

#[derive(Debug, Clone, Serialize)]
pub struct InstalledApp {
    pub app_id: String,
    pub version: String,
    pub permissions: Vec<Permission>,
    pub installed_at: i64,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct BundleSource {
    pub url: String,
    pub sha256: String,
    #[serde(default)]
    pub wrap: Option<bundle::Wrap>,
}

fn store(app: &AppHandle) -> database::store::Store {
    app.state::<MistyRuntime>().environment.store()
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

fn row(app_id: String, version: String, permissions: String, installed_at: i64) -> InstalledApp {
    InstalledApp {
        app_id,
        version,
        permissions: serde_json::from_str(&permissions).unwrap_or_default(),
        installed_at,
    }
}

pub fn list(app: &AppHandle) -> Result<Vec<InstalledApp>, String> {
    let connection = store(app).connect().map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT app_id, version, permissions, installed_at FROM installed_apps ORDER BY installed_at",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |found| {
            Ok(row(found.get(0)?, found.get(1)?, found.get(2)?, found.get(3)?))
        })
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

pub fn find(app: &AppHandle, app_id: &str) -> Result<Option<InstalledApp>, String> {
    store(app)
        .connect()
        .and_then(|connection| {
            connection
                .query_row(
                    "SELECT app_id, version, permissions, installed_at FROM installed_apps WHERE app_id = ?1",
                    params![app_id],
                    |found| Ok(row(found.get(0)?, found.get(1)?, found.get(2)?, found.get(3)?)),
                )
                .optional()
        })
        .map_err(|error| error.to_string())
}

fn save(app: &AppHandle, installed: &InstalledApp) -> Result<(), String> {
    let permissions =
        serde_json::to_string(&installed.permissions).map_err(|error| error.to_string())?;
    store(app)
        .connect()
        .and_then(|connection| {
            connection.execute(
                "INSERT INTO installed_apps(app_id, version, permissions, installed_at) VALUES(?1, ?2, ?3, ?4)
                 ON CONFLICT(app_id) DO UPDATE SET version = excluded.version, permissions = excluded.permissions",
                params![installed.app_id, installed.version, permissions, installed.installed_at],
            )
        })
        .map(drop)
        .map_err(|error| error.to_string())
}

fn forget(app: &AppHandle, app_id: &str) -> Result<(), String> {
    store(app)
        .connect()
        .and_then(|connection| {
            connection.execute(
                "DELETE FROM installed_apps WHERE app_id = ?1",
                params![app_id],
            )
        })
        .map(drop)
        .map_err(|error| error.to_string())
}

fn changed(app: &AppHandle) {
    let _ = app.emit(CHANGED_EVENT, ());
}

#[tauri::command]
pub fn apps_installed(webview: Webview, app: AppHandle) -> Result<Vec<InstalledApp>, String> {
    person_window(&webview)?;
    list(&app)
}

#[tauri::command]
pub async fn apps_install(
    webview: Webview,
    app: AppHandle,
    app_id: String,
    version: String,
    permissions: Vec<Permission>,
    source: Option<BundleSource>,
) -> Result<InstalledApp, String> {
    person_window(&webview)?;
    if !valid_id(&app_id) || !valid_version(&version) {
        return Err("That isn't an app id and version.".into());
    }
    let manifest = match super::site::site_entry(&app_id).filter(|site| site.version == version) {
        Some(site) => site.manifest()?,
        None => {
            let source =
                source.ok_or_else(|| "Misty's registry doesn't say where to get this app.".to_owned())?;
            install_bundle(app_id.clone(), version.clone(), source.url, source.sha256, source.wrap)
                .await?
        }
    };
    let asked: HashSet<Permission> = manifest.permissions.iter().copied().collect();
    if permissions.iter().any(|permission| !asked.contains(permission)) {
        return Err("That's more than the app asks for.".into());
    }
    let mut approved = permissions;
    approved.sort();
    approved.dedup();
    if app_server::runs_here(&app_id) {
        app_server::install(&app, &app_id).await?;
    }
    let installed = InstalledApp {
        installed_at: find(&app, &app_id)?.map_or_else(now, |known| known.installed_at),
        app_id,
        version,
        permissions: approved,
    };
    save(&app, &installed)?;
    {
        let (app_id, version) = (installed.app_id.clone(), installed.version.clone());
        let _ = tauri::async_runtime::spawn_blocking(move || {
            bundle::remove_other_versions(&bundle::cache_root()?, &app_id, &version)
        })
        .await;
    }
    changed(&app);
    Ok(installed)
}

#[tauri::command]
pub async fn apps_remove(webview: Webview, app: AppHandle, app_id: String) -> Result<(), String> {
    person_window(&webview)?;
    if !valid_id(&app_id) {
        return Err("That isn't an app id.".into());
    }
    forget(&app, &app_id)?;
    program::withdraw(&app_id);
    let server = app_server::remove(&app_id).await;
    let removed = {
        let app_id = app_id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            bundle::remove_all_versions(&bundle::cache_root()?, &app_id)?;
            program::remove_all(&app_id)
        })
        .await
        .map_err(|error| error.to_string())?
    };
    changed(&app);
    removed.and(server)
}
