use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    thread,
};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use super::ssh_terminal::{ssh_command_for_connection, SshConnectionRequest};

struct TerminalSession {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

static TERMINAL_SESSIONS: OnceLock<Mutex<HashMap<String, TerminalSession>>> = OnceLock::new();

fn sessions() -> &'static Mutex<HashMap<String, TerminalSession>> {
    TERMINAL_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateRequest {
    pub cwd: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub pixel_width: Option<u16>,
    pub pixel_height: Option<u16>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub environment: Option<TerminalEnvironmentRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TerminalEnvironmentRequest {
    Local,
    Ssh { connection: SshConnectionRequest },
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputEvent {
    session_id: String,
    data: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalExitEvent {
    session_id: String,
    exit_code: Option<u32>,
}

#[tauri::command]
pub async fn terminal_create(
    app: AppHandle,
    request: TerminalCreateRequest,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || terminal_create_blocking(app, request))
        .await
        .map_err(|error| error.to_string())?
}

fn terminal_create_blocking(
    app: AppHandle,
    request: TerminalCreateRequest,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: request.rows.unwrap_or(30).max(2),
            cols: request.cols.unwrap_or(100).max(2),
            pixel_width: request.pixel_width.unwrap_or(0),
            pixel_height: request.pixel_height.unwrap_or(0),
        })
        .map_err(|error| error.to_string())?;

    let is_ssh = matches!(
        request.environment.as_ref(),
        Some(TerminalEnvironmentRequest::Ssh { .. })
    );
    let mut command = match request.environment.as_ref() {
        Some(TerminalEnvironmentRequest::Ssh { connection }) => {
            ssh_command_for_connection(connection)?
        }
        _ => {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_owned());
            let mut local = CommandBuilder::new(&shell);
            // Interactive + login so both `.zprofile` and `.zshrc` run — matches the
            // behavior of Terminal.app / iTerm2 / Kitty.
            local.arg("-il");
            if let Some(cwd) = request
                .cwd
                .as_deref()
                .map(str::trim)
                .filter(|cwd| !cwd.is_empty())
            {
                let path = PathBuf::from(cwd);
                if path.is_dir() {
                    local.cwd(path);
                }
            }
            local
        }
    };
    // Baseline env for a modern xterm.js host — 256-color + true color paths
    // in shell prompts, git, less, bat, etc. rely on TERM and COLORTERM being
    // set. Overrides can still come in via `request.env`.
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env(
        "LANG",
        std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_owned()),
    );
    // Renderer-supplied environment overrides are local-shell only. SSH uses
    // the device process environment so ssh-agent/keychain work, but renderer
    // values can never become remote connection configuration.
    if !is_ssh {
        for (key, value) in request.env.iter() {
            if key.is_empty() {
                continue;
            }
            command.env(key, value);
        }
    }

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let session_id = Uuid::new_v4().to_string();
    let child = Arc::new(Mutex::new(child));
    let session = TerminalSession {
        writer: Arc::new(Mutex::new(writer)),
        master: Arc::new(Mutex::new(pair.master)),
        child: child.clone(),
    };
    sessions()
        .lock()
        .map_err(|_| "Terminal session registry is unavailable.".to_owned())?
        .insert(session_id.clone(), session);

    let reader_session_id = session_id.clone();
    let reader_app = app.clone();
    thread::spawn(move || {
        // Larger buffer keeps big output bursts (fastfetch, cargo build,
        // `git log`) in fewer round-trips.
        let mut buffer = [0_u8; 32 * 1024];
        // Carry-over bytes from the tail of the previous read that formed
        // an incomplete UTF-8 codepoint or terminated inside a multi-byte
        // codepoint. Emitting those as `from_utf8_lossy` would replace with
        // U+FFFD and corrupt cursor-positioning escape sequences the shell
        // relies on for prompt redraws — that was the "prompt drift" bug.
        let mut carry: Vec<u8> = Vec::with_capacity(8);
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let combined: Vec<u8> = if carry.is_empty() {
                        buffer[..read].to_vec()
                    } else {
                        let mut merged = Vec::with_capacity(carry.len() + read);
                        merged.append(&mut carry);
                        merged.extend_from_slice(&buffer[..read]);
                        merged
                    };
                    let payload = extract_valid_utf8(&combined, &mut carry);
                    if payload.is_empty() {
                        continue;
                    }
                    let _ = reader_app.emit(
                        "misty://terminal-output",
                        TerminalOutputEvent {
                            session_id: reader_session_id.clone(),
                            data: payload,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        let exit_code = child
            .lock()
            .ok()
            .and_then(|mut process| process.wait().ok())
            .map(|status| status.exit_code());
        if let Ok(mut registry) = sessions().lock() {
            registry.remove(&reader_session_id);
        }
        let _ = reader_app.emit(
            "misty://terminal-exit",
            TerminalExitEvent {
                session_id: reader_session_id,
                exit_code,
            },
        );
    });

    Ok(session_id)
}

#[tauri::command]
pub async fn terminal_write(session_id: String, data: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || terminal_write_blocking(session_id, data))
        .await
        .map_err(|error| error.to_string())?
}

fn terminal_write_blocking(session_id: String, data: String) -> Result<(), String> {
    let registry = sessions()
        .lock()
        .map_err(|_| "Terminal session registry is unavailable.".to_owned())?;
    let session = registry
        .get(&session_id)
        .ok_or_else(|| "Terminal session is no longer running.".to_owned())?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "Terminal input is unavailable.".to_owned())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn terminal_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    pixel_width: Option<u16>,
    pixel_height: Option<u16>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        terminal_resize_blocking(session_id, cols, rows, pixel_width, pixel_height)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn terminal_resize_blocking(
    session_id: String,
    cols: u16,
    rows: u16,
    pixel_width: Option<u16>,
    pixel_height: Option<u16>,
) -> Result<(), String> {
    let registry = sessions()
        .lock()
        .map_err(|_| "Terminal session registry is unavailable.".to_owned())?;
    let session = registry
        .get(&session_id)
        .ok_or_else(|| "Terminal session is no longer running.".to_owned())?;
    let result = session
        .master
        .lock()
        .map_err(|_| "Terminal resize is unavailable.".to_owned())?
        .resize(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: pixel_width.unwrap_or(0),
            pixel_height: pixel_height.unwrap_or(0),
        })
        .map_err(|error| error.to_string());
    result
}

#[tauri::command]
pub async fn terminal_interrupt(session_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        terminal_write_blocking(session_id, "\u{3}".to_owned())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn terminal_kill(session_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || terminal_kill_blocking(session_id))
        .await
        .map_err(|error| error.to_string())?
}

fn terminal_kill_blocking(session_id: String) -> Result<(), String> {
    let mut registry = sessions()
        .lock()
        .map_err(|_| "Terminal session registry is unavailable.".to_owned())?;
    let Some(session) = registry.remove(&session_id) else {
        return Ok(());
    };
    let result = session
        .child
        .lock()
        .map_err(|_| "Terminal process is unavailable.".to_owned())?
        .kill()
        .map_err(|error| error.to_string());
    result
}

/// Split a byte buffer at the last complete UTF-8 codepoint boundary. Bytes
/// after the boundary are moved into `carry` to be prepended to the next
/// read; the returned `String` contains only fully-valid UTF-8. Genuinely
/// invalid bytes (as opposed to a boundary split) are still lossily decoded
/// so a corrupt stream doesn't stall forever.
fn extract_valid_utf8(bytes: &[u8], carry: &mut Vec<u8>) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_owned(),
        Err(error) => {
            let valid_up_to = error.valid_up_to();
            let head = unsafe {
                // SAFETY: `from_utf8` guarantees `bytes[..valid_up_to]` is
                // valid UTF-8; the Err only tells us the tail is not.
                std::str::from_utf8_unchecked(&bytes[..valid_up_to])
            };
            match error.error_len() {
                None => {
                    // Incomplete codepoint at the very end — carry it over
                    // and only emit the safe prefix.
                    carry.extend_from_slice(&bytes[valid_up_to..]);
                    head.to_owned()
                }
                Some(bad_len) => {
                    // Genuinely invalid bytes in the middle of the stream.
                    // Emit the safe prefix, replace the bad bytes with the
                    // U+FFFD replacement char, then recurse on the tail.
                    let mut out = String::with_capacity(bytes.len());
                    out.push_str(head);
                    out.push('\u{FFFD}');
                    let tail_start = valid_up_to + bad_len;
                    out.push_str(&extract_valid_utf8(&bytes[tail_start..], carry));
                    out
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_registry_starts_empty() {
        assert!(sessions().lock().expect("registry").is_empty());
    }

    #[test]
    fn extract_utf8_passes_ascii_through() {
        let mut carry = Vec::new();
        let out = extract_valid_utf8(b"hello world", &mut carry);
        assert_eq!(out, "hello world");
        assert!(carry.is_empty());
    }

    #[test]
    fn extract_utf8_carries_incomplete_codepoint() {
        let mut carry = Vec::new();
        // "hi ñ" — the ñ is 0xC3 0xB1; feed only the first byte
        let out = extract_valid_utf8(&[b'h', b'i', b' ', 0xC3], &mut carry);
        assert_eq!(out, "hi ");
        assert_eq!(carry, vec![0xC3]);
    }

    #[test]
    fn extract_utf8_completes_across_reads() {
        let mut carry = Vec::new();
        let _ = extract_valid_utf8(&[b'h', b'i', b' ', 0xC3], &mut carry);
        // Second read begins with the completion byte
        let mut merged = Vec::new();
        merged.append(&mut carry);
        merged.extend_from_slice(&[0xB1, b'!']);
        let out = extract_valid_utf8(&merged, &mut carry);
        assert_eq!(out, "ñ!");
        assert!(carry.is_empty());
    }

    #[test]
    fn extract_utf8_replaces_invalid_middle_bytes() {
        let mut carry = Vec::new();
        // 0xFF is never valid in UTF-8 — should be replaced without stalling
        let out = extract_valid_utf8(&[b'a', 0xFF, b'b'], &mut carry);
        assert_eq!(out, "a\u{FFFD}b");
        assert!(carry.is_empty());
    }
}
