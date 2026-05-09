use std::{
    collections::HashMap,
    io::{BufReader, Read, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
    thread,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

struct LspSession {
    child: Child,
    stdin: ChildStdin,
}

static SESSIONS: OnceLock<Mutex<HashMap<String, Arc<Mutex<LspSession>>>>> = OnceLock::new();

fn sessions() -> &'static Mutex<HashMap<String, Arc<Mutex<LspSession>>>> {
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspStartRequest {
    pub language: String,
    pub cwd: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LspMessageEvent {
    session_id: String,
    payload: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LspExitEvent {
    session_id: String,
    reason: String,
}

fn command_for(language: &str) -> Option<Command> {
    let mut cmd = match language {
        "typescript" | "ts" | "tsx" | "javascript" | "js" | "jsx" => {
            let mut command = Command::new("typescript-language-server");
            command.arg("--stdio");
            command
        }
        "rust" | "rs" => Command::new("rust-analyzer"),
        "python" | "py" => {
            let mut command = Command::new("pyright-langserver");
            command.arg("--stdio");
            command
        }
        "go" | "golang" => Command::new("gopls"),
        "c" | "cpp" | "cxx" | "h" | "hpp" => Command::new("clangd"),
        "yaml" | "yml" => {
            let mut command = Command::new("yaml-language-server");
            command.arg("--stdio");
            command
        }
        "json" | "jsonc" => {
            let mut command = Command::new("vscode-json-language-server");
            command.arg("--stdio");
            command
        }
        "html" | "htm" => {
            let mut command = Command::new("vscode-html-language-server");
            command.arg("--stdio");
            command
        }
        "css" | "scss" | "less" => {
            let mut command = Command::new("vscode-css-language-server");
            command.arg("--stdio");
            command
        }
        "sh" | "bash" | "zsh" | "shell" => {
            let mut command = Command::new("bash-language-server");
            command.arg("start");
            command
        }
        "lua" => Command::new("lua-language-server"),
        "zig" => Command::new("zls"),
        "tailwind" | "tailwindcss" => {
            let mut command = Command::new("tailwindcss-language-server");
            command.arg("--stdio");
            command
        }
        _ => return None,
    };

    if let Ok(current_path) = std::env::var("PATH") {
        let home = std::env::var("HOME").unwrap_or_default();
        let extra_dirs = [
            "/opt/homebrew/bin".to_string(),
            "/usr/local/bin".to_string(),
            format!("{home}/.cargo/bin"),
            format!("{home}/go/bin"),
            format!("{home}/.local/bin"),
        ];
        let mut paths: Vec<String> = current_path.split(':').map(|s| s.to_string()).collect();
        for dir in extra_dirs {
            if !dir.is_empty() && !paths.contains(&dir) && std::path::Path::new(&dir).is_dir() {
                paths.insert(0, dir);
            }
        }
        cmd.env("PATH", paths.join(":"));
    }

    Some(cmd)
}

#[tauri::command]
pub async fn code_lsp_start(app: AppHandle, request: LspStartRequest) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || lsp_start_blocking(app, request))
        .await
        .map_err(|error| error.to_string())?
}

fn lsp_start_blocking(app: AppHandle, request: LspStartRequest) -> Result<String, String> {
    let mut command = command_for(&request.language)
        .ok_or_else(|| format!("No LSP server configured for '{}'.", request.language))?;
    if let Some(cwd) = request.cwd.as_deref().filter(|value| !value.is_empty()) {
        command.current_dir(cwd);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not launch LSP server: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "LSP server has no stdin.".to_owned())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "LSP server has no stdout.".to_owned())?;

    let session_id = Uuid::new_v4().to_string();
    let reader_session_id = session_id.clone();
    let reader_app = app.clone();

    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let content_length = match read_headers(&mut reader) {
                Ok(length) => length,
                Err(_) => break,
            };
            let Some(content_length) = content_length else {
                continue;
            };
            let mut body = vec![0u8; content_length];
            if reader.read_exact(&mut body).is_err() {
                break;
            }
            let payload = match String::from_utf8(body) {
                Ok(text) => text,
                Err(_) => continue,
            };
            let _ = reader_app.emit(
                "misty://code-lsp-message",
                LspMessageEvent {
                    session_id: reader_session_id.clone(),
                    payload,
                },
            );
        }
        if let Ok(mut registry) = sessions().lock() {
            registry.remove(&reader_session_id);
        }
        let _ = reader_app.emit(
            "misty://code-lsp-exit",
            LspExitEvent {
                session_id: reader_session_id,
                reason: "stdout closed".to_owned(),
            },
        );
    });

    let session = LspSession { child, stdin };
    sessions()
        .lock()
        .map_err(|_| "LSP session registry unavailable.".to_owned())?
        .insert(session_id.clone(), Arc::new(Mutex::new(session)));

    Ok(session_id)
}

#[tauri::command]
pub async fn code_lsp_send(session_id: String, payload: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || lsp_send_blocking(session_id, payload))
        .await
        .map_err(|error| error.to_string())?
}

fn lsp_send_blocking(session_id: String, payload: String) -> Result<(), String> {
    let session = {
        let registry = sessions()
            .lock()
            .map_err(|_| "LSP session registry unavailable.".to_owned())?;
        registry.get(&session_id).cloned()
    };
    let session = session.ok_or_else(|| "LSP session is not running.".to_owned())?;
    let mut session = session
        .lock()
        .map_err(|_| "LSP session is busy.".to_owned())?;
    let bytes = payload.as_bytes();
    let header = format!("Content-Length: {}\r\n\r\n", bytes.len());
    session
        .stdin
        .write_all(header.as_bytes())
        .map_err(|error| error.to_string())?;
    session
        .stdin
        .write_all(bytes)
        .map_err(|error| error.to_string())?;
    session.stdin.flush().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn code_lsp_stop(session_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || lsp_stop_blocking(session_id))
        .await
        .map_err(|error| error.to_string())?
}

fn lsp_stop_blocking(session_id: String) -> Result<(), String> {
    let session = {
        let mut registry = sessions()
            .lock()
            .map_err(|_| "LSP session registry unavailable.".to_owned())?;
        registry.remove(&session_id)
    };
    let Some(session) = session else {
        return Ok(());
    };
    if let Ok(mut session) = session.lock() {
        let _ = session.child.kill();
    }
    Ok(())
}

fn read_headers<R: std::io::BufRead>(reader: &mut R) -> std::io::Result<Option<usize>> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line)?;
        if read == 0 {
            return Err(std::io::Error::from(std::io::ErrorKind::UnexpectedEof));
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            return Ok(content_length);
        }
        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            content_length = value.trim().parse().ok();
        }
    }
}
