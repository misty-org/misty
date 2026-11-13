//! Files the person drags onto a Misty window from Finder, Explorer or a Linux file manager.
//!
//! The webview's own drop handler is on (`dragDropEnabled`), so the operating system hands the
//! dropped paths to Tauri rather than to the page. The page hears of the drop through Tauri's
//! drag-drop event and reads each file back here. Tauri emits that event to the page before it
//! calls the app's own handlers, so the page retries a read that comes in a moment too early. Only paths the system itself dropped on one of
//! Misty's own windows can be read, and only while they are recent, so the page can't use this to
//! read any other file on the computer. Dropping a file is the person handing it over, the same as
//! picking it in a dialog, so each one gets the file gate's picked-file grant, read-only.
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{DragDropEvent, Runtime, Webview, WebviewEvent, Window, WindowEvent};

/// How many dropped paths are remembered: a few drops' worth.
const REMEMBERED: usize = 64;
/// The largest file read back, matching the composer's own limit for an attachment.
const LARGEST: u64 = 10 * 1024 * 1024;

static DROPPED: Mutex<VecDeque<PathBuf>> = Mutex::new(VecDeque::new());

/// Notes the paths of a drop on one of Misty's own windows.
pub fn window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event else {
        return;
    };
    remember_for(window.label(), paths);
}

/// Notes the paths of a drop on the webview of one of Misty's own windows. Tauri reports a drop
/// here, not as a window event, when the webview is a child of its window, which with the
/// `unstable` feature every webview is. Websites in tabs carry their own labels and are passed over.
pub fn webview_event<R: Runtime>(webview: &Webview<R>, event: &WebviewEvent) {
    let WebviewEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event else {
        return;
    };
    remember_for(webview.label(), paths);
}

fn remember_for(label: &str, paths: &[PathBuf]) {
    if crate::app::trusted_windows::app_command_policy::allows(label) {
        remember(paths);
    }
}

fn remember(paths: &[PathBuf]) {
    let Ok(mut dropped) = DROPPED.lock() else {
        return;
    };
    for path in paths {
        file_access::allow_picked_file(path, file_access::Access::Read);
        dropped.retain(|known| known != path);
        dropped.push_back(path.clone());
        while dropped.len() > REMEMBERED {
            dropped.pop_front();
        }
    }
}

fn was_dropped(path: &Path) -> bool {
    DROPPED
        .lock()
        .map(|dropped| dropped.iter().any(|known| known == path))
        .unwrap_or(false)
}

/// The bytes of a file the person just dropped on the window.
#[tauri::command]
pub async fn dropped_file_read(path: String) -> Result<tauri::ipc::Response, String> {
    let path = PathBuf::from(path);
    read(&path).map(tauri::ipc::Response::new)
}

fn read(path: &Path) -> Result<Vec<u8>, String> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "That file".to_owned());
    if !was_dropped(path) {
        return Err(format!("{name} wasn't dropped on Misty."));
    }
    let meta =
        file_access::fs::metadata(path).map_err(|_| format!("Misty couldn't open {name}."))?;
    if meta.is_dir() {
        return Err(format!(
            "{name} is a folder. Drop the files inside it instead."
        ));
    }
    if meta.len() > LARGEST {
        return Err(format!("{name} is larger than 10 MB."));
    }
    file_access::fs::read(path).map_err(|_| format!("Misty couldn't read {name}."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_files_that_were_dropped() {
        let dir = std::env::temp_dir().join(format!("misty-drop-{}", std::process::id()));
        file_access::fs::create_dir_all(&dir).unwrap();
        let dropped = dir.join("notes.txt");
        let other = dir.join("secret.txt");
        file_access::fs::write(&dropped, b"hello").unwrap();
        file_access::fs::write(&other, b"nope").unwrap();

        remember(std::slice::from_ref(&dropped));

        assert_eq!(read(&dropped).unwrap(), b"hello");
        assert!(read(&other).unwrap_err().contains("wasn't dropped"));
        remember(std::slice::from_ref(&dir));
        assert!(read(&dir).unwrap_err().contains("folder"));
        let _ = file_access::fs::remove_dir_all(&dir);
    }
}
