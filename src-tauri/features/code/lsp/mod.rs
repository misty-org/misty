//! Language servers for the Code page: completion, diagnostics, hover and go to definition for
//! TypeScript and JavaScript, Python, Rust and Go.
//!
//! Misty downloads and updates the servers itself into its own folder, the way Zed does
//! (`install`, `node`, `store`), starts one per project folder a window has files open in
//! (`roots`, `servers`), and passes LSP messages between the server's stdio and the window
//! (`framing`). The window only ever names a language from the catalog (`catalog`): which program
//! runs, and with which arguments, is decided here.
//!
//! Events, each sent only to the window concerned:
//! - `misty://code-lsp-progress`: `{ language, step, received, total }` while installing.
//! - `misty://code-lsp-message`: `{ id, message }`, one JSON-RPC message from a server.
//! - `misty://code-lsp-closed`: `{ id, message }`, a server ended on its own.

mod catalog;
mod download;
mod framing;
mod install;
mod node;
mod roots;
mod servers;
mod store;

use std::collections::HashSet;
use std::path::Path;
use std::sync::{LazyLock, Mutex};

use serde::Serialize;

use crate::project::{linked_path, person_window};
use catalog::Language;
use download::Progress;

/// What the status row knows about a language's server.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspStatus {
    language: &'static str,
    /// The server's own name (`rust-analyzer`).
    server: &'static str,
    installed: bool,
    version: Option<String>,
    /// Why it can't be installed here, such as Go missing.
    problem: Option<&'static str>,
}

/// A started server, for the window's client.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspStarted {
    id: String,
    /// The project folder the server works in.
    root_uri: String,
    /// The asking file, as the server knows it.
    file_uri: String,
    /// The linked folder, for turning the server's links to other files back into paths.
    folder_uri: String,
}

async fn status_of(base: &Path, language: Language) -> LspStatus {
    let record = install::current(base, language).await;
    LspStatus {
        language: language.id(),
        server: language.server(),
        installed: record.is_some(),
        version: record.map(|record| record.version),
        problem: install::missing(language),
    }
}

/// Looks for a newer server in the background, once a day at most.
fn check_for_update(base: &Path, language: Language) {
    install::check_for_update(base.to_path_buf(), language, servers::dirs_in_use());
}

/// Whether a language's server is installed, and which version.
#[tauri::command]
pub async fn code_lsp_status(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    language: String,
) -> Result<LspStatus, String> {
    person_window(&webview)?;
    let _ = account;
    let language = Language::from_id(&language)?;
    let base = store::base(&app)?;
    let status = status_of(&base, language).await;
    if status.installed {
        check_for_update(&base, language);
    }
    Ok(status)
}

/// Installs a language's server, and Node.js first when an npm server needs it. Progress goes to
/// the asking window as `misty://code-lsp-progress`.
#[tauri::command]
pub async fn code_lsp_install(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    language: String,
) -> Result<LspStatus, String> {
    person_window(&webview)?;
    let _ = account;
    let language = Language::from_id(&language)?;
    if let Some(problem) = install::missing(language) {
        return Err(problem.into());
    }
    let base = store::base(&app)?;
    let progress = Progress {
        app: app.clone(),
        window: webview.label().to_string(),
        language: language.id(),
    };
    install::install(&base, language, Some(&progress)).await?;
    Ok(status_of(&base, language).await)
}

/// Starts the server for `file`'s project inside the linked `folder`, or joins the one already
/// running there. Each call is one more user, until `code_lsp_stop`.
#[tauri::command]
pub async fn code_lsp_start(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    language: String,
    folder: String,
    file: String,
    page: String,
) -> Result<LspStarted, String> {
    person_window(&webview)?;
    let language = Language::from_id(&language)?;
    if page.is_empty() || page.len() > 64 {
        return Err("That page can't start a language server.".into());
    }
    let folder = linked_path(&app, &account, &folder).await?;
    let file = linked_path(&app, &account, &file).await?;
    if !file.starts_with(&folder) {
        return Err("That file isn't in this folder.".into());
    }
    let root = {
        let (folder, file) = (folder.clone(), file.clone());
        tokio::task::spawn_blocking(move || roots::workspace_root(language, &folder, &file))
            .await
            .map_err(|error| error.to_string())?
    };
    let base = store::base(&app)?;
    let record = install::current(&base, language)
        .await
        .ok_or_else(|| format!("{} isn't installed yet.", language.server()))?;
    let launch = install::launch(&base, language, &record).await?;
    watch_window(&webview);
    let id = servers::start(&app, webview.label(), &page, language, root.clone(), launch).await?;
    check_for_update(&base, language);
    Ok(LspStarted {
        id,
        root_uri: folder_uri(&root)?,
        file_uri: url::Url::from_file_path(&file)
            .map_err(|_| "That file has no address a language server can use.".to_string())?
            .to_string(),
        folder_uri: folder_uri(&folder)?,
    })
}

/// A folder's `file:` URI, without the trailing slash servers don't expect in a root.
fn folder_uri(folder: &Path) -> Result<String, String> {
    let uri = url::Url::from_directory_path(folder)
        .map_err(|_| "That folder has no address a language server can use.".to_string())?;
    Ok(uri.as_str().trim_end_matches('/').to_string())
}

/// Hands JSON-RPC messages from the window's client to its server. They come as one ordered
/// batch, since separate calls may be handled out of order and LSP's edits must not be.
#[tauri::command]
pub async fn code_lsp_send(
    webview: tauri::Webview,
    id: String,
    messages: Vec<String>,
) -> Result<(), String> {
    person_window(&webview)?;
    servers::send(webview.label(), &id, messages)
}

/// One file stops using a server. It returns whether the server ended because that was the last.
#[tauri::command]
pub async fn code_lsp_stop(webview: tauri::Webview, id: String) -> Result<bool, String> {
    person_window(&webview)?;
    servers::release(webview.label(), &id)
}

/// Windows whose closing already ends their servers.
static WATCHED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

/// Ends a window's servers when it closes. Watched from here, so the servers never outlive their
/// window even where the app's own window cleanup doesn't call `close_window`.
fn watch_window(webview: &tauri::Webview) {
    let label = webview.label().to_string();
    let first = WATCHED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(label.clone());
    if !first {
        return;
    }
    webview.window().on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            close_window(&label);
        }
    });
}

/// Ends the servers a window started, as it closes.
pub fn close_window(window: &str) {
    servers::close_window(window);
    WATCHED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(window);
}

/// Ends every server, as the app quits.
pub fn close_all() {
    servers::close_all();
}
