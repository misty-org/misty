// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/dsh_host.rs.
//! DeepSeek Harness (DSH) local-host maintenance: probe/adopt/spawn/stop the
//! `dsh web` server. CLI version/update lives in [`crate::engines::support::cli_lifecycle`].
//!
//! Wire protocol (0.1.2+ typert gateway, verified against tmd-cli's cli-dsh):
//! `POST {origin}/api/<namespace>/<method>` with
//! `{type:"client-request",rpcId,method,payload:{args}}` →
//! `{type:"server-response",rpcId,result:{ok:true,value}|{ok:false,error}}`.
//!
//! BrowserAuth (0.1.2+): every RPC requires the signed `dsh-auth-*` cookie.
//! Credential chain: the spawned host prints a one-time launch token
//! (`dsh web: http://…/?token=…`) on its output; we capture it, exchange it
//! via `GET /?token=…` (303 + set-cookie, no redirects), and persist the
//! cookie per-origin in DSH's own engine folder, `~/.misty/shared/engines/dsh/host-credentials.json`,
//! which goes when DSH is removed. The cookie
//! rides only on requests to the origin of the child this run spawned
//! ([`TRUSTED_ORIGIN`]); anything else answering on the port never sees it.
//!
//! Ownership rule: only the `dsh web` child we spawned is tracked in
//! [`DshHostState`], restarted and killed (app exit / dsh_host_stop). A host
//! answering describe without our credentials is adopted as-is; anything else
//! on the port — a 401, a different HTTP service — is reported as "port
//! occupied" and left running. CC GUI never looks up and kills whatever
//! listens on a port: v1.2.0 did (`netstat` + `taskkill /T /F`, `lsof` +
//! `kill -KILL`) on every launch and took down other apps' services on 3080.
//! The one exception is Misty's own leftover: a `dsh web` serving this very
//! port from a `dsh` inside Misty's data root (`~/.misty`), which an earlier
//! session started and never stopped (it quit or crashed first). Its cookie
//! is gone with that session, so it answers 401 and would hold the port for
//! good; [`stop_own_leftover`] stops it, and only it.

use file_access::fs::{File, OpenOptions};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Child;
use tokio::time::{sleep, Instant};

use crate::engines::support::settings::AppSettings;
use crate::engines::{command_for_binary, resolve};

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 3080;
const DESCRIBE_METHOD: &str = "settings/describe";
const DESCRIBE_CONNECT_TIMEOUT: Duration = Duration::from_millis(800);
const DESCRIBE_TOTAL_TIMEOUT: Duration = Duration::from_secs(3);
const SPAWN_POLL_INTERVAL: Duration = Duration::from_millis(250);
#[cfg(windows)]
const SPAWN_READY_TIMEOUT: Duration = Duration::from_secs(45);
#[cfg(not(windows))]
const SPAWN_READY_TIMEOUT: Duration = Duration::from_secs(20);
const RING_CAP: usize = 8192;
const LOG_DIR: &str = "host-logs";
const LOG_MAX_BYTES: u64 = 4 * 1024 * 1024;
const LOG_KEEP_SUFFIX: &str = ".1";
const LOG_KEEP_RUNS: usize = 8;
const TOKEN_EXCHANGE_ATTEMPTS: usize = 6;
const TOKEN_EXCHANGE_RETRY_INTERVAL: Duration = Duration::from_millis(400);
const TOKEN_REEXCHANGE_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Default)]
pub struct DshHostState {
    spawned: Mutex<Option<Spawned>>,
    ensure: tokio::sync::Mutex<()>,
}

struct Spawned {
    child: Child,
    origin: String,
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    exit_watcher: Option<crate::agents::shell::exit_watcher::ExitWatcher>,
    #[cfg(windows)]
    _tree_guard: Option<std::sync::Arc<crate::engines::job::KillOnCloseJob>>,
}

impl Drop for Spawned {
    fn drop(&mut self) {
        distrust_origin(&self.origin);
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if let Some(watcher) = self.exit_watcher.take() {
            watcher.stop_now();
        }
        if let Some(pid) = self.child.id() {
            crate::engines::kill_process_group(pid);
        }
        let _ = self.child.start_kill();
    }
}

impl DshHostState {
    pub fn kill_spawned(&self) -> bool {
        let mut guard = lock(&self.spawned);
        guard.take().is_some()
    }

    fn reap_exited(&self) {
        let mut guard = lock(&self.spawned);
        let exited = guard
            .as_mut()
            .is_some_and(|spawned| !matches!(spawned.child.try_wait(), Ok(None)));
        if exited {
            guard.take();
        }
    }

    fn spawned_origin(&self) -> Option<String> {
        lock(&self.spawned)
            .as_ref()
            .map(|spawned| spawned.origin.clone())
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

static TRUSTED_ORIGIN: Mutex<Option<String>> = Mutex::new(None);

fn origin_trusted(origin: &str) -> bool {
    lock(&TRUSTED_ORIGIN).as_deref() == Some(origin)
}

fn distrust_origin(origin: &str) {
    let mut trusted = lock(&TRUSTED_ORIGIN);
    if trusted.as_deref() == Some(origin) {
        *trusted = None;
    }
}

struct PendingTrust {
    origin: String,
    kept: bool,
}

impl PendingTrust {
    fn grant(origin: &str) -> Self {
        *lock(&TRUSTED_ORIGIN) = Some(origin.to_string());
        Self {
            origin: origin.to_string(),
            kept: false,
        }
    }

    fn keep(mut self) {
        self.kept = true;
    }

    fn withdraw(&self) {
        distrust_origin(&self.origin);
    }
}

impl Drop for PendingTrust {
    fn drop(&mut self) {
        if !self.kept {
            distrust_origin(&self.origin);
        }
    }
}

struct HostConfig {
    host: String,
    port: u16,
    origin: String,
    auto_start: bool,
}

impl HostConfig {
    fn from(settings: &AppSettings) -> Self {
        let host = settings
            .dsh_host
            .as_deref()
            .map(str::trim)
            .filter(|h| !h.is_empty())
            .unwrap_or(DEFAULT_HOST)
            .to_string();
        let port = settings.dsh_port.filter(|p| *p > 0).unwrap_or(DEFAULT_PORT);
        let origin = format!("http://{host}:{port}");
        let auto_start = settings.dsh_auto_start != Some(false);
        Self {
            host,
            port,
            origin,
            auto_start,
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DshHostStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub host: String,
    pub port: u16,
    pub origin: String,
    pub auto_start: bool,
    pub running: bool,
    pub ownership: Option<&'static str>,
    pub describe: Option<Value>,
    pub web_url: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OkResult {
    pub ok: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct HostCredentials {
    cookie: String,
    launch_token: String,
}

fn credentials_path() -> PathBuf {
    dsh_home().join("host-credentials.json")
}

fn dsh_home() -> PathBuf {
    let engines = crate::engines::support::paths::app_home();
    let home = engines.join("dsh");
    let _ = file_access::fs::create_dir_all(&home);
    for (before, now) in [
        ("dsh-host-credentials.json", "host-credentials.json"),
        ("dsh-host-logs", LOG_DIR),
    ] {
        let (from, to) = (engines.join(before), home.join(now));
        if file_access::fs::exists(&from) && !file_access::fs::exists(&to) {
            let _ = file_access::fs::rename(&from, &to);
        }
    }
    home
}

fn load_credentials(origin: &str) -> Option<HostCredentials> {
    let text = file_access::fs::read_to_string(credentials_path()).ok()?;
    let map: BTreeMap<String, HostCredentials> = serde_json::from_str(&text).ok()?;
    map.get(origin).cloned()
}

fn store_credentials(origin: &str, credentials: HostCredentials) {
    let mut map: BTreeMap<String, HostCredentials> =
        file_access::fs::read_to_string(credentials_path())
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
    map.insert(origin.to_string(), credentials);
    match serde_json::to_string_pretty(&map) {
        Ok(content) => {
            if let Err(error) =
                crate::engines::support::settings::atomic_write(&credentials_path(), &content)
            {
                eprintln!("[dsh] persisting host credentials failed: {error}");
            }
        }
        Err(error) => eprintln!("[dsh] serializing host credentials failed: {error}"),
    }
}

fn extract_launch_token(line: &str) -> Option<String> {
    const NEEDLE: &str = "token=";
    let bytes = line.as_bytes();
    let mut from = 0;
    while let Some(rel) = line[from..].find(NEEDLE) {
        let at = from + rel;
        from = at + NEEDLE.len();
        if at > 0 && !matches!(bytes[at - 1], b'?' | b'&') {
            continue;
        }
        let rest = &line[from..];
        let end = rest
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-'))
            .unwrap_or(rest.len());
        if end > 0 {
            return Some(rest[..end].to_string());
        }
    }
    None
}

struct TokenCapture {
    origin: String,
    token: Mutex<Option<String>>,
    busy: AtomicBool,
}

impl TokenCapture {
    async fn capture(self: &Arc<Self>, line: &str) {
        if self.busy.swap(true, Ordering::Relaxed) {
            return;
        }
        let Some(token) = extract_launch_token(line) else {
            self.busy.store(false, Ordering::Relaxed);
            return;
        };
        *lock(&self.token) = Some(token);
        self.exchange_until_stored().await;
    }

    async fn reexchange_stored(self: &Arc<Self>) {
        if self.busy.swap(true, Ordering::Relaxed) {
            return;
        }
        if lock(&self.token).is_none() {
            self.busy.store(false, Ordering::Relaxed);
            return;
        }
        self.exchange_until_stored().await;
    }

    async fn exchange_until_stored(self: &Arc<Self>) {
        let token = lock(&self.token).clone();
        let Some(token) = token else {
            self.busy.store(false, Ordering::Relaxed);
            return;
        };
        for _ in 0..TOKEN_EXCHANGE_ATTEMPTS {
            if let Some(cookie) = exchange_token(&self.origin, &token).await {
                store_credentials(
                    &self.origin,
                    HostCredentials {
                        cookie,
                        launch_token: token,
                    },
                );
                return;
            }
            sleep(TOKEN_EXCHANGE_RETRY_INTERVAL).await;
        }
        eprintln!("[dsh] launch token exchange failed; keeping probe-driven fallback");
        self.busy.store(false, Ordering::Relaxed);
    }
}

fn http_client(origin: &str) -> &'static reqwest::Client {
    static LOCAL: LazyLock<reqwest::Client> = LazyLock::new(|| {
        reqwest::Client::builder()
            .connect_timeout(DESCRIBE_CONNECT_TIMEOUT)
            .timeout(DESCRIBE_TOTAL_TIMEOUT)
            .no_proxy()
            .build()
            .expect("reqwest client")
    });
    static REMOTE: LazyLock<reqwest::Client> = LazyLock::new(|| {
        reqwest::Client::builder()
            .connect_timeout(DESCRIBE_CONNECT_TIMEOUT)
            .timeout(DESCRIBE_TOTAL_TIMEOUT)
            .build()
            .expect("reqwest client")
    });
    if origin_is_local(origin) {
        &LOCAL
    } else {
        &REMOTE
    }
}

fn exchange_client(origin: &str) -> &'static reqwest::Client {
    static LOCAL: LazyLock<reqwest::Client> = LazyLock::new(|| {
        reqwest::Client::builder()
            .connect_timeout(DESCRIBE_CONNECT_TIMEOUT)
            .timeout(DESCRIBE_TOTAL_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .build()
            .expect("reqwest client")
    });
    static REMOTE: LazyLock<reqwest::Client> = LazyLock::new(|| {
        reqwest::Client::builder()
            .connect_timeout(DESCRIBE_CONNECT_TIMEOUT)
            .timeout(DESCRIBE_TOTAL_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("reqwest client")
    });
    if origin_is_local(origin) {
        &LOCAL
    } else {
        &REMOTE
    }
}

async fn exchange_token(origin: &str, token: &str) -> Option<String> {
    let response = exchange_client(origin)
        .get(format!("{origin}/?token={token}"))
        .send()
        .await
        .ok()?;
    if response.status() != reqwest::StatusCode::SEE_OTHER {
        return None;
    }
    let raw = response
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .next()?
        .to_str()
        .ok()?;
    let pair = raw.split(';').next()?.trim();
    (!pair.is_empty()).then(|| pair.to_string())
}

pub(crate) fn configured_origin(settings: &AppSettings) -> String {
    HostConfig::from(settings).origin
}

pub(crate) fn host_cookie(origin: &str) -> Option<String> {
    if !origin_trusted(origin) {
        return None;
    }
    load_credentials(origin).map(|credentials| credentials.cookie)
}

async fn host_post(origin: &str, method: &str, args: Value) -> Result<(u16, Value), String> {
    let mut request = http_client(origin)
        .post(format!("{origin}/api/{method}"))
        .header(reqwest::header::CONTENT_TYPE, "application/json");
    if let Some(cookie) = host_cookie(origin) {
        request = request.header(reqwest::header::COOKIE, cookie);
    }
    let body = json!({
        "type": "client-request",
        "rpcId": uuid::Uuid::new_v4().to_string(),
        "method": method,
        "payload": { "args": args },
    });
    let response = request
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("Couldn't connect to {origin} ({e})"))?;
    let status = response.status().as_u16();
    let text = response
        .text()
        .await
        .map_err(|e| format!("{method}: couldn't read the response ({e})"))?;
    Ok((status, serde_json::from_str(&text).unwrap_or(Value::Null)))
}

pub(crate) async fn host_call(origin: &str, method: &str, args: Value) -> Result<Value, String> {
    host_call_rpc(origin, method, args)
        .await
        .map_err(|error| error.message)
}

pub(crate) struct HostRpcError {
    pub code: String,
    pub message: String,
    pub details: Value,
}

pub(crate) async fn host_call_rpc(
    origin: &str,
    method: &str,
    args: Value,
) -> Result<Value, HostRpcError> {
    let flattened = match host_post(origin, method, args).await {
        Ok(pair) => pair,
        Err(message) => {
            return Err(HostRpcError {
                code: "transport".to_string(),
                message,
                details: Value::Null,
            })
        }
    };
    let (status, envelope) = flattened;
    if status == 401 {
        return Err(HostRpcError {
            code: "unauthorized".to_string(),
            message: format!(
                "{method} unauthorized (401): the host credentials are missing or expired. Restart the DSH host from the settings."
            ),
            details: Value::Null,
        });
    }
    if envelope.get("type").and_then(Value::as_str) != Some("server-response") {
        return Err(HostRpcError {
            code: "bad-envelope".to_string(),
            message: format!("{method}: the response has the wrong shape (not a server-response)"),
            details: Value::Null,
        });
    }
    let result = envelope.get("result").cloned().unwrap_or(Value::Null);
    if result.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(result.get("value").cloned().unwrap_or(Value::Null));
    }
    let error = result.get("error").cloned().unwrap_or(Value::Null);
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("unknown error");
    Err(HostRpcError {
        code: error
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
        message: format!("{method} refused: {message}"),
        details: error.get("details").cloned().unwrap_or(Value::Null),
    })
}

pub(crate) enum ProbeOutcome {
    Live(Value),
    Unauthorized,
    Answered(String),
    Down(String),
}

impl ProbeOutcome {
    fn is_live(&self) -> bool {
        matches!(self, ProbeOutcome::Live(_))
    }
}

pub(crate) async fn probe_describe(origin: &str) -> ProbeOutcome {
    let (status, envelope) = match host_post(origin, DESCRIBE_METHOD, json!({})).await {
        Ok(pair) => pair,
        Err(e) => return ProbeOutcome::Down(e),
    };
    if status == 401 {
        return ProbeOutcome::Unauthorized;
    }
    if envelope.get("type").and_then(Value::as_str) != Some("server-response") {
        return ProbeOutcome::Answered(format!(
            "describe: the response has the wrong shape (HTTP {status})"
        ));
    }
    let result = envelope.get("result").cloned().unwrap_or(Value::Null);
    if result.get("ok").and_then(Value::as_bool) == Some(true) {
        return ProbeOutcome::Live(result.get("value").cloned().unwrap_or(Value::Null));
    }
    let message = result
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("unknown error");
    ProbeOutcome::Answered(format!("describe refused: {message}"))
}

#[derive(Debug, PartialEq)]
enum EnsureAction {
    Adopt,
    Spawn,
    RestartOwn,
    Occupied(String),
}

fn ensure_action(probe: &ProbeOutcome, ours: bool) -> EnsureAction {
    match probe {
        ProbeOutcome::Live(_) => EnsureAction::Adopt,
        _ if ours => EnsureAction::RestartOwn,
        ProbeOutcome::Down(_) => EnsureAction::Spawn,
        ProbeOutcome::Unauthorized => EnsureAction::Occupied("HTTP 401".to_string()),
        ProbeOutcome::Answered(detail) => EnsureAction::Occupied(detail.clone()),
    }
}

fn leftover_own_dsh(command: &str, misty_root: &str, port: u16) -> bool {
    if misty_root.is_empty() {
        return false;
    }
    let Some(at) = command.find(misty_root) else {
        return false;
    };
    let program = command[at..].split_whitespace().next().unwrap_or("");
    let is_dsh = program
        .split(['/', '\\'])
        .any(|part| part == "dsh" || part == "dsh.js" || part == "dsh.cmd");
    let words: Vec<&str> = command.split_whitespace().collect();
    let port = port.to_string();
    let serves_port = words
        .windows(2)
        .any(|pair| pair[0] == "--port" && pair[1] == port)
        || words.iter().any(|word| *word == format!("--port={port}"));
    is_dsh && words.contains(&"web") && serves_port
}

#[cfg(unix)]
async fn stop_own_leftover(port: u16) -> bool {
    let Some(root) = file_access::paths::misty_root_dir() else {
        return false;
    };
    let root = root.to_string_lossy().into_owned();
    let Ok(listening) = tokio::process::Command::new("lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t"])
        .stdin(Stdio::null())
        .output()
        .await
    else {
        return false;
    };
    let mut stopped = false;
    for pid in String::from_utf8_lossy(&listening.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<i32>().ok())
        .filter(|pid| *pid > 1)
    {
        let Ok(shown) = tokio::process::Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "command="])
            .stdin(Stdio::null())
            .output()
            .await
        else {
            continue;
        };
        let command = String::from_utf8_lossy(&shown.stdout);
        if !leftover_own_dsh(command.trim(), &root, port) {
            continue;
        }
        eprintln!("[dsh] stopping Misty's own leftover dsh web (pid {pid}) on port {port}");
        // SAFETY: plain signals to a process (and the group it leads, as Misty spawns it) whose
        // command line was just checked; no memory touched.
        unsafe {
            libc::kill(-pid, libc::SIGTERM);
            libc::kill(pid, libc::SIGTERM);
        }
        stopped = true;
    }
    stopped
}

#[cfg(not(unix))]
async fn stop_own_leftover(_port: u16) -> bool {
    false
}

fn occupied_message(port: u16, detail: &str) -> String {
    format!(
        "Port {port} is in use by another program ({detail}). Misty only stops the dsh web it started itself, never other programs: close the program using the port, or choose another port in the settings."
    )
}

pub(crate) fn autostart_allowed(settings: &AppSettings) -> bool {
    should_autostart(
        settings.dsh_auto_start,
        crate::engines::support::config::ensure_engine_enabled("dsh").is_ok(),
        dsh_installed(settings),
    )
}

fn should_autostart(switch: Option<bool>, engine_enabled: bool, installed: bool) -> bool {
    switch != Some(false) && engine_enabled && installed
}

#[allow(
    clippy::disallowed_methods,
    reason = "checks for the dsh program the person installed, which lives outside the gate"
)]
fn dsh_installed(settings: &AppSettings) -> bool {
    let bin = dsh_bin(settings);
    let path = Path::new(&bin);
    path.is_absolute() && path.is_file()
}

fn normalize_describe(value: &Value) -> Value {
    let entry = value
        .get("namespaces")
        .and_then(Value::as_array)
        .and_then(|namespaces| {
            namespaces.iter().find(|entry| {
                entry.get("ns").and_then(Value::as_str) == Some("agent-default-model")
            })
        });
    let inner = entry.and_then(|entry| entry.get("value")).cloned();
    let mut view = Map::new();
    for key in ["provider", "model"] {
        if let Some(text) = inner
            .as_ref()
            .and_then(|inner| inner.get(key))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            view.insert(key.to_string(), Value::String(text.to_string()));
        }
    }
    Value::Object(view)
}

fn dsh_bin(settings: &AppSettings) -> String {
    if let Some(custom) = settings.bin_override("dsh") {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            match crate::engines::support::settings::validate_bin_override(trimmed) {
                Ok(path) => return resolve::resolve_launchable_cli_binary(&path.to_string_lossy()),
                Err(reason) => {
                    eprintln!("[dsh] ignoring invalid dsh bin override: {reason}");
                }
            }
        }
    }
    resolve::resolve_launchable_cli_binary("dsh")
}

struct HostLog {
    path: PathBuf,
    file: Mutex<Option<File>>,
    written: AtomicU64,
}

impl HostLog {
    fn path_for(home: &Path, now: SystemTime) -> Option<PathBuf> {
        let epoch = now.duration_since(UNIX_EPOCH).ok()?.as_secs();
        Some(home.join(LOG_DIR).join(run_log_name(epoch)))
    }

    fn open(path: PathBuf) -> Arc<Self> {
        let file = path
            .parent()
            .map(file_access::fs::create_dir_all)
            .transpose()
            .ok()
            .flatten()
            .and_then(|()| {
                OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&path)
                    .ok()
            });
        if file.is_none() {
            eprintln!("[dsh] host log disabled (cannot open {})", path.display());
        }
        let written = file
            .as_ref()
            .and_then(|file| file.metadata().ok())
            .map(|meta| meta.len())
            .unwrap_or(0);
        Arc::new(Self {
            path,
            file: Mutex::new(file),
            written: AtomicU64::new(written),
        })
    }

    fn for_new_run() -> Option<Arc<Self>> {
        Self::for_new_run_at(&dsh_home(), SystemTime::now())
    }

    fn for_new_run_at(home: &Path, now: SystemTime) -> Option<Arc<Self>> {
        let path = Self::path_for(home, now)?;
        if let Some(dir) = path.parent() {
            Self::prune_old_runs(dir, LOG_KEEP_RUNS);
        }
        Some(Self::open(path))
    }

    fn prune_old_runs(dir: &Path, keep: usize) {
        let Ok(entries) = file_access::fs::read_dir(dir) else {
            return;
        };
        let mut runs: Vec<(u64, PathBuf)> = entries
            .flatten()
            .filter_map(|entry| {
                let path = entry.path();
                Some((run_log_epoch(entry.file_name().to_str()?)?, path))
            })
            .collect();
        runs.sort_unstable_by(|a, b| b.0.cmp(&a.0));
        for (_, path) in runs.into_iter().skip(keep) {
            let _ = file_access::fs::remove_file(rotated_path(&path));
            let _ = file_access::fs::remove_file(&path);
        }
    }

    fn line(&self, line: &str) {
        self.line_capped(line, LOG_MAX_BYTES);
    }

    fn line_capped(&self, line: &str, max_bytes: u64) {
        let mut guard = lock(&self.file);
        if self.written.load(Ordering::Relaxed) > max_bytes {
            self.rotate_locked(&mut guard);
        }
        let Some(file) = guard.as_mut() else {
            return;
        };
        if file.write_all(line.as_bytes()).is_err() || file.flush().is_err() {
            eprintln!("[dsh] host log write failed; sink disabled");
            *guard = None;
            return;
        }
        self.written.fetch_add(line.len() as u64, Ordering::Relaxed);
    }

    fn rotate_locked(&self, guard: &mut Option<File>) {
        *guard = None;
        let _ = file_access::fs::rename(&self.path, rotated_path(&self.path));
        *guard = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .ok();
        self.written.store(0, Ordering::Relaxed);
    }
}

fn rotated_path(path: &Path) -> PathBuf {
    path.with_extension(format!(
        "{}{LOG_KEEP_SUFFIX}",
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("log")
    ))
}

fn run_log_name(epoch: u64) -> String {
    format!("dsh-host-{epoch}.log")
}

fn run_log_epoch(name: &str) -> Option<u64> {
    name.strip_prefix("dsh-host-")?
        .strip_suffix(".log")?
        .parse()
        .ok()
}

fn loggable_line(line: &str) -> &str {
    if extract_launch_token(line).is_some() {
        "=== [redacted] launch token line ===\n"
    } else {
        line
    }
}

fn spawn_ring_drain<R: AsyncRead + Unpin + Send + 'static>(
    pipe: R,
    buf: Arc<Mutex<String>>,
    capture: Option<Arc<TokenCapture>>,
    log: Option<Arc<HostLog>>,
) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(pipe);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if let Some(log) = &log {
                        log.line(loggable_line(&line));
                    }
                    {
                        let mut guard = lock(&buf);
                        guard.push_str(&line);
                        if guard.len() > RING_CAP {
                            let mut start = guard.len() - RING_CAP;
                            while !guard.is_char_boundary(start) {
                                start += 1;
                            }
                            guard.drain(..start);
                        }
                    }
                    if let Some(capture) = &capture {
                        capture.capture(&line).await;
                    }
                }
            }
        }
    });
}

fn ring_snapshot(buf: &Mutex<String>) -> String {
    lock(buf).trim().to_string()
}

pub(crate) async fn ensure_host(
    host_state: &DshHostState,
    settings: &AppSettings,
) -> Result<(), String> {
    let _serialize = host_state.ensure.lock().await;
    let cfg = HostConfig::from(settings);

    host_state.reap_exited();
    let ours = host_state.spawned_origin().as_deref() == Some(cfg.origin.as_str());
    match ensure_action(&probe_describe(&cfg.origin).await, ours) {
        EnsureAction::Adopt => return Ok(()),
        EnsureAction::Occupied(detail) => {
            if !stop_own_leftover(cfg.port).await {
                return Err(occupied_message(cfg.port, &detail));
            }
            let mut freed = false;
            for _ in 0..10 {
                sleep(Duration::from_millis(300)).await;
                if matches!(probe_describe(&cfg.origin).await, ProbeOutcome::Down(_)) {
                    freed = true;
                    break;
                }
            }
            if !freed {
                return Err(occupied_message(cfg.port, &detail));
            }
        }
        EnsureAction::RestartOwn => {
            host_state.kill_spawned();
            sleep(Duration::from_millis(600)).await;
        }
        EnsureAction::Spawn => {}
    }

    let bin = dsh_bin(settings);
    let mut command = command_for_binary(&bin);
    command
        .arg("web")
        .arg("--host")
        .arg(&cfg.host)
        .arg("--port")
        .arg(cfg.port.to_string())
        .arg("--no-open");
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    crate::engines::hide_console(&mut command);
    let mut child = command.spawn().map_err(|e| {
        format!("Couldn't start dsh web ({bin}): {e}. Check that @deepseek-ai/dsh is installed, or check the custom path.")
    })?;
    let trust = PendingTrust::grant(&cfg.origin);
    #[cfg(windows)]
    let tree_guard = crate::engines::job::assign_kill_on_close(&child);
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let exit_watcher = child
        .id()
        .and_then(|pid| crate::agents::shell::exit_watcher::ExitWatcher::start(pid as i32).ok());
    let output = Arc::new(Mutex::new(String::new()));
    let capture = Arc::new(TokenCapture {
        origin: cfg.origin.clone(),
        token: Mutex::new(None),
        busy: AtomicBool::new(false),
    });
    let log = HostLog::for_new_run();
    if let Some(log) = &log {
        log.line(&format!(
            "=== dsh web spawn: origin={} bin={} pid={} ===\n",
            cfg.origin,
            bin,
            child.id().unwrap_or(0)
        ));
    }
    if let Some(stdout) = child.stdout.take() {
        spawn_ring_drain(
            stdout,
            Arc::clone(&output),
            Some(Arc::clone(&capture)),
            log.clone(),
        );
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_ring_drain(
            stderr,
            Arc::clone(&output),
            Some(Arc::clone(&capture)),
            log.clone(),
        );
    }
    let log_path = log.as_ref().map(|log| log.path.clone());

    let deadline = Instant::now() + SPAWN_READY_TIMEOUT;
    let mut last_unauthorized = false;
    let mut next_reexchange = Instant::now();
    loop {
        let probe = probe_describe(&cfg.origin).await;
        if probe.is_live() {
            *lock(&host_state.spawned) = Some(Spawned {
                child,
                origin: cfg.origin.clone(),
                #[cfg(any(target_os = "macos", target_os = "linux"))]
                exit_watcher,
                #[cfg(windows)]
                _tree_guard: tree_guard,
            });
            trust.keep();
            return Ok(());
        }
        if matches!(probe, ProbeOutcome::Unauthorized) {
            last_unauthorized = true;
            if Instant::now() >= next_reexchange {
                next_reexchange = Instant::now() + TOKEN_REEXCHANGE_INTERVAL;
                capture.reexchange_stored().await;
            }
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                trust.withdraw();
                if probe_describe(&cfg.origin).await.is_live() {
                    return Ok(());
                }
                let tail = ring_snapshot(&output);
                return Err(format!(
                    "dsh web exited right after starting ({status}). {}{}",
                    if tail.is_empty() {
                        "No output.".to_string()
                    } else {
                        format!("Output: {tail}")
                    },
                    match &log_path {
                        Some(path) => format!(" (full output in {})", path.display()),
                        None => String::new(),
                    }
                ));
            }
            Ok(None) => {}
            Err(e) => {
                let _ = child.start_kill();
                return Err(format!("dsh web status check failed: {e}"));
            }
        }
        if Instant::now() >= deadline {
            let _ = child.start_kill();
            trust.withdraw();
            if probe_describe(&cfg.origin).await.is_live() {
                return Ok(());
            }
            let tail = ring_snapshot(&output);
            if last_unauthorized {
                return Err(format!(
                    "The dsh host answers at {} but its credentials weren't accepted (401), and it wasn't ready after {} seconds. {}",
                    cfg.origin,
                    SPAWN_READY_TIMEOUT.as_secs(),
                    if tail.is_empty() {
                        "No launch token in its output.".to_string()
                    } else {
                        format!("Output: {tail}")
                    }
                ));
            }
            return Err(format!(
                "Timed out waiting for the dsh host to be ready ({} seconds, {}). {}",
                SPAWN_READY_TIMEOUT.as_secs(),
                cfg.origin,
                if tail.is_empty() {
                    String::new()
                } else {
                    format!("Output: {tail}")
                }
            ));
        }
        sleep(SPAWN_POLL_INTERVAL).await;
    }
}

async fn status_snapshot(host_state: &DshHostState, settings: &AppSettings) -> DshHostStatus {
    let cfg = HostConfig::from(settings);
    let bin = dsh_bin(settings);
    let (cli, probe) = tokio::join!(
        crate::engines::resolve::version_of(&bin),
        probe_describe(&cfg.origin)
    );
    let running = probe.is_live();
    let ownership = if running {
        Some(
            if host_state.spawned_origin().as_deref() == Some(cfg.origin.as_str()) {
                "spawned"
            } else {
                "adopted"
            },
        )
    } else {
        None
    };
    let ours = host_state.spawned_origin().as_deref() == Some(cfg.origin.as_str());
    let (describe, error) = match probe {
        ProbeOutcome::Live(value) => (Some(normalize_describe(&value)), None),
        ProbeOutcome::Unauthorized if ours => (
            None,
            Some(
                "The host is running but its credentials are invalid (401). Start it again and the credentials are renewed."
                    .to_string(),
            ),
        ),
        ProbeOutcome::Unauthorized => (None, Some(occupied_message(cfg.port, "HTTP 401"))),
        ProbeOutcome::Answered(detail) => (None, Some(occupied_message(cfg.port, &detail))),
        ProbeOutcome::Down(error) => (None, Some(error)),
    };
    let web_url = compose_web_url(
        &cfg.origin,
        origin_trusted(&cfg.origin),
        load_credentials(&cfg.origin),
    );
    DshHostStatus {
        installed: cli.is_some(),
        version: cli,
        host: cfg.host,
        port: cfg.port,
        origin: cfg.origin.clone(),
        auto_start: cfg.auto_start,
        running,
        ownership,
        describe,
        web_url,
        error,
    }
}

fn compose_web_url(
    origin: &str,
    trusted: bool,
    credentials: Option<HostCredentials>,
) -> Option<String> {
    if !trusted {
        return None;
    }
    credentials.map(|credentials| format!("{origin}/?token={}", credentials.launch_token))
}

#[tauri::command]
pub async fn dsh_host_status(
    state: tauri::State<'_, crate::engines::support::EngineState>,
) -> Result<DshHostStatus, String> {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    Ok(status_snapshot(&state.dsh_host, &settings).await)
}

#[tauri::command]
pub async fn dsh_host_start(
    state: tauri::State<'_, crate::engines::support::EngineState>,
) -> Result<DshHostStatus, String> {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    ensure_host(&state.dsh_host, &settings).await?;
    Ok(status_snapshot(&state.dsh_host, &settings).await)
}

#[tauri::command]
pub async fn dsh_host_stop(
    state: tauri::State<'_, crate::engines::support::EngineState>,
) -> Result<OkResult, String> {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let cfg = HostConfig::from(&settings);
    let had_child = state.dsh_host.kill_spawned();
    for _ in 0..STOP_SETTLE_ATTEMPTS {
        if matches!(probe_describe(&cfg.origin).await, ProbeOutcome::Down(_)) {
            return Ok(OkResult { ok: true });
        }
        sleep(STOP_SETTLE_INTERVAL).await;
    }
    Err(if had_child {
        format!(
            "The dsh web Misty started was stopped, but something still answers on port {}. Misty never stops a process it didn't start: close the program using the port yourself.",
            cfg.port
        )
    } else {
        format!(
            "The DSH host on port {} wasn't started by Misty, so Misty won't stop it. Close it from the terminal or program that started it.",
            cfg.port
        )
    })
}

const STOP_SETTLE_ATTEMPTS: usize = 8;
const STOP_SETTLE_INTERVAL: Duration = Duration::from_millis(250);

fn is_local_host(host: &str) -> bool {
    matches!(
        host.trim().to_ascii_lowercase().as_str(),
        "127.0.0.1" | "localhost" | "::1" | "0.0.0.0" | "[::1]" | "[::]"
    )
}

fn origin_is_local(origin: &str) -> bool {
    let lowered = origin.trim().to_ascii_lowercase();
    let authority = lowered
        .strip_prefix("http://")
        .or_else(|| lowered.strip_prefix("https://"))
        .unwrap_or(lowered.as_str());
    let authority = authority.split(['/', '?', '#']).next().unwrap_or("");
    let host = match authority.rsplit_once(':') {
        Some((head, tail)) if !tail.is_empty() && tail.bytes().all(|b| b.is_ascii_digit()) => head,
        _ => authority,
    };
    is_local_host(host)
}

#[cfg(test)]
#[path = "dsh_host_tests.rs"]
mod tests;
