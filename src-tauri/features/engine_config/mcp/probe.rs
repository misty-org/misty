// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

use super::McpError;
use serde::Serialize;
use serde_json::{json, Value};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, BufReader};

const STDIO_TIMEOUT: Duration = Duration::from_secs(25);
const HTTP_TIMEOUT: Duration = Duration::from_secs(12);
const MAX_LINE: usize = 64 * 1024 * 1024;
const MAX_TOOLS: usize = 40;
const CLIENT_NAME: &str = "misty";
const PROTOCOL_VERSION: &str = "2025-06-18";

#[derive(Debug, Clone, Default)]
pub(crate) struct ProbeTarget {
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: Option<String>,
    pub url: Option<String>,
    pub headers: Vec<(String, String)>,
    pub transport: Option<String>,
    pub from_workspace: bool,
}

impl ProbeTarget {
    pub(crate) fn kind(&self) -> &'static str {
        match self.transport.as_deref().map(str::trim) {
            Some("stdio") | Some("local") => "stdio",
            Some("http") | Some("streamable-http") | Some("sse") | Some("remote") => "http",
            _ if self.command.is_some() => "stdio",
            _ if self.url.is_some() => "http",
            _ => "unknown",
        }
    }

    fn outbound_value(&self, value: &str) -> String {
        if self.from_workspace {
            value.to_string()
        } else {
            expand_env(value)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProbePlan {
    pub kind: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env_keys: Vec<String>,
    pub url: Option<String>,
    pub header_keys: Vec<String>,
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

fn require_confirmed(target: &ProbeTarget, confirmed: Option<&str>) -> Result<(), McpError> {
    if !target.from_workspace || confirmed == Some(fingerprint(target).as_str()) {
        return Ok(());
    }
    Err(McpError::conflict(
        "workspace MCP config changed since it was confirmed; confirm it again",
    ))
}

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

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProbeRequest {
    pub entry_id: String,
    #[serde(default)]
    pub workspace: Option<String>,
    #[serde(default)]
    pub plan_fingerprint: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProbeResult {
    pub status: String,
    pub message: Option<String>,
    pub tools: Vec<String>,
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
    cmd.envs(crate::engine_config::support::child_env());
    if let Some(cwd) = target.cwd.as_deref() {
        cmd.current_dir(cwd);
    }
    for (key, value) in &target.env {
        cmd.env(key, expand_env(value));
    }
    #[cfg(unix)]
    cmd.process_group(0);
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

pub(crate) fn launch_command(program: &str) -> tokio::process::Command {
    #[cfg(windows)]
    {
        if let Some(path) = crate::engine_config::support::find_program(program) {
            return crate::engines::resolve::command_for(&path);
        }
    }
    tokio::process::Command::new(program)
}

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

struct LineReader<R> {
    inner: BufReader<R>,
    buffer: Vec<u8>,
    limit: usize,
    dropping: bool,
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

async fn probe_http(target: &ProbeTarget) -> McpProbeResult {
    let Some(url) = target.url.as_deref().map(|url| target.outbound_value(url)) else {
        return McpProbeResult::failed("The config has no server address");
    };
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut builder = reqwest::Client::builder().timeout(HTTP_TIMEOUT);
    if !is_loopback_url(&url) {
        builder = crate::engine_config::proxy::apply_to_client(builder);
    } else {
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
    if error.is_connect() || detail.contains("connect") {
        return "Couldn't connect (the server isn't running or the address can't be reached)"
            .to_string();
    }
    detail
}

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
