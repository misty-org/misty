// The file panel: a linked folder's tree one level at a time with its Git-ignore state, a file's
// text (an image's bytes load by URL; see `file_protocol.rs`), the tree's new, rename, duplicate,
// copy and paste, move to trash, and search.
//
// Adapted from desktop-cc-gui's files.rs (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE. Every path a window names passes `linked_path` first, and every read and write
// goes through the file gate.

pub(crate) mod clipboard;
mod copy;
pub mod search;
#[cfg(test)]
mod tests;

use serde::Serialize;
use std::path::Path;

use tauri::Manager;

use super::{linked_path, person_window};

pub(crate) use clipboard::ClipboardFileSnapshot;

pub(crate) const MAX_READ_BYTES: usize = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime_ms: i64,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub ignored: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub kind: &'static str,
    pub text: Option<String>,
    pub size: u64,
    pub mtime_ms: i64,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOpResult {
    pub path: String,
    pub is_dir: bool,
}

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

fn is_os_junk(name: &str) -> bool {
    [".DS_Store", "Thumbs.db", "desktop.ini"]
        .iter()
        .any(|junk| name.eq_ignore_ascii_case(junk))
}

pub(crate) fn list_dir_blocking(
    dir: &Path,
    ignore_root: Option<&Path>,
) -> Result<Vec<DirEntry>, String> {
    let entries = file_access::fs::read_dir(dir)
        .map_err(|error| format!("Couldn't read {}: {error}", dir.display()))?;
    let raw: Vec<(String, Option<std::fs::Metadata>)> = entries
        .flatten()
        .map(|entry| (entry.file_name().to_string_lossy().to_string(), entry))
        .filter(|(name, _)| !is_os_junk(name))
        .map(|(name, entry)| (name, file_access::fs::metadata(entry.path()).ok()))
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
        "png" | "apng" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "svg" | "bmp" | "ico"
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
        "avif" => "image/avif",
        "apng" => "image/apng",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "image/png",
    }
}

fn read_file_blocking(file: &Path) -> Result<FileContent, String> {
    let meta = file_access::fs::metadata(file)
        .map_err(|error| format!("Couldn't read {}: {error}", file.display()))?;
    let (size, mtime_ms) = (meta.len(), mtime_ms(&meta));
    if is_image(file) {
        return Ok(FileContent {
            kind: "image",
            text: None,
            size,
            mtime_ms,
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
    if bytes[..bytes.len().min(8192)].contains(&0) {
        return Ok(FileContent {
            kind: "binary",
            text: None,
            size,
            mtime_ms,
            truncated: false,
        });
    }
    Ok(FileContent {
        kind: "text",
        text: Some(String::from_utf8_lossy(&bytes).to_string()),
        size,
        mtime_ms,
        truncated,
    })
}

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

const MAX_BYTES: u64 = 100 * 1024 * 1024;

fn read_bytes_blocking(file: &Path) -> Result<Vec<u8>, String> {
    let name = file
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "That file".to_owned());
    let meta =
        file_access::fs::metadata(file).map_err(|_| format!("Misty couldn't open {name}."))?;
    if meta.is_dir() {
        return Err(format!("{name} is a folder."));
    }
    if meta.len() > MAX_BYTES {
        return Err(format!("{name} is larger than 100 MB."));
    }
    file_access::fs::read(file).map_err(|_| format!("Misty couldn't read {name}."))
}

#[tauri::command]
pub async fn project_read_bytes(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    person_window(&webview)?;
    let file = linked_path(&app, &account, &path).await?;
    blocking(move || read_bytes_blocking(&file))
        .await
        .map(tauri::ipc::Response::new)
}

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

#[tauri::command]
pub async fn project_clipboard_snapshot(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<ClipboardFileSnapshot, String> {
    person_window(&webview)?;
    clipboard::snapshot_on_main_thread(&app).await
}

#[tauri::command]
pub async fn project_clipboard_change_count(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<Option<u64>, String> {
    person_window(&webview)?;
    clipboard::change_count_on_main_thread(&app).await
}

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
