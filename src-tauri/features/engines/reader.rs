// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/reader.rs.
//! Stdout reader and per-turn streaming state: the capped line reader,
//! event dispatch core, and settle/cleanup path for engine process runs.

use super::codex_usage;
use super::events::EngineEvent;
#[cfg(test)]
use super::grok;
#[cfg(windows)]
use super::job;
use super::plan_review;
use super::registry::{kill_process_group, FollowupPrefs, ProcessRegistry};
use super::Engine;
use crate::engines::support::event_sink;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[cfg(test)]
use tokio::process::Command;
use tokio::process::{Child, ChildStderr, ChildStdout};
use tokio::sync::Mutex as TokioMutex;

pub(crate) const READER_SETTLE_GRACE: std::time::Duration = std::time::Duration::from_secs(10);
pub(crate) const POST_EXIT_DRAIN: std::time::Duration = std::time::Duration::from_millis(200);
pub(crate) const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;
pub(crate) fn spawn_stdin_writer(
    child: &mut Child,
    payload: Option<String>,
    keep_open: bool,
) -> Option<Arc<TokioMutex<Option<tokio::process::ChildStdin>>>> {
    if !keep_open {
        let payload = payload?;
        if let Some(mut stdin) = child.stdin.take() {
            tokio::spawn(async move {
                let _ = stdin.write_all(payload.as_bytes()).await;
                let _ = stdin.write_all(b"\n").await;
            });
        }
        return None;
    }
    let keep = Arc::new(TokioMutex::new(child.stdin.take()));
    if let Some(payload) = payload {
        let handle = Arc::clone(&keep);
        tokio::spawn(async move {
            let mut guard = handle.lock().await;
            if let Some(stdin) = guard.as_mut() {
                let _ = stdin.write_all(payload.as_bytes()).await;
                let _ = stdin.write_all(b"\n").await;
            }
        });
    }
    Some(keep)
}
pub(crate) fn ring_push(buf: &Arc<Mutex<String>>, text: &str) {
    const CAP: usize = 4096;
    let mut guard = match buf.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    guard.push_str(text);
    if guard.len() > CAP {
        let mut keep = guard.len() - CAP;
        while !guard.is_char_boundary(keep) {
            keep += 1;
        }
        guard.drain(..keep);
    }
}
pub(crate) fn spawn_stderr_capture(stderr: ChildStderr) -> Arc<Mutex<String>> {
    let buf = Arc::new(Mutex::new(String::new()));
    let target = Arc::clone(&buf);
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => ring_push(&target, &line),
            }
        }
    });
    buf
}

pub(super) fn redact_secrets(text: &str) -> String {
    use std::sync::LazyLock;
    static PATTERNS: LazyLock<Vec<regex::Regex>> = LazyLock::new(|| {
        [
            r"(?i)sk-[A-Za-z0-9_-]+",
            r"(?i)bearer\s+\S+",
            r"(?i)api[_-]?key\s*[=:]\s*\S+",
            r"(?i)token\s*[=:]\s*\S+",
        ]
        .iter()
        .filter_map(|p| regex::Regex::new(p).ok())
        .collect()
    });
    let mut out = text.to_string();
    for pattern in PATTERNS.iter() {
        out = pattern.replace_all(&out, "***").into_owned();
    }
    out
}
pub(crate) struct TurnState {
    seq: u64,
    pub(crate) native_session_id: Option<String>,
    pub(crate) saw_done: bool,
    pub(crate) saw_error: bool,
    attempt_error: Option<String>,
    saw_any_output: bool,
    pending_terminal: Option<(String, Value)>,
    exit_confirmed: bool,
    gen_open_since: Option<Instant>,
    gen_explicit: bool,
    gen_ms: u64,
    pending_background_tasks: usize,
    awaiting_followup: bool,
}
impl TurnState {
    pub(crate) fn new(preassigned: Option<String>) -> Self {
        Self {
            seq: 0,
            native_session_id: preassigned,
            saw_done: false,
            saw_error: false,
            attempt_error: None,
            saw_any_output: false,
            pending_terminal: None,
            exit_confirmed: false,
            gen_open_since: None,
            gen_explicit: false,
            gen_ms: 0,
            pending_background_tasks: 0,
            awaiting_followup: false,
        }
    }

    fn push(
        &mut self,
        sink: &Arc<event_sink::EventSink>,
        run_id: &str,
        engine_id: &str,
        kind: &str,
        data: Value,
    ) {
        self.push_meta(sink, run_id, engine_id, kind, data, None)
    }

    fn push_with_gen_ms(
        &mut self,
        sink: &Arc<event_sink::EventSink>,
        run_id: &str,
        engine_id: &str,
        kind: &str,
        data: Value,
        gen_ms: Option<u64>,
    ) {
        self.push_meta(sink, run_id, engine_id, kind, data, gen_ms)
    }

    fn push_meta(
        &mut self,
        sink: &Arc<event_sink::EventSink>,
        run_id: &str,
        engine_id: &str,
        kind: &str,
        data: Value,
        gen_ms: Option<u64>,
    ) {
        if !self.exit_confirmed
            && run_id.starts_with("pa-")
            && matches!(engine_id, "pi" | "codex")
            && matches!(kind, "done" | "error")
        {
            self.pending_terminal = Some((kind.to_string(), data));
            return;
        }
        self.seq += 1;
        let mut payload = serde_json::json!({
            "runId": run_id,
            "sessionId": self.native_session_id,
            "engine": engine_id,
            "seq": self.seq,
            "kind": kind,
            "data": data,
            "ts": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
        });
        if let Some(gen_ms) = gen_ms {
            payload["genMs"] = Value::from(gen_ms);
        }
        sink.push(payload);
    }

    fn gen_begin(&mut self, explicit: bool) {
        if self.gen_open_since.is_none() {
            self.gen_open_since = Some(Instant::now());
            self.gen_explicit = explicit;
        }
    }

    fn gen_end(&mut self) {
        if let Some(since) = self.gen_open_since.take() {
            self.gen_ms += since.elapsed().as_millis() as u64;
        }
        self.gen_explicit = false;
    }

    fn take_gen_ms(&mut self) -> Option<u64> {
        self.gen_end();
        let ms = std::mem::take(&mut self.gen_ms);
        (ms > 0).then_some(ms)
    }

    pub(crate) fn confirm_exit(&mut self, core: &TurnCore) {
        self.exit_confirmed = true;
        if let Some((kind, data)) = self.pending_terminal.take() {
            self.push(&core.sink, &core.run_id, &core.engine_id, &kind, data);
        }
    }
}
pub(crate) struct TurnCore {
    pub(crate) sink: Arc<event_sink::EventSink>,
    pub(crate) registry: Arc<ProcessRegistry>,
    pub(crate) engine_id: String,
    pub(crate) run_id: String,
    pub(crate) db: Option<Arc<crate::engines::support::db::Db>>,
    pub(crate) followup: Option<FollowupPrefs>,
}
pub(crate) fn expire_parked_plans(core: &TurnCore, state: &mut TurnState, key: &str) {
    let Some(db) = &core.db else {
        return;
    };
    let parked: Vec<(String, i64)> = core
        .registry
        .take_plans(key)
        .into_iter()
        .map(|(plan_id, revision, _)| (plan_id, revision))
        .collect();
    if let Ok(expired) = plan_review::expire_reviews(db, &parked) {
        for (plan_id, revision, _previous) in expired {
            core.dispatch_event(
                state,
                EngineEvent::PlanReviewSettled {
                    plan_id,
                    revision,
                    status: plan_review::PlanStatus::Expired.as_str().to_string(),
                },
            );
        }
    }
}

impl TurnCore {
    fn adopt_session_id(&self, state: &mut TurnState, id: &str, announce: bool) {
        if state.native_session_id.as_deref() == Some(id) {
            return;
        }
        state.native_session_id = Some(id.to_string());
        self.registry.rekey(&self.run_id, id.to_string());
        if announce {
            state.push(
                &self.sink,
                &self.run_id,
                &self.engine_id,
                "session",
                Value::String(id.to_string()),
            );
        }
    }

    pub(crate) fn dispatch_event(&self, state: &mut TurnState, event: EngineEvent) {
        if (state.saw_done || state.saw_error) && !matches!(event, EngineEvent::SessionId(_)) {
            return;
        }
        if state.awaiting_followup
            && matches!(
                event,
                EngineEvent::Delta(_) | EngineEvent::Thinking(_) | EngineEvent::Message { .. }
            )
        {
            state.awaiting_followup = false;
            self.registry.clear_awaiting_followup(&self.run_id);
            state.push(
                &self.sink,
                &self.run_id,
                &self.engine_id,
                "turn_resumed",
                Value::Null,
            );
        }
        match event {
            EngineEvent::Delta(text) => {
                state.gen_begin(false);
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "delta",
                    Value::String(text),
                )
            }
            EngineEvent::Thinking(text) => {
                state.gen_begin(false);
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "thinking",
                    Value::String(text),
                )
            }
            EngineEvent::Generation { active } => {
                if active {
                    state.gen_begin(true);
                } else {
                    state.gen_end();
                }
            }
            EngineEvent::Message {
                role,
                text,
                path,
                todos,
                args,
                result,
                patch,
                tool_call_id,
            } => {
                let response_end = role == "assistant" || (role == "tool" && result.is_none());
                if response_end && !state.gen_explicit {
                    state.gen_end();
                }
                let mut payload = serde_json::json!({ "role": role, "text": text });
                if let Some(path) = path {
                    payload["path"] = Value::String(path);
                }
                if let Some(todos) = todos {
                    if let Ok(value) = serde_json::to_value(todos) {
                        payload["todos"] = value;
                    }
                }
                if let Some(args) = args {
                    payload["args"] = args;
                }
                if let Some(result) = result {
                    payload["result"] = result;
                }
                if let Some(tool_call_id) = tool_call_id {
                    payload["toolCallId"] = Value::String(tool_call_id);
                }
                if patch {
                    payload["patch"] = Value::Bool(true);
                }
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "message",
                    payload,
                )
            }
            EngineEvent::AttemptEnd { error } => state.attempt_error = error,
            EngineEvent::SessionId(id) => self.adopt_session_id(state, &id, true),
            EngineEvent::Usage(usage) => {
                let gen_ms = state.take_gen_ms();
                state.push_with_gen_ms(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "usage",
                    usage,
                    gen_ms,
                )
            }
            EngineEvent::Error(error) => {
                state.gen_end();
                state.saw_error = true;
                crate::engines::support::mcp::mark_run_ended(&self.run_id);
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "error",
                    Value::String(plain_error_text(error)),
                );
                let registry = Arc::clone(&self.registry);
                let run_id = self.run_id.clone();
                tokio::task::spawn_blocking(move || registry.kill(&run_id));
            }
            EngineEvent::Compaction { active, reason } => {
                state.gen_end();
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "compaction",
                    serde_json::json!({ "active": active, "reason": reason }),
                );
            }
            EngineEvent::Warn(error) => {
                state.gen_end();
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "warn",
                    Value::String(error),
                );
            }
            EngineEvent::Retry {
                attempt,
                max,
                message,
            } => {
                state.gen_end();
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "retry",
                    serde_json::json!({ "attempt": attempt, "max": max, "message": message }),
                );
            }
            EngineEvent::PermissionDenied {
                tool,
                path,
                message,
                tool_use_id,
            } => {
                state.gen_end();
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "permission_denied",
                    serde_json::json!({
                        "tool": tool,
                        "path": path,
                        "message": message,
                        "toolUseId": tool_use_id,
                    }),
                );
            }
            EngineEvent::Question {
                request_id,
                tool_use_id,
                input,
            } => {
                state.gen_end();
                if let Some(entry) = self.registry.get(&self.run_id) {
                    if let Ok(mut questions) = entry.questions.lock() {
                        let parked_input = if self.engine_id == "codebuddy" {
                            serde_json::json!({
                                "codebuddyQuestion": { "input": input, "toolUseId": tool_use_id },
                            })
                        } else {
                            input.clone()
                        };
                        questions.insert(request_id.clone(), parked_input);
                    }
                }
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "question",
                    serde_json::json!({
                        "requestId": request_id,
                        "toolUseId": tool_use_id,
                        "input": input,
                    }),
                );
            }
            EngineEvent::PlanDraft {
                plan_id,
                text,
                replace,
            } => {
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "plan_draft",
                    serde_json::json!({
                        "planId": plan_id,
                        "text": text,
                        "replace": replace,
                    }),
                );
            }
            EngineEvent::PlanReviewReady { record, context } => {
                state.gen_end();
                let mut record = *record;
                if let Some(db) = &self.db {
                    match plan_review::record_review(db, &record) {
                        Ok(revision) => record.revision = revision,
                        Err(error) => {
                            self.dispatch_event(
                                state,
                                EngineEvent::Error(format!(
                                    "plan review could not be persisted: {error}"
                                )),
                            );
                            return;
                        }
                    }
                }
                if record.review_kind == plan_review::PlanReviewKind::NativeRequest {
                    if let Some(entry) = self.registry.get(&self.run_id) {
                        if let Ok(mut plans) = entry.plans.lock() {
                            let mut parked = context;
                            if let Some(map) = parked.as_object_mut() {
                                map.insert(
                                    "revision".to_string(),
                                    serde_json::Value::from(record.revision),
                                );
                            } else {
                                parked = serde_json::json!({
                                    "revision": record.revision,
                                    "opaque": parked,
                                });
                            }
                            plans.insert(record.plan_id.clone(), parked);
                        }
                    }
                }
                let payload = serde_json::to_value(&record)
                    .unwrap_or_else(|_| serde_json::json!({ "planId": record.plan_id }));
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "plan_review",
                    payload,
                );
            }
            EngineEvent::PlanReviewSettled {
                plan_id,
                revision,
                status,
            } => {
                if let Some(entry) = self.registry.get(&self.run_id) {
                    if let Ok(mut plans) = entry.plans.lock() {
                        plans.remove(&plan_id);
                    }
                }
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "plan_review_settled",
                    serde_json::json!({
                        "planId": plan_id,
                        "revision": revision,
                        "status": status,
                    }),
                );
            }
            EngineEvent::AgentSettled => {
                let event = match state.attempt_error.take() {
                    Some(error) => EngineEvent::Error(error),
                    None => EngineEvent::Done {
                        session_id: None,
                        usage: None,
                    },
                };
                self.dispatch_event(state, event);
            }
            EngineEvent::QuestionSettled { request_id } => {
                if let Some(entry) = self.registry.get(&self.run_id) {
                    if let Ok(mut questions) = entry.questions.lock() {
                        questions.remove(&request_id);
                    }
                }
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "question_settled",
                    serde_json::json!({ "requestId": request_id }),
                );
            }
            EngineEvent::ControlPermission {
                request_id,
                tool_name,
                input,
            } => {
                state.gen_end();
                crate::engines::gate::answer_control_permission(
                    Arc::clone(&self.registry),
                    self.run_id.clone(),
                    request_id,
                    tool_name,
                    input,
                );
            }
            EngineEvent::ElicitationDecline { request_id } => {
                let registry = Arc::clone(&self.registry);
                let run_id = self.run_id.clone();
                let line = serde_json::json!({
                    "type": "control_response",
                    "response": {
                        "subtype": "success",
                        "request_id": request_id,
                        "response": { "action": "decline" },
                    },
                })
                .to_string();
                tokio::spawn(async move {
                    let _ = registry.write_line(&run_id, line).await;
                });
            }
            EngineEvent::ControlRequestError {
                request_id,
                subtype,
            } => {
                let registry = Arc::clone(&self.registry);
                let run_id = self.run_id.clone();
                let line = serde_json::json!({
                    "type": "control_response",
                    "response": {
                        "subtype": "error",
                        "request_id": request_id,
                        "error": format!("unsupported control request subtype: {subtype}"),
                    },
                })
                .to_string();
                tokio::spawn(async move {
                    let _ = registry.write_line(&run_id, line).await;
                });
            }
            EngineEvent::Model(model) => {
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "model",
                    Value::String(model),
                );
            }
            EngineEvent::Effort(effort) => {
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "effort",
                    Value::String(effort),
                );
            }
            EngineEvent::Launch {
                model,
                effort,
                comparison_model,
                reports_served,
            } => {
                let mut payload = selection_payload(model, effort);
                if let Some(model) = comparison_model {
                    payload["comparisonModel"] = model.map(Value::String).unwrap_or(Value::Null);
                }
                if reports_served {
                    payload["reportsServed"] = Value::Bool(true);
                }
                state.push(&self.sink, &self.run_id, &self.engine_id, "launch", payload);
            }
            EngineEvent::Served { model, effort } => {
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "served",
                    selection_payload(model, effort),
                );
            }
            EngineEvent::SessionTitle(title) => {
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "session_title",
                    Value::String(title),
                );
            }
            EngineEvent::SessionMode(mode) => {
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "session_mode",
                    Value::String(mode),
                );
            }
            EngineEvent::SessionChoice { model, effort } => {
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "session_choice",
                    selection_payload(model, effort),
                );
            }
            EngineEvent::McpServers { servers, tools } => {
                crate::engines::support::mcp::record_from_run(
                    &self.run_id,
                    state.native_session_id.as_deref(),
                    servers,
                    tools,
                );
            }
            EngineEvent::BackgroundTasks { pending } => {
                state.pending_background_tasks = pending;
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "background_tasks",
                    serde_json::json!({ "pending": pending }),
                );
            }
            EngineEvent::Scope { parent } => {
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "scope",
                    serde_json::json!({ "parent": parent }),
                );
            }
            EngineEvent::Done { session_id, usage } => {
                let gen_ms = state.take_gen_ms();
                if let Some(id) = session_id {
                    self.adopt_session_id(state, &id, false);
                }
                let background = state.pending_background_tasks > 0;
                let park_prefs = self.followup.clone().filter(|prefs| {
                    background || (prefs.warm && state.native_session_id.is_some())
                });
                let warm = park_prefs.is_some() && !background;
                if let Some(prefs) = park_prefs {
                    state.awaiting_followup = true;
                    if let Some(id) = state.native_session_id.as_deref() {
                        if warm {
                            let (since, evicted) =
                                self.registry.set_warm_followup(id, &self.run_id, prefs);
                            for run in evicted {
                                self.registry.close_stdin(&run);
                            }
                            super::registry::reap_when_idle(
                                Arc::clone(&self.registry),
                                id.to_string(),
                                self.run_id.clone(),
                                since,
                            );
                        } else {
                            self.registry.set_awaiting_followup(id, &self.run_id, prefs);
                        }
                    }
                } else {
                    state.saw_done = true;
                    state.awaiting_followup = false;
                    self.registry.clear_awaiting_followup(&self.run_id);
                    crate::engines::support::mcp::mark_run_ended(&self.run_id);
                    self.registry.close_stdin(&self.run_id);
                }
                state.push_with_gen_ms(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "done",
                    serde_json::json!({ "usage": usage, "warm": warm }),
                    gen_ms,
                );
            }
        }
    }
}
pub(crate) struct RunContext {
    pub(crate) core: TurnCore,
    pub(crate) engine_impl: Box<dyn Engine>,
    pub(crate) pid: u32,
    pub(crate) preassigned_session_id: Option<String>,
    pub(crate) initial_model: Option<String>,
    pub(crate) comparison_model: Option<Option<String>>,
    pub(crate) initial_effort: Option<String>,
    pub(crate) child: Arc<TokioMutex<Child>>,
    pub(crate) killed: Arc<std::sync::atomic::AtomicBool>,
    pub(crate) cleanup_files: Vec<PathBuf>,
    pub(crate) stderr_buf: Arc<Mutex<String>>,
    pub(crate) stdout_plain_buf: Arc<Mutex<String>>,
    #[cfg(windows)]
    pub(crate) _tree_guard: Option<Arc<job::KillOnCloseJob>>,
}
impl Drop for RunContext {
    fn drop(&mut self) {
        cleanup_staged_files(&self.cleanup_files);
        self.core
            .registry
            .remove_run_if_pid(&self.core.run_id, self.pid);
    }
}
impl RunContext {
    fn dispatch_event(&self, state: &mut TurnState, event: EngineEvent) {
        self.core.dispatch_event(state, event);
    }
}
pub(crate) fn plain_error_text(error: String) -> String {
    let trimmed = error.trim();
    if !trimmed.starts_with('{') {
        return error;
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return error;
    };
    ["/error/message", "/message", "/error"]
        .iter()
        .find_map(|pointer| value.pointer(pointer).and_then(Value::as_str))
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(str::to_string)
        .unwrap_or(error)
}

pub(crate) struct VirtualRunGuard {
    registry: Arc<ProcessRegistry>,
    run_id: String,
    virtual_pid: u32,
}

impl VirtualRunGuard {
    pub(crate) fn new(registry: Arc<ProcessRegistry>, run_id: String, virtual_pid: u32) -> Self {
        Self {
            registry,
            run_id,
            virtual_pid,
        }
    }
}

impl Drop for VirtualRunGuard {
    fn drop(&mut self) {
        self.registry
            .remove_run_if_pid(&self.run_id, self.virtual_pid);
    }
}

pub fn sweep_staging_dirs() {
    let home = crate::engines::support::paths::app_home();
    for name in [
        "claude-staging",
        "grok-staging",
        "codex-plan-staging",
        "codebuddy-staging",
    ] {
        let dir = home.join(name);
        if file_access::fs::exists(&dir) {
            if let Err(error) = file_access::fs::remove_dir_all(&dir) {
                eprintln!(
                    "[engine] failed to sweep staging dir {}: {error}",
                    dir.display()
                );
            }
        }
    }
}
pub(crate) fn cleanup_staged_files(paths: &[PathBuf]) {
    for path in paths {
        let result = if file_access::fs::is_dir(path) {
            file_access::fs::remove_dir_all(path)
        } else {
            file_access::fs::remove_file(path)
        };
        if let Err(error) = result {
            if error.kind() != std::io::ErrorKind::NotFound {
                eprintln!(
                    "[engine] failed to remove staging path {}: {error}",
                    path.display()
                );
            }
        }
    }
}
pub(crate) enum LineRead {
    Line(Vec<u8>),
    Eof,
    TooLong,
}
pub(crate) async fn read_line_capped(
    reader: &mut BufReader<ChildStdout>,
    line: &mut Vec<u8>,
) -> std::io::Result<LineRead> {
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return Ok(if line.is_empty() {
                LineRead::Eof
            } else {
                LineRead::Line(std::mem::take(line))
            });
        }
        let end = available
            .iter()
            .position(|b| *b == b'\n')
            .unwrap_or(available.len());
        if line.len() + end > MAX_LINE_BYTES {
            return Ok(LineRead::TooLong);
        }
        line.extend_from_slice(&available[..end]);
        let has_newline = end < available.len();
        reader.consume(end + usize::from(has_newline));
        if has_newline {
            return Ok(LineRead::Line(std::mem::take(line)));
        }
    }
}
fn selection_payload(model: Option<String>, effort: Option<String>) -> Value {
    let mut out = serde_json::Map::new();
    if let Some(model) = model.filter(|m| !m.trim().is_empty()) {
        out.insert("model".to_string(), Value::String(model));
    }
    if let Some(effort) = effort.filter(|e| !e.trim().is_empty()) {
        out.insert("effort".to_string(), Value::String(effort));
    }
    Value::Object(out)
}
pub(crate) async fn run_reader(stdout: ChildStdout, ctx: RunContext) {
    let mut state = TurnState::new(ctx.preassigned_session_id.clone());
    if ctx.initial_model.is_some() || ctx.initial_effort.is_some() {
        ctx.dispatch_event(
            &mut state,
            EngineEvent::Launch {
                comparison_model: ctx.comparison_model.clone(),
                model: ctx.initial_model.clone(),
                effort: ctx.initial_effort.clone(),
                reports_served: ctx.engine_impl.reports_served(),
            },
        );
    }
    let mut reader = BufReader::new(stdout);
    let mut line_buf = Vec::new();
    let is_codex = ctx.core.engine_id == "codex";
    let mut usage_tail: Option<codex_usage::UsageTail> = None;
    let mut stream_session_id = false;
    let mut tail_attempts = 0u32;
    let mut poll = tokio::time::interval(std::time::Duration::from_millis(500));
    poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let (exit_tx, mut exit_rx) = tokio::sync::oneshot::channel::<()>();
    {
        let child = Arc::clone(&ctx.child);
        tokio::spawn(async move {
            let mut guard = child.lock().await;
            let _ = guard.wait().await;
            let _ = exit_tx.send(());
        });
    }
    let mut child_exited = false;
    loop {
        let read = tokio::select! {
            line = read_line_capped(&mut reader, &mut line_buf) => line,
            _ = &mut exit_rx, if !child_exited => {
                child_exited = true;
                continue;
            }
            _ = poll.tick(), if is_codex && !state.saw_done && !state.saw_error => {
                if let Some(tail) = usage_tail.as_mut() {
                    for usage in tail.poll() {
                        ctx.dispatch_event(&mut state, EngineEvent::Usage(usage));
                    }
                } else if stream_session_id && tail_attempts < 20 {
                    tail_attempts += 1;
                    usage_tail = state
                        .native_session_id
                        .as_deref()
                        .and_then(codex_usage::UsageTail::open);
                }
                continue;
            }
            _ = tokio::time::sleep(POST_EXIT_DRAIN), if child_exited => break,
        };
        let line = match read {
            Ok(LineRead::Line(bytes)) => bytes,
            Ok(LineRead::Eof) => break,
            Ok(LineRead::TooLong) => {
                ctx.dispatch_event(
                    &mut state,
                    EngineEvent::Error(format!(
                        "{} emitted a line over {} MiB without a newline; run terminated",
                        ctx.core.engine_id,
                        MAX_LINE_BYTES / (1024 * 1024),
                    )),
                );
                break;
            }
            Err(_) => break,
        };
        let text = String::from_utf8_lossy(&line);
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        state.saw_any_output = true;
        if serde_json::from_str::<Value>(trimmed).is_err() {
            ring_push(&ctx.stdout_plain_buf, &format!("{trimmed}\n"));
        }
        let mut events = Vec::new();
        ctx.engine_impl.parse_line(trimmed, &mut events);
        stream_session_id |= events
            .iter()
            .any(|event| matches!(event, EngineEvent::SessionId(_)));
        for mut event in events {
            if matches!(event, EngineEvent::Done { .. } | EngineEvent::Error(_))
                && !state.saw_done
                && !state.saw_error
            {
                if let Some(tail) = usage_tail.as_mut() {
                    for usage in tail.poll() {
                        ctx.dispatch_event(&mut state, EngineEvent::Usage(usage));
                    }
                    if let EngineEvent::Done {
                        usage: Some(usage), ..
                    } = &mut event
                    {
                        *usage = tail.with_window(usage);
                    }
                }
            }
            ctx.dispatch_event(&mut state, event);
        }
    }

    if let Some(tail) = usage_tail.as_mut() {
        for usage in tail.poll() {
            ctx.dispatch_event(&mut state, EngineEvent::Usage(usage));
        }
    }

    let status = {
        let mut guard = ctx.child.lock().await;
        guard.wait().await.ok()
    };
    #[cfg(unix)]
    if ctx.pid != 0 {
        kill_process_group(ctx.pid);
    }
    for path in &ctx.cleanup_files {
        let _ = file_access::fs::remove_file(path);
    }
    ctx.core.registry.clear_awaiting_followup(&ctx.core.run_id);
    if state.awaiting_followup {
        crate::engines::support::mcp::mark_run_ended(&ctx.core.run_id);
        state.push(
            &ctx.core.sink,
            &ctx.core.run_id,
            &ctx.core.engine_id,
            "process_closed",
            Value::Null,
        );
    }
    let _ = file_access::fs::remove_file(crate::engines::pi_family::served_models_path(
        &ctx.core.run_id,
    ));
    for key in [
        state.native_session_id.clone(),
        Some(ctx.core.run_id.clone()),
    ]
    .into_iter()
    .flatten()
    {
        for request_id in ctx.core.registry.take_questions(&key) {
            ctx.dispatch_event(&mut state, EngineEvent::QuestionSettled { request_id });
        }
        expire_parked_plans(&ctx.core, &mut state, &key);
    }
    if let Some(key) = state.native_session_id.clone() {
        ctx.core.registry.remove_if_pid(&key, ctx.pid);
    }
    ctx.core.registry.remove_if_pid(&ctx.core.run_id, ctx.pid);
    if let Some(key) = ctx.preassigned_session_id.as_deref() {
        ctx.core.registry.remove_if_pid(key, ctx.pid);
    }
    let stderr_tail = ctx
        .stderr_buf
        .lock()
        .map(|g| redact_secrets(g.trim()))
        .unwrap_or_default();
    let failed = status.map(|s| !s.success()).unwrap_or(true);
    if failed && !state.saw_error && !stderr_tail.is_empty() {
        state.push(
            &ctx.core.sink,
            &ctx.core.run_id,
            &ctx.core.engine_id,
            "warn",
            Value::String(format!("engine stderr: {stderr_tail}")),
        );
    }

    if !state.saw_done && !state.saw_error && !state.awaiting_followup {
        let killed = ctx.killed.load(std::sync::atomic::Ordering::SeqCst);
        if killed {
            state.push(
                &ctx.core.sink,
                &ctx.core.run_id,
                &ctx.core.engine_id,
                "done",
                serde_json::json!({ "usage": null }),
            );
        } else if failed || !state.saw_any_output || state.attempt_error.is_some() {
            let mut message = state.attempt_error.take().unwrap_or_else(|| {
                format!(
                    "{} exited with status {}",
                    ctx.core.engine_id,
                    status
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| "unknown".to_string())
                )
            });
            if !stderr_tail.is_empty() {
                message.push_str(&format!(": {stderr_tail}"));
            } else {
                let stdout_tail = ctx
                    .stdout_plain_buf
                    .lock()
                    .map(|g| redact_secrets(g.trim()))
                    .unwrap_or_default();
                if !stdout_tail.is_empty() {
                    message.push_str(&format!(": {stdout_tail}"));
                }
            }
            state.push(
                &ctx.core.sink,
                &ctx.core.run_id,
                &ctx.core.engine_id,
                "error",
                Value::String(message),
            );
        } else {
            state.push(
                &ctx.core.sink,
                &ctx.core.run_id,
                &ctx.core.engine_id,
                "done",
                serde_json::json!({ "usage": null }),
            );
        }
    }
    if status.is_some() {
        state.confirm_exit(&ctx.core);
    }
    ctx.core.sink.flush();
}
#[cfg(test)]
mod staging_tests {
    use super::*;
    use crate::engines::ChildEntry;
    use std::collections::HashMap;

    #[test]
    fn ring_push_snaps_truncation_to_char_boundary() {
        let buf = Arc::new(Mutex::new(String::new()));
        ring_push(&buf, &"引擎错误".repeat(1000));
        let kept = buf.lock().unwrap_or_else(|p| p.into_inner());
        assert!(kept.len() <= 4096);
        assert!(kept.ends_with("引擎错误"));
    }

    #[test]
    fn selection_payload_omits_unreported_sides() {
        assert_eq!(
            selection_payload(Some("claude-opus-5-5".to_string()), None),
            serde_json::json!({ "model": "claude-opus-5-5" })
        );
        assert_eq!(
            selection_payload(None, Some("xhigh".to_string())),
            serde_json::json!({ "effort": "xhigh" })
        );
        assert_eq!(
            selection_payload(Some(" ".to_string()), Some(String::new())),
            serde_json::json!({})
        );
    }

    #[tokio::test]
    async fn launch_event_preserves_resolved_and_unresolved_alias_evidence() {
        struct Capture(Mutex<Vec<Value>>);
        impl event_sink::Emit for Capture {
            fn emit_json(&self, _: &str, payload: &str) {
                self.0
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str(payload).unwrap());
            }
        }
        let capture = Arc::new(Capture(Mutex::new(Vec::new())));
        let sink = event_sink::EventSink::new(capture.clone());
        let core = TurnCore {
            sink,
            registry: Arc::new(ProcessRegistry::default()),
            engine_id: "claude".into(),
            run_id: "test".into(),
            db: None,
            followup: None,
        };
        let mut state = TurnState::new(None);
        for (model, reports_served) in [(Some("claude-opus-5-5".to_string()), true), (None, false)]
        {
            core.dispatch_event(
                &mut state,
                EngineEvent::Launch {
                    model: Some("opus".into()),
                    effort: Some("high".into()),
                    comparison_model: Some(model),
                    reports_served,
                },
            );
        }
        core.sink.flush();
        let emitted = capture.0.lock().unwrap();
        let events: Vec<_> = emitted
            .iter()
            .flat_map(|batch| batch.as_array().unwrap())
            .collect();
        assert_eq!(
            events[0]["data"],
            serde_json::json!({"model":"opus", "effort":"high", "comparisonModel":"claude-opus-5-5", "reportsServed":true})
        );
        assert_eq!(
            events[1]["data"],
            serde_json::json!({"model":"opus", "effort":"high", "comparisonModel":null})
        );
    }

    struct Noop;
    impl event_sink::Emit for Noop {
        fn emit_json(&self, _: &str, _: &str) {}
    }

    #[tokio::test]
    async fn reader_context_cleans_private_configs_on_completion_and_abort() {
        for abort in [false, true] {
            let directory =
                std::env::temp_dir().join(format!("ccgui-reader-cleanup-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(directory.join("config.toml"), "temporary credential").unwrap();
            let mut command = Command::new(if cfg!(windows) { "cmd.exe" } else { "sh" });
            command.args(if cfg!(windows) {
                ["/c", "exit 0"]
            } else {
                ["-c", "exit 0"]
            });
            let mut child = command.spawn().unwrap();
            child.wait().await.unwrap();
            let ctx = RunContext {
                core: TurnCore {
                    sink: event_sink::EventSink::new(Arc::new(Noop)),
                    registry: Arc::new(ProcessRegistry::default()),
                    engine_id: "grok".into(),
                    run_id: "test".into(),
                    db: None,
                    followup: None,
                },
                engine_impl: Box::new(grok::GrokEngine),
                pid: 0,
                preassigned_session_id: None,
                initial_model: None,
                comparison_model: None,
                initial_effort: None,
                child: Arc::new(TokioMutex::new(child)),
                killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                cleanup_files: vec![directory.clone()],
                stderr_buf: Arc::new(Mutex::new(String::new())),
                stdout_plain_buf: Arc::new(Mutex::new(String::new())),
                #[cfg(windows)]
                _tree_guard: None,
            };
            let task = tokio::spawn(async move {
                if abort {
                    std::future::pending::<()>().await;
                }
                drop(ctx);
            });
            if abort {
                task.abort();
            }
            let result = task.await;
            assert_eq!(result.is_err(), abort);
            assert!(!directory.exists());
        }
    }

    #[tokio::test]
    async fn dropping_a_run_context_frees_the_runs_concurrency_slot() {
        let mut command = Command::new(if cfg!(windows) { "cmd.exe" } else { "sh" });
        command.args(if cfg!(windows) {
            ["/c", "exit 0"]
        } else {
            ["-c", "exit 0"]
        });
        let mut child = command.spawn().unwrap();
        child.wait().await.unwrap();
        let registry = Arc::new(ProcessRegistry::default());
        let entry = ChildEntry {
            child: None,
            pid: 4242,
            run_id: "run-abort".into(),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            reader_abort: Arc::new(std::sync::OnceLock::new()),
            stdin: None,
            questions: Arc::new(Mutex::new(HashMap::new())),
            plans: Arc::new(Mutex::new(HashMap::new())),
        };
        registry.insert("run-abort".into(), entry.clone());
        registry.insert_alias("session-abort".into(), entry);
        let ctx = RunContext {
            core: TurnCore {
                sink: event_sink::EventSink::new(Arc::new(Noop)),
                registry: Arc::clone(&registry),
                engine_id: "grok".into(),
                run_id: "run-abort".into(),
                db: None,
                followup: None,
            },
            engine_impl: Box::new(grok::GrokEngine),
            pid: 4242,
            preassigned_session_id: None,
            initial_model: None,
            comparison_model: None,
            initial_effort: None,
            child: Arc::new(TokioMutex::new(child)),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            cleanup_files: Vec::new(),
            stderr_buf: Arc::new(Mutex::new(String::new())),
            stdout_plain_buf: Arc::new(Mutex::new(String::new())),
            #[cfg(windows)]
            _tree_guard: None,
        };
        let task = tokio::spawn(async move {
            let _held = ctx;
            std::future::pending::<()>().await;
        });
        task.abort();
        assert!(task.await.is_err());

        assert!(
            registry.get("run-abort").is_none(),
            "run-id key survived the abort"
        );
        assert!(
            registry.get("session-abort").is_none(),
            "session alias survived the abort"
        );
    }

    #[tokio::test]
    async fn dropping_a_virtual_run_guard_frees_every_key_of_that_run() {
        let registry = Arc::new(ProcessRegistry::default());
        let entry = ChildEntry {
            child: None,
            pid: 5150,
            run_id: "run-v".into(),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            reader_abort: Arc::new(std::sync::OnceLock::new()),
            stdin: None,
            questions: Arc::new(Mutex::new(HashMap::new())),
            plans: Arc::new(Mutex::new(HashMap::new())),
        };
        registry.insert("run-v".into(), entry.clone());
        registry.insert_alias("session-v".into(), entry);
        registry.insert(
            "run-other".into(),
            ChildEntry {
                child: None,
                pid: 5151,
                run_id: "run-other".into(),
                killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                reader_abort: Arc::new(std::sync::OnceLock::new()),
                stdin: None,
                questions: Arc::new(Mutex::new(HashMap::new())),
                plans: Arc::new(Mutex::new(HashMap::new())),
            },
        );

        {
            let _guard = VirtualRunGuard::new(Arc::clone(&registry), "run-v".into(), 5150);
            assert!(registry.get("run-v").is_some());
        }

        assert!(registry.get("run-v").is_none());
        assert!(registry.get("session-v").is_none());
        assert!(
            registry.get("run-other").is_some(),
            "unrelated run was swept"
        );
    }
}
#[cfg(test)]
mod terminal_event_tests {
    use super::*;

    #[derive(Default)]
    struct Collector(Mutex<Vec<Value>>);
    impl event_sink::Emit for Collector {
        fn emit_json(&self, _: &str, raw: &str) {
            self.0
                .lock()
                .unwrap()
                .extend(serde_json::from_str::<Vec<Value>>(raw).unwrap());
        }
    }

    #[tokio::test]
    async fn plugin_pi_and_codex_terminals_wait_for_confirmed_exit() {
        for engine in ["pi", "codex"] {
            for fail in [false, true] {
                let collector = Arc::new(Collector::default());
                let core = TurnCore {
                    sink: event_sink::EventSink::with_name(
                        collector.clone(),
                        event_sink::ENGINE_EVENT_NAME,
                    ),
                    registry: Arc::new(ProcessRegistry::default()),
                    engine_id: engine.into(),
                    run_id: "pa-relay-test".into(),
                    db: None,
                    followup: None,
                };
                let mut state = TurnState::new(None);
                core.dispatch_event(
                    &mut state,
                    if fail {
                        EngineEvent::Error("failed".into())
                    } else {
                        EngineEvent::Done {
                            session_id: None,
                            usage: None,
                        }
                    },
                );
                core.sink.flush();
                assert!(collector.0.lock().unwrap().is_empty());
                state.confirm_exit(&core);
                state.confirm_exit(&core);
                core.sink.flush();
                let events = collector.0.lock().unwrap();
                assert_eq!(events.len(), 1);
                assert_eq!(events[0]["kind"], if fail { "error" } else { "done" });
            }
        }
    }

    #[tokio::test]
    async fn usage_reports_carry_the_measured_generation_window() {
        let collector = Arc::new(Collector::default());
        let core = TurnCore {
            sink: event_sink::EventSink::new(collector.clone()),
            registry: Arc::new(ProcessRegistry::default()),
            engine_id: "pi".into(),
            run_id: "gen-ms-test".into(),
            db: None,
            followup: None,
        };
        let mut state = TurnState::new(Some("session".into()));
        let tool_start = || EngineEvent::Message {
            role: "tool".into(),
            text: "read".into(),
            path: None,
            todos: None,
            args: None,
            result: None,
            patch: false,
            tool_call_id: None,
        };

        core.dispatch_event(&mut state, EngineEvent::Generation { active: true });
        core.dispatch_event(&mut state, EngineEvent::Delta("hi".into()));
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        core.dispatch_event(&mut state, tool_start());
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        core.dispatch_event(
            &mut state,
            EngineEvent::Usage(serde_json::json!({"output_tokens": 3})),
        );

        core.dispatch_event(&mut state, EngineEvent::Delta("mid".into()));
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        core.dispatch_event(&mut state, tool_start());
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        core.dispatch_event(
            &mut state,
            EngineEvent::Usage(serde_json::json!({"output_tokens": 3})),
        );

        core.sink.flush();
        let events = collector.0.lock().unwrap();
        let usages: Vec<u64> = events
            .iter()
            .filter(|event| event["kind"] == "usage")
            .filter_map(|event| event.get("genMs").and_then(Value::as_u64))
            .collect();
        assert_eq!(usages.len(), 2, "both usage reports carry genMs");
        assert!(
            usages[0] >= 200,
            "explicit window ignored the tool row: {usages:?}"
        );
        assert!(
            usages[1] < 200,
            "implicit window closed at the tool row: {usages:?}"
        );
    }

    #[tokio::test]
    async fn terminal_runs_do_not_emit_late_usage_text_or_duplicate_completion() {
        for fail in [false, true] {
            let collector = Arc::new(Collector::default());
            let core = TurnCore {
                sink: event_sink::EventSink::new(collector.clone()),
                registry: Arc::new(ProcessRegistry::default()),
                engine_id: "codex".into(),
                run_id: "terminal-test".into(),
                db: None,
                followup: None,
            };
            let mut state = TurnState::new(Some("session".into()));
            core.dispatch_event(&mut state, EngineEvent::Delta("完成中文与 emoji 🐎".into()));
            core.dispatch_event(
                &mut state,
                EngineEvent::Usage(
                    serde_json::json!({"input_tokens": 90000, "model_context_window":1000000}),
                ),
            );
            core.dispatch_event(
                &mut state,
                if fail {
                    EngineEvent::Error("failed".into())
                } else {
                    EngineEvent::Done {
                        session_id: None,
                        usage: None,
                    }
                },
            );
            core.dispatch_event(
                &mut state,
                EngineEvent::Usage(serde_json::json!({"input_tokens":90000})),
            );
            core.dispatch_event(&mut state, EngineEvent::Delta("late".into()));
            core.dispatch_event(
                &mut state,
                EngineEvent::Done {
                    session_id: None,
                    usage: None,
                },
            );
            core.sink.flush();
            let events = collector.0.lock().unwrap();
            let kinds: Vec<_> = events
                .iter()
                .map(|event| event["kind"].as_str().unwrap())
                .collect();
            assert_eq!(
                kinds,
                ["delta", "usage", if fail { "error" } else { "done" }]
            );
            assert_eq!(events[0]["data"], "完成中文与 emoji 🐎");
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn plugin_pi_interrupt_emits_terminal_only_after_child_exit() {
        for early_done in [false, true] {
            let mut command = Command::new("sh");
            let delta = r#"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"ready"}}"#;
            let done = if early_done {
                r#"printf '%s\n' '{"type":"agent_end","messages":[{"role":"assistant","stopReason":"stop"}]}';"#
            } else {
                ""
            };
            command.args([
                "-c",
                &format!("printf '%s\\n' '{delta}'; {done} exec sleep 30"),
            ]);
            command
                .stdout(std::process::Stdio::piped())
                .process_group(0)
                .kill_on_drop(true);
            let mut child = command.spawn().unwrap();
            let pid = child.id().unwrap();
            let stdout = child.stdout.take().unwrap();
            let child = Arc::new(TokioMutex::new(child));
            let collector = Arc::new(Collector::default());
            let sink =
                event_sink::EventSink::with_name(collector.clone(), event_sink::ENGINE_EVENT_NAME);
            let registry = Arc::new(ProcessRegistry::default());
            let killed = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let run_id = "pa-relay-interrupt";
            registry.insert(
                run_id.into(),
                crate::engines::ChildEntry {
                    child: Some(child.clone()),
                    pid,
                    run_id: run_id.into(),
                    killed: killed.clone(),
                    reader_abort: Arc::new(std::sync::OnceLock::new()),
                    stdin: None,
                    questions: Arc::new(Mutex::new(std::collections::HashMap::new())),
                    plans: Arc::new(Mutex::new(std::collections::HashMap::new())),
                },
            );
            let context = RunContext {
                core: TurnCore {
                    sink: sink.clone(),
                    registry: registry.clone(),
                    engine_id: "pi".into(),
                    run_id: run_id.into(),
                    db: None,
                    followup: None,
                },
                engine_impl: Box::new(crate::engines::pi_family::pi()),
                pid,
                preassigned_session_id: None,
                initial_model: None,
                comparison_model: None,
                initial_effort: None,
                child: child.clone(),
                killed,
                cleanup_files: vec![],
                stderr_buf: Arc::new(Mutex::new(String::new())),
                stdout_plain_buf: Arc::new(Mutex::new(String::new())),
            };
            let reader = tokio::spawn(run_reader(stdout, context));
            tokio::time::timeout(std::time::Duration::from_secs(3), async {
                loop {
                    sink.flush();
                    if !collector.0.lock().unwrap().is_empty() {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            sink.flush();
            assert!(!collector
                .0
                .lock()
                .unwrap()
                .iter()
                .any(|event| matches!(event["kind"].as_str(), Some("done" | "error"))));
            assert!(registry.kill(run_id));
            tokio::time::timeout(std::time::Duration::from_secs(3), reader)
                .await
                .unwrap()
                .unwrap();
            assert!(child.lock().await.try_wait().unwrap().is_some());
            assert_eq!(registry.active_run_count(), 0);
            let events = collector.0.lock().unwrap();
            assert_eq!(
                events
                    .iter()
                    .filter(|event| matches!(event["kind"].as_str(), Some("done" | "error")))
                    .count(),
                1
            );
            assert_eq!(events.last().unwrap()["kind"], "done");
        }
    }
}
#[cfg(test)]
#[path = "reader_plan_dispatch_tests.rs"]
mod plan_dispatch_tests;

#[cfg(test)]
mod plain_error_tests {
    use super::plain_error_text;

    #[test]
    fn a_provider_json_reply_shows_its_own_message() {
        let raw = r#"{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.","code":"model_not_found"}}"#;
        assert_eq!(
            plain_error_text(raw.into()),
            "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account."
        );
        assert_eq!(plain_error_text(r#"{"message":"quota"}"#.into()), "quota");
        assert_eq!(plain_error_text("Not signed in".into()), "Not signed in");
        assert_eq!(plain_error_text("{not json".into()), "{not json");
        assert_eq!(plain_error_text(r#"{"code":1}"#.into()), r#"{"code":1}"#);
    }
}
