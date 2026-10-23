//! Screen recordings the person starts: one display with its sound (and the
//! microphone when asked) written to an .mp4 in Misty's cache. The file is
//! uploaded to the Library by the main window, then removed here.
use serde::Deserialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, Webview};

#[cfg(target_os = "macos")]
mod platform {
    use std::ffi::{c_char, CStr, CString};
    use std::path::Path;
    extern "C" {
        fn MistyScreenRecordStart(
            path: *const c_char,
            display: u32,
            microphone: bool,
            error: *mut c_char,
            length: usize,
        ) -> i32;
        fn MistyScreenRecordStop(seconds: *mut f64, error: *mut c_char, length: usize) -> i32;
    }
    fn failure(buffer: &[u8]) -> String {
        CStr::from_bytes_until_nul(buffer)
            .map(|text| text.to_string_lossy().into_owned())
            .unwrap_or_else(|_| "Recording failed.".into())
    }
    pub fn start(path: &Path, display: Option<u32>, microphone: bool) -> Result<(), String> {
        let path =
            CString::new(path.to_string_lossy().as_bytes()).map_err(|_| "Bad recording path.")?;
        let mut error = [0u8; 512];
        match unsafe {
            MistyScreenRecordStart(
                path.as_ptr(),
                display.unwrap_or(0),
                microphone,
                error.as_mut_ptr().cast(),
                error.len(),
            )
        } {
            0 => Ok(()),
            _ => Err(failure(&error)),
        }
    }
    pub fn stop() -> Result<f64, String> {
        let (mut seconds, mut error) = (0.0, [0u8; 512]);
        match unsafe { MistyScreenRecordStop(&mut seconds, error.as_mut_ptr().cast(), error.len()) }
        {
            0 => Ok(seconds),
            _ => Err(failure(&error)),
        }
    }
}

#[cfg(target_os = "windows")]
use super::recording_windows as platform;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    pub fn start(_: &std::path::Path, _: Option<u32>, _: bool) -> Result<(), String> {
        Err("Recording the screen isn't available on this computer.".into())
    }
    pub fn stop() -> Result<f64, String> {
        Err("Nothing is being recorded.".into())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingRequest {
    /// The display to record; the main display when absent.
    pub display: Option<u32>,
    #[serde(default)]
    pub microphone: bool,
}

fn require_main(webview: &Webview) -> Result<(), String> {
    crate::infra::space_windows::is_person_window(webview.label())
        .then_some(())
        .ok_or_else(|| "Main Misty window required.".into())
}

fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    let folder = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("recordings");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    Ok(folder)
}

/// Only files Misty wrote into its recordings folder may be removed.
fn inside(folder: &Path, path: &Path) -> bool {
    let name_ok = path
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.ends_with(".mp4") && !n.contains(".."));
    name_ok && path.parent() == Some(folder)
}

fn state(app: &AppHandle, recording: bool) {
    let _ = app.emit("misty://recording-state", json!({ "recording": recording }));
}

/// Starts recording; returns the file being written.
#[tauri::command]
pub async fn voice_recording_start(
    webview: Webview,
    app: AppHandle,
    request: RecordingRequest,
) -> Result<String, String> {
    require_main(&webview)?;
    let path = folder(&app)?.join(format!("recording-{}.mp4", chrono_stamp()));
    let target = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        platform::start(&target, request.display, request.microphone)
    })
    .await
    .map_err(|e| e.to_string())??;
    state(&app, true);
    Ok(path.to_string_lossy().into_owned())
}

/// Stops recording and closes the file: {path, seconds, bytes}.
#[tauri::command]
pub async fn voice_recording_stop(
    webview: Webview,
    app: AppHandle,
    path: String,
) -> Result<serde_json::Value, String> {
    require_main(&webview)?;
    let result = tauri::async_runtime::spawn_blocking(platform::stop)
        .await
        .map_err(|e| e.to_string())?;
    state(&app, false);
    let seconds = result?;
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok(json!({ "path": path, "seconds": seconds, "bytes": bytes }))
}

/// Removes a recording once it is in the Library, or when discarded.
#[tauri::command]
pub fn voice_recording_discard(
    webview: Webview,
    app: AppHandle,
    path: String,
) -> Result<(), String> {
    require_main(&webview)?;
    let folder = folder(&app)?;
    let path = PathBuf::from(path);
    if !inside(&folder, &path) {
        return Err("That isn't a Misty recording.".into());
    }
    std::fs::remove_file(path).or_else(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            Ok(())
        } else {
            Err(e.to_string())
        }
    })
}

fn chrono_stamp() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{seconds}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_recordings_in_the_folder_can_be_removed() {
        let folder = Path::new("/cache/recordings");
        assert!(inside(folder, &folder.join("recording-1.mp4")));
        assert!(!inside(
            folder,
            Path::new("/cache/recordings/../secrets.mp4")
        ));
        assert!(!inside(folder, Path::new("/home/me/movie.mp4")));
        assert!(!inside(folder, &folder.join("notes.txt")));
    }
}
