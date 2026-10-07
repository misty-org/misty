//! Brings a person's other browser with them: bookmarks, history, settings,
//! signed-in sites and the list of extensions from the Chrome family, Firefox
//! and Safari, and bookmarks from or to the HTML file every browser reads.
//! Source files are only read, from private copies. The renderer names a
//! source by browser and profile ID; paths and cookie values never cross.
//! Commands are limited to the main window (`app_command_policy`).
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

use discover::{Browser, BrowserProfile, BrowserSource, Family};
use extensions::ImportedExtension;
use model::BookmarkRoots;
use serde::{Deserialize, Serialize};
use settings::ImportedSettings;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSourceRequest {
    pub browser: Browser,
    pub profile: String,
}

/// The Misty browser profile that receives history, permissions and sign-ins:
/// a profile identity, or none for the default store.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTargetRequest {
    pub source: ImportSourceRequest,
    pub misty_profile: Option<String>,
}

impl ImportTargetRequest {
    fn misty_profile(&self) -> Result<Option<&str>, String> {
        let profile = self.misty_profile.as_deref();
        super::browser_profile::data_store_identifier(profile)?;
        Ok(profile)
    }
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

#[tauri::command]
pub async fn browser_import_discover() -> Vec<BrowserSource> {
    tokio::task::spawn_blocking(discover::discover)
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn browser_import_preview(request: ImportSourceRequest) -> Result<ImportPreview, String> {
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
    request: ImportSourceRequest,
) -> Result<ImportedBookmarks, String> {
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
    app: AppHandle,
    request: ImportTargetRequest,
) -> Result<Added, String> {
    let target = super::browser_history::profile_key(request.misty_profile()?.map(str::to_owned));
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
    request: ImportTargetRequest,
) -> Result<ImportedSettingsResult, String> {
    let misty_profile = request.misty_profile()?.map(str::to_owned);
    blocking(move || {
        let source = profile(&request.source)?;
        let settings = settings::read(request.source.browser.family(), &source.path);
        #[cfg(target_os = "macos")]
        let site_permissions_added = {
            let decisions: Vec<_> = settings
                .site_permissions
                .iter()
                .map(|p| (p.origin.clone(), p.kind, p.allow))
                .collect();
            super::browser_site_permissions::import_decisions(misty_profile.as_deref(), &decisions)?
        };
        #[cfg(not(target_os = "macos"))]
        let site_permissions_added = {
            let _ = misty_profile;
            0
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
    app: AppHandle,
    request: ImportTargetRequest,
) -> Result<Added, String> {
    let misty_profile = request.misty_profile()?.map(str::to_owned);
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

/// Reads a bookmarks HTML file the person picks. `None` when they cancel.
#[tauri::command]
pub async fn browser_import_bookmarks_file(
    app: AppHandle,
) -> Result<Option<ImportedBookmarks>, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose a bookmarks file")
        .add_filter("Bookmarks", &["html", "htm"])
        .pick_file(move |file| {
            let _ = send.send(file);
        });
    let Some(file) = receive.await.ok().flatten() else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|_| "Choose a file on this computer.".to_owned())?;
    blocking(move || {
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if size > 64 << 20 {
            return Err("That file is too large to be a bookmarks file.".to_owned());
        }
        let bytes = std::fs::read(&path).map_err(|_| "That file could not be read.".to_owned())?;
        let (roots, skipped) = netscape::parse(&String::from_utf8_lossy(&bytes))?;
        Ok(Some(ImportedBookmarks { roots, skipped }))
    })
    .await
}

/// Saves Misty's bookmarks as the HTML file every browser imports. Returns
/// whether a file was written (`false` when the person cancels).
#[tauri::command]
pub async fn browser_import_save_bookmarks(
    app: AppHandle,
    roots: BookmarkRoots,
) -> Result<bool, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let name = format!("bookmarks_{}.html", chrono::Local::now().format("%Y-%m-%d"));
    app.dialog()
        .file()
        .set_title("Export bookmarks")
        .set_file_name(&name)
        .add_filter("Bookmarks", &["html"])
        .save_file(move |file| {
            let _ = send.send(file);
        });
    let Some(file) = receive.await.ok().flatten() else {
        return Ok(false);
    };
    let path = file
        .into_path()
        .map_err(|_| "Choose a location on this computer.".to_owned())?;
    std::fs::write(path, netscape::write(&roots))
        .map_err(|_| "The bookmarks file could not be saved there.".to_owned())?;
    Ok(true)
}
