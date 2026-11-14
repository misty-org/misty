//! Short conversations with the person's own `codex app-server`, out of turn: start it, shake
//! hands, make a few calls in order, stop it. A chat's turns each start their own app-server
//! (`codex_app.rs`), so nothing is running between them to ask; a command that reads or changes
//! a thread, the config or the account starts one here instead.
//!
//! [`chat_command`] builds the process exactly as a chat's turn would (the same program, the
//! current channel's flags and env, the person's own variables and provider credentials), so
//! a command sees the threads and settings its turns do. Callers with their own needs (the
//! usage-limits reader) build the command themselves and hand it to [`Session::start`].

use std::collections::VecDeque;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::time::{timeout_at, Instant};

use super::qoder_session::{
    encode_ndjson, jsonrpc_error_response, jsonrpc_id_key, jsonrpc_request,
    JSONRPC_METHOD_NOT_FOUND,
};
use super::{read_line_capped, LineRead};

/// Notifications kept while a call waits for its reply, for a later [`Session::next_notification`].
/// Only the newest are kept: a caller that never reads them must not grow the backlog for ever.
const BACKLOG: usize = 512;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum RpcError {
    /// No Codex CLI could be started on this computer.
    NotInstalled,
    /// Codex answered the call with a JSON-RPC error.
    Refused { code: i64, message: String },
    /// Codex could not be started, stopped before answering, or took too long.
    Failed(String),
}

impl RpcError {
    /// Whether Codex refused because the thread isn't loaded in this process. A thread is
    /// loaded by resuming it; some calls only work on a loaded thread.
    pub(crate) fn thread_not_loaded(&self) -> bool {
        match self {
            Self::Refused { message, .. } => {
                let lower = message.to_ascii_lowercase();
                lower.contains("thread not found") || lower.contains("not loaded")
            }
            _ => false,
        }
    }
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotInstalled => f.write_str("Codex isn't installed on this computer."),
            Self::Refused { message, .. } if !message.trim().is_empty() => {
                f.write_str(message.trim())
            }
            Self::Refused { code, .. } => write!(f, "Codex refused the request ({code})."),
            Self::Failed(reason) => f.write_str(reason),
        }
    }
}

/// The app-server command a chat's turn starts with, working in `folder` (the home folder
/// when the chat has none).
pub(crate) async fn chat_command(folder: Option<&Path>) -> Result<Command, RpcError> {
    let workspace = folder
        .map(Path::to_path_buf)
        .or_else(dirs::home_dir)
        .unwrap_or_default();
    let launch = super::prepare_launch(
        "codex",
        &workspace.to_string_lossy(),
        None,
        String::new(),
        Vec::new(),
        None,
        None,
        None,
        None,
        None,
        Vec::new(),
        None,
        None,
        None,
        Vec::new(),
    )
    .map_err(RpcError::Failed)?;
    let mut command = launch.built.command;
    command.current_dir(&workspace);
    // A turn resolves the provider's credentials just before it spawns; so does this.
    super::codex_provider_env::apply(&mut command).await;
    Ok(command)
}

/// One running app-server, after `initialize`. Dropping it stops the process and everything
/// it started (MCP servers included).
pub(crate) struct Session {
    child: Child,
    pid: Option<u32>,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    line: Vec<u8>,
    next_id: u64,
    deadline: Instant,
    backlog: VecDeque<Value>,
    #[cfg(windows)]
    _tree_guard: Option<std::sync::Arc<super::job::KillOnCloseJob>>,
}

impl Session {
    /// Starts `command` (a complete `codex … app-server` line) and shakes hands. Every call
    /// after this has to be answered within `limit` of now, unless [`Session::allow`] gives more.
    /// `experimental` opts into the app-server's experimental API, which some methods and
    /// fields need.
    pub(crate) async fn start(
        mut command: Command,
        experimental: bool,
        limit: Duration,
    ) -> Result<Self, RpcError> {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(unix)]
        command.process_group(0);
        #[cfg(windows)]
        super::hide_console(&mut command);
        let mut child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                RpcError::NotInstalled
            } else {
                RpcError::Failed(format!("Codex could not be started: {error}"))
            }
        })?;
        #[cfg(windows)]
        let tree_guard = super::job::assign_kill_on_close(&child);
        let pid = child.id();
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            if let Some(pid) = pid {
                super::kill_process_group(pid);
            }
            return Err(RpcError::Failed("Codex has no input or output.".into()));
        };
        let mut session = Self {
            child,
            pid,
            stdin,
            stdout: BufReader::new(stdout),
            line: Vec::new(),
            next_id: 1,
            deadline: Instant::now() + limit,
            backlog: VecDeque::new(),
            #[cfg(windows)]
            _tree_guard: tree_guard,
        };
        session
            .call(
                "initialize",
                super::codex_app::initialize_params(experimental),
            )
            .await?;
        session
            .write(&json!({ "jsonrpc": "2.0", "method": "initialized" }))
            .await?;
        Ok(session)
    }

    /// Gives what follows `limit` from now, for a call that can take long (a turn).
    pub(crate) fn allow(&mut self, limit: Duration) {
        self.deadline = Instant::now() + limit;
    }

    /// Calls `method` and returns its result. Notifications that arrive first are kept for
    /// [`Session::next_notification`]; requests from Codex are declined.
    pub(crate) async fn call(&mut self, method: &str, params: Value) -> Result<Value, RpcError> {
        let id = self.next_id;
        self.next_id += 1;
        self.write(&jsonrpc_request(id, method, params)).await?;
        let key = id.to_string();
        loop {
            let message = self.read().await?;
            if message.get("method").is_some() {
                self.keep(message).await?;
                continue;
            }
            let id = message.get("id").unwrap_or(&Value::Null);
            if jsonrpc_id_key(id).as_deref() != Some(key.as_str()) {
                continue;
            }
            if let Some(error) = message.get("error") {
                return Err(RpcError::Refused {
                    code: error.get("code").and_then(Value::as_i64).unwrap_or(0),
                    message: error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                });
            }
            return Ok(message.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    /// The next notification (`{method, params}`), the kept ones first.
    pub(crate) async fn next_notification(&mut self) -> Result<Value, RpcError> {
        if let Some(message) = self.backlog.pop_front() {
            return Ok(message);
        }
        loop {
            let message = self.read().await?;
            if message.get("method").is_none() {
                continue;
            }
            if message.get("id").is_some_and(|id| !id.is_null()) {
                self.decline(&message).await?;
                continue;
            }
            return Ok(message);
        }
    }

    /// Stops the app-server and everything it started.
    pub(crate) async fn stop(mut self) {
        if let Some(pid) = self.pid.take() {
            super::kill_process_group(pid);
        }
        let _ = tokio::time::timeout(Duration::from_secs(5), self.child.wait()).await;
    }

    /// A notification is kept; a request from Codex (an approval, a question) is declined at
    /// once, since nobody is there to answer it and Codex would wait for ever.
    async fn keep(&mut self, message: Value) -> Result<(), RpcError> {
        if message.get("id").is_some_and(|id| !id.is_null()) {
            return self.decline(&message).await;
        }
        if self.backlog.len() >= BACKLOG {
            self.backlog.pop_front();
        }
        self.backlog.push_back(message);
        Ok(())
    }

    async fn decline(&mut self, request: &Value) -> Result<(), RpcError> {
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        self.write(&jsonrpc_error_response(
            &id,
            JSONRPC_METHOD_NOT_FOUND,
            "Misty can't answer this outside a turn.",
        ))
        .await
    }

    async fn write(&mut self, message: &Value) -> Result<(), RpcError> {
        let stopped = |_| RpcError::Failed("Codex stopped before answering.".into());
        let bytes = encode_ndjson(message).map_err(RpcError::Failed)?;
        self.stdin.write_all(&bytes).await.map_err(stopped)?;
        self.stdin.flush().await.map_err(stopped)
    }

    /// The next JSON message on stdout, skipping anything that isn't JSON.
    async fn read(&mut self) -> Result<Value, RpcError> {
        loop {
            let read = timeout_at(
                self.deadline,
                read_line_capped(&mut self.stdout, &mut self.line),
            )
            .await
            .map_err(|_| RpcError::Failed("Codex didn't answer in time.".into()))?;
            let line = match read {
                Ok(LineRead::Line(line)) => line,
                Ok(LineRead::Eof) | Err(_) => {
                    return Err(RpcError::Failed("Codex stopped before answering.".into()))
                }
                Ok(LineRead::TooLong) => {
                    return Err(RpcError::Failed(
                        "Codex sent an answer too long to read.".into(),
                    ))
                }
            };
            if let Ok(message) = serde_json::from_slice::<Value>(&line) {
                return Ok(message);
            }
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        // An early return (a refused call, a timeout) must not leave the app-server or its MCP
        // servers running; `kill_on_drop` alone only reaches the direct child.
        if let Some(pid) = self.pid.take() {
            super::kill_process_group(pid);
        }
    }
}
