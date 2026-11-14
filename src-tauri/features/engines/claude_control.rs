//! A short-lived Claude Code process for the commands Misty runs out of turn (`slash/claude/`).
//! It starts like a turn's (the same program, channel and variables) in the chat's folder,
//! resuming the chat's session, but sends no prompt: Claude Code answers SDK control requests on
//! stdin (`get_status`, `get_context_usage`, `mcp_toggle`, …) without calling the model, and ends
//! when stdin closes. Checked against 2.1.322.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::time::Instant;

use crate::engines::{read_line_capped, BuiltCommand, LineRead, SendRequest};

/// How long one answer may take. Most come within a second, but a fresh process loads its
/// settings, plugins and MCP servers first, and a reconnect waits on the server.
pub(crate) const ANSWER: Duration = Duration::from_secs(60);

/// How long a running process gets to end on its own once stdin closes.
const EXIT: Duration = Duration::from_secs(5);

/// The most of the process's error output kept, for a message when it ends early.
const STDERR_CAP: usize = 64 * 1024;

pub(crate) struct Control {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    line: Vec<u8>,
    next_id: u64,
    stderr: Option<tokio::task::JoinHandle<String>>,
    cleanup: Vec<PathBuf>,
}

impl Control {
    /// Starts Claude Code in `folder`, resuming `session` when there is one. `fork` resumes it
    /// as a new session copied from it (`--fork-session`), which Claude Code writes only once a
    /// message is recorded (`send_text`).
    pub(crate) async fn start(
        folder: &Path,
        session: Option<&str>,
        fork: bool,
    ) -> Result<Self, String> {
        if let Some(session) = session {
            check_session(session)?;
        }
        let built = command(folder, session, fork)?;
        let BuiltCommand {
            mut command,
            cleanup_files,
            ..
        } = built;
        command
            .current_dir(folder)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            // The same search folders a turn gets, so a shebang shim finds its interpreter.
            .env("PATH", crate::engines::resolve::search_path());
        // Its own process group, so a stuck one is ended with its MCP servers.
        #[cfg(unix)]
        command.process_group(0);
        #[cfg(windows)]
        crate::engines::hide_console(&mut command);
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                crate::engines::cleanup_staged_files(&cleanup_files);
                return Err(format!("Couldn't start Claude Code: {error}"));
            }
        };
        let (Some(stdin), Some(stdout), Some(stderr)) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take())
        else {
            let _ = child.start_kill();
            crate::engines::cleanup_staged_files(&cleanup_files);
            return Err("Couldn't talk to Claude Code.".into());
        };
        let stderr = tokio::spawn(async move {
            let mut kept = Vec::new();
            let _ = stderr.take(STDERR_CAP as u64).read_to_end(&mut kept).await;
            String::from_utf8_lossy(&kept).into_owned()
        });
        Ok(Self {
            child,
            stdin: Some(stdin),
            stdout: BufReader::new(stdout),
            line: Vec::new(),
            next_id: 0,
            stderr: Some(stderr),
            cleanup: cleanup_files,
        })
    }

    /// Sends one control request (`{"subtype": …, …}`) and waits up to `wait` for its answer:
    /// the response object (Null when the answer carries none), or Claude Code's error.
    pub(crate) async fn request(
        &mut self,
        request: Value,
        wait: Duration,
    ) -> Result<Value, String> {
        self.next_id += 1;
        let id = format!("misty-{}", self.next_id);
        self.write(&json!({
            "type": "control_request",
            "request_id": id,
            "request": request,
        }))
        .await?;
        let deadline = Instant::now() + wait;
        loop {
            let value = self.next_value(deadline).await?;
            if value.get("type").and_then(Value::as_str) != Some("control_response") {
                continue;
            }
            let response = &value["response"];
            if response.get("request_id").and_then(Value::as_str) != Some(id.as_str()) {
                continue;
            }
            return if response.get("subtype").and_then(Value::as_str) == Some("success") {
                Ok(response.get("response").cloned().unwrap_or(Value::Null))
            } else {
                Err(response
                    .get("error")
                    .and_then(Value::as_str)
                    .filter(|error| !error.trim().is_empty())
                    .unwrap_or("Claude Code couldn't do that.")
                    .to_string())
            };
        }
    }

    /// Sends `text` as a user message and waits for the turn's `result` line. Only for local
    /// commands that run no model turn (`/rename <name>`), which Misty may run on its own.
    pub(crate) async fn send_text(
        &mut self,
        folder: &Path,
        text: &str,
        wait: Duration,
    ) -> Result<Value, String> {
        let message = crate::engines::images::claude_stdin_message(text, &[], folder)?;
        self.write_raw(&message).await?;
        let deadline = Instant::now() + wait;
        loop {
            let value = self.next_value(deadline).await?;
            if value.get("type").and_then(Value::as_str) != Some("result") {
                continue;
            }
            let failed = value.get("is_error").and_then(Value::as_bool) == Some(true);
            let said = value
                .get("result")
                .and_then(Value::as_str)
                .is_some_and(|text| !text.trim().is_empty());
            // A resumed process can first report stopping its predecessor's background task as
            // an empty result (`claude.rs`); the message's own result follows it.
            if failed || said {
                return Ok(value);
            }
        }
    }

    /// Closes stdin, which ends the process, and waits briefly for it.
    pub(crate) async fn finish(mut self) {
        self.stdin.take();
        if tokio::time::timeout(EXIT, self.child.wait()).await.is_err() {
            self.end();
        }
    }

    async fn write(&mut self, value: &Value) -> Result<(), String> {
        self.write_raw(&value.to_string()).await
    }

    async fn write_raw(&mut self, line: &str) -> Result<(), String> {
        let Some(stdin) = self.stdin.as_mut() else {
            return Err("Claude Code isn't listening anymore.".into());
        };
        let mut bytes = line.as_bytes().to_vec();
        bytes.push(b'\n');
        stdin
            .write_all(&bytes)
            .await
            .map_err(|_| "Claude Code stopped before it was asked.".to_string())?;
        stdin.flush().await.map_err(|error| error.to_string())
    }

    /// The next JSON line from stdout. A control request from Claude Code itself (a permission
    /// ask, an MCP elicitation) is refused in place: none should come with no prompt, and an
    /// unanswered one would park the process.
    async fn next_value(&mut self, deadline: Instant) -> Result<Value, String> {
        loop {
            let read = tokio::time::timeout_at(
                deadline,
                read_line_capped(&mut self.stdout, &mut self.line),
            )
            .await
            .map_err(|_| "Claude Code didn't answer in time.".to_string())?
            .map_err(|error| error.to_string())?;
            let bytes = match read {
                LineRead::Line(bytes) => bytes,
                LineRead::Eof => return Err(self.ended().await),
                LineRead::TooLong => return Err("Claude Code's answer was too long.".into()),
            };
            let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
                continue;
            };
            if value.get("type").and_then(Value::as_str) == Some("control_request") {
                if let Some(id) = value.get("request_id").and_then(Value::as_str) {
                    let refusal = json!({
                        "type": "control_response",
                        "response": {
                            "subtype": "error",
                            "request_id": id,
                            "error": "Misty is only reading this session.",
                        },
                    });
                    self.write(&refusal).await?;
                }
                continue;
            }
            return Ok(value);
        }
    }

    /// Why the process ended before answering, from the last of its error output.
    async fn ended(&mut self) -> String {
        let said = match self.stderr.take() {
            Some(task) => tokio::time::timeout(Duration::from_secs(2), task)
                .await
                .ok()
                .and_then(Result::ok)
                .unwrap_or_default(),
            None => String::new(),
        };
        match said
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .last()
        {
            Some(line) => format!(
                "Claude Code stopped: {}",
                line.chars().take(300).collect::<String>()
            ),
            None => "Claude Code stopped before answering.".into(),
        }
    }

    /// Ends the process and everything it started.
    fn end(&mut self) {
        if let Some(pid) = self.child.id() {
            crate::engines::kill_process_group(pid);
        }
        let _ = self.child.start_kill();
    }
}

impl Drop for Control {
    fn drop(&mut self) {
        if matches!(self.child.try_wait(), Ok(None)) {
            self.end();
        }
        crate::engines::cleanup_staged_files(&std::mem::take(&mut self.cleanup));
    }
}

/// Sends one request in a process of its own.
pub(crate) async fn ask(
    folder: &Path,
    session: Option<&str>,
    request: Value,
    wait: Duration,
) -> Result<Value, String> {
    let mut control = Control::start(folder, session, false).await?;
    let answer = control.request(request, wait).await;
    control.finish().await;
    answer
}

/// A session id is passed on the command line, so it must read as one and never as a flag.
fn check_session(session: &str) -> Result<(), String> {
    let fine = !session.is_empty()
        && session.len() <= 128
        && !session.starts_with('-')
        && session
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if fine {
        Ok(())
    } else {
        Err("This chat's Claude Code session isn't one Misty can open.".into())
    }
}

/// Claude Code's command line for a control-only process, set up the way `prepare_launch`
/// sets up a turn: the program from Settings, the person's own variables, the chosen channel
/// (its variables and settings overlay) and the device's default model, so `/status` and
/// `/context` describe what the next turn runs on.
fn command(folder: &Path, session: Option<&str>, fork: bool) -> Result<BuiltCommand, String> {
    let provider = crate::engines::support::config::resolve_provider("claude", None)?;
    let mut channel_env = match provider.as_ref() {
        Some(provider) => crate::engines::support::provider_files::channel_env("claude", provider)?,
        None => HashMap::new(),
    };
    channel_env.extend(crate::engines::channels::env_for("claude"));
    let env = {
        let mut env = crate::engine_config::engine_env::env_for("claude")?;
        env.extend(channel_env);
        env
    };
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let model = settings
        .default_models
        .get("claude")
        .filter(|model| !model.trim().is_empty())
        .cloned();
    let model =
        crate::engines::claude_channel::resolve_model(model.as_deref(), provider.as_ref(), &env);
    let bin = crate::engines::engine_bin(&settings, "claude");
    let mut command = crate::engines::command_for_binary(&bin);
    command.args([
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
    ]);
    if let Some(model) = model.as_deref() {
        command.arg("--model").arg(model);
    }
    if let Some(session) = session {
        command.arg("--resume").arg(session);
        if fork {
            command.arg("--fork-session");
        }
    }
    for (key, value) in &env {
        command.env(key, value);
    }
    let mut built = BuiltCommand {
        command,
        stdin_payload: None,
        keep_stdin_open: true,
        cleanup_files: Vec::new(),
        preassigned_session_id: None,
    };
    if let Some(provider) = provider.as_ref() {
        let req = SendRequest {
            session_id: session.map(str::to_string),
            workspace: folder.to_path_buf(),
            prompt: String::new(),
            prompt_contributions: Vec::new(),
            native_compact: false,
            images: Vec::new(),
            model,
            effort: None,
            service_tier: None,
            permission: None,
            additional_dirs: Vec::new(),
            provider_id: None,
            mcp_servers: None,
            allowed_tools: None,
        };
        if let Err(error) = crate::engines::claude_channel::apply(&mut built, provider, &env, &req)
        {
            crate::engines::cleanup_staged_files(&built.cleanup_files);
            return Err(error);
        }
    }
    Ok(built)
}
