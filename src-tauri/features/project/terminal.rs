// The terminal panel: the person's own shell in a linked folder, on a real pseudo-terminal.
//
// Modelled on desktop-cc-gui's terminal.rs (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{LazyLock, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use tauri::Emitter;

use super::{linked_path, person_window};

const MOST_OPEN: usize = 16;
const OUTPUT: &str = "misty://terminal-output";
const CLOSED: &str = "misty://terminal-closed";

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// The window that opened it, the only one that may write to it.
    window: String,
}

static OPEN: LazyLock<Mutex<HashMap<String, Session>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn open() -> std::sync::MutexGuard<'static, HashMap<String, Session>> {
    OPEN.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn shell() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into())
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into())
    }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.max(2),
        rows: rows.max(2),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Sends what the shell prints to its window, never splitting a character across two messages.
fn pump(app: tauri::AppHandle, window: String, id: String, mut reader: Box<dyn Read + Send>) {
    std::thread::spawn(move || {
        let mut held: Vec<u8> = Vec::new();
        let mut chunk = [0_u8; 8192];
        loop {
            let read = match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(read) => read,
            };
            held.extend_from_slice(&chunk[..read]);
            let whole = match std::str::from_utf8(&held) {
                Ok(_) => held.len(),
                // Bytes that can never be text are passed on as they are; a cut-off character waits.
                Err(error) if error.error_len().is_some() => held.len(),
                Err(error) => error.valid_up_to(),
            };
            if whole == 0 {
                continue;
            }
            let text = String::from_utf8_lossy(&held[..whole]).to_string();
            held.drain(..whole);
            let _ = app.emit_to(window.as_str(), OUTPUT, json!({ "id": id, "data": text }));
        }
        if let Some(mut session) = open().remove(&id) {
            let _ = session.child.kill();
        }
        let _ = app.emit_to(window.as_str(), CLOSED, json!({ "id": id }));
    });
}

/// Opens a terminal in a linked folder. Opening one that is already open changes nothing.
#[tauri::command]
pub async fn project_terminal_open(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    id: String,
    folder: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    person_window(&webview)?;
    let folder = linked_path(&app, &account, &folder).await?;
    if !file_access::fs::is_dir(&folder) {
        return Err("That folder is gone.".into());
    }
    {
        let held = open();
        if held.contains_key(&id) {
            return Ok(());
        }
        if held.len() >= MOST_OPEN {
            return Err("Close a terminal before opening another.".into());
        }
    }
    let pair = native_pty_system()
        .openpty(size(cols, rows))
        .map_err(|error| format!("A terminal could not be opened: {error}"))?;
    let mut command = CommandBuilder::new(shell());
    #[cfg(not(windows))]
    command.arg("-i");
    command.cwd(&folder);
    command.env("PATH", crate::engines::resolve::search_path());
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("The shell could not be started: {error}"))?;
    drop(pair.slave);
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let window = webview.label().to_string();
    open().insert(
        id.clone(),
        Session {
            master: pair.master,
            writer,
            child,
            window: window.clone(),
        },
    );
    pump(app, window, id, reader);
    Ok(())
}

/// Types into a terminal.
#[tauri::command]
pub async fn project_terminal_write(
    webview: tauri::Webview,
    id: String,
    data: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let window = webview.label().to_string();
    tokio::task::spawn_blocking(move || {
        let mut held = open();
        let session = held.get_mut(&id).ok_or("That terminal has closed.")?;
        if session.window != window {
            return Err("That terminal belongs to another window.".to_string());
        }
        session
            .writer
            .write_all(data.as_bytes())
            .and_then(|()| session.writer.flush())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn project_terminal_resize(
    webview: tauri::Webview,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    person_window(&webview)?;
    let held = open();
    let Some(session) = held.get(&id) else {
        return Ok(());
    };
    if session.window != webview.label() {
        return Err("That terminal belongs to another window.".into());
    }
    session
        .master
        .resize(size(cols, rows))
        .map_err(|error| error.to_string())
}

/// Closes a terminal and ends its shell. Closing one that is gone changes nothing.
#[tauri::command]
pub fn project_terminal_close(webview: tauri::Webview, id: String) -> Result<(), String> {
    person_window(&webview)?;
    let mut held = open();
    if held
        .get(&id)
        .is_some_and(|session| session.window != webview.label())
    {
        return Err("That terminal belongs to another window.".into());
    }
    if let Some(mut session) = held.remove(&id) {
        let _ = session.child.kill();
    }
    Ok(())
}

/// Ends every shell, as the app quits.
pub fn close_all() {
    for (_, mut session) in open().drain() {
        let _ = session.child.kill();
    }
}
