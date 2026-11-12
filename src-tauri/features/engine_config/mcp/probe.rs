// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

//! Probing an MCP server: really connect once by its config and do the `initialize` plus
//! `tools/list` handshake. A stdio server is started, and `npx` may download its package on the
//! way. The result only says "Misty can connect and complete the handshake right now", apart from
//! the status a CLI session reported.
//!
//! When it runs (the window's `engine-config/mcp/probe-store.ts`):
//! - The person's own sources (`~/.claude.json`, `~/.codex/config.toml` and similar files):
//!   probed once when the MCP page or `/mcp` panel opens (results kept 3 minutes), or on request;
//! - Workspace sources (`workspace_file`: the config file is in the repository and can arrive
//!   with it): never probed automatically. Before a manual probe `engine_mcp_probe_plan` shows the
//!   person the full command or address to confirm, and `${ENV}` in URLs and headers isn't
//!   expanded.
//!
//! Safety: the command, arguments, environment and headers are always parsed again from the
//! config file (`probe_target`), never taken from the window; the result carries only tool names
//! and an error summary, never a credential.

use super::McpError;
use serde::Serialize;
use serde_json::{json, Value};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, BufReader};

/// A cold stdio start (npx's first download) is much slower than HTTP.
const STDIO_TIMEOUT: Duration = Duration::from_secs(25);
const HTTP_TIMEOUT: Duration = Duration::from_secs(12);
/// The cap on one protocol line, so a server writing logs or large objects to stdout can't use up
/// memory. A valid `tools/list` can be large (139 tools came to about 1.9 MB in one case); the old
/// 1 MiB cap dropped the whole response and the page showed "can't connect".
const MAX_LINE: usize = 64 * 1024 * 1024;
/// The most tool names listed in the details (`tool_count` isn't limited by it).
const MAX_TOOLS: usize = 40;
const CLIENT_NAME: &str = "misty";
const PROTOCOL_VERSION: &str = "2025-06-18";

/// A connection target parsed from config (not redacted; used only here).
#[derive(Debug, Clone, Default)]
pub(crate) struct ProbeTarget {
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: Option<String>,
    pub url: Option<String>,
    pub headers: Vec<(String, String)>,
    /// The transport as written in the config (stdio / http / sse / local / remote / …).
    pub transport: Option<String>,
    /// From a config file inside the workspace (`super::source_in_workspace`): `${ENV}` in URLs
    /// and headers is sent as written, never expanded from this process's environment.
    pub from_workspace: bool,
}

impl ProbeTarget {
    /// How to probe it: stdio / http / unknown.
    pub(crate) fn kind(&self) -> &'static str {
        match self.transport.as_deref().map(str::trim) {
            Some("stdio") | Some("local") => "stdio",
            Some("http") | Some("streamable-http") | Some("sse") | Some("remote") => "http",
            _ if self.command.is_some() => "stdio",
            _ if self.url.is_some() => "http",
            _ => "unknown",
        }
    }

    /// A URL or header value: the person's own config expands `${VAR}` by the CLI's rules; config
    /// from a repository doesn't, or `"url": "https://x/?k=${OPENAI_API_KEY}"` could use a probe
    /// to send the key away.
    fn outbound_value(&self, value: &str) -> String {
        if self.from_workspace {
            value.to_string()
        } else {
            expand_env(value)
        }
    }
}

/// What the person confirms before a workspace source is probed by hand: the full command and
/// address, and only the names of env vars and headers (their values may be keys). The URL is
/// redacted and `${ENV}` isn't expanded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProbePlan {
    /// stdio | http | unknown
    pub kind: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env_keys: Vec<String>,
    pub url: Option<String>,
    pub header_keys: Vec<String>,
    /// Hash of the full target (values included): `mcp_probe` runs a
    /// workspace target only when handed this exact fingerprint, so what
    /// executes is what the user confirmed — not whatever the file says by
    /// the time the click lands (a `git pull` or an agent may rewrite it).
    pub fingerprint: String,
}

fn plan_for(target: &ProbeTarget) -> McpProbePlan {
    McpProbePlan {
        kind: target.kind().to_string(),
        command: target.command.clone(),
        args: target.args.clone(),
        cwd: target.cwd.clone(),
        env_keys: target.env.iter().map(|(key, _)| key.clone()).collect(),
        url: target.url.as_deref().map(super::redact_url),
        header_keys: target.headers.iter().map(|(key, _)| key.clone()).collect(),
        fingerprint: fingerprint(target),
    }
}

fn fingerprint(target: &ProbeTarget) -> String {
    use sha2::{Digest, Sha256};
    let canonical = json!([
        target.kind(),
        target.transport,
        target.command,
        target.args,
        target.cwd,
        target.env,
        target.url,
        target.headers,
    ]);
    let digest = Sha256::digest(canonical.to_string().as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Workspace targets need the fingerprint of the plan the user confirmed;
/// the user's own servers never asked for confirmation.
fn require_confirmed(target: &ProbeTarget, confirmed: Option<&str>) -> Result<(), McpError> {
    if !target.from_workspace || confirmed == Some(fingerprint(target).as_str()) {
        return Ok(());
    }
    Err(McpError::conflict(
        "workspace MCP config changed since it was confirmed; confirm it again",
    ))
}

/// What a probe would run, for confirming first (runs nothing).
#[tauri::command]
pub async fn engine_mcp_probe_plan(
    webview: tauri::Webview,
    request: McpProbeRequest,
) -> Result<McpProbePlan, McpError> {
    super::person_window(&webview)?;
    super::blocking(move || {
        let workspace = super::validate_workspace(request.workspace.as_deref())?;
        let target = super::probe_target(&request.entry_id, workspace.as_deref())?;
        Ok(plan_for(&target))
    })
    .await
}

/// A probe request from the window; the entry id is resolved here to the real command in the config.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProbeRequest {
    pub entry_id: String,
    #[serde(default)]
    pub workspace: Option<String>,
    /// `McpProbePlan.fingerprint` of the plan the user confirmed; required
    /// for workspace sources (see `require_confirmed`).
    #[serde(default)]
    pub plan_fingerprint: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProbeResult {
    /// connected | needs_auth | failed | unsupported
    pub status: String,
    pub message: Option<String>,
    /// Tool names, at most `MAX_TOOLS` (for the details list).
    pub tools: Vec<String>,
    /// How many tools `tools/list` declared, not cut by `MAX_TOOLS`. Counts on the page must use
    /// it (a server may declare 139 while the list shows the first 40).
    pub tool_count: usize,
    pub server_name: Option<String>,
    pub protocol_version: Option<String>,
    pub elapsed_ms: u64,
}

impl McpProbeResult {
    fn failed(message: impl Into<String>) -> Self {
        Self {
            status: "failed".to_string(),
            message: Some(message.into()),
            ..Self::default()
        }
    }
    fn connected() -> Self {
        Self {
            status: "connected".to_string(),
            ..Self::default()
        }
    }
}

impl Default for McpProbeResult {
    fn default() -> Self {
        Self {
            status: "failed".to_string(),
            message: None,
            tools: Vec::new(),
            tool_count: 0,
            server_name: None,
            protocol_version: None,
            elapsed_ms: 0,
        }
    }
}

/// Probes one MCP server: an explicit action, not cached (the window keeps what it shows).
#[tauri::command]
pub async fn engine_mcp_probe(
    webview: tauri::Webview,
    request: McpProbeRequest,
) -> Result<McpProbeResult, McpError> {
    super::person_window(&webview)?;
    let fingerprint = request.plan_fingerprint.clone();
    let target = super::blocking(move || {
        let workspace = super::validate_workspace(request.workspace.as_deref())?;
        super::probe_target(&request.entry_id, workspace.as_deref())
    })
    .await?;
    require_confirmed(&target, fingerprint.as_deref())?;
    Ok(run_probe(&target).await)
}

async fn run_probe(target: &ProbeTarget) -> McpProbeResult {
    let started = Instant::now();
    let mut result = match target.kind() {
        "stdio" => probe_stdio(target).await,
        "http" => probe_http(target).await,
        _ => {
            McpProbeResult::failed("The config has neither a command nor an address to connect to")
        }
    };
    result.elapsed_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
    result
}

// ===== stdio =====

async fn probe_stdio(target: &ProbeTarget) -> McpProbeResult {
    probe_stdio_within(target, STDIO_TIMEOUT).await
}

async fn probe_stdio_within(target: &ProbeTarget, timeout: Duration) -> McpProbeResult {
    let Some(command) = target.command.as_deref() else {
        return McpProbeResult::failed("The config has no command to run");
    };
    let mut cmd = launch_command(command);
    cmd.args(&target.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    // Misty's search PATH (so `npx` and `uvx` are found from a GUI launch) and the proxy from
    // Settings; the entry's own env wins over both.
    cmd.envs(crate::engine_config::support::child_env());
    if let Some(cwd) = target.cwd.as_deref() {
        cmd.current_dir(cwd);
    }
    for (key, value) in &target.env {
        cmd.env(key, expand_env(value));
    }
    // Its own process group: npx / uvx start more children, and the whole group is killed after.
    #[cfg(unix)]
    cmd.process_group(0);
    // Windows: a GUI process starting a console program pops up a visible console (uv.exe,
    // node.exe and cmd.exe are all console programs). stdio is redirected, so the window is only
    // noise, and opening the page probes every stdio server at once.
    #[cfg(windows)]
    crate::engine_config::support::hide_console_tokio(&mut cmd);
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(error) => return McpProbeResult::failed(format!("Couldn't start it: {error}")),
    };
    let pid = child.id().unwrap_or(0);
    let (Some(mut stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        finish_process(pid, &mut child).await;
        return McpProbeResult::failed("Couldn't open the stdio channel");
    };
    let mut reader = LineReader::new(stdout);
    let handshake = tokio::time::timeout(timeout, stdio_handshake(&mut stdin, &mut reader)).await;
    drop(stdin);
    finish_process(pid, &mut child).await;
    match handshake {
        Ok(Ok(result)) => result,
        Ok(Err(message)) => McpProbeResult::failed(message),
        Err(_) => McpProbeResult::failed(format!(
            "Timed out (no handshake within {}s){}",
            timeout.as_secs(),
            overlong_note(&reader)
        )),
    }
}

/// `npx` and friends ship as `.cmd` shims on Windows that CreateProcess can't run by bare name;
/// they're found on Misty's search PATH and wrapped the way the engines are.
pub(crate) fn launch_command(program: &str) -> tokio::process::Command {
    #[cfg(windows)]
    {
        if let Some(path) = crate::engine_config::support::find_program(program) {
            return crate::engines::resolve::command_for(&path);
        }
    }
    tokio::process::Command::new(program)
}

/// Cleanup: kill the whole process group first (grandchildren hold the pipe), then reap the child.
async fn finish_process(pid: u32, child: &mut tokio::process::Child) {
    if pid != 0 {
        crate::engine_config::support::kill_process_group(pid);
    }
    let _ = child.start_kill();
    let _ = child.wait().await;
}

async fn stdio_handshake(
    stdin: &mut tokio::process::ChildStdin,
    reader: &mut LineReader<tokio::process::ChildStdout>,
) -> Result<McpProbeResult, String> {
    write_message(stdin, &initialize_request()).await?;
    let initialized = read_result(reader, 1).await?;
    write_message(stdin, &notification("notifications/initialized")).await?;
    write_message(
        stdin,
        &json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}),
    )
    .await?;
    let tools = read_result(reader, 2).await?;
    Ok(assemble(initialized, tools))
}

async fn write_message(
    stdin: &mut tokio::process::ChildStdin,
    message: &Value,
) -> Result<(), String> {
    let mut text = serde_json::to_string(message).map_err(|error| error.to_string())?;
    text.push('\n');
    use tokio::io::AsyncWriteExt;
    stdin
        .write_all(text.as_bytes())
        .await
        .map_err(|error| format!("Couldn't write to the server: {error}"))?;
    stdin
        .flush()
        .await
        .map_err(|error| format!("Couldn't write to the server: {error}"))
}

/// Reads the child's stdout line by line. One read can bring several lines (a log and a response
/// in the same chunk): what's left stays in the buffer instead of being dropped with the line.
struct LineReader<R> {
    inner: BufReader<R>,
    buffer: Vec<u8>,
    /// The byte cap on one line (without the newline).
    limit: usize,
    /// The current line is too long: drop it up to the next newline.
    dropping: bool,
    /// How many lines were dropped for length, so a failed handshake can give the real reason
    /// instead of an untrue "the server sent no response it understood".
    dropped: usize,
}

impl<R: tokio::io::AsyncRead + Unpin> LineReader<R> {
    fn new(inner: R) -> Self {
        Self::with_limit(inner, MAX_LINE)
    }

    fn with_limit(inner: R, limit: usize) -> Self {
        Self {
            inner: BufReader::new(inner),
            buffer: Vec::new(),
            limit,
            dropping: false,
            dropped: 0,
        }
    }

    /// Reads the next line into `out`; returns the bytes consumed, 0 at EOF.
    async fn next_line(&mut self, out: &mut Vec<u8>) -> std::io::Result<usize> {
        loop {
            if let Some(index) = self.buffer.iter().position(|byte| *byte == b'\n') {
                if self.dropping {
                    self.buffer.drain(..=index);
                    self.dropping = false;
                    return Ok(1);
                }
                out.extend_from_slice(&self.buffer[..index]);
                let consumed = index + 1;
                self.buffer.drain(..consumed);
                return Ok(consumed);
            }
            if self.dropping {
                self.buffer.clear();
            } else if self.buffer.len() > self.limit {
                self.dropping = true;
                self.dropped += 1;
                self.buffer.clear();
            }
            let mut chunk = [0u8; 8192];
            let read = self.inner.read(&mut chunk).await?;
            if read == 0 {
                if self.buffer.is_empty() {
                    return Ok(0);
                }
                out.extend_from_slice(&self.buffer);
                let total = self.buffer.len();
                self.buffer.clear();
                return Ok(total);
            }
            self.buffer.extend_from_slice(&chunk[..read]);
        }
    }
}

/// Reads up to the JSON-RPC response with the matching id, skipping logs and banners the server
/// prints to stdout and unrelated notifications.
async fn read_result<R: tokio::io::AsyncRead + Unpin>(
    reader: &mut LineReader<R>,
    id: i64,
) -> Result<Value, String> {
    let mut line = Vec::new();
    for _ in 0..200 {
        line.clear();
        let read = reader
            .next_line(&mut line)
            .await
            .map_err(|error| format!("Couldn't read the server's output: {error}"))?;
        if read == 0 {
            return Err(format!(
                "The server ended before the handshake finished{}",
                overlong_note(reader)
            ));
        }
        let Ok(text) = std::str::from_utf8(&line) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(text.trim()) else {
            continue;
        };
        if value.get("id").and_then(Value::as_i64) != Some(id) {
            continue;
        }
        if let Some(error) = value.get("error") {
            return Err(rpc_error_message(error));
        }
        return Ok(value.get("result").cloned().unwrap_or(Value::Null));
    }
    Err(format!(
        "The server sent no response Misty recognized{}",
        overlong_note(reader)
    ))
}

/// A note about lines dropped for length, added to the failure, so "the response was too big and
/// was dropped" isn't reported as the misleading "the server sent no response Misty recognized".
fn overlong_note<R: tokio::io::AsyncRead + Unpin>(reader: &LineReader<R>) -> String {
    if reader.dropped == 0 {
        return String::new();
    }
    format!(
        " ({} lines of output were over the {} MiB limit and were dropped)",
        reader.dropped,
        reader.limit / (1024 * 1024)
    )
}

// ===== HTTP / SSE =====

async fn probe_http(target: &ProbeTarget) -> McpProbeResult {
    let Some(url) = target.url.as_deref().map(|url| target.outbound_value(url)) else {
        return McpProbeResult::failed("The config has no server address");
    };
    // The app installs the TLS provider at launch; tests and the lazy proxy may not have.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut builder = reqwest::Client::builder().timeout(HTTP_TIMEOUT);
    if !is_loopback_url(&url) {
        builder = crate::engine_config::proxy::apply_to_client(builder);
    } else {
        // Servers on this computer (Figma, an IDE's built-in MCP and the like) are reached
        // directly: a proxy would turn a request to 127.0.0.1 into a 502 that says nothing about
        // the server.
        builder = builder.no_proxy();
    }
    let client = match builder.build() {
        Ok(client) => client,
        Err(error) => {
            return McpProbeResult::failed(format!("The HTTP client isn't available: {error}"))
        }
    };
    let send = |session: Option<String>, body: Value| {
        let mut request = client
            .post(&url)
            .header(
                reqwest::header::ACCEPT,
                "application/json, text/event-stream",
            )
            .json(&body);
        for (key, value) in &target.headers {
            request = request.header(key, target.outbound_value(value));
        }
        if let Some(session) = session {
            request = request.header("mcp-session-id", session);
        }
        request.send()
    };

    let response = match send(None, initialize_request()).await {
        Ok(response) => response,
        Err(error) => {
            return McpProbeResult::failed(format!("Couldn't connect: {}", error_message(&error)))
        }
    };
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return McpProbeResult {
            status: "needs_auth".to_string(),
            message: Some(format!(
                "The server asks for authentication (HTTP {})",
                status.as_u16()
            )),
            ..McpProbeResult::default()
        };
    }
    if !status.is_success() {
        return McpProbeResult::failed(format!("HTTP {}", status.as_u16()));
    }
    let session = response
        .headers()
        .get("mcp-session-id")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = match response.text().await {
        Ok(body) => body,
        Err(error) => {
            return McpProbeResult::failed(format!("Couldn't read the response: {error}"))
        }
    };
    let initialized = match response_payload(&body, 1) {
        Some(value) => match payload_result(&value) {
            Ok(result) => result,
            Err(message) => return McpProbeResult::failed(message),
        },
        None => {
            return McpProbeResult::failed(
                "The server sent no initialize response Misty recognized",
            )
        }
    };
    let _ = send(session.clone(), notification("notifications/initialized")).await;
    let tools = match send(
        session,
        json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}),
    )
    .await
    {
        Ok(response) if response.status().is_success() => match response.text().await {
            Ok(body) => response_payload(&body, 2)
                .map(|value| payload_result(&value).unwrap_or(Value::Null))
                .unwrap_or(Value::Null),
            Err(error) => {
                return McpProbeResult::failed(format!("Couldn't read the response: {error}"))
            }
        },
        Ok(response) => {
            let code = response.status();
            if code == reqwest::StatusCode::UNAUTHORIZED || code == reqwest::StatusCode::FORBIDDEN {
                return McpProbeResult {
                    status: "needs_auth".to_string(),
                    message: Some(format!(
                        "The server asks for authentication (HTTP {})",
                        code.as_u16()
                    )),
                    ..McpProbeResult::default()
                };
            }
            return McpProbeResult::failed(format!("tools/list returned HTTP {}", code.as_u16()));
        }
        Err(error) => {
            return McpProbeResult::failed(format!("tools/list failed: {}", error_message(&error)))
        }
    };
    if initialized.get("error").is_some() {
        return McpProbeResult::failed(rpc_error_message(&initialized["error"]));
    }
    assemble(initialized, tools)
}

/// The `result` of a JSON-RPC response; one with an `error` is always a failure.
fn payload_result(value: &Value) -> Result<Value, String> {
    if let Some(error) = value.get("error") {
        return Err(rpc_error_message(error));
    }
    Ok(value.get("result").cloned().unwrap_or(Value::Null))
}

fn is_loopback_url(raw: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(raw) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") {
        return true;
    }
    host.parse::<std::net::IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
}

/// The body may be JSON or SSE (`data: {...}`); takes the message with the matching id.
fn response_payload(body: &str, id: i64) -> Option<Value> {
    let trimmed = body.trim();
    if trimmed.starts_with('{') {
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            if value.get("id").and_then(Value::as_i64) == Some(id) {
                return Some(value);
            }
        }
    }
    for line in body.lines() {
        let line = line.trim();
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(data.trim()) else {
            continue;
        };
        if value.get("id").and_then(Value::as_i64) == Some(id) {
            return Some(value);
        }
    }
    None
}

// ===== Shared =====

fn initialize_request() -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": CLIENT_NAME, "version": env!("CARGO_PKG_VERSION") },
        },
    })
}

fn notification(method: &str) -> Value {
    json!({ "jsonrpc": "2.0", "method": method })
}

fn assemble(initialized: Value, tools: Value) -> McpProbeResult {
    let mut result = McpProbeResult::connected();
    result.protocol_version = initialized
        .get("protocolVersion")
        .and_then(Value::as_str)
        .map(str::to_string);
    result.server_name = initialized
        .get("serverInfo")
        .and_then(|info| info.get("name"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let items = tools.get("tools").and_then(Value::as_array);
    result.tool_count = items.map_or(0, Vec::len);
    result.tools = items
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("name").and_then(Value::as_str))
                .take(MAX_TOOLS)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    result
}

fn rpc_error_message(error: &Value) -> String {
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("The server returned an error");
    match error.get("code").and_then(Value::as_i64) {
        Some(code) => format!("{message} (code {code})"),
        None => message.to_string(),
    }
}

fn error_message(error: &reqwest::Error) -> String {
    let detail = error.to_string();
    if error.is_timeout() {
        return "Timed out".to_string();
    }
    // reqwest wraps TCP connect errors in the Request kind, so `is_connect()` isn't always true.
    if error.is_connect() || detail.contains("connect") {
        return "Couldn't connect (the server isn't running or the address can't be reached)"
            .to_string();
    }
    detail
}

/// Expands `${VAR}` / `${VAR:-default}` in config (as the CLIs do); an undefined variable becomes
/// an empty string rather than sending the literal text.
pub(crate) fn expand_env(value: &str) -> String {
    if !value.contains("${") {
        return value.to_string();
    }
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let Some(end) = rest[start..].find('}') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let token = &rest[start + 2..start + end];
        let (name, default) = match token.split_once(":-") {
            Some((name, default)) => (name, Some(default)),
            None => (token, None),
        };
        match std::env::var(name) {
            Ok(resolved) if !resolved.is_empty() => out.push_str(&resolved),
            _ => out.push_str(default.unwrap_or("")),
        }
        rest = &rest[start + end + 1..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests;
