// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

//! `--mcp-lazy -- <command> <args…>`: a transparent stdio MCP proxy that
//! defers starting the real server until a request needs it.
//!
//! The engine CLI spawns this binary instead of the configured server. The
//! handshake and the discovery lists (`initialize`, `tools/list`,
//! `prompts/list`, `resources/list`, `resources/templates/list`) are answered
//! from a cache written the last time the real server ran; `ping` is answered
//! locally. The first other request (`tools/call`, `resources/read`, …)
//! starts the real server, replays the client's `initialize`, refreshes the
//! lists, and forwards traffic both ways from then on. Without a cache the
//! server starts on `initialize` once, to fill it.
//!
//! Behaviour follows askmegit/mcp-snooze (MIT); this is a Rust rewrite. The
//! protocol core ([`Proxy`]) does no I/O so it can be tested directly; the
//! runner ([`serve`]) owns the pipes and the child process.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, value::RawValue, Value};

/// argv[1] that selects proxy mode (checked before every other MCP mode).
pub const FLAG: &str = "--mcp-lazy";
const INTERNAL_PREFIX: &str = "misty-lazy-";
const START_TIMEOUT: Duration = Duration::from_secs(60);
const EOF_GRACE: Duration = Duration::from_secs(2);
const CACHE_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const MAX_LINE_BYTES: usize = 64 * 1024 * 1024;

/// What the last real run answered: the `initialize` result and one result
/// per discovery list method.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Cache {
    pub initialize: Value,
    pub lists: BTreeMap<String, Value>,
}

pub(crate) trait CacheStore {
    fn load(&self, protocol_version: &str) -> Option<Cache>;
    fn save(&self, protocol_version: &str, cache: &Cache);
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Action {
    ToClient(String),
    ToChild(String),
    /// Start the real server as generation `n`; later child events carry it.
    Spawn(u64),
    Kill,
    /// Pass-through child exited: the proxy has nothing left to serve.
    Exit,
}

#[derive(Deserialize)]
struct Envelope<'a> {
    #[serde(borrow, default)]
    id: Option<&'a RawValue>,
    #[serde(default)]
    method: Option<String>,
    #[serde(borrow, default)]
    params: Option<&'a RawValue>,
    #[serde(borrow, default)]
    result: Option<&'a RawValue>,
    #[serde(default)]
    error: Option<ErrorBody>,
}

#[derive(Deserialize)]
struct ErrorBody {
    #[serde(default)]
    code: Option<i64>,
}

/// JSON-RPC "Method not found".
const METHOD_NOT_FOUND: i64 = -32601;

enum Phase {
    Dormant,
    Starting {
        gen: u64,
        init_id: String,
        lists: Option<ListFetch>,
    },
    Ready {
        gen: u64,
    },
    /// No `initialize` was seen (e.g. a stateless client): forward verbatim.
    Raw {
        gen: u64,
    },
}

struct ListFetch {
    waiting: HashMap<String, String>,
    results: BTreeMap<String, Value>,
    complete: bool,
}

pub(crate) struct Proxy<S: CacheStore> {
    store: S,
    phase: Phase,
    gen: u64,
    serial: u64,
    init_params: Option<Value>,
    protocol_version: String,
    init_result: Option<Value>,
    cache: Option<Cache>,
    /// Client `initialize` ids waiting for the real server (cache miss).
    init_waiters: Vec<Value>,
    /// Client lines held while the server starts.
    queue: Vec<String>,
    /// Client requests forwarded to the live server, by canonical id.
    pending: HashMap<String, Value>,
    /// Internal `tools/list` refreshes after `list_changed`.
    refresh: HashMap<String, String>,
}

impl<S: CacheStore> Proxy<S> {
    pub(crate) fn new(store: S) -> Self {
        Self {
            store,
            phase: Phase::Dormant,
            gen: 0,
            serial: 0,
            init_params: None,
            protocol_version: String::from("none"),
            init_result: None,
            cache: None,
            init_waiters: Vec::new(),
            queue: Vec::new(),
            pending: HashMap::new(),
            refresh: HashMap::new(),
        }
    }

    pub(crate) fn has_pending(&self) -> bool {
        !self.pending.is_empty() || !self.init_waiters.is_empty() || !self.queue.is_empty()
    }

    pub(crate) fn is_starting(&self, gen: u64) -> bool {
        matches!(self.phase, Phase::Starting { gen: g, .. } if g == gen)
    }

    fn live_gen(&self) -> Option<u64> {
        match self.phase {
            Phase::Dormant => None,
            Phase::Starting { gen, .. } | Phase::Ready { gen } | Phase::Raw { gen } => Some(gen),
        }
    }

    fn next_internal_id(&mut self) -> String {
        self.serial += 1;
        format!("{INTERNAL_PREFIX}{}", self.serial)
    }

    pub(crate) fn on_client(&mut self, line: &str) -> Vec<Action> {
        if matches!(self.phase, Phase::Raw { .. }) {
            return vec![Action::ToChild(line.to_string())];
        }
        let Ok(envelope) = serde_json::from_str::<Envelope>(line) else {
            // Batches and anything unparsed: let the real server answer.
            return self.forward_or_start(None, line);
        };
        let id = envelope.id.map(raw_to_value);
        match (id, envelope.method.as_deref()) {
            (Some(id), Some("initialize")) => self.initialize(id, envelope.params),
            (Some(id), Some("ping")) => vec![Action::ToClient(result_line(&id, &json!({})))],
            // 2026-07-28 probe: refusing it makes dual-revision clients fall
            // back to the `initialize` handshake this proxy can cache.
            (Some(id), Some("server/discover")) => {
                vec![Action::ToClient(error_line(
                    &id,
                    -32601,
                    "Method not found",
                ))]
            }
            (None, Some("notifications/initialized")) => Vec::new(),
            (Some(id), Some(method)) => self.request(id, method, envelope.params, line),
            (Some(_), None) => match self.phase {
                // A reply to a server request is only meaningful to a live
                // server. While starting it is live too: servers ask
                // `roots/list` right after `initialized`, before the lists
                // the proxy is still waiting on come back.
                Phase::Ready { .. } | Phase::Starting { .. } => {
                    vec![Action::ToChild(line.to_string())]
                }
                _ => Vec::new(),
            },
            (None, Some(_)) => match self.phase {
                Phase::Ready { .. } => vec![Action::ToChild(line.to_string())],
                Phase::Starting { .. } => {
                    self.queue.push(line.to_string());
                    Vec::new()
                }
                _ => Vec::new(),
            },
            (None, None) => Vec::new(),
        }
    }

    fn initialize(&mut self, id: Value, params: Option<&RawValue>) -> Vec<Action> {
        let params = params
            .and_then(|raw| serde_json::from_str::<Value>(raw.get()).ok())
            .unwrap_or_else(|| json!({}));
        self.protocol_version = params
            .get("protocolVersion")
            .and_then(Value::as_str)
            .unwrap_or("none")
            .to_string();
        self.init_params = Some(params);
        if let (Phase::Ready { .. }, Some(result)) = (&self.phase, &self.init_result) {
            return vec![Action::ToClient(result_line(&id, result))];
        }
        self.cache = self.store.load(&self.protocol_version);
        if let Some(cache) = &self.cache {
            return vec![Action::ToClient(result_line(&id, &cache.initialize))];
        }
        self.init_waiters.push(id);
        self.ensure_started()
    }

    fn request(
        &mut self,
        id: Value,
        method: &str,
        params: Option<&RawValue>,
        line: &str,
    ) -> Vec<Action> {
        if self.init_params.is_none() {
            self.gen += 1;
            self.phase = Phase::Raw { gen: self.gen };
            return vec![Action::Spawn(self.gen), Action::ToChild(line.to_string())];
        }
        if matches!(self.phase, Phase::Dormant) && !has_cursor(params) {
            if let Some(result) = self
                .cache
                .as_ref()
                .and_then(|cache| cache.lists.get(method))
            {
                return vec![Action::ToClient(result_line(&id, result))];
            }
        }
        self.forward_or_start(Some(id), line)
    }

    fn forward_or_start(&mut self, id: Option<Value>, line: &str) -> Vec<Action> {
        match self.phase {
            Phase::Ready { .. } => {
                if let Some(id) = id {
                    self.pending.insert(id_key(&id), id);
                }
                vec![Action::ToChild(line.to_string())]
            }
            Phase::Starting { .. } => {
                self.queue.push(line.to_string());
                Vec::new()
            }
            Phase::Raw { .. } => vec![Action::ToChild(line.to_string())],
            Phase::Dormant => {
                if self.init_params.is_none() {
                    self.gen += 1;
                    self.phase = Phase::Raw { gen: self.gen };
                    return vec![Action::Spawn(self.gen), Action::ToChild(line.to_string())];
                }
                self.queue.push(line.to_string());
                self.ensure_started()
            }
        }
    }

    fn ensure_started(&mut self) -> Vec<Action> {
        if !matches!(self.phase, Phase::Dormant) {
            return Vec::new();
        }
        self.gen += 1;
        let init_id = self.next_internal_id();
        let request = json!({
            "jsonrpc": "2.0",
            "id": init_id,
            "method": "initialize",
            "params": self.init_params.clone().unwrap_or_else(|| json!({})),
        });
        self.phase = Phase::Starting {
            gen: self.gen,
            init_id,
            lists: None,
        };
        vec![
            Action::Spawn(self.gen),
            Action::ToChild(request.to_string()),
        ]
    }

    pub(crate) fn on_child(&mut self, gen: u64, line: &str) -> Vec<Action> {
        if self.live_gen() != Some(gen) {
            return Vec::new();
        }
        if matches!(self.phase, Phase::Raw { .. }) {
            return vec![Action::ToClient(line.to_string())];
        }
        let Ok(envelope) = serde_json::from_str::<Envelope>(line) else {
            return match self.phase {
                Phase::Ready { .. } => vec![Action::ToClient(line.to_string())],
                _ => Vec::new(),
            };
        };
        let id = envelope.id.map(raw_to_value);
        let result = envelope
            .result
            .and_then(|raw| serde_json::from_str::<Value>(raw.get()).ok());
        let not_found =
            envelope.error.as_ref().and_then(|error| error.code) == Some(METHOD_NOT_FOUND);
        if let (Some(Value::String(internal)), None) = (&id, &envelope.method) {
            if internal.starts_with(INTERNAL_PREFIX) {
                return self.internal_response(internal.clone(), result, not_found);
            }
        }
        match (id, envelope.method.as_deref()) {
            (Some(id), None) => {
                self.pending.remove(&id_key(&id));
                vec![Action::ToClient(line.to_string())]
            }
            (_, Some(method)) => {
                let mut out = vec![Action::ToClient(line.to_string())];
                if method == "notifications/tools/list_changed"
                    && matches!(self.phase, Phase::Ready { .. })
                {
                    let id = self.next_internal_id();
                    self.refresh.insert(id.clone(), "tools/list".into());
                    out.push(Action::ToChild(list_request(&id, "tools/list")));
                }
                out
            }
            (None, None) => Vec::new(),
        }
    }

    fn internal_response(
        &mut self,
        id: String,
        result: Option<Value>,
        not_found: bool,
    ) -> Vec<Action> {
        if let Some(method) = self.refresh.remove(&id) {
            if let (Some(result), Some(cache)) = (result, self.cache.as_mut()) {
                cache.lists.insert(method, result);
                self.store.save(&self.protocol_version, cache);
            }
            return Vec::new();
        }
        let Phase::Starting {
            gen,
            init_id,
            lists,
        } = &mut self.phase
        else {
            return Vec::new();
        };
        let gen = *gen;
        if lists.is_none() {
            if *init_id != id {
                return Vec::new();
            }
            let Some(result) = result.filter(Value::is_object) else {
                return self.fail_start("MCP server rejected initialize");
            };
            let methods = list_methods(&result);
            self.init_result = Some(result);
            let mut out = vec![Action::ToChild(
                json!({"jsonrpc": "2.0", "method": "notifications/initialized"}).to_string(),
            )];
            let mut waiting = HashMap::new();
            for method in methods {
                let request_id = self.next_internal_id();
                out.push(Action::ToChild(list_request(&request_id, method)));
                waiting.insert(request_id, method.to_string());
            }
            let Phase::Starting { lists, .. } = &mut self.phase else {
                unreachable!("phase checked above");
            };
            *lists = Some(ListFetch {
                waiting,
                results: BTreeMap::new(),
                complete: true,
            });
            if lists.as_ref().is_some_and(|fetch| fetch.waiting.is_empty()) {
                out.extend(self.finish_start(gen));
            }
            return out;
        }
        let fetch = lists.as_mut().expect("lists checked above");
        let Some(method) = fetch.waiting.remove(&id) else {
            return Vec::new();
        };
        match result {
            Some(result) => {
                fetch.results.insert(method, result);
            }
            // The capability is declared but this method isn't implemented (often
            // resources/templates/list): cache it as an empty list. Otherwise the cache is never
            // complete and every session starts the real server at the handshake.
            None if not_found => {
                let empty = empty_list(&method);
                fetch.results.insert(method, empty);
            }
            None => fetch.complete = false,
        }
        if fetch.waiting.is_empty() {
            self.finish_start(gen)
        } else {
            Vec::new()
        }
    }

    fn finish_start(&mut self, gen: u64) -> Vec<Action> {
        let Phase::Starting {
            lists: Some(fetch), ..
        } = std::mem::replace(&mut self.phase, Phase::Ready { gen })
        else {
            return Vec::new();
        };
        let init_result = self.init_result.clone().unwrap_or_else(|| json!({}));
        let mut out = Vec::new();
        for id in std::mem::take(&mut self.init_waiters) {
            out.push(Action::ToClient(result_line(&id, &init_result)));
        }
        if fetch.complete {
            let fresh = Cache {
                initialize: init_result,
                lists: fetch.results,
            };
            if let Some(old) = &self.cache {
                for notice in changed_notices(old, &fresh) {
                    out.push(Action::ToClient(
                        json!({"jsonrpc": "2.0", "method": notice}).to_string(),
                    ));
                }
            }
            self.store.save(&self.protocol_version, &fresh);
            self.cache = Some(fresh);
        }
        for line in std::mem::take(&mut self.queue) {
            out.extend(self.on_client(&line));
        }
        out
    }

    fn fail_start(&mut self, message: &str) -> Vec<Action> {
        self.phase = Phase::Dormant;
        let mut out = self.fail_waiting(message);
        out.push(Action::Kill);
        out
    }

    fn fail_waiting(&mut self, message: &str) -> Vec<Action> {
        let mut out = Vec::new();
        for id in std::mem::take(&mut self.init_waiters) {
            out.push(Action::ToClient(error_line(&id, -32603, message)));
        }
        for (_, id) in std::mem::take(&mut self.pending) {
            out.push(Action::ToClient(error_line(&id, -32603, message)));
        }
        for line in std::mem::take(&mut self.queue) {
            if let Ok(envelope) = serde_json::from_str::<Envelope>(&line) {
                if let (Some(id), Some(_)) = (envelope.id, envelope.method) {
                    out.push(Action::ToClient(error_line(
                        &raw_to_value(id),
                        -32603,
                        message,
                    )));
                }
            }
        }
        self.refresh.clear();
        out
    }

    pub(crate) fn on_child_exit(&mut self, gen: u64) -> Vec<Action> {
        if self.live_gen() != Some(gen) {
            return Vec::new();
        }
        if matches!(self.phase, Phase::Raw { .. }) {
            return vec![Action::Exit];
        }
        self.phase = Phase::Dormant;
        self.fail_waiting("MCP server exited")
    }

    pub(crate) fn on_start_timeout(&mut self, gen: u64) -> Vec<Action> {
        if !self.is_starting(gen) {
            return Vec::new();
        }
        self.fail_start("MCP server did not finish starting in time")
    }
}

fn raw_to_value(raw: &RawValue) -> Value {
    serde_json::from_str(raw.get()).unwrap_or(Value::Null)
}

fn id_key(id: &Value) -> String {
    id.to_string()
}

fn has_cursor(params: Option<&RawValue>) -> bool {
    params
        .and_then(|raw| serde_json::from_str::<Value>(raw.get()).ok())
        .is_some_and(|value| value.get("cursor").is_some())
}

fn list_methods(initialize: &Value) -> Vec<&'static str> {
    let capabilities = initialize.get("capabilities");
    let has = |name: &str| capabilities.and_then(|caps| caps.get(name)).is_some();
    let mut methods = Vec::new();
    if has("tools") {
        methods.push("tools/list");
    }
    if has("resources") {
        methods.push("resources/list");
        methods.push("resources/templates/list");
    }
    if has("prompts") {
        methods.push("prompts/list");
    }
    methods
}

/// An empty result for a list method (field names as in the MCP spec).
fn empty_list(method: &str) -> Value {
    let field = match method {
        "tools/list" => "tools",
        "resources/list" => "resources",
        "resources/templates/list" => "resourceTemplates",
        _ => "prompts",
    };
    let mut result = serde_json::Map::new();
    result.insert(field.to_string(), Value::Array(Vec::new()));
    Value::Object(result)
}

fn changed_notices(old: &Cache, fresh: &Cache) -> Vec<&'static str> {
    let mut notices = Vec::new();
    let differs = |method: &str| old.lists.get(method) != fresh.lists.get(method);
    if differs("tools/list") {
        notices.push("notifications/tools/list_changed");
    }
    if differs("resources/list") || differs("resources/templates/list") {
        notices.push("notifications/resources/list_changed");
    }
    if differs("prompts/list") {
        notices.push("notifications/prompts/list_changed");
    }
    notices
}

fn list_request(id: &str, method: &str) -> String {
    json!({"jsonrpc": "2.0", "id": id, "method": method}).to_string()
}

fn result_line(id: &Value, result: &Value) -> String {
    json!({"jsonrpc": "2.0", "id": id, "result": result}).to_string()
}

fn error_line(id: &Value, code: i64, message: &str) -> String {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}).to_string()
}

/// Rewrites one stdio server so the engine spawns it through this proxy.
pub(crate) fn wrap(command: &str, args: &[String]) -> Result<(String, Vec<String>), String> {
    let exe = std::env::current_exe().map_err(|e| format!("resolve own exe for MCP proxy: {e}"))?;
    let mut wrapped = vec![FLAG.to_string(), "--".to_string(), command.to_string()];
    wrapped.extend(args.iter().cloned());
    Ok((exe.to_string_lossy().into_owned(), wrapped))
}

struct FileStore {
    dir: PathBuf,
    command: Vec<String>,
    cwd: String,
}

impl FileStore {
    fn path(&self, protocol_version: &str) -> PathBuf {
        use sha2::{Digest, Sha256};
        let mut parts = self.command.clone();
        parts.push(self.cwd.clone());
        parts.push(protocol_version.to_string());
        let digest = Sha256::digest(parts.join("\0").as_bytes());
        self.dir.join(format!("{digest:x}.json"))
    }
}

impl CacheStore for FileStore {
    fn load(&self, protocol_version: &str) -> Option<Cache> {
        let path = self.path(protocol_version);
        let age = file_access::fs::metadata(&path)
            .ok()?
            .modified()
            .ok()?
            .elapsed()
            .ok()?;
        if age > CACHE_MAX_AGE {
            return None;
        }
        let cache: Cache = serde_json::from_slice(&file_access::fs::read(&path).ok()?).ok()?;
        let complete = list_methods(&cache.initialize)
            .into_iter()
            .all(|method| cache.lists.contains_key(method));
        (cache.initialize.is_object() && complete).then_some(cache)
    }

    fn save(&self, protocol_version: &str, cache: &Cache) {
        let path = self.path(protocol_version);
        let write = || -> std::io::Result<()> {
            file_access::fs::create_dir_all(&self.dir)?;
            let bytes = serde_json::to_vec(cache).map_err(std::io::Error::other)?;
            let temp = path.with_extension(format!("{}.tmp", std::process::id()));
            file_access::fs::write(&temp, bytes)?;
            file_access::fs::rename(&temp, &path)
        };
        if let Err(error) = write() {
            eprintln!("[mcp-lazy] cache write failed: {error}");
        }
    }
}

/// Entry point for `--mcp-lazy -- <command> <args…>` (argv after the flag).
pub fn serve(args: Vec<String>) -> Result<(), String> {
    let command = match args.split_first() {
        Some((separator, rest)) if separator == "--" && !rest.is_empty() => rest.to_vec(),
        _ => return Err("usage: --mcp-lazy -- <command> [args…]".into()),
    };
    let cwd = std::env::current_dir()
        .map_err(|e| format!("read working directory: {e}"))?
        .to_string_lossy()
        .into_owned();
    let store = FileStore {
        dir: crate::engine_config::support::app_home().join("mcp-lazy-cache"),
        command: command.clone(),
        cwd,
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("start runtime: {e}"))?;
    runtime.block_on(runner::run(Proxy::new(store), command))
}

mod runner;

#[cfg(test)]
#[path = "lazy/tests.rs"]
mod tests;
