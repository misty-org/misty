// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/opencode_server.rs.
//! Managed `opencode serve` lifecycle: probe the default port, adopt a
//! healthy server, else spawn our own on a free port and wait for health.
//!
//! The server is what makes the built-in `question` tool answerable: `run`
//! clients attach to it (`opencode run --attach`), question/permission asks
//! park server-side, and the GUI answers them over HTTP
//! (`POST /question/:requestID/reply`).
//!
//! Ownership rule mirrors dsh_host: only servers we spawned are tracked in
//! [`OpencodeServerState`] and killed on app exit; an adopted server (the
//! user's own `opencode serve`) is never touched.
//!
//! OpenCode 2.x serves a different API under `/api/…` (checked against 2.3.0's
//! `/openapi.json`): every route asks for HTTP basic auth (user `opencode`, the
//! password from `OPENCODE_SERVER_PASSWORD`, else a random one it prints), a
//! folder is the `location[directory]` query, and `/global/health` is its web
//! app's page rather than JSON. So Misty starts its own server with a password
//! it made, remembers per origin which API it speaks ([`Api`]), and [`call`]
//! routes and authenticates from that. A 2.x server Misty didn't start can't
//! be adopted: its password is unknown.

use std::collections::HashMap;
use std::process::Stdio;
#[cfg(windows)]
use std::sync::Arc;
use std::sync::{Mutex, OnceLock};

use serde_json::Value;
use tokio::process::Child;
use tokio::time::{sleep, Duration, Instant};

use crate::engines::{command_for_binary, resolve};

pub(crate) const DEFAULT_PORT: u16 = 4096;
const SERVER_USER: &str = "opencode";
const SPAWN_POLL_INTERVAL: Duration = Duration::from_millis(250);
const SPAWN_READY_TIMEOUT: Duration = Duration::from_secs(20);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Default)]
pub struct OpencodeServerState {
    origin: Mutex<Option<String>>,
    spawned: Mutex<Option<Child>>,
    #[cfg(windows)]
    job: Mutex<Option<Arc<crate::engines::job::KillOnCloseJob>>>,
    ensure: tokio::sync::Mutex<()>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl OpencodeServerState {
    pub fn kill_spawned(&self) {
        let child = lock(&self.spawned).take();
        if let Some(mut child) = child {
            if let Some(pid) = child.id() {
                crate::engines::kill_process_group(pid);
            }
            let _ = child.start_kill();
        }
        #[cfg(windows)]
        {
            *lock(&self.job) = None;
        }
        *lock(&self.origin) = None;
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Api {
    pub v2: bool,
    pub password: Option<String>,
}

fn apis() -> &'static Mutex<HashMap<String, Api>> {
    static APIS: OnceLock<Mutex<HashMap<String, Api>>> = OnceLock::new();
    APIS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn api(origin: &str) -> Api {
    lock(apis()).get(origin).cloned().unwrap_or_default()
}

pub(crate) fn is_v2(origin: &str) -> bool {
    api(origin).v2
}

fn remember(origin: &str, api: Api) {
    lock(apis()).insert(origin.to_string(), api);
}

async fn probe(origin: &str, password: Option<&str>) -> Option<Api> {
    let client = reqwest::Client::builder()
        .timeout(HEALTH_TIMEOUT)
        .build()
        .ok()?;
    let get = |path: &str| {
        let request = client.get(format!("{origin}{path}"));
        match password {
            Some(password) => request.basic_auth(SERVER_USER, Some(password)),
            None => request,
        }
    };
    let api = |v2| Api {
        v2,
        password: password.map(str::to_owned),
    };
    if let Ok(response) = get("/global/health").send().await {
        let body = response.json::<Value>().await.unwrap_or(Value::Null);
        if body.get("healthy").and_then(Value::as_bool) == Some(true) {
            return Some(api(false));
        }
    }
    let response = get("/api/info").send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let body = response.json::<Value>().await.ok()?;
    body.get("version").and_then(Value::as_str)?;
    Some(api(true))
}

fn free_port() -> Result<u16, String> {
    std::net::TcpListener::bind("127.0.0.1:0")
        .map(|listener| listener.local_addr().map(|addr| addr.port()))
        .and_then(|r| r)
        .map_err(|e| format!("no free port for opencode serve: {e}"))
}

pub(crate) async fn ensure_server(
    state: &OpencodeServerState,
    bin: &str,
    probe_port: u16,
) -> Result<String, String> {
    if let Some(origin) = lock(&state.origin).clone() {
        return Ok(origin);
    }
    let _serialize = state.ensure.lock().await;
    if let Some(origin) = lock(&state.origin).clone() {
        return Ok(origin);
    }

    let default_origin = format!("http://127.0.0.1:{probe_port}");
    if let Some(api) = probe(&default_origin, None).await {
        remember(&default_origin, api);
        *lock(&state.origin) = Some(default_origin.clone());
        return Ok(default_origin);
    }

    let resolved = resolve::resolve_launchable_cli_binary(bin);
    let port = free_port()?;
    let origin = format!("http://127.0.0.1:{port}");
    let password = uuid::Uuid::new_v4().simple().to_string();
    let mut command = command_for_binary(&resolved);
    command
        .arg("serve")
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .env("OPENCODE_SERVER_PASSWORD", &password)
        .env_remove("OPENCODE_PASSWORD")
        .env_remove("OPENCODE_SERVER_USERNAME");
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    crate::engines::hide_console(&mut command);
    let mut child = command.spawn().map_err(|e| {
        format!(
            "Couldn't start opencode serve ({resolved}): {e}. Check that opencode is installed."
        )
    })?;
    #[cfg(windows)]
    let tree_guard = crate::engines::job::assign_kill_on_close(&child);

    let deadline = Instant::now() + SPAWN_READY_TIMEOUT;
    loop {
        if let Some(api) = probe(&origin, Some(&password)).await {
            remember(&origin, api);
            *lock(&state.spawned) = Some(child);
            #[cfg(windows)]
            {
                *lock(&state.job) = tree_guard;
            }
            *lock(&state.origin) = Some(origin.clone());
            return Ok(origin);
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                return Err(format!(
                    "opencode serve exited right after starting ({status}). Check the opencode install."
                ));
            }
            Ok(None) => {}
            Err(e) => return Err(format!("opencode serve is in an unexpected state: {e}")),
        }
        if Instant::now() >= deadline {
            if let Some(pid) = child.id() {
                crate::engines::kill_process_group(pid);
            }
            let _ = child.start_kill();
            return Err(
                "opencode serve timed out starting (no healthy check within 20s)".to_string(),
            );
        }
        sleep(SPAWN_POLL_INTERVAL).await;
    }
}

pub(crate) async fn ensure_running() -> Result<String, String> {
    let state = crate::engines::support::state()
        .ok_or_else(|| "OpenCode isn't ready yet; try again in a moment.".to_string())?;
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = crate::engines::engine_bin(&settings, "opencode");
    ensure_server(&state.opencode_server, &bin, DEFAULT_PORT).await
}

pub(crate) fn request(
    client: &reqwest::Client,
    method: reqwest::Method,
    origin: &str,
    path: &str,
    directory: Option<&str>,
) -> reqwest::RequestBuilder {
    let mut request = client.request(method, format!("{origin}{path}"));
    if let Some(password) = api(origin).password {
        request = request.basic_auth(SERVER_USER, Some(password));
    }
    if let Some(directory) = directory {
        let key = if path.starts_with("/api/") {
            "location[directory]"
        } else {
            "directory"
        };
        request = request.query(&[(key, directory)]);
    }
    request
}

pub(crate) fn data(value: &Value) -> &Value {
    value.get("data").unwrap_or(value)
}

pub(crate) async fn call(
    method: reqwest::Method,
    origin: &str,
    path: &str,
    directory: Option<&str>,
    body: Option<Value>,
    timeout: Duration,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = request(&client, method, origin, path, directory);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|e| format!("{e}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "opencode {path} failed ({status}): {}",
            failure_detail(&text)
        ));
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)))
}

fn failure_detail(text: &str) -> String {
    let parsed = serde_json::from_str::<Value>(text).ok();
    let message = parsed.as_ref().and_then(|value| {
        ["/data/message", "/message", "/error"]
            .iter()
            .find_map(|pointer| value.pointer(pointer).and_then(Value::as_str))
    });
    match message {
        Some(message) => message.trim().to_string(),
        None => text.trim().chars().take(200).collect(),
    }
}

pub(crate) async fn post(
    origin: &str,
    path: &str,
    directory: &str,
    body: Option<Value>,
) -> Result<(), String> {
    call(
        reqwest::Method::POST,
        origin,
        path,
        Some(directory),
        body,
        Duration::from_secs(10),
    )
    .await
    .map(|_| ())
}
