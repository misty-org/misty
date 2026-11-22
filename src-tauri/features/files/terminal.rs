//! Kura's terminal button: the system terminal opened in the folder Files shows.

use std::path::Path;

use file_access::disk::check_disk;
use file_access::Access;

use super::listing::io_text;
use super::{asked_path, blocking, failed, person_window};

/// Opens the system terminal in a folder: Terminal on macOS, Windows Terminal (else a command
/// prompt) on Windows, the first of the usual terminals on Linux.
#[tauri::command]
pub async fn files_open_terminal(webview: tauri::Webview, path: String) -> Result<(), String> {
    person_window(&webview)?;
    let path = asked_path(&path)?;
    blocking(move || {
        check_disk(&path, Access::Read).map_err(|error| failed(&path, io_text(&error)))?;
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
