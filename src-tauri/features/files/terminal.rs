use std::path::Path;

use super::listing::io_text;
use super::{asked_path, blocking, failed, gated, person_window};

#[tauri::command]
pub async fn files_open_terminal(webview: tauri::Webview, path: String) -> Result<(), String> {
    person_window(&webview)?;
    let path = asked_path(&path)?;
    blocking(move || {
        let meta = gated::stat(&path).map_err(|error| failed(&path, io_text(&error)))?;
        if !meta.is_dir() {
            return Err(failed(&path, "A terminal opens only in a folder."));
        }
        open_terminal(&path)
    })
    .await
}

#[cfg(target_os = "macos")]
fn open_terminal(path: &Path) -> Result<(), String> {
    let status = std::process::Command::new("/usr/bin/open")
        .arg("-a")
        .arg("Terminal")
        .arg(path)
        .stdin(std::process::Stdio::null())
        .status()
        .map_err(|error| failed(path, error))?;
    if status.success() {
        Ok(())
    } else {
        Err(failed(path, "The terminal couldn't open there."))
    }
}

#[cfg(target_os = "windows")]
fn open_terminal(path: &Path) -> Result<(), String> {
    if std::process::Command::new("wt.exe")
        .arg("-d")
        .arg(path)
        .spawn()
        .is_ok()
    {
        return Ok(());
    }
    std::process::Command::new("cmd.exe")
        .args(["/c", "start", "cmd.exe"])
        .current_dir(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| failed(path, error))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_terminal(path: &Path) -> Result<(), String> {
    for terminal in [
        "x-terminal-emulator",
        "gnome-terminal",
        "konsole",
        "xfce4-terminal",
        "xterm",
    ] {
        if std::process::Command::new(terminal)
            .current_dir(path)
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
    }
    Err(failed(path, "No terminal app was found."))
}
