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
    child: Mutex<Option<Child>>,
    stdin: Mutex<ChildStdin>,
}

static SESSIONS: OnceLock<Mutex<HashMap<String, Arc<LspSession>>>> = OnceLock::new();

fn sessions() -> &'static Mutex<HashMap<String, Arc<LspSession>>> {
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
    launch_for_app(command, app)
}

fn launch_for_app(command: Command, app: AppHandle) -> Result<String, String> {
    let exit_app = app.clone();
    launch(
        command,
        move |session_id, payload| {
            let _ = app.emit(
                "misty://code-lsp-message",
                LspMessageEvent {
                    session_id,
                    payload,
                },
            );
        },
        {
            let app = exit_app;
            move |session_id, reason| {
                let _ = app.emit("misty://code-lsp-exit", LspExitEvent { session_id, reason });
            }
        },
    )
}

#[cfg(target_os = "macos")]
pub(crate) fn directory_path(directory: &cap_std::fs::Dir) -> Result<String, String> {
    use std::os::fd::AsRawFd;
    let mut bytes = [0 as libc::c_char; libc::PATH_MAX as usize];
    if unsafe { libc::fcntl(directory.as_raw_fd(), libc::F_GETPATH, bytes.as_mut_ptr()) } == -1 {
        return Err("The selected Code folder is unavailable.".into());
    }
    let path = unsafe { std::ffi::CStr::from_ptr(bytes.as_ptr()) }
        .to_str()
        .map_err(|_| "The selected Code folder path is not valid UTF-8.")?;
    Ok(path.to_owned())
}

#[cfg(target_os = "macos")]
fn directory_command(
    language: &str,
    directory: std::sync::Arc<cap_std::fs::Dir>,
) -> Result<Command, String> {
    use std::os::{fd::AsRawFd, unix::process::CommandExt};
    let mut command =
        command_for(language).ok_or("No language server is configured for this language.")?;
    // Use the retained directory descriptor, not a path that could be replaced
    // between permission checking and process launch. fchdir is async-signal-safe.
    unsafe {
        command.pre_exec(move || {
            if libc::fchdir(directory.as_raw_fd()) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    Ok(command)
}

#[cfg(target_os = "macos")]
pub(crate) fn start_in_directory(
    app: AppHandle,
    language: &str,
    directory: std::sync::Arc<cap_std::fs::Dir>,
) -> Result<String, String> {
    launch_for_app(directory_command(language, directory)?, app)
}

#[cfg(all(test, target_os = "macos"))]
pub(crate) fn test_start_in_directory(
    language: &str,
    directory: std::sync::Arc<cap_std::fs::Dir>,
    message: impl Fn(String, String) + Send + 'static,
    exited: impl Fn(String, String) + Send + 'static,
) -> Result<String, String> {
    launch(directory_command(language, directory)?, message, exited)
}

const MAX_MESSAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_HEADER_BYTES: u64 = 8192;

impl LspSession {
    fn stop(&self) {
        if let Ok(mut child) = self.child.lock() {
            if let Some(mut child) = child.take() {
                // Language servers can spawn workers; give each launch a process group.
                #[cfg(unix)]
                unsafe {
                    libc::kill(-(child.id() as i32), libc::SIGKILL);
                }
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}
impl Drop for LspSession {
    fn drop(&mut self) {
        self.stop();
    }
}

fn launch(
    mut command: Command,
    message: impl Fn(String, String) + Send + 'static,
    exited: impl Fn(String, String) + Send + 'static,
) -> Result<String, String> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not launch LSP server: {error}"))?;
    let stdin = child.stdin.take().expect("piped language-server stdin");
    let stdout = child.stdout.take().expect("piped language-server stdout");
    let session = Arc::new(LspSession {
        child: Mutex::new(Some(child)),
        stdin: Mutex::new(stdin),
    });
    let session_id = Uuid::new_v4().to_string();
    // Register before starting the reader: an immediate EOF must remove this entry.
    sessions()
        .lock()
        .map_err(|_| "LSP session registry unavailable.")?
        .insert(session_id.clone(), session.clone());
    let reader_id = session_id.clone();
    let spawn = thread::Builder::new()
        .name("misty-code-lsp".into())
        .spawn(move || {
            let mut reader = BufReader::new(stdout);
            let reason = loop {
                let length = match read_headers(&mut reader) {
                    Ok(Some(length)) => length,
                    Ok(None) => break "Missing language-server content length.",
                    Err(_) => break "Language-server output closed or had invalid framing.",
                };
                let mut body = vec![0; length];
                if reader.read_exact(&mut body).is_err() {
                    break "Language-server output closed.";
                }
                let payload = match String::from_utf8(body) {
                    Ok(payload) => payload,
                    Err(_) => break "Language-server output is not UTF-8.",
                };
                if validate_payload(&payload).is_err() {
                    break "Language-server output is not JSON-RPC.";
                }
                message(reader_id.clone(), payload);
            };
            if let Ok(mut registry) = sessions().lock() {
                registry.remove(&reader_id);
            }
            session.stop();
            exited(reader_id, reason.into());
        });
    if let Err(error) = spawn {
        lsp_stop_blocking(session_id.clone())?;
        return Err(format!("Could not start language-server reader: {error}"));
    }
    Ok(session_id)
}

fn validate_payload(payload: &str) -> Result<(), String> {
    if payload.len() > MAX_MESSAGE_BYTES {
        return Err("Language-server messages are limited to 8 MiB.".into());
    }
    let value: serde_json::Value =
        serde_json::from_str(payload).map_err(|_| "Invalid language-server JSON.")?;
    if value.as_object().is_none() || value.get("jsonrpc").and_then(|v| v.as_str()) != Some("2.0") {
        return Err("Expected a JSON-RPC 2.0 language-server message.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn code_lsp_send(session_id: String, payload: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || lsp_send_blocking(session_id, payload))
        .await
        .map_err(|error| error.to_string())?
}

fn lsp_send_blocking(session_id: String, payload: String) -> Result<(), String> {
    validate_payload(&payload)?;
    let session = {
        let registry = sessions()
            .lock()
            .map_err(|_| "LSP session registry unavailable.".to_owned())?;
        registry.get(&session_id).cloned()
    };
    let session = session.ok_or_else(|| "LSP session is not running.".to_owned())?;
    let mut stdin = session
        .stdin
        .lock()
        .map_err(|_| "LSP session is busy.".to_owned())?;
    let bytes = payload.as_bytes();
    let header = format!("Content-Length: {}\r\n\r\n", bytes.len());
    stdin
        .write_all(header.as_bytes())
        .map_err(|error| error.to_string())?;
    stdin.write_all(bytes).map_err(|error| error.to_string())?;
    stdin.flush().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn code_lsp_stop(session_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || lsp_stop_blocking(session_id))
        .await
        .map_err(|error| error.to_string())?
}

pub(crate) fn lsp_stop_blocking(session_id: String) -> Result<(), String> {
    let session = {
        let mut registry = sessions()
            .lock()
            .map_err(|_| "LSP session registry unavailable.".to_owned())?;
        registry.remove(&session_id)
    };
    let Some(session) = session else {
        return Ok(());
    };
    session.stop();
    Ok(())
}

fn read_headers<R: std::io::BufRead>(reader: &mut R) -> std::io::Result<Option<usize>> {
    use std::io::{BufRead, Error, ErrorKind};
    let invalid = || Error::new(ErrorKind::InvalidData, "Invalid language-server framing.");
    let mut content_length = None;
    let mut remaining = MAX_HEADER_BYTES;
    loop {
        let mut line = String::new();
        // `take` limits allocations even when a server never sends a newline.
        let read = reader.by_ref().take(remaining + 1).read_line(&mut line)? as u64;
        if read == 0 {
            return Err(ErrorKind::UnexpectedEof.into());
        }
        if read > remaining || !line.ends_with("\r\n") {
            return Err(invalid());
        }
        remaining -= read;
        let trimmed = &line[..line.len() - 2];
        if trimmed.is_empty() {
            return content_length.map(Some).ok_or_else(invalid);
        }
        let (name, value) = trimmed.split_once(':').ok_or_else(invalid)?;
        if name.eq_ignore_ascii_case("Content-Length") {
            if content_length.is_some() {
                return Err(invalid());
            }
            let value = value.trim();
            if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
                return Err(invalid());
            }
            let length: usize = value.parse().map_err(|_| invalid())?;
            if length == 0 || length > MAX_MESSAGE_BYTES {
                return Err(invalid());
            }
            content_length = Some(length);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    #[test]
    fn headers_are_bounded_and_require_one_valid_byte_length() {
        assert_eq!(read_headers(&mut Cursor::new(b"content-length: 12\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n")).unwrap(), Some(12));
        for header in [
            "\r\n",
            "Content-Length: 2\r\nContent-Length: 2\r\n\r\n",
            "Content-Length: -1\r\n\r\n",
            "Content-Length: 0\r\n\r\n",
            "Content-Length: 8388609\r\n\r\n",
            "Content-Length: 2\n\n",
        ] {
            assert!(read_headers(&mut Cursor::new(header)).is_err());
        }
        assert!(read_headers(&mut Cursor::new("X".repeat(100_000))).is_err());
    }
    #[test]
    fn messages_require_json_rpc_and_a_byte_bound() {
        assert!(validate_payload(r#"{"jsonrpc":"2.0","method":"initialized"}"#).is_ok());
        for payload in ["[]", "null", "{}", r#"{"jsonrpc":"1.0"}"#, "invalid"] {
            assert!(validate_payload(payload).is_err());
        }
        assert!(validate_payload(&"x".repeat(MAX_MESSAGE_BYTES + 1)).is_err());
    }
    #[test]
    fn immediate_exit_is_removed_and_reaped_before_exit_event() {
        let (send, receive) = std::sync::mpsc::channel();
        let id = launch(
            Command::new("/usr/bin/true"),
            |_, _| {},
            move |id, _| {
                send.send(id).unwrap();
            },
        )
        .unwrap();
        assert_eq!(
            receive
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap(),
            id
        );
        assert!(!sessions().lock().unwrap().contains_key(&id));
        lsp_stop_blocking(id).unwrap();
    }
    #[test]
    fn explicit_stop_terminates_process_and_output_reader() {
        let (send, receive) = std::sync::mpsc::channel();
        let mut command = Command::new("/bin/sleep");
        command.arg("30");
        let id = launch(
            command,
            |_, _| {},
            move |id, _| {
                let _ = send.send(id);
            },
        )
        .unwrap();
        let process = sessions().lock().unwrap()[&id].clone();
        lsp_stop_blocking(id.clone()).unwrap();
        assert!(process.child.lock().unwrap().is_none());
        assert_eq!(
            receive
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap(),
            id
        );
        assert!(
            lsp_send_blocking(id.clone(), r#"{"jsonrpc":"2.0","method":"exit"}"#.into()).is_err()
        );
        lsp_stop_blocking(id).unwrap();
    }
    #[test]
    #[ignore = "Requires the macOS developer-tools clangd; run explicitly for native verification"]
    fn real_clangd_initializes_inspects_and_stops_through_native_runtime() {
        use serde_json::{json, Value};
        let executable = Command::new("xcrun")
            .args(["--find", "clangd"])
            .output()
            .unwrap();
        assert!(executable.status.success());
        let fixture = tempfile::Builder::new()
            .prefix("misty-sdk #? ")
            .tempdir()
            .unwrap();
        let source = fixture.path().join("main.cpp");
        let text = "int answer = 42;\nint main() { return answer; }\n";
        std::fs::write(&source, text).unwrap();
        let uri = url::Url::from_file_path(&source).unwrap().to_string();
        let root_uri = url::Url::from_directory_path(fixture.path())
            .unwrap()
            .to_string();
        let (send, receive) = std::sync::mpsc::channel();
        let mut command = Command::new(String::from_utf8(executable.stdout).unwrap().trim());
        command
            .args([
                "--background-index=false",
                "--pch-storage=memory",
                "--log=error",
            ])
            .current_dir(fixture.path());
        let id = launch(
            command,
            move |_, payload| {
                let _ = send.send(payload);
            },
            |_, _| {},
        )
        .unwrap();
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = lsp_stop_blocking(self.0.clone());
            }
        }
        let cleanup = Cleanup(id.clone());
        let send = |payload: Value| lsp_send_blocking(id.clone(), payload.to_string()).unwrap();
        let reply = |expected: i64| -> Value {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
            loop {
                let payload = receive
                    .recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
                    .unwrap();
                let value: Value = serde_json::from_str(&payload).unwrap();
                if value.get("id").and_then(Value::as_i64) == Some(expected) {
                    return value;
                }
            }
        };
        send(
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":null,"rootUri":root_uri,"capabilities":{}}}),
        );
        assert!(reply(1)["result"]["capabilities"].is_object());
        send(json!({"jsonrpc":"2.0","method":"initialized","params":{}}));
        send(
            json!({"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{"uri":uri,"languageId":"cpp","version":1,"text":text}}}),
        );
        send(
            json!({"jsonrpc":"2.0","id":2,"method":"textDocument/hover","params":{"textDocument":{"uri":uri},"position":{"line":0,"character":5}}}),
        );
        assert!(reply(2)["result"].to_string().contains("answer"));
        drop(cleanup);
        assert!(!sessions().lock().unwrap().contains_key(&id));
    }
}
