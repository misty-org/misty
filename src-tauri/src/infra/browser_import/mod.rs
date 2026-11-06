//! Brings a person's other browser with them: bookmarks, history, settings,
//! signed-in sites and the list of extensions from the Chrome family, Firefox
//! and Safari, and bookmarks from or to the HTML file every browser reads.
//! Source files are only read, from private copies. The renderer names a
//! source by browser and profile ID; paths and cookie values never cross.
//! Commands are limited to profile windows (`app_command_policy`), and what they
//! write lands in the calling window's profile.
mod bookmark_file;
pub use bookmark_file::*;
mod chromium;
mod chromium_key;
mod cookie_writer;
mod cookies;
mod discover;
mod extensions;
mod firefox;
mod history;
mod model;
mod netscape;
mod safari;
mod settings;
mod snapshot;

pub use discover::import_folders;
use discover::{Browser, BrowserProfile, BrowserSource, Family};
use extensions::ImportedExtension;
use model::BookmarkRoots;
use serde::{Deserialize, Serialize};
use settings::ImportedSettings;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::permissions::Permission;

const IMPORT_OFF: &str = "Misty needs your OK to read your other browsers. You can allow it under Settings, Agents, Access.";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSourceRequest {
    pub browser: Browser,
    pub profile: String,
}

/// A source whose history, permissions and sign-ins land in the calling window's profile.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTargetRequest {
    pub source: ImportSourceRequest,
}

/// The website data store of the calling window's profile; `None` is this computer's original
/// store. Never named by the renderer.
fn profile_store(webview: &tauri::Webview) -> Result<Option<String>, String> {
    let label = webview.label();
    if !super::profile_windows::is_person_window(label) {
        return Err("Import from a profile's window.".into());
    }
    let key = super::profile_windows::profile_for_window(label)
        .ok_or("Import from a profile's window.")?;
    super::profile_windows::store_for_profile(&key)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedBookmarks {
    pub roots: BookmarkRoots,
    /// Entries left out: bookmarklets, browser pages, saved searches.
    pub skipped: usize,
}

/// What a source has, per kind. `issue` explains why a kind can't come across.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Available<T> {
    pub value: Option<T>,
    pub issue: Option<String>,
}

impl<T> From<Result<T, String>> for Available<T> {
    fn from(result: Result<T, String>) -> Self {
        match result {
            Ok(value) => Self {
                value: Some(value),
                issue: None,
            },
            Err(issue) => Self {
                value: None,
                issue: Some(issue),
            },
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkCounts {
    pub links: usize,
    pub folders: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub bookmarks: Available<BookmarkCounts>,
    pub history: Available<usize>,
    /// The settings this source has that Misty can take.
    pub settings: Vec<&'static str>,
    /// Sites with saved sign-ins.
    pub signins: Available<usize>,
    pub extensions: Vec<ImportedExtension>,
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|_| "The import stopped unexpectedly.".to_owned())?
}

fn profile(request: &ImportSourceRequest) -> Result<BrowserProfile, String> {
    discover::resolve(request.browser, &request.profile)
}

fn read_bookmarks(
    browser: Browser,
    path: &std::path::Path,
) -> Result<(BookmarkRoots, usize), String> {
    match browser.family() {
        Family::Chromium => chromium::bookmarks(path),
        Family::Firefox => firefox::bookmarks(path),
        Family::Safari => safari::bookmarks(path),
    }
}

/// The one way into other browsers' files. Every import starts here, in the person's window, so
/// this is where the person is asked; a window that isn't theirs is refused without a prompt.
#[tauri::command]
pub async fn browser_import_discover(
    webview: tauri::Webview,
    app: AppHandle,
) -> Result<Vec<BrowserSource>, String> {
    if !super::profile_windows::is_person_window(webview.label()) {
        return Err("Import from a profile's window.".into());
    }
    if !super::permissions::ensure_async(&app, Permission::BrowserImport).await {
        return Err(IMPORT_OFF.into());
    }
    blocking(|| Ok(discover::discover())).await
}

/// Every other command reads a source the person already allowed. It refuses when that's off, and
/// the file gate refuses the same files underneath it.
fn require_import(app: &AppHandle) -> Result<(), String> {
    if super::permissions::is_on(app, Permission::BrowserImport) {
        Ok(())
    } else {
        Err(IMPORT_OFF.into())
    }
}

#[tauri::command]
pub async fn browser_import_preview(
    app: AppHandle,
    request: ImportSourceRequest,
) -> Result<ImportPreview, String> {
    require_import(&app)?;
    blocking(move || {
        let source = profile(&request)?;
        let family = request.browser.family();
        Ok(ImportPreview {
            bookmarks: read_bookmarks(request.browser, &source.path)
                .map(|(roots, _)| {
                    let (links, folders) = roots.counts();
                    BookmarkCounts { links, folders }
                })
                .into(),
            history: history::count(family, &source.path).into(),
            settings: settings::read(family, &source.path).summary(),
            signins: cookies::count(request.browser, &source.path).into(),
            extensions: extensions::read(family, &source.path),
        })
    })
    .await
}

#[tauri::command]
pub async fn browser_import_bookmarks(
    app: AppHandle,
    request: ImportSourceRequest,
) -> Result<ImportedBookmarks, String> {
    require_import(&app)?;
    blocking(move || {
        let source = profile(&request)?;
        let (roots, skipped) = read_bookmarks(request.browser, &source.path)?;
        Ok(ImportedBookmarks { roots, skipped })
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Added {
    pub added: usize,
    /// Sign-ins the source browser locks to itself.
    pub locked: usize,
}

#[tauri::command]
pub async fn browser_import_history(
    webview: tauri::Webview,
    app: AppHandle,
    request: ImportTargetRequest,
) -> Result<Added, String> {
    require_import(&app)?;
    let target = super::browser_library::history::profile_key(profile_store(&webview)?);
    blocking(move || {
        let source = profile(&request.source)?;
        let visits = history::read(request.source.browser.family(), &source.path)?;
        let mut library = super::browser_library::library(&app)?;
        Ok(Added {
            added: history::write(&mut library, &target, &visits)?,
            locked: 0,
        })
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSettingsResult {
    pub settings: ImportedSettings,
    /// Camera and microphone decisions added for sites.
    pub site_permissions_added: usize,
}

/// Reads the settings and saves the site decisions natively; the app applies
/// the rest to the account's settings.
#[tauri::command]
pub async fn browser_import_settings(
    webview: tauri::Webview,
    app: AppHandle,
    request: ImportTargetRequest,
) -> Result<ImportedSettingsResult, String> {
    require_import(&app)?;
    let misty_profile = profile_store(&webview)?;
    blocking(move || {
        let source = profile(&request.source)?;
        let settings = settings::read(request.source.browser.family(), &source.path);
        let site_permissions_added = {
            let decisions: Vec<_> = settings
                .site_permissions
                .iter()
                .map(|p| (p.origin.clone(), p.kind, p.allow))
                .collect();
            super::site_settings::permissions::import_decisions(
                misty_profile.as_deref(),
                &decisions,
            )?
        };
        Ok(ImportedSettingsResult {
            settings,
            site_permissions_added,
        })
    })
    .await
}

/// Imports saved sign-ins. Reading a Chromium browser's on macOS shows the
/// system's Keychain prompt for that browser first.
#[tauri::command]
pub async fn browser_import_signins(
    webview: tauri::Webview,
    app: AppHandle,
    request: ImportTargetRequest,
) -> Result<Added, String> {
    require_import(&app)?;
    let misty_profile = profile_store(&webview)?;
    let source = request.source.clone();
    let read = blocking(move || {
        let path = profile(&source)?.path;
        cookies::read(source.browser, &path)
    })
    .await?;
    let added = cookie_writer::write(&app, misty_profile.as_deref(), read.cookies).await?;
    Ok(Added {
        added,
        locked: read.locked,
    })
}
