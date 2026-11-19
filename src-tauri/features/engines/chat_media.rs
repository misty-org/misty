//! Media moving between a Space and a chat's folder, for the video and photo editors' agents.
//! `chat_media_save` puts a Media file the window read from the Space into the chat's folder,
//! for the chat's agent to work on with its own tools (`media.fetch`); `chat_media_load` hands
//! the window a file the agent made in that folder, to add to Media (`file.upload`). Both stay
//! inside the chat's own folder: a name can't climb out of it, and a path that leads outside it
//! (through `..` or a link) is refused.

use std::path::{Path, PathBuf};

use tauri::State;

use super::chat_folder;
use super::commands::{blocking, person_window};
use crate::app::runtime::MistyRuntime;

/// The largest file either way: a long video, read whole into memory.
const MAX_MEDIA_BYTES: usize = 2 * 1024 * 1024 * 1024;

fn header(request: &tauri::ipc::Request<'_>, name: &str) -> Result<String, String> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(percent_decode)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("The request names no {name}."))
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A file name that stays one name: no folders, no leading dots, nothing a system refuses.
pub(crate) fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '\0') || c.is_control() { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.').trim();
    if trimmed.is_empty() {
        "media".into()
    } else {
        trimmed.chars().take(180).collect()
    }
}

/// `folder/name`, or `folder/stem (2).ext` and so on when that is taken.
fn free_path(folder: &Path, name: &str) -> PathBuf {
    let first = folder.join(name);
    if !first.exists() {
        return first;
    }
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let extension = path.extension().and_then(|e| e.to_str());
    (2..10_000)
        .map(|n| match extension {
            Some(ext) => folder.join(format!("{stem} ({n}).{ext}")),
            None => folder.join(format!("{stem} ({n})")),
        })
        .find(|candidate| !candidate.exists())
        .unwrap_or(first)
}

/// Whether `path`, followed through any links, is inside `folder`.
pub(crate) fn inside(folder: &Path, path: &Path) -> bool {
    match (
        file_access::fs::canonicalize(folder),
        file_access::fs::canonicalize(path),
    ) {
        (Ok(folder), Ok(path)) => path.starts_with(&folder) && path != folder,
        _ => false,
    }
}

/// Saves a Media file into the chat's folder (`media/` in it) and answers its path. The bytes come
/// as the body; the account, chat and file name in headers.
#[tauri::command]
pub async fn chat_media_save(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    person_window(&webview)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("The file didn't arrive.".into());
    };
    if bytes.len() > MAX_MEDIA_BYTES {
        return Err("That file is larger than Misty moves (2 GB).".into());
    }
    let account = header(&request, "x-account")?;
    let conversation = header(&request, "x-conversation")?;
    let name = safe_name(&header(&request, "x-file-name")?);
    let bytes = bytes.clone();
    let db = state.environment.store();
    blocking(move || {
        let folder = chat_folder::current(&db, &account, &conversation)
            .ok_or("This chat has no folder on this computer yet.")?
            .join("media");
        file_access::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
        let path = free_path(&folder, &name);
        if !inside(folder.parent().unwrap_or(&folder), &folder) {
            return Err("The chat's media folder leads outside the chat's folder.".into());
        }
        file_access::fs::write(&path, &bytes).map_err(|error| error.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
}

/// A file in the chat's folder, as bytes, for the window to add to Media. Refused for anything
/// outside the folder.
#[tauri::command]
pub async fn chat_media_load(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    conversation: String,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    person_window(&webview)?;
    let db = state.environment.store();
    let bytes = blocking(move || {
        let folder = chat_folder::current(&db, &account, &conversation)
            .ok_or("This chat has no folder on this computer yet.")?;
        let path = PathBuf::from(&path);
        let path = if path.is_absolute() { path } else { folder.join(path) };
        if !inside(&folder, &path) {
            return Err("Only files in this chat's own folder can be added to Media.".into());
        }
        let size = file_access::fs::metadata(&path)
            .map_err(|_| "That file isn't there.".to_string())?
            .len();
        if size as usize > MAX_MEDIA_BYTES {
            return Err("That file is larger than Misty moves (2 GB).".into());
        }
        file_access::fs::read(&path).map_err(|error| error.to_string())
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_stay_one_name() {
        assert_eq!(safe_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(safe_name(".hidden"), "hidden");
        assert_eq!(safe_name("  "), "media");
        assert_eq!(safe_name("clip one.mp4"), "clip one.mp4");
    }

    #[test]
    fn only_paths_inside_the_folder_count() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("chat");
        std::fs::create_dir_all(folder.join("media")).unwrap();
        std::fs::write(folder.join("media/a.mp4"), b"x").unwrap();
        std::fs::write(root.path().join("outside.mp4"), b"x").unwrap();
        assert!(inside(&folder, &folder.join("media/a.mp4")));
        assert!(!inside(&folder, &folder.join("../outside.mp4")));
        assert!(!inside(&folder, &root.path().join("outside.mp4")));
        assert!(!inside(&folder, &folder));
    }

    #[test]
    fn a_taken_name_gets_a_number() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("a.mp4"), b"x").unwrap();
        assert_eq!(free_path(root.path(), "a.mp4"), root.path().join("a (2).mp4"));
        assert_eq!(free_path(root.path(), "b.mp4"), root.path().join("b.mp4"));
    }
}
