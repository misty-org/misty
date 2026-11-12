// The file panel: a linked folder's tree one level at a time with its Git-ignore state, a file's
// text or image, the tree's new, rename, duplicate, copy and paste, move to trash, and search.
//
// Adapted from desktop-cc-gui's files.rs (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE. Every path a window names passes `linked_path` first, and every read and write
// goes through the file gate.

mod clipboard;
mod copy;
pub mod search;
#[cfg(test)]
mod tests;

use base64::Engine as _;
use serde::Serialize;
use std::path::Path;

use tauri::Manager;

use super::{linked_path, person_window};

pub(crate) use clipboard::ClipboardFileSnapshot;

pub(crate) const MAX_READ_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime_ms: i64,
    /// Git ignores this entry (`.gitignore`, info/exclude, global excludes, and `.git` itself);
    /// see `git_ignore.rs`. Omitted when false.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub ignored: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    /// `text`, `image` or `binary`.
    pub kind: &'static str,
    pub text: Option<String>,
    pub data_url: Option<String>,
    /// The file is longer than what was read; saving it would cut it short, so it opens read-only.
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOpResult {
    pub path: String,
    pub is_dir: bool,
}

/// What pasting the system clipboard did: the items that landed, and why each one that didn't
/// stayed behind (one bad entry must not lose the rest).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteClipboardResult {
    pub created: Vec<FileOpResult>,
    pub failed: Vec<String>,
}

fn mtime_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

/// One folder's entries, folders first. With `ignore_root` each entry carries its Git-ignore
/// state, bounded by the tree's root (see `git_ignore.rs`); other callers skip the Git work.
pub(crate) fn list_dir_blocking(
    dir: &Path,
    ignore_root: Option<&Path>,
) -> Result<Vec<DirEntry>, String> {
    let entries = file_access::fs::read_dir(dir)
        .map_err(|error| format!("Couldn't read {}: {error}", dir.display()))?;
    let raw: Vec<(String, Option<std::fs::Metadata>)> = entries
        .flatten()
        .map(|entry| {
            (
                entry.file_name().to_string_lossy().to_string(),
                file_access::fs::metadata(entry.path()).ok(),
            )
        })
        .collect();
    let is_dir = |meta: &Option<std::fs::Metadata>| meta.as_ref().is_some_and(|m| m.is_dir());
    let ignored = match ignore_root {
        Some(root) => super::git_ignore::ignored_names(
            dir,
            root,
            raw.iter().map(|(name, meta)| (name.as_str(), is_dir(meta))),
        ),
        None => Default::default(),
    };
    let mut out: Vec<DirEntry> = raw
        .into_iter()
        .map(|(name, meta)| DirEntry {
            is_dir: is_dir(&meta),
            size: meta.as_ref().map_or(0, |m| m.len()),
            mtime_ms: meta.as_ref().map_or(0, mtime_ms),
            ignored: ignored.contains(&name),
            name,
        })
        .collect();
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(out)
}

/// What a folder holds, folders first. `git_ignore_root` is the tree's root, which bounds how far
/// a folder's ignored state is inherited.
#[tauri::command]
pub async fn project_list_dir(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
    git_ignore_root: Option<String>,
) -> Result<Vec<DirEntry>, String> {
    person_window(&webview)?;
    let dir = linked_path(&app, &account, &path).await?;
    let root = match git_ignore_root {
        Some(root) => Some(linked_path(&app, &account, &root).await?),
        None => None,
    };
    blocking(move || list_dir_blocking(&dir, root.as_deref())).await
}

pub(crate) fn is_image(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico"
    )
}

pub(crate) fn image_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "image/png",
    }
}

pub(crate) fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn read_file_blocking(file: &Path) -> Result<FileContent, String> {
    let meta = file_access::fs::metadata(file)
        .map_err(|error| format!("Couldn't read {}: {error}", file.display()))?;
    if is_image(file) {
        if meta.len() > MAX_IMAGE_BYTES as u64 {
            return Err("This image is larger than 5 MB, too large to preview.".into());
        }
        let bytes = file_access::fs::read(file)
            .map_err(|error| format!("Couldn't read {}: {error}", file.display()))?;
        return Ok(FileContent {
            kind: "image",
            text: None,
            data_url: Some(data_url(image_mime(file), &bytes)),
            truncated: false,
        });
    }
    let mut bytes = Vec::new();
    {
        use std::io::Read;
        let opened = file_access::fs::File::open(file)
            .map_err(|error| format!("Couldn't open {}: {error}", file.display()))?;
        opened
            .take((MAX_READ_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("Couldn't read {}: {error}", file.display()))?;
    }
    let truncated = bytes.len() > MAX_READ_BYTES;
    bytes.truncate(MAX_READ_BYTES);
    // A zero byte in the first 8 KB means it isn't text.
    if bytes[..bytes.len().min(8192)].contains(&0) {
        return Ok(FileContent {
            kind: "binary",
            text: None,
            data_url: None,
            truncated: false,
        });
    }
    Ok(FileContent {
        kind: "text",
        text: Some(String::from_utf8_lossy(&bytes).to_string()),
        data_url: None,
        truncated,
    })
}

/// A file's text up to a megabyte, or an image (up to 5 MB) as a data URL.
#[tauri::command]
pub async fn project_read_file(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
) -> Result<FileContent, String> {
    person_window(&webview)?;
    let file = linked_path(&app, &account, &path).await?;
    blocking(move || read_file_blocking(&file)).await
}

/// Saves a file's text.
#[tauri::command]
pub async fn project_write_file(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
    content: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let file = linked_path(&app, &account, &path).await?;
    blocking(move || {
        file_access::fs::write(&file, content)
            .map_err(|error| format!("Couldn't save {}: {error}", file.display()))
    })
    .await
}

#[tauri::command]
pub async fn project_create_dir(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let dir = linked_path(&app, &account, &path).await?;
    blocking(move || {
        file_access::fs::create_dir_all(&dir)
            .map_err(|error| format!("Couldn't make {}: {error}", dir.display()))
    })
    .await
}

/// "New file" from the tree's menu: fails instead of overwriting when the name is taken.
#[tauri::command]
pub async fn project_create_file(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let file = linked_path(&app, &account, &path).await?;
    blocking(move || {
        file_access::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&file)
            .map(|_| ())
            .map_err(|error| format!("Couldn't make {}: {error}", file.display()))
    })
    .await
}

#[tauri::command]
pub async fn project_rename(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    from: String,
    to: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let source = linked_path(&app, &account, &from).await?;
    let target = linked_path(&app, &account, &to).await?;
    blocking(move || {
        if file_access::fs::symlink_metadata(&target).is_ok() {
            return Err(format!("{} already exists.", target.display()));
        }
        file_access::fs::rename(&source, &target).map_err(|error| {
            format!(
                "Couldn't rename {} to {}: {error}",
                source.display(),
                target.display()
            )
        })
    })
    .await
}

/// Moves `path` to the system's trash in this process. On macOS the trash crate would ask Finder
/// through `osascript` by default (an Automation prompt, and a process chain security tools
/// distrust); NSFileManager's `trashItemAtURL` needs neither. The cost is that Finder's "Put
/// Back" may be missing for these items; dragging them out of the Trash still restores them.
pub(crate) fn move_to_trash(path: &Path) -> Result<(), trash::Error> {
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut context = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        context.set_delete_method(DeleteMethod::NsFileManager);
    }
    context.delete(path)
}

#[tauri::command]
pub async fn project_trash(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let target = linked_path(&app, &account, &path).await?;
    // The folder itself stays: a whole linked folder is unlinked, never trashed from here.
    let store = app
        .state::<crate::app::runtime::MistyRuntime>()
        .environment
        .store();
    let roots = blocking(move || crate::engines::store::all_folders(&store)).await?;
    if roots.contains(&target) {
        return Err("A linked folder can't be moved to the trash from here.".into());
    }
    blocking(move || {
        move_to_trash(&target)
            .map_err(|error| format!("Couldn't move {} to the trash: {error}", target.display()))
    })
    .await
}

#[tauri::command]
pub async fn project_duplicate(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
) -> Result<FileOpResult, String> {
    person_window(&webview)?;
    let source = linked_path(&app, &account, &path).await?;
    blocking(move || copy::duplicate(&source)).await
}

#[tauri::command]
pub async fn project_paste(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    source: String,
    target_dir: String,
) -> Result<FileOpResult, String> {
    person_window(&webview)?;
    let source = linked_path(&app, &account, &source).await?;
    let dir = linked_path(&app, &account, &target_dir).await?;
    blocking(move || copy::paste(&source, &dir)).await
}

/// Pastes the files the system clipboard holds (a Finder or Explorer copy). Nothing created and
/// nothing failed means the clipboard held no file; the tree then falls back to its own copy.
///
/// The source paths are read from the clipboard here and never travel through a window: a
/// window-named "paste from anywhere" would be a read of any file once the copy lands in the
/// folder. Only the reading runs on the main thread, as AppKit wants; the copy, which can be a
/// whole folder from another disk, runs on a worker.
#[tauri::command]
pub async fn project_paste_clipboard(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    target_dir: String,
) -> Result<PasteClipboardResult, String> {
    person_window(&webview)?;
    let dir = linked_path(&app, &account, &target_dir).await?;
    if !file_access::fs::is_dir(&dir) {
        return Err(format!("{} isn't a folder.", dir.display()));
    }
    let snapshot = clipboard::snapshot_on_main_thread(&app).await?;
    blocking(move || Ok(copy::copy_clipboard_items_into(&snapshot.paths, &dir))).await
}

/// The file paths on the system clipboard and its change count, so the tree's Paste can tell
/// whether its own Copy is still the newest one.
#[tauri::command]
pub async fn project_clipboard_snapshot(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<ClipboardFileSnapshot, String> {
    person_window(&webview)?;
    clipboard::snapshot_on_main_thread(&app).await
}

/// The clipboard's change count alone, read without opening the clipboard, for when a snapshot
/// fails because another program holds it (Windows).
#[tauri::command]
pub async fn project_clipboard_change_count(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<Option<u64>, String> {
    person_window(&webview)?;
    clipboard::change_count_on_main_thread(&app).await
}

/// Puts files from a linked folder on the system clipboard, so Finder or Explorer pastes the real
/// item. Returns the clipboard's change count afterwards, written or not. Paths outside the
/// linked folders were refused before this.
#[tauri::command]
pub async fn project_clipboard_set_files(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    paths: Vec<String>,
) -> Result<Option<u64>, String> {
    person_window(&webview)?;
    let mut allowed = Vec::new();
    for path in paths {
        allowed.push(linked_path(&app, &account, &path).await?);
    }
    clipboard::set_files_on_main_thread(&app, allowed).await
}
