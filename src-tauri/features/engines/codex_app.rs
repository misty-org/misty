// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/codex_app.rs.
//! Codex **app-server** transport (`codex app-server`), the codex path that can
//! actually ask the user a question mid-turn.
//!
//! The exec transport (`codex.rs`) launches the same CLI one-shot: it resolves
//! its own `requestUserInput` prompts from the defaults baked into the run, so a
//! question never reaches the app's card UI. The app-server is a resident
//! JSON-RPC peer instead — it asks either with a server→client request that
//! parks the turn, or with question metadata attached to an `agentMessage`.
//! Blocking answers return on stdin; async answers steer the active turn. This
//! module owns the pump, item projection, and both answer routes.
//!
//! Wire (verified against the installed CLI, whose shipped JSON schema is the
//! source of truth here): `initialize {clientInfo}` → `thread/start
//! {cwd, sandbox, approvalPolicy}` (or `thread/resume {threadId, excludeTurns}`
//! for a session the app already holds) → `turn/start {threadId, input}`, which
//! acknowledges immediately with `{turn:{id}}`; the work then streams as `item/*` and
//! `item/agentMessage/delta` notifications and only `turn/completed` ends the
//! turn. Two schema facts shape the code below: `turn/completed` carries no
//! usage (it arrives earlier via `thread/tokenUsage/updated`), and there is no
//! `turn/failed` notification — a failed turn is a `turn/completed` whose
//! `turn.status` is `failed` with an explanatory `turn.error.message`. Both
//! shapes are terminal so a newer CLI cannot hang the pump until the prompt
//! timeout.
//!
//! Approvals are declined, never granted: the CLI runs with
//! `approvalPolicy: "never"` and the sandbox is the enforced boundary, exactly
//! as the exec transport's auto-decline behaves, so answering "approve" here
//! would hand the model a privilege the app never offered.
//!
//! Plan approval (next_turn): a `permission == "plan"` run starts its turn
//! with `collaborationMode {mode:"plan"}` (EXPERIMENTAL in the 0.154.0
//! schema, so the client opts into `experimentalApi` at initialize). The plan
//! streams as `item/plan/delta` previews — drafts only, the schema warns the
//! concatenation need not match the final text — and the authoritative body
//! is the completed `type:"plan"` item, which becomes a next_turn PlanReview.
//! The plan turn then just ENDS (`turn/completed`): the thread idles while
//! the user reviews, and [`run_plan_decision`] later re-attaches, re-fetches
//! the final plan item to prove it is unchanged, and atomically starts one
//! execution (`mode:"default"`) or follow-up planning turn.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Map, Value};
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex as TokioMutex;
use tokio::time::{timeout, Instant};

use super::codex_read_only;
use super::images;
use super::plan_review::{self, PlanDecision, PlanReview, PlanReviewKind};
use super::qoder_session::{
    encode_ndjson, jsonrpc_id_key, jsonrpc_request, jsonrpc_result_response, teardown, KILL_POLL,
    PROMPT_TIMEOUT, RPC_HANDSHAKE_TIMEOUT,
};
use super::{
    assistant_message, read_line_capped, spawn_stderr_capture, tool_call_message,
    tool_call_message_with_id, tool_result_patch, tool_result_patch_with_id, BuiltCommand,
    ChildEntry, Engine, EngineEvent, LineRead, SendRequest, TurnCore, TurnState, VirtualRunGuard,
    MAX_LINE_BYTES,
};

#[path = "codex_app_denials.rs"]
pub(super) mod denials;
#[path = "codex_app_native.rs"]
mod native;
#[path = "codex_app_plan.rs"]
mod plan;
#[path = "codex_app_questions.rs"]
mod questions;
#[path = "codex_app_sandbox.rs"]
mod sandbox;
use native::{native_command, started_turn_id, NativeCommand};
use plan::{
    check_plan_item, decision_collaboration, decision_spec, plan_collaboration, plan_id_for,
    plan_title, PLAN_STALE_PREFIX,
};
use sandbox::{sandbox_for, writable_roots};

pub(super) use questions::{answer_frame, async_answer_request, next_async_question_rpc_id};
use questions::{async_question_cards, park_async_question, park_question, question_cards};

const CANCELLED: &str = "codex turn cancelled";

const THREAD_TIMEOUT: Duration = Duration::from_secs(90);
const RESUME_TIMEOUT: Duration = Duration::from_secs(30);
const INTERRUPT_SETTLE_TIMEOUT: Duration = Duration::from_secs(2);
pub(super) const ASYNC_QUESTION_REPLY_TIMEOUT: Duration = Duration::from_secs(10);
static NEXT_ASYNC_QUESTION_RPC_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy)]
enum Expect<'a> {
    Reply(&'a str),
    Turn,
}

enum Handled {
    Ignore,
    Answer(Value),
    Parked,
    Ended,
}

#[derive(Default)]
struct TurnView {
    thread_reply: Option<Value>,
    streamed_message: Option<String>,
    streamed_reasoning: Option<String>,
    turn_id: Option<String>,
    last_usage: Option<Value>,
    exit_unconfirmed: bool,
    isolated_home: Option<std::path::PathBuf>,
    plan_mode: bool,
    workspace: String,
    main_thread: Option<String>,
    children: HashMap<String, String>,
    last_spawn: Option<String>,
    scope: Option<String>,
}

impl TurnView {
    fn is_child(&self, thread: &str) -> bool {
        self.main_thread
            .as_deref()
            .is_some_and(|main| main != thread)
            || self.children.contains_key(thread)
    }

    fn set_scope(&mut self, core: &TurnCore, state: &mut TurnState, parent: Option<String>) {
        if self.scope != parent {
            self.scope = parent.clone();
            core.dispatch_event(state, EngineEvent::Scope { parent });
        }
    }
}

fn is_sub_agent(thread: &Value) -> bool {
    thread
        .get("source")
        .and_then(Value::as_object)
        .is_some_and(|source| {
            source
                .keys()
                .any(|key| key.to_ascii_lowercase().replace('_', "") == "subagent")
        })
}

fn handle_child_notification(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    method: &str,
    params: &Value,
    thread: &str,
) -> Handled {
    if !matches!(method, "item/started" | "item/completed") {
        return Handled::Ignore;
    }
    let Some(item) = params.get("item") else {
        return Handled::Ignore;
    };
    if matches!(
        item.get("type").and_then(Value::as_str),
        Some("agentMessage" | "reasoning" | "plan" | "userMessage") | None
    ) {
        return Handled::Ignore;
    }
    let parent = view
        .children
        .get(thread)
        .cloned()
        .or_else(|| view.last_spawn.clone());
    view.set_scope(core, state, parent);
    handle_item(
        core,
        state,
        view,
        item,
        method == "item/completed",
        Some(thread),
    );
    Handled::Ignore
}

struct AppServer {
    stdin: Arc<TokioMutex<Option<ChildStdin>>>,
    stdout: BufReader<ChildStdout>,
    line_buf: Vec<u8>,
    next_id: u64,
}

impl AppServer {
    fn new(stdin: Arc<TokioMutex<Option<ChildStdin>>>, stdout: ChildStdout) -> Self {
        Self {
            stdin,
            stdout: BufReader::new(stdout),
            line_buf: Vec::new(),
            next_id: 1,
        }
    }

    async fn write(&self, value: &Value) -> Result<(), String> {
        let bytes = encode_ndjson(value)?;
        let mut guard = self.stdin.lock().await;
        let Some(stdin) = guard.as_mut() else {
            return Err("codex stdin is already closed".to_string());
        };
        stdin
            .write_all(&bytes)
            .await
            .map_err(|error| format!("codex stdin write failed: {error}"))?;
        stdin
            .flush()
            .await
            .map_err(|error| format!("codex stdin flush failed: {error}"))
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<String, String> {
        let id = self.next_id;
        self.next_id += 1;
        self.write(&jsonrpc_request(id, method, params)).await?;
        Ok(id.to_string())
    }

    async fn pump(
        &mut self,
        label: &str,
        expect: Expect<'_>,
        deadline: impl Into<Option<Instant>>,
        killed: &AtomicBool,
        interrupt: Option<(&str, Option<&str>)>,
        on_message: &mut (dyn FnMut(&Value) -> Handled + Send),
    ) -> Result<Option<Value>, String> {
        let mut interrupted = false;
        let mut awaiting_id = false;
        let mut learned: Option<String> = None;
        let mut deadline: Option<Instant> = deadline.into();
        loop {
            if killed.load(Ordering::SeqCst) {
                let interrupt = interrupt
                    .map(|(thread_id, turn_id)| (thread_id, turn_id.or(learned.as_deref())));
                match interrupt {
                    Some((thread_id, Some(turn_id))) if !interrupted => {
                        interrupted = true;
                        let settle_by = Instant::now() + INTERRUPT_SETTLE_TIMEOUT;
                        deadline = Some(deadline.map_or(settle_by, |until| until.min(settle_by)));
                        self.request(
                            "turn/interrupt",
                            json!({ "threadId": thread_id, "turnId": turn_id }),
                        )
                        .await?;
                    }
                    Some((_, Some(_))) => {}
                    Some((_, None)) => {
                        if !awaiting_id {
                            awaiting_id = true;
                            let settle_by = Instant::now() + INTERRUPT_SETTLE_TIMEOUT;
                            deadline =
                                Some(deadline.map_or(settle_by, |until| until.min(settle_by)));
                        }
                    }
                    None => return Err(CANCELLED.to_string()),
                }
            }
            let remaining = deadline.map(|until| until.saturating_duration_since(Instant::now()));
            if remaining == Some(Duration::ZERO) {
                return Err(if interrupted || awaiting_id {
                    CANCELLED.to_string()
                } else {
                    format!("{label} timed out")
                });
            }
            let line = match timeout(
                remaining.map_or(KILL_POLL, |remaining| remaining.min(KILL_POLL)),
                read_line_capped(&mut self.stdout, &mut self.line_buf),
            )
            .await
            {
                Err(_) => continue,
                Ok(Err(error)) => return Err(format!("{label}: reading codex stdout: {error}")),
                Ok(Ok(LineRead::Eof)) => {
                    return Err(format!("{label}: the codex app-server closed stdout"))
                }
                Ok(Ok(LineRead::TooLong)) => {
                    return Err(format!(
                        "codex emitted a line over {} MiB without a newline; run terminated",
                        MAX_LINE_BYTES / (1024 * 1024),
                    ));
                }
                Ok(Ok(LineRead::Line(line))) => line,
            };
            let text = String::from_utf8_lossy(&line);
            let trimmed = text.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
                continue;
            };
            if let Some((thread_id, None)) = interrupt {
                if learned.is_none() {
                    learned = started_turn_id(&value, thread_id).map(str::to_string);
                }
            }
            let id = value.get("id").filter(|id| !id.is_null());
            if value.get("method").is_none() {
                let expected = matches!(expect, Expect::Reply(key)
                    if jsonrpc_id_key(id.unwrap_or(&Value::Null)).as_deref() == Some(key));
                if !expected {
                    let _ = on_message(&value);
                    continue;
                }
                if let Some(error) = value.get("error") {
                    return Err(format!(
                        "rpc:{}:{}",
                        error.get("code").and_then(Value::as_i64).unwrap_or(0),
                        error
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("codex reported an error"),
                    ));
                }
                return Ok(Some(value.get("result").cloned().unwrap_or(Value::Null)));
            }
            match on_message(&value) {
                Handled::Ended => return Ok(None),
                Handled::Answer(frame) if id.is_some() => self.write(&frame).await?,
                _ => {}
            }
        }
    }
}

fn route(core: &TurnCore, state: &mut TurnState, view: &mut TurnView, value: &Value) -> Handled {
    let Some(method) = value.get("method").and_then(Value::as_str) else {
        if let Some(request_id) = value.get("id").and_then(Value::as_str) {
            let result = if let Some(error) = value.get("error") {
                let message = error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Codex rejected the question answer");
                Err(format!(
                    "Codex did not accept the question answer: {}",
                    super::reader::redact_secrets(message)
                ))
            } else {
                Ok(value.get("result").cloned().unwrap_or(Value::Null))
            };
            core.registry
                .resolve_pending_rpc_reply(&core.run_id, request_id, result);
        }
        return Handled::Ignore;
    };
    let params = value.get("params").cloned().unwrap_or(Value::Null);
    match value.get("id").filter(|id| !id.is_null()) {
        Some(id) => handle_server_request(core, state, method, id, &params),
        None => handle_notification(core, state, view, method, &params),
    }
}

fn handle_server_request(
    core: &TurnCore,
    state: &mut TurnState,
    method: &str,
    id: &Value,
    params: &Value,
) -> Handled {
    match method {
        "item/tool/requestUserInput" => {
            let (cards, ids) = question_cards(params);
            if cards.is_empty() {
                return Handled::Answer(jsonrpc_result_response(id, json!({ "answers": {} })));
            }
            park_question(core, state, id, params, cards, ids);
            Handled::Parked
        }
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
            let tool = if method.starts_with("item/commandExecution") {
                "command"
            } else {
                "file change"
            };
            let registry = Arc::clone(&core.registry);
            let (run_id, id, params) = (core.run_id.clone(), id.clone(), params.clone());
            tokio::spawn(async move {
                let decision = match crate::engines::gate::ask(&run_id, tool, params).await {
                    crate::engines::gate::Decision::Allow => "accept",
                    crate::engines::gate::Decision::Deny(_) => "decline",
                };
                let frame = jsonrpc_result_response(&id, json!({ "decision": decision }));
                let _ = registry.write_line(&run_id, frame.to_string()).await;
            });
            let _ = state;
            Handled::Parked
        }
        "item/permissions/requestApproval" => {
            Handled::Answer(jsonrpc_result_response(id, json!({ "permissions": {} })))
        }
        "mcpServer/elicitation/request" => {
            Handled::Answer(jsonrpc_result_response(id, json!({ "action": "decline" })))
        }
        _ => Handled::Answer(jsonrpc_result_response(id, json!({}))),
    }
}

fn handle_notification(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    method: &str,
    params: &Value,
) -> Handled {
    if method == "account/rateLimits/updated" {
        crate::engine_config::usage_limits::record_codex_rate_limits(params);
    }
    if method == "thread/started" {
        if let Some(thread) = params.get("thread") {
            let id = thread.get("id").and_then(Value::as_str).unwrap_or("");
            if is_sub_agent(thread) {
                if let (false, Some(spawn)) = (id.is_empty(), view.last_spawn.clone()) {
                    view.children.entry(id.to_string()).or_insert(spawn);
                }
                return Handled::Ignore;
            }
            if view.main_thread.is_none() && !id.is_empty() {
                view.main_thread = Some(id.to_string());
            }
        }
    }
    if let Some(thread) = params.get("threadId").and_then(Value::as_str) {
        if view.is_child(thread) {
            let thread = thread.to_string();
            return handle_child_notification(core, state, view, method, params, &thread);
        }
    }
    if method == "turn/started" && view.turn_id.is_none() {
        view.turn_id = params
            .pointer("/turn/id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .map(str::to_string);
    }
    if matches!(method, "item/started" | "item/completed") {
        view.set_scope(core, state, None);
    }
    match method {
        "item/agentMessage/delta" => {
            if let Some(delta) = params.get("delta").and_then(Value::as_str) {
                if !delta.is_empty() {
                    if let Some(item_id) = params.get("itemId").and_then(Value::as_str) {
                        view.streamed_message = Some(item_id.to_string());
                    }
                    core.dispatch_event(state, EngineEvent::Delta(delta.to_string()));
                }
            }
        }
        "item/reasoning/textDelta" | "item/reasoning/summaryTextDelta" => {
            if let Some(delta) = params.get("delta").and_then(Value::as_str) {
                if !delta.is_empty() {
                    if let Some(item_id) = params.get("itemId").and_then(Value::as_str) {
                        view.streamed_reasoning = Some(item_id.to_string());
                    }
                    core.dispatch_event(state, EngineEvent::Thinking(delta.to_string()));
                }
            }
        }
        "item/started" | "item/completed" => {
            if let Some(item) = params.get("item") {
                let thread_id = params.get("threadId").and_then(Value::as_str);
                handle_item(
                    core,
                    state,
                    view,
                    item,
                    method == "item/completed",
                    thread_id,
                );
            }
        }
        "item/plan/delta" => {
            if view.plan_mode {
                if let (Some(thread_id), Some(delta)) = (
                    params.get("threadId").and_then(Value::as_str),
                    params.get("delta").and_then(Value::as_str),
                ) {
                    if !delta.is_empty() {
                        core.dispatch_event(
                            state,
                            EngineEvent::PlanDraft {
                                plan_id: plan_id_for(thread_id),
                                text: delta.to_string(),
                                replace: false,
                            },
                        );
                    }
                }
            }
        }
        "thread/tokenUsage/updated" => {
            if let Some(usage) = params.get("tokenUsage") {
                let window = usage
                    .get("modelContextWindow")
                    .filter(|value| !value.is_null())
                    .or_else(|| params.get("modelContextWindow"));
                if let Some(payload) = usage_payload(usage, window) {
                    view.last_usage = Some(payload);
                }
            }
        }
        "thread/started" => {
            if let Some(thread_id) = params.pointer("/thread/id").and_then(Value::as_str) {
                if view
                    .main_thread
                    .as_deref()
                    .is_none_or(|main| main == thread_id)
                {
                    core.dispatch_event(state, EngineEvent::SessionId(thread_id.to_string()));
                }
            }
        }
        "model/rerouted" => {
            if let Some(to) = params
                .get("toModel")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|to| !to.is_empty())
            {
                core.dispatch_event(
                    state,
                    EngineEvent::Served {
                        model: Some(to.to_string()),
                        effort: None,
                    },
                );
            }
        }
        "turn/completed" | "turn/failed" => {
            let turn = params.get("turn");
            let failed = turn
                .and_then(|turn| turn.get("status"))
                .and_then(Value::as_str)
                == Some("failed");
            let message = turn
                .and_then(|turn| turn.pointer("/error/message"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if failed || !message.is_empty() {
                core.dispatch_event(
                    state,
                    EngineEvent::Error(if message.is_empty() {
                        "codex reported a failed turn".to_string()
                    } else {
                        message.to_string()
                    }),
                );
            }
            return Handled::Ended;
        }
        "item/autoApprovalReview/completed" => {
            let thread = params.get("threadId").and_then(Value::as_str);
            if let (Some(thread), Some(event)) = (thread, denials::core_event(params)) {
                let notice = denials::notice(&event);
                denials::keep(thread, event);
                core.dispatch_event(state, EngineEvent::Warn(notice));
            }
        }
        "error" => {
            let message = params
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or("codex reported an error");
            core.dispatch_event(state, EngineEvent::Warn(message.to_string()));
        }
        _ => {}
    }
    Handled::Ignore
}

fn handle_item(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    item: &Value,
    completed: bool,
    thread_id: Option<&str>,
) {
    let Some(kind) = item.get("type").and_then(Value::as_str) else {
        return;
    };
    let item_id = item.get("id").and_then(Value::as_str);
    match kind {
        "agentMessage" => {
            if !completed {
                return;
            }
            if view.streamed_message.as_deref() != item_id {
                let text = item.get("text").and_then(Value::as_str).unwrap_or("");
                if !text.trim().is_empty() {
                    core.dispatch_event(state, assistant_message(text.to_string()));
                }
            }
            let cards = async_question_cards(item);
            if !cards.is_empty() {
                let thread_id = thread_id
                    .map(str::to_string)
                    .or_else(|| state.native_session_id.clone());
                if let (Some(request_id), Some(thread_id), Some(turn_id)) = (
                    item_id.map(str::trim).filter(|id| !id.is_empty()),
                    thread_id
                        .as_deref()
                        .map(str::trim)
                        .filter(|id| !id.is_empty()),
                    view.turn_id
                        .as_deref()
                        .map(str::trim)
                        .filter(|id| !id.is_empty()),
                ) {
                    park_async_question(core, state, request_id, thread_id, turn_id, cards);
                }
            }
        }
        "plan" => {
            if !completed || !view.plan_mode {
                return;
            }
            let (Some(plan_item_id), Some(text)) = (
                item.get("id").and_then(Value::as_str),
                item.get("text").and_then(Value::as_str),
            ) else {
                return;
            };
            if text.trim().is_empty() {
                return;
            }
            let Some(thread_id) = thread_id
                .map(str::to_string)
                .or_else(|| state.native_session_id.clone())
            else {
                return;
            };
            let record = PlanReview {
                plan_id: plan_id_for(&thread_id),
                engine: core.engine_id.clone(),
                session_id: thread_id.clone(),
                workspace_path: view.workspace.clone(),
                run_id: Some(core.run_id.clone()),
                revision: 0,
                title: plan_title(text),
                content: text.to_string(),
                content_hash: plan_review::content_hash(text),
                complete: true,
                review_kind: PlanReviewKind::NextTurn,
                native_plan_id: Some(plan_item_id.to_string()),
                exec_permission: "auto".to_string(),
                status: plan_review::PlanStatus::AwaitingReview,
                execution: plan_review::PlanExecution::NotStarted,
                decision: None,
                decision_intent_at: None,
                applied_at: None,
                created_at: 0,
                updated_at: 0,
                superseded_by: None,
            };
            core.dispatch_event(
                state,
                EngineEvent::PlanReviewReady {
                    record: Box::new(record),
                    context: Value::Null,
                },
            );
        }
        "reasoning" => {
            if !completed || view.streamed_reasoning.as_deref() == item_id {
                return;
            }
            let mut parts: Vec<String> = Vec::new();
            for key in ["summary", "content"] {
                if let Some(entries) = item.get(key).and_then(Value::as_array) {
                    parts.extend(
                        entries
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .filter(|part| !part.trim().is_empty()),
                    );
                }
            }
            let text = parts.join("\n");
            if !text.is_empty() {
                core.dispatch_event(state, EngineEvent::Thinking(text));
            }
        }
        "commandExecution" => {
            let command = item.get("command").and_then(Value::as_str).unwrap_or("");
            let name = row_name(command);
            if completed {
                core.dispatch_event(
                    state,
                    tool_result_patch(name, Some(&pick(item, &["aggregatedOutput", "exitCode"]))),
                );
            } else {
                core.dispatch_event(
                    state,
                    tool_call_message(name, Some(&pick(item, &["command", "cwd"]))),
                );
            }
        }
        "fileChange" => {
            if completed {
                core.dispatch_event(
                    state,
                    tool_result_patch("apply_patch", Some(&pick(item, &["status"]))),
                );
            } else if let Some(changes) = item.get("changes").and_then(Value::as_array) {
                for change in changes {
                    core.dispatch_event(
                        state,
                        tool_call_message(
                            "apply_patch",
                            Some(&pick(change, &["path", "kind", "diff"])),
                        ),
                    );
                }
            }
        }
        "mcpToolCall" => {
            let name = item
                .get("tool")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| "mcp".to_string());
            if completed {
                core.dispatch_event(
                    state,
                    tool_result_patch(name, Some(&pick(item, &["result", "error", "status"]))),
                );
            } else {
                core.dispatch_event(
                    state,
                    tool_call_message(name, Some(&pick(item, &["server", "tool", "arguments"]))),
                );
            }
        }
        "dynamicToolCall" => {
            let name = item
                .get("tool")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| "tool".to_string());
            if completed {
                core.dispatch_event(
                    state,
                    tool_result_patch(name, Some(&pick(item, &["success", "contentItems"]))),
                );
            } else {
                core.dispatch_event(
                    state,
                    tool_call_message(name, Some(&pick(item, &["namespace", "tool", "arguments"]))),
                );
            }
        }
        "webSearch" => {
            if completed {
                core.dispatch_event(
                    state,
                    tool_result_patch("web_search", Some(&pick(item, &["results"]))),
                );
            } else {
                core.dispatch_event(
                    state,
                    tool_call_message("web_search", Some(&pick(item, &["query", "action"]))),
                );
            }
        }
        "imageGeneration" => {
            if completed {
                core.dispatch_event(
                    state,
                    tool_result_patch(
                        "image_generation",
                        Some(&pick(item, &["status", "savedPath", "failure"])),
                    ),
                );
            } else {
                core.dispatch_event(
                    state,
                    tool_call_message("image_generation", Some(&pick(item, &["revisedPrompt"]))),
                );
            }
        }
        "collabAgentToolCall" => {
            let tool = item.get("tool").and_then(Value::as_str).unwrap_or("agent");
            let name = collab_row_name(tool);
            let receivers: Vec<String> = item
                .get("receiverThreadIds")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect();
            if let Some(id) = item_id {
                if tool == "spawnAgent" || tool == "spawn_agent" {
                    view.last_spawn = Some(id.to_string());
                    for receiver in &receivers {
                        view.children.insert(receiver.clone(), id.to_string());
                    }
                }
            }
            if completed {
                core.dispatch_event(
                    state,
                    tool_result_patch_with_id(
                        name,
                        Some(&pick(
                            item,
                            &["status", "receiverThreadIds", "agentsStates"],
                        )),
                        item_id,
                    ),
                );
            } else {
                core.dispatch_event(
                    state,
                    tool_call_message_with_id(
                        name,
                        Some(&pick(item, &["prompt", "model", "receiverThreadIds"])),
                        item_id,
                    ),
                );
            }
        }
        _ => {}
    }
}

fn collab_row_name(tool: &str) -> &'static str {
    match tool {
        "spawnAgent" | "spawn_agent" => "spawn_agent",
        "sendInput" | "send_input" => "send_input",
        "resumeAgent" | "resume_agent" => "resume_agent",
        "wait" => "wait_agent",
        "closeAgent" | "close_agent" => "close_agent",
        _ => "agent",
    }
}

fn approval_for(permission: Option<&str>) -> &'static str {
    match permission {
        Some(super::codex::READ_ONLY) => "on-request",
        Some("manual") => "untrusted",
        _ => "never",
    }
}

fn turn_input(req: &SendRequest) -> Vec<Value> {
    let mut input = vec![json!({ "type": "text", "text": req.prompt })];
    for raw in &req.images {
        if let Some(path) = images::absolutize_image_path(raw, &req.workspace) {
            input.push(json!({ "type": "localImage", "path": path.to_string_lossy() }));
        }
    }
    input
}

fn usage_payload(usage: &Value, context_window: Option<&Value>) -> Option<Value> {
    let last = usage.get("last")?;
    let mut out = Map::new();
    for (from, to) in [
        ("inputTokens", "input_tokens"),
        ("cachedInputTokens", "cached_input_tokens"),
        ("cacheWriteInputTokens", "cache_write_input_tokens"),
        ("outputTokens", "output_tokens"),
        ("reasoningOutputTokens", "reasoning_output_tokens"),
        ("totalTokens", "total_tokens"),
    ] {
        if let Some(field) = last.get(from).filter(|field| !field.is_null()) {
            out.insert(to.to_string(), field.clone());
        }
    }
    if let Some(window) = context_window.filter(|window| !window.is_null()) {
        out.insert("model_context_window".to_string(), window.clone());
    }
    if out.is_empty() {
        return None;
    }
    Some(Value::Object(out))
}

fn row_name(command: &str) -> String {
    let name = command.trim();
    if name.is_empty() {
        return "tool".to_string();
    }
    name.chars().take(120).collect()
}

fn pick(value: &Value, keys: &[&str]) -> Value {
    let mut out = Map::new();
    for key in keys {
        if let Some(field) = value.get(*key).filter(|field| !field.is_null()) {
            out.insert((*key).to_string(), field.clone());
        }
    }
    Value::Object(out)
}

struct SpawnedCodex {
    child: Child,
    server: AppServer,
    stderr_buf: Arc<Mutex<String>>,
    #[cfg(windows)]
    _tree_guard: Option<Arc<super::job::KillOnCloseJob>>,
}

fn spawn_app_server(command: &mut Command, workspace: &Path) -> Result<SpawnedCodex, String> {
    command
        .current_dir(workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    super::hide_console(command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to spawn codex app-server: {error}"))?;
    #[cfg(windows)]
    let tree_guard = super::job::assign_kill_on_close(&child);
    let (stdin, stdout, stderr) =
        match (child.stdin.take(), child.stdout.take(), child.stderr.take()) {
            (Some(stdin), Some(stdout), Some(stderr)) => (stdin, stdout, stderr),
            _ => {
                let _ = child.start_kill();
                return Err("missing stdio pipe after spawn".to_string());
            }
        };
    Ok(SpawnedCodex {
        child,
        server: AppServer::new(Arc::new(TokioMutex::new(Some(stdin))), stdout),
        stderr_buf: spawn_stderr_capture(stderr),
        #[cfg(windows)]
        _tree_guard: tree_guard,
    })
}

pub(super) async fn run_app_server_turn(
    core: TurnCore,
    req: SendRequest,
    built: BuiltCommand,
    killed: Arc<AtomicBool>,
    virtual_pid: u32,
) {
    let mut state = TurnState::new(req.session_id.clone());
    let mut view = TurnView {
        plan_mode: req.permission.as_deref() == Some("plan"),
        workspace: req.workspace.to_string_lossy().into_owned(),
        ..Default::default()
    };
    let preassigned_session_id = req.session_id.clone();
    let _registry_guard =
        VirtualRunGuard::new(Arc::clone(&core.registry), core.run_id.clone(), virtual_pid);
    let result = turn_inner(&core, &mut state, &mut view, &req, built, &killed, None).await;
    settle(
        &core,
        &mut state,
        &view,
        result,
        &killed,
        virtual_pid,
        preassigned_session_id,
    )
    .await;
}

async fn settle(
    core: &TurnCore,
    state: &mut TurnState,
    view: &TurnView,
    result: Result<(), String>,
    killed: &Arc<AtomicBool>,
    virtual_pid: u32,
    preassigned_session_id: Option<String>,
) {
    for key in [
        state.native_session_id.clone(),
        Some(core.run_id.clone()),
        preassigned_session_id.clone(),
    ]
    .into_iter()
    .flatten()
    {
        for request_id in core.registry.take_questions(&key) {
            core.dispatch_event(state, EngineEvent::QuestionSettled { request_id });
        }
        super::reader::expire_parked_plans(core, state, &key);
    }
    core.registry.settle_pending_rpc_replies(&core.run_id);
    if let Err(error) = result {
        if !killed.load(Ordering::SeqCst) {
            core.dispatch_event(state, EngineEvent::Error(error));
        }
    }
    if !state.saw_done && !state.saw_error {
        let usage = if killed.load(Ordering::SeqCst) {
            None
        } else {
            view.last_usage.clone()
        };
        let session_id = state.native_session_id.clone();
        core.dispatch_event(state, EngineEvent::Done { session_id, usage });
    }
    core.registry.remove_if_pid(&core.run_id, virtual_pid);
    if let Some(session_id) = state.native_session_id.clone() {
        core.registry.remove_if_pid(&session_id, virtual_pid);
    }
    if let Some(session_id) = preassigned_session_id {
        core.registry.remove_if_pid(&session_id, virtual_pid);
    }
    if !view.exit_unconfirmed {
        state.confirm_exit(core);
    }
    core.sink.flush();
}

async fn turn_inner(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    built: BuiltCommand,
    killed: &Arc<AtomicBool>,
    decision: Option<&DecisionCheck>,
) -> Result<(), String> {
    let BuiltCommand {
        mut command,
        cleanup_files,
        ..
    } = built;
    let _staging_guard = codex_read_only::StagedHomeGuard(cleanup_files);
    let outcome = drive(&mut command, core, state, view, req, killed, decision).await;
    outcome
}

async fn drive(
    command: &mut Command,
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    killed: &Arc<AtomicBool>,
    decision: Option<&DecisionCheck>,
) -> Result<(), String> {
    if codex_read_only::requested(req) {
        view.isolated_home = Some(
            file_access::fs::canonicalize(codex_read_only::isolated_home(command)?)
                .map_err(|_| "Cannot verify isolated Codex home")?,
        );
    }
    let ordinary = decision.is_none()
        && !codex_read_only::requested(req)
        && req.permission.as_deref() != Some("plan");
    let fingerprint = super::warm::claim(&core.run_id).filter(|_| ordinary);
    let taken = fingerprint
        .zip(req.session_id.as_deref())
        .and_then(|(fingerprint, thread)| {
            WARM.take(&super::warm::key(&core.engine_id, thread), fingerprint)
        })
        .and_then(|mut warm| {
            if warm.item.alive() {
                Some(warm)
            } else {
                warm.retire();
                None
            }
        });
    let mut warm = match taken {
        Some(warm) => {
            warm.hand_to(&core.run_id);
            view.thread_reply = Some(warm.item.thread.clone());
            warm
        }
        None => super::warm::Warm {
            item: WarmCodex {
                spawned: spawn_app_server(command, &req.workspace)?,
                thread: Value::Null,
            },
            token: None,
            cleanup: Vec::new(),
        },
    };
    view.exit_unconfirmed = true;
    core.registry
        .set_stdin(&core.run_id, Arc::clone(&warm.item.spawned.server.stdin));
    let result = handshake_and_turn(
        &mut warm.item.spawned.server,
        core,
        state,
        view,
        req,
        killed,
        decision,
    )
    .await;
    if let (Ok(()), Some(fingerprint), Some(thread_id), Some(reply)) = (
        &result,
        fingerprint,
        view.main_thread.clone(),
        view.thread_reply.clone(),
    ) {
        if !killed.load(Ordering::SeqCst) && warm.item.alive() {
            warm.item.thread = reply;
            if warm.token.is_none() {
                warm.token = super::mcp::token_in(req.mcp_servers.as_ref());
            }
            WARM.park(
                super::warm::key(&core.engine_id, &thread_id),
                req.workspace.clone(),
                fingerprint,
                warm,
            );
            view.exit_unconfirmed = false;
            return Ok(());
        }
    }
    let spawned = &mut warm.item.spawned;
    teardown(&mut spawned.child).await;
    view.exit_unconfirmed = !matches!(spawned.child.try_wait(), Ok(Some(_)));
    match result {
        Ok(()) => Ok(()),
        Err(error) => Err(terminal_message(error, &spawned.stderr_buf)),
    }
}

struct WarmCodex {
    spawned: SpawnedCodex,
    thread: Value,
}

impl WarmCodex {
    fn alive(&mut self) -> bool {
        matches!(self.spawned.child.try_wait(), Ok(None))
    }
}

impl super::warm::Retire for WarmCodex {
    fn retire(mut self, cleanup: Vec<PathBuf>) {
        tokio::spawn(async move {
            teardown(&mut self.spawned.child).await;
            super::cleanup_staged_files(&cleanup);
        });
    }
    fn kill_now(mut self, cleanup: Vec<PathBuf>) {
        super::warm::kill_child_now(&mut self.spawned.child, &cleanup);
    }
}

static WARM: super::warm::Pool<WarmCodex> = super::warm::Pool::new();

pub(super) fn kill_warm() {
    WARM.kill_all();
}

pub(super) fn retire_warm_in(folder: &Path) {
    WARM.retire_in(folder);
}

async fn handshake_and_turn(
    server: &mut AppServer,
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    killed: &Arc<AtomicBool>,
    decision: Option<&DecisionCheck>,
) -> Result<(), String> {
    let Some(started) = handshake_and_start(
        server,
        core,
        state,
        view,
        req,
        killed,
        decision,
        PROMPT_TIMEOUT,
    )
    .await?
    else {
        return Ok(());
    };
    pump_turn_to_end(server, core, state, view, &started, killed).await
}

struct TurnStarted {
    thread_id: String,
    turn_id: Option<String>,
}

pub(super) fn initialize_params(experimental: bool) -> Value {
    json!({
        "clientInfo": { "name": "codex-backend", "version": "" },
        "capabilities": { "experimentalApi": experimental },
    })
}

#[allow(clippy::too_many_arguments)]
async fn handshake_and_start(
    server: &mut AppServer,
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    killed: &Arc<AtomicBool>,
    decision: Option<&DecisionCheck>,
    ack_timeout: Option<Duration>,
) -> Result<Option<TurnStarted>, String> {
    let (result, method) = match view.thread_reply.clone() {
        Some(reply) => (reply, "thread/resume"),
        None => open_thread(server, core, state, view, req, killed, decision).await?,
    };
    view.thread_reply = Some(result.clone());
    start_on_thread(
        server,
        core,
        state,
        view,
        req,
        killed,
        decision,
        ack_timeout,
        result,
        method,
    )
    .await
}

async fn open_thread(
    server: &mut AppServer,
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    killed: &Arc<AtomicBool>,
    decision: Option<&DecisionCheck>,
) -> Result<(Value, &'static str), String> {
    let deadline = Instant::now() + RPC_HANDSHAKE_TIMEOUT;
    let experimental = req.session_id.is_some()
        || codex_read_only::requested(req)
        || decision.is_some()
        || req.permission.as_deref() == Some("plan");
    let key = server
        .request("initialize", initialize_params(experimental))
        .await?;
    let initialized = server
        .pump(
            "initialize",
            Expect::Reply(&key),
            deadline,
            killed,
            None,
            &mut |value| route(core, state, view, value),
        )
        .await?
        .ok_or_else(|| "the codex app-server ended before initialize was answered".to_string())?;
    if codex_read_only::requested(req) {
        codex_read_only::validate_version(&initialized)?;
        for (method, params) in [
            ("configRequirements/read", json!({})),
            (
                "config/read",
                json!({"cwd":req.workspace.to_string_lossy(),"includeLayers":true}),
            ),
        ] {
            let key = server.request(method, params).await?;
            let response = server
                .pump(
                    method,
                    Expect::Reply(&key),
                    Instant::now() + RPC_HANDSHAKE_TIMEOUT,
                    killed,
                    None,
                    &mut |value| route(core, state, view, value),
                )
                .await?
                .ok_or("Codex isolation preflight ended without a response")?;
            if method == "configRequirements/read" {
                if response.get("requirements") != Some(&Value::Null) {
                    return Err(
                        "Codex read-only planning does not support managed requirements".into(),
                    );
                }
            } else {
                codex_read_only::validate_config(
                    &response,
                    view.isolated_home
                        .as_deref()
                        .ok_or("Missing isolated Codex planning home")?,
                )?;
            }
        }
    }
    let deadline = Instant::now()
        + if req.session_id.is_some() {
            RESUME_TIMEOUT
        } else {
            THREAD_TIMEOUT
        };
    let (method, mut params) = thread_open_request(req.session_id.as_deref());
    params["cwd"] = json!(req.workspace.to_string_lossy());
    params["sandbox"] = json!(sandbox_for(req.permission.as_deref()));
    params["approvalPolicy"] = json!(approval_for(req.permission.as_deref()));
    if let Some(config) = writable_roots(req) {
        params["config"] = config;
    }
    if codex_read_only::requested(req) {
        params["ephemeral"] = json!(true);
        params["dynamicTools"] = json!([]);
        params["selectedCapabilityRoots"] = json!([]);
        params["environments"] =
            json!([{"environmentId":"local","cwd":req.workspace.to_string_lossy()}]);
    }
    if let Some(model) = req.model.as_deref() {
        params["model"] = json!(model);
    }
    if !codex_read_only::requested(req) {
        if let Some(effort) = req.effort.as_deref() {
            if let Some(obj) = params.as_object_mut() {
                if !obj.contains_key("config") || obj["config"].is_null() {
                    obj.insert("config".to_string(), json!({}));
                }
                if let Some(config) = obj.get_mut("config").and_then(Value::as_object_mut) {
                    config.insert("model_reasoning_effort".to_string(), json!(effort));
                }
            }
        }
    }
    let key = server.request(method, params).await?;
    let result = server
        .pump(
            method,
            Expect::Reply(&key),
            deadline,
            killed,
            None,
            &mut |value| route(core, state, view, value),
        )
        .await?
        .ok_or_else(|| format!("the codex app-server ended before {method} was answered"))?;
    if codex_read_only::requested(req) {
        codex_read_only::validate_thread(&result)?;
    }
    Ok((result, method))
}

#[allow(clippy::too_many_arguments)]
async fn start_on_thread(
    server: &mut AppServer,
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    killed: &Arc<AtomicBool>,
    decision: Option<&DecisionCheck>,
    ack_timeout: Option<Duration>,
    result: Value,
    method: &str,
) -> Result<Option<TurnStarted>, String> {
    let thread_id = result
        .pointer("/thread/id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| req.session_id.clone())
        .ok_or_else(|| format!("{method} returned no thread id"))?;
    view.main_thread = Some(thread_id.clone());
    core.dispatch_event(state, EngineEvent::SessionId(thread_id.clone()));
    if req.model.is_some() || req.effort.is_some() {
        core.dispatch_event(
            state,
            EngineEvent::Launch {
                comparison_model: None,
                model: req.model.clone(),
                effort: req.effort.clone(),
                reports_served: true,
            },
        );
    }
    let thread_model = result
        .get("model")
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(model) = thread_model.as_deref() {
        core.dispatch_event(state, EngineEvent::Model(model.to_string()));
    }
    let reported_effort = result
        .get("reasoningEffort")
        .or_else(|| result.pointer("/thread/reasoningEffort"))
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(effort) = req.effort.as_deref().or(reported_effort.as_deref()) {
        core.dispatch_event(state, EngineEvent::Effort(effort.to_string()));
    }
    if thread_model.is_some() || reported_effort.is_some() {
        core.dispatch_event(
            state,
            EngineEvent::Served {
                model: thread_model.clone(),
                effort: reported_effort.clone(),
            },
        );
    }
    if let Some(check) = decision {
        verify_plan_item(server, core, state, view, &thread_id, check, killed).await?;
    }
    let mut prompt_text = None;
    if decision.is_none()
        && req.permission.as_deref() != Some("plan")
        && !codex_read_only::requested(req)
    {
        match native_command(&req.prompt, &req.images, &thread_id) {
            Some(NativeCommand::Prompt(text)) => prompt_text = Some(text),
            Some(NativeCommand::Call(method, params)) => {
                let key = server.request(method, params).await?;
                let Some(result) = server
                    .pump(
                        method,
                        Expect::Reply(&key),
                        ack_timeout.map(|limit| Instant::now() + limit),
                        killed,
                        None,
                        &mut |value| route(core, state, view, value),
                    )
                    .await?
                else {
                    return Ok(None);
                };
                let turn_id = result
                    .pointer("/turn/id")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| view.turn_id.clone());
                return Ok(Some(TurnStarted { thread_id, turn_id }));
            }
            None => {}
        }
    }
    let input = match prompt_text {
        Some(text) => vec![json!({ "type": "text", "text": text })],
        None => turn_input(req),
    };
    let mut turn_params = json!({ "threadId": thread_id, "input": input });
    if codex_read_only::requested(req) {
        turn_params["approvalPolicy"] = json!("never");
        turn_params["sandboxPolicy"] = json!({"type":"readOnly","networkAccess":false});
    }
    if let Some(check) = decision {
        turn_params["collaborationMode"] = decision_collaboration(
            check.mode,
            thread_model.as_deref(),
            reported_effort.as_deref(),
        )?;
    } else if req.permission.as_deref() == Some("plan") {
        turn_params["collaborationMode"] = plan_collaboration(
            req.model.as_deref(),
            thread_model.as_deref(),
            req.effort.as_deref(),
        )?;
    } else {
        if let Some(effort) = req.effort.as_deref() {
            turn_params["effort"] = json!(effort);
        }
        if let Some(model) = req.model.as_deref() {
            turn_params["model"] = json!(model);
        }
    }
    let key = server.request("turn/start", turn_params).await?;
    let Some(result) = server
        .pump(
            "turn/start",
            Expect::Reply(&key),
            ack_timeout.map(|limit| Instant::now() + limit),
            killed,
            None,
            &mut |value| route(core, state, view, value),
        )
        .await?
    else {
        return Ok(None);
    };
    let turn_id = result
        .pointer("/turn/id")
        .and_then(Value::as_str)
        .map(str::to_string);
    Ok(Some(TurnStarted { thread_id, turn_id }))
}

fn thread_open_request(session_id: Option<&str>) -> (&'static str, Value) {
    match session_id {
        Some(thread_id) => (
            "thread/resume",
            json!({ "threadId": thread_id, "excludeTurns": true }),
        ),
        None => ("thread/start", json!({})),
    }
}

async fn pump_turn_to_end(
    server: &mut AppServer,
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    started: &TurnStarted,
    killed: &Arc<AtomicBool>,
) -> Result<(), String> {
    if started.turn_id.is_some() {
        view.turn_id = started.turn_id.clone();
    }
    server
        .pump(
            "turn",
            Expect::Turn,
            PROMPT_TIMEOUT.map(|limit| Instant::now() + limit),
            killed,
            Some((started.thread_id.as_str(), started.turn_id.as_deref())),
            &mut |value| route(core, state, view, value),
        )
        .await?;
    Ok(())
}

struct DecisionCheck {
    mode: &'static str,
    native_plan_id: String,
    content_hash: String,
}

async fn verify_plan_item(
    server: &mut AppServer,
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    thread_id: &str,
    check: &DecisionCheck,
    killed: &Arc<AtomicBool>,
) -> Result<(), String> {
    let key = server
        .request(
            "thread/turns/list",
            json!({
                "threadId": thread_id,
                "itemsView": "full",
                "limit": 16,
                "sortDirection": "desc",
            }),
        )
        .await?;
    let page = server
        .pump(
            "thread/turns/list",
            Expect::Reply(&key),
            Instant::now() + RESUME_TIMEOUT,
            killed,
            None,
            &mut |value| route(core, state, view, value),
        )
        .await?
        .ok_or_else(|| {
            "the codex app-server ended before thread/turns/list was answered".to_string()
        })?;
    check_plan_item(&page, &check.native_plan_id, &check.content_hash)
}

pub(crate) async fn run_plan_decision(
    state: &crate::engines::support::EngineState,
    review: &PlanReview,
    decision: PlanDecision,
    feedback: Option<&str>,
) -> Result<(), String> {
    let spec = decision_spec(review, decision, feedback)?;
    let thread_id = review.session_id.trim().to_string();
    let check = DecisionCheck {
        mode: spec.mode,
        native_plan_id: spec.native_plan_id,
        content_hash: review.content_hash.clone(),
    };

    crate::engines::support::config::ensure_engine_enabled("codex")?;
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = super::engine_bin(&settings, "codex");
    let provider = crate::engines::support::config::resolve_provider("codex", None)?;
    let channel_env = provider
        .as_ref()
        .map(|provider| crate::engines::support::provider_files::channel_env("codex", provider))
        .transpose()?
        .unwrap_or_default();
    let req = SendRequest {
        session_id: Some(thread_id.clone()),
        workspace: PathBuf::from(&review.workspace_path),
        prompt: spec.prompt,
        prompt_contributions: Vec::new(),
        native_compact: false,
        images: Vec::new(),
        model: None,
        effort: None,
        service_tier: settings.codex_service_tier.clone(),
        permission: Some(spec.permission),
        additional_dirs: state.db.granted_roots().unwrap_or_default(),
        provider_id: None,
        mcp_servers: None,
        allowed_tools: None,
    };
    let mut built = super::codex::CodexEngine.host_command(&req, &bin)?;
    built.command.current_dir(&req.workspace);
    for (key, value) in &channel_env {
        built.command.env(key, value);
    }
    if let Some(provider) = provider.as_ref() {
        super::codex::apply_channel(&mut built.command, provider, &channel_env, &req)?;
    }
    super::codex_provider_env::apply(&mut built.command).await;

    let run_id = uuid::Uuid::new_v4().to_string();
    let killed = Arc::new(AtomicBool::new(false));
    let reader_abort = Arc::new(std::sync::OnceLock::new());
    let pid = super::next_virtual_pid();
    let entry = ChildEntry {
        child: None,
        pid,
        run_id: run_id.clone(),
        killed: Arc::clone(&killed),
        reader_abort: Arc::clone(&reader_abort),
        stdin: None,
        questions: Arc::new(Mutex::new(HashMap::new())),
        plans: Arc::new(Mutex::new(HashMap::new())),
    };
    {
        let mut map = state.processes.0.lock().map_err(|e| e.to_string())?;
        if super::registry::active_run_count(&map) >= super::MAX_CONCURRENT_RUNS {
            return Err(format!(
                "too many concurrent runs ({}); wait for one to finish",
                super::MAX_CONCURRENT_RUNS
            ));
        }
        map.insert(run_id.clone(), entry.clone());
        map.entry(thread_id.clone()).or_insert(entry);
    }

    let core = TurnCore {
        sink: Arc::clone(&state.sink),
        registry: Arc::clone(&state.processes),
        engine_id: "codex".to_string(),
        run_id: run_id.clone(),
        db: Some(Arc::clone(&state.db)),
        followup: None,
    };
    let mut turn_state = TurnState::new(Some(thread_id.clone()));
    let mut view = TurnView {
        plan_mode: decision == PlanDecision::RequestChanges,
        workspace: review.workspace_path.clone(),
        ..Default::default()
    };

    let spawned = match start_decision_turn(
        &core,
        &mut turn_state,
        &mut view,
        &req,
        built,
        &killed,
        pid,
        &check,
    )
    .await
    {
        Ok(spawned) => spawned,
        Err(error) => {
            if error.starts_with(PLAN_STALE_PREFIX) {
                let _ = plan_review::expire_reviews(
                    &state.db,
                    &[(review.plan_id.clone(), review.revision)],
                );
            }
            return Err(error);
        }
    };

    let task = tokio::spawn(finish_decision_turn(
        core,
        req.session_id.clone(),
        killed,
        pid,
        spawned.0,
        spawned.1,
        turn_state,
        view,
    ));
    let _ = reader_abort.set(task.abort_handle());
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn start_decision_turn(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    built: BuiltCommand,
    killed: &Arc<AtomicBool>,
    virtual_pid: u32,
    check: &DecisionCheck,
) -> Result<(SpawnedCodex, Option<TurnStarted>), String> {
    let BuiltCommand {
        mut command,
        cleanup_files,
        ..
    } = built;
    let _staging_guard = codex_read_only::StagedHomeGuard(cleanup_files);
    let mut spawned = match spawn_app_server(&mut command, &req.workspace) {
        Ok(spawned) => spawned,
        Err(error) => {
            core.registry.remove_if_pid(&core.run_id, virtual_pid);
            if let Some(session_id) = req.session_id.as_deref() {
                core.registry.remove_if_pid(session_id, virtual_pid);
            }
            return Err(error);
        }
    };
    view.exit_unconfirmed = true;
    core.registry
        .set_stdin(&core.run_id, Arc::clone(&spawned.server.stdin));
    let started = handshake_and_start(
        &mut spawned.server,
        core,
        state,
        view,
        req,
        killed,
        Some(check),
        Some(RESUME_TIMEOUT),
    )
    .await;
    let started = match started {
        Ok(started) => started,
        Err(error) => {
            let error = terminal_message(error, &spawned.stderr_buf);
            teardown(&mut spawned.child).await;
            view.exit_unconfirmed = !matches!(spawned.child.try_wait(), Ok(Some(_)));
            settle(
                core,
                state,
                view,
                Err(error.clone()),
                killed,
                virtual_pid,
                req.session_id.clone(),
            )
            .await;
            return Err(error);
        }
    };
    Ok((spawned, started))
}

#[allow(clippy::too_many_arguments)]
async fn finish_decision_turn(
    core: TurnCore,
    preassigned_session_id: Option<String>,
    killed: Arc<AtomicBool>,
    virtual_pid: u32,
    mut spawned: SpawnedCodex,
    started: Option<TurnStarted>,
    mut state: TurnState,
    mut view: TurnView,
) {
    let _registry_guard =
        VirtualRunGuard::new(Arc::clone(&core.registry), core.run_id.clone(), virtual_pid);
    let result = match started {
        Some(started) => {
            pump_turn_to_end(
                &mut spawned.server,
                &core,
                &mut state,
                &mut view,
                &started,
                &killed,
            )
            .await
        }
        None => Ok(()),
    };
    teardown(&mut spawned.child).await;
    view.exit_unconfirmed = !matches!(spawned.child.try_wait(), Ok(Some(_)));
    let result = result.map_err(|error| terminal_message(error, &spawned.stderr_buf));
    settle(
        &core,
        &mut state,
        &view,
        result,
        &killed,
        virtual_pid,
        preassigned_session_id,
    )
    .await;
}

fn terminal_message(raw: String, stderr_buf: &Mutex<String>) -> String {
    if let Some(rest) = raw.strip_prefix("rpc:") {
        if let Some((_, message)) = rest.split_once(':') {
            if !message.trim().is_empty() {
                return message.to_string();
            }
        }
    }
    let stderr = stderr_buf.lock().map(|buf| buf.clone()).unwrap_or_default();
    let stderr = stderr.trim();
    if stderr.is_empty() {
        return raw;
    }
    format!("{raw}\n{stderr}")
}

#[cfg(test)]
mod tests {
    use super::plan::{collaboration_mode, DEFAULT_PLAN_TITLE, EXECUTE_PLAN_PROMPT};
    use super::*;
    use crate::engines::registry::ChildEntry;
    use crate::engines::support::event_sink::{Emit, EventSink};
    use crate::engines::ProcessRegistry;
    use std::collections::HashMap;

    pub(super) struct CollectingEmitter(Mutex<Vec<String>>);

    impl Emit for CollectingEmitter {
        fn emit_json(&self, _name: &str, raw_json: &str) {
            self.0.lock().unwrap().push(raw_json.to_string());
        }
    }

    pub(super) fn test_core() -> (TurnCore, Arc<ProcessRegistry>, Arc<CollectingEmitter>) {
        let emitter = Arc::new(CollectingEmitter(Mutex::new(Vec::new())));
        let registry = Arc::new(ProcessRegistry::default());
        registry.insert(
            "test-run".to_string(),
            ChildEntry {
                child: None,
                pid: 4_000_000_099,
                run_id: "test-run".to_string(),
                killed: Arc::new(AtomicBool::new(false)),
                reader_abort: Arc::new(std::sync::OnceLock::new()),
                stdin: None,
                questions: Arc::new(Mutex::new(HashMap::new())),
                plans: Arc::new(Mutex::new(HashMap::new())),
            },
        );
        let core = TurnCore {
            sink: EventSink::new(emitter.clone()),
            registry: Arc::clone(&registry),
            engine_id: "codex".to_string(),
            run_id: "test-run".to_string(),
            db: None,
            followup: None,
        };
        (core, registry, emitter)
    }

    fn flushed(core: &TurnCore, emitter: &Arc<CollectingEmitter>) -> Vec<(String, Value)> {
        core.sink.flush();
        let mut out = Vec::new();
        for raw in emitter.0.lock().unwrap().iter() {
            let parsed: Value = serde_json::from_str(raw).expect("flushed batch must be JSON");
            let batch = parsed.as_array().cloned().unwrap_or_else(|| vec![parsed]);
            for value in batch {
                out.push((
                    value
                        .get("kind")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    value.get("data").cloned().unwrap_or(Value::Null),
                ));
            }
        }
        out
    }

    fn parked(rpc_id: Value, ids: Value) -> Value {
        json!({ "rpcId": rpc_id, "ids": ids })
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    #[ignore = "requires CCGUI_CODEX_READ_ONLY_TEST_BIN pointing to audited Codex 0.154.0 on macOS; no model calls"]
    async fn installed_codex_isolated_planner_blocks_writes_and_external_tools() {
        use crate::engines::Engine;
        let bin = std::env::var("CCGUI_CODEX_READ_ONLY_TEST_BIN").unwrap();
        let root =
            std::env::temp_dir().join(format!("ccgui-codex-isolation-{}", uuid::Uuid::new_v4()));
        let _root_guard = codex_read_only::StagedHomeGuard(vec![root.clone()]);
        let native = root.join("native");
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&native).unwrap();
        std::fs::create_dir_all(workspace.join(".codex")).unwrap();
        let marker = root.join("MCP_STARTED");
        let malicious = format!(
            "[mcp_servers.fixture]\ncommand=\"/bin/sh\"\nargs=[\"-c\",\"touch {}\"]\n",
            marker.display()
        );
        std::fs::write(native.join("config.toml"),format!("model=\"probe\"\nmodel_provider=\"probe\"\nnotify=[\"/bin/sh\",\"-c\",\"touch {}\"]\n[model_providers.probe]\nname=\"probe\"\nbase_url=\"http://127.0.0.1:9/v1\"\nwire_api=\"responses\"\n{malicious}",marker.display())).unwrap();
        std::fs::write(workspace.join(".codex/config.toml"), &malicious).unwrap();
        let request = SendRequest {
            session_id: None,
            workspace: workspace.clone(),
            prompt: "not sent".into(),
            prompt_contributions: Vec::new(),
            native_compact: false,
            images: vec![],
            model: Some("probe".into()),
            effort: None,
            service_tier: None,
            permission: Some(codex_read_only::PERMISSION.into()),
            additional_dirs: vec![],
            provider_id: None,
            mcp_servers: None,
            allowed_tools: None,
        };
        let mut built = crate::engines::codex::CodexEngine
            .host_command(&request, &bin)
            .unwrap();
        codex_read_only::stage(&request, &mut built, &native, &root.join("staging")).unwrap();
        let home =
            std::fs::canonicalize(codex_read_only::isolated_home(&built.command).unwrap()).unwrap();
        assert!(!std::fs::read_to_string(home.join("config.toml"))
            .unwrap()
            .contains("mcp_servers"));
        let mut spawned = spawn_app_server(&mut built.command, &workspace).unwrap();
        let killed = AtomicBool::new(false);
        let result: Result<(),String> = async {
            for (method,params) in [
                ("initialize",initialize_params(true)),
                ("configRequirements/read",json!({})),
                ("config/read",json!({"cwd":workspace,"includeLayers":true})),
                ("thread/start",json!({"cwd":workspace,"model":"probe","sandbox":"read-only","approvalPolicy":"never","ephemeral":true,"dynamicTools":[],"selectedCapabilityRoots":[],"environments":[{"environmentId":"local","cwd":workspace}]})),
                ("command/exec",json!({"command":["/bin/sh","-c","cat .codex/config.toml"],"cwd":workspace,"sandboxPolicy":{"type":"readOnly","networkAccess":false},"timeoutMs":3000})),
                ("command/exec",json!({"command":["/bin/sh","-c","touch DENIED_WRITE"],"cwd":workspace,"sandboxPolicy":{"type":"readOnly","networkAccess":false},"timeoutMs":3000})),
            ] {
                let writing=params.pointer("/command/2")==Some(&json!("touch DENIED_WRITE"));
                let key=spawned.server.request(method,params).await?;
                let response=spawned.server.pump(method,Expect::Reply(&key),Instant::now()+Duration::from_secs(10),&killed,None,&mut |_| Handled::Ignore).await?
                    .ok_or("Probe ended without a response")?;
                match method {
                    "initialize"=>codex_read_only::validate_version(&response).map_err(|error| format!("{error}; reported user agent: {}",response["userAgent"]))?,
                    "configRequirements/read"=>assert_eq!(response["requirements"],Value::Null),
                    "config/read"=>codex_read_only::validate_config(&response,&home)?,
                    "thread/start"=>codex_read_only::validate_thread(&response)?,
                    "command/exec" if writing=>assert_ne!(response["exitCode"],json!(0)),
                    "command/exec"=>assert_eq!(response["exitCode"],json!(0)),
                    _=>unreachable!(),
                }
            }
            Ok(())
        }.await;
        teardown(&mut spawned.child).await;
        result.unwrap();
        assert!(!marker.exists());
        assert!(!workspace.join("DENIED_WRITE").exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn plugin_codex_interrupt_during_handshake_waits_for_process_exit() {
        let (mut core, registry, emitter) = test_core();
        let mut entry = registry.get("test-run").unwrap();
        registry.remove_if_pid("test-run", entry.pid);
        core.run_id = "pa-relay-codex-interrupt".into();
        entry.run_id = core.run_id.clone();
        let killed = entry.killed.clone();
        let virtual_pid = entry.pid;
        registry.insert(core.run_id.clone(), entry);
        let directory =
            std::env::temp_dir().join(format!("ccgui-codex-interrupt-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let pid_file = directory.join("pid");
        let mut command = Command::new("sh");
        command.args([
            "-c",
            &format!(
                "echo $$ > '{}'; read ignored; exec sleep 30",
                pid_file.display()
            ),
        ]);
        let request = SendRequest {
            session_id: None,
            workspace: directory.clone(),
            prompt: "hi".into(),
            prompt_contributions: Vec::new(),
            native_compact: false,
            images: vec![],
            model: None,
            effort: None,
            service_tier: None,
            permission: None,
            additional_dirs: vec![],
            provider_id: None,
            mcp_servers: None,
            allowed_tools: None,
        };
        let built = BuiltCommand {
            command,
            stdin_payload: None,
            keep_stdin_open: true,
            cleanup_files: vec![],
            preassigned_session_id: None,
        };
        let run_id = core.run_id.clone();
        let sink = core.sink.clone();
        let task = tokio::spawn(run_app_server_turn(
            core,
            request,
            built,
            killed,
            virtual_pid,
        ));
        let child_pid: i32 = timeout(Duration::from_secs(15), async {
            loop {
                let pid = std::fs::read_to_string(&pid_file)
                    .ok()
                    .and_then(|text| text.trim().parse().ok());
                if let Some(pid) = pid {
                    break pid;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert!(registry.kill(&run_id));
        timeout(Duration::from_secs(15), task)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(unsafe { libc::kill(child_pid, 0) }, -1);
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH)
        );
        assert_eq!(registry.active_run_count(), 0);
        sink.flush();
        let events: Vec<Value> = emitter
            .0
            .lock()
            .unwrap()
            .iter()
            .flat_map(|raw| serde_json::from_str::<Vec<Value>>(raw).unwrap())
            .collect();
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event["kind"].as_str(), Some("done" | "error")))
                .count(),
            1
        );
        assert_eq!(events.last().unwrap()["kind"], "done");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn answer_frame_keys_a_single_choice_by_the_servers_question_id() {
        let frame = answer_frame(
            &parked(json!(7), json!({ "Which one?": "q1" })),
            Some(&json!({ "Which one?": "Alpha" })),
        )
        .unwrap();
        assert_eq!(frame["jsonrpc"], json!("2.0"));
        assert_eq!(frame["id"], json!(7));
        assert_eq!(
            frame["result"],
            json!({ "answers": { "q1": { "answers": ["Alpha"] } } })
        );
    }

    #[test]
    fn answer_frame_keeps_every_label_of_a_multi_select() {
        let frame = answer_frame(
            &parked(json!("rpc-9"), json!({ "Layers?": "q9" })),
            Some(&json!({ "Layers?": ["ui", "engine"] })),
        )
        .unwrap();
        assert_eq!(frame["id"], json!("rpc-9"));
        assert_eq!(
            frame["result"]["answers"]["q9"]["answers"],
            json!(["ui", "engine"])
        );
    }

    #[test]
    fn answer_frame_rejects_an_answer_to_a_question_that_was_never_asked() {
        let error = answer_frame(
            &parked(json!(1), json!({ "Which one?": "q1" })),
            Some(&json!({ "Something else?": "Alpha" })),
        )
        .unwrap_err();
        assert!(error.contains("Something else?"), "{error}");
    }

    #[test]
    fn answer_frame_rejects_a_non_object_answer_map() {
        let error =
            answer_frame(&parked(json!(1), json!({})), Some(&json!(["Alpha"]))).unwrap_err();
        assert!(error.contains("object"), "{error}");
    }

    #[test]
    fn answer_frame_settles_a_dismissed_card_with_an_empty_answer() {
        let frame = answer_frame(&parked(json!(3), json!({ "Which one?": "q1" })), None).unwrap();
        assert_eq!(frame["id"], json!(3));
        assert_eq!(frame["result"], json!({ "answers": {} }));
    }

    #[test]
    fn answer_frame_reports_a_single_question_answered_with_null_as_empty() {
        let frame = answer_frame(
            &parked(json!(3), json!({ "Which one?": "q1" })),
            Some(&json!({ "Which one?": null })),
        )
        .unwrap();
        assert_eq!(frame["result"]["answers"]["q1"], json!({ "answers": [] }));
    }

    #[test]
    fn question_cards_synthesise_missing_headers_and_options() {
        let params = json!({
            "itemId": "item-1",
            "questions": [
                {
                    "id": "q1",
                    "question": "Which one?",
                    "options": [
                        { "label": "Alpha" },
                        { "label": "Beta", "description": "the second one" },
                    ],
                },
                { "id": "q2", "question": "  And then?  " },
            ],
        });
        let (cards, ids) = question_cards(&params);
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0]["question"], json!("Which one?"));
        assert_eq!(cards[0]["header"], json!("Q1"));
        assert_eq!(cards[0]["options"][0], json!({ "label": "Alpha" }));
        assert_eq!(
            cards[0]["options"][1],
            json!({ "label": "Beta", "description": "the second one" })
        );
        assert!(cards[0].get("multiSelect").is_none());
        assert_eq!(cards[1]["question"], json!("And then?"));
        assert_eq!(cards[1]["header"], json!("Q2"));
        assert_eq!(cards[1]["options"], json!([]));
        assert_eq!(ids, json!({ "Which one?": "q1", "And then?": "q2" }));
    }

    #[test]
    fn question_cards_skip_questions_the_card_cannot_ask() {
        let params = json!({
            "questions": [
                { "id": "q1", "question": "   " },
                { "question": "no id" },
                { "id": "q3", "question": "Real?" },
            ],
        });
        let (cards, ids) = question_cards(&params);
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0]["header"], json!("Q3"));
        assert_eq!(ids, json!({ "Real?": "q3" }));
    }

    #[test]
    fn async_question_cards_project_titles_and_string_options() {
        let cards = async_question_cards(&json!({
            "questions": [
                { "title": "  Which route?  ", "options": ["Direct", "Queue"] },
                { "title": "Free-form?", "options": null },
                { "title": "   ", "options": ["ignored"] },
            ],
        }));
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0]["question"], json!("Which route?"));
        assert_eq!(cards[0]["header"], json!("Q1"));
        assert_eq!(
            cards[0]["options"],
            json!([{ "label": "Direct" }, { "label": "Queue" }])
        );
        assert_eq!(cards[1]["question"], json!("Free-form?"));
        assert_eq!(cards[1]["options"], json!([]));
    }

    #[test]
    fn async_answer_request_steers_the_live_turn_with_the_call_id() {
        let parked = json!({
            "callId": "call_123",
            "threadId": "thread_1",
            "turnId": "turn_1",
            "questions": [{ "question": "Which route?", "options": [{ "label": "Direct" }] }],
        });
        let frame = async_answer_request(
            &parked,
            "ccgui-async-question-7",
            Some(&json!({ "Which route?": "Direct" })),
        )
        .unwrap();
        assert_eq!(frame["jsonrpc"], json!("2.0"));
        assert_eq!(frame["id"], json!("ccgui-async-question-7"));
        assert_eq!(frame["method"], json!("turn/steer"));
        assert_eq!(frame["params"]["threadId"], json!("thread_1"));
        assert_eq!(frame["params"]["expectedTurnId"], json!("turn_1"));
        let text = frame["params"]["input"][0]["text"]
            .as_str()
            .expect("steering input is text");
        assert!(text.contains("call_123"));
        assert!(text.contains("Which route?"));
        assert!(text.contains("Direct"));
    }

    #[test]
    fn async_answer_request_rejects_unknown_question_titles() {
        let parked = json!({
            "callId": "call_123",
            "threadId": "thread_1",
            "turnId": "turn_1",
            "questions": [{ "question": "Which route?" }],
        });
        let error = async_answer_request(
            &parked,
            "ccgui-async-question-7",
            Some(&json!({ "Another question?": "Direct" })),
        )
        .unwrap_err();
        assert!(error.contains("Another question?"), "{error}");
    }

    #[test]
    fn resumed_threads_skip_full_history_hydration() {
        let (method, params) = thread_open_request(Some("thread-123"));
        assert_eq!(method, "thread/resume");
        assert_eq!(params["threadId"], json!("thread-123"));
        assert_eq!(params["excludeTurns"], json!(true));

        let (method, params) = thread_open_request(None);
        assert_eq!(method, "thread/start");
        assert!(params.get("excludeTurns").is_none());
    }

    #[tokio::test]
    async fn metadata_only_resume_preserves_the_turn_and_plan_verification_handshake() {
        let peer = r#"
const assert = require('node:assert/strict');
const mode = process.argv[1];
const resumed = mode !== 'new';
const methods = ['initialize', resumed ? 'thread/resume' : 'thread/start'];
if (mode === 'decision') methods.push('thread/turns/list');
methods.push('turn/start');
let step = 0;
require('node:readline').createInterface({input: process.stdin}).on('line', line => {
  const {id, method, params} = JSON.parse(line);
  assert.equal(method, methods[step++]);
  let result;
  if (method === 'initialize') {
    assert.equal(params.capabilities.experimentalApi, resumed);
    result = {};
  } else if (method === 'thread/resume' || method === 'thread/start') {
    assert.equal(params.approvalPolicy, 'never');
    assert.equal(params.sandbox, 'workspace-write');
    assert.equal(params.excludeTurns, resumed ? true : undefined);
    assert.equal(params.threadId, resumed ? 'thread-123' : undefined);
    assert.equal(params.history, undefined);
    result = {thread: {id: 'thread-123', turns: []}, model: 'test-model', reasoningEffort: 'high'};
  } else if (method === 'thread/turns/list') {
    assert.equal(params.threadId, 'thread-123');
    assert.equal(params.itemsView, 'full');
    result = {data: [{id: 'plan-turn', items: [{id: 'plan-1', type: 'plan', text: '# Plan'}]}]};
  } else {
    assert.equal(params.threadId, 'thread-123');
    assert.equal(params.input[0].text, 'Continue the conversation');
    assert.equal(params.history, undefined);
    if (mode === 'decision') {
      assert.equal(params.collaborationMode.mode, 'default');
      assert.equal(params.collaborationMode.settings.model, 'test-model');
      assert.equal(params.collaborationMode.settings.reasoning_effort, 'high');
    }
    result = {turn: {id: 'next-turn'}};
  }
  process.stdout.write(JSON.stringify({jsonrpc: '2.0', id, result}) + '\n', () => {
    if (method === 'turn/start') process.exit(0);
  });
});
"#;
        for mode in ["new", "resume", "decision"] {
            let mut child = Command::new("node")
                .args(["-e", peer, mode])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .expect("protocol test requires the project's Node runtime");
            let stdin = Arc::new(TokioMutex::new(child.stdin.take()));
            let mut server = AppServer::new(stdin, child.stdout.take().unwrap());
            let req = SendRequest {
                session_id: (mode != "new").then(|| "thread-123".into()),
                workspace: std::env::temp_dir(),
                prompt: "Continue the conversation".into(),
                prompt_contributions: Vec::new(),
                native_compact: false,
                images: Vec::new(),
                model: None,
                effort: None,
                service_tier: None,
                permission: Some("auto".into()),
                additional_dirs: Vec::new(),
                provider_id: None,
                mcp_servers: None,
                allowed_tools: None,
            };
            let decision = (mode == "decision").then(|| DecisionCheck {
                mode: "default",
                native_plan_id: "plan-1".into(),
                content_hash: plan_review::content_hash("# Plan"),
            });
            let (core, _registry, _emitter) = test_core();
            let result = handshake_and_start(
                &mut server,
                &core,
                &mut TurnState::new(req.session_id.clone()),
                &mut TurnView::default(),
                &req,
                &Arc::new(AtomicBool::new(false)),
                decision.as_ref(),
                Some(Duration::from_secs(5)),
            )
            .await;
            let status = timeout(Duration::from_secs(5), child.wait())
                .await
                .expect("protocol peer must exit")
                .unwrap();
            assert!(status.success(), "{mode}: peer rejected the handshake");
            let started = result.expect(mode).expect("turn must be acknowledged");
            assert_eq!(started.thread_id, "thread-123");
            assert_eq!(started.turn_id.as_deref(), Some("next-turn"));
        }
    }

    #[test]
    fn usage_payload_projects_the_protocol_fields_onto_snake_case() {
        let usage = json!({
            "last": {
                "inputTokens": 120,
                "cachedInputTokens": 100,
                "cacheWriteInputTokens": 5,
                "outputTokens": 30,
                "reasoningOutputTokens": 7,
                "totalTokens": 150,
            },
            "total": { "inputTokens": 1, "outputTokens": 2, "totalTokens": 3 },
        });
        let payload = usage_payload(&usage, Some(&json!(128_000))).unwrap();
        assert_eq!(payload["input_tokens"], json!(120));
        assert_eq!(payload["cached_input_tokens"], json!(100));
        assert_eq!(payload["cache_write_input_tokens"], json!(5));
        assert_eq!(payload["output_tokens"], json!(30));
        assert_eq!(payload["reasoning_output_tokens"], json!(7));
        assert_eq!(payload["total_tokens"], json!(150));
        assert_eq!(payload["model_context_window"], json!(128_000));
    }

    #[test]
    fn usage_payload_omits_what_the_report_does_not_carry() {
        assert!(usage_payload(&json!({ "total": { "totalTokens": 3 } }), None).is_none());
        assert!(usage_payload(&json!({ "last": {} }), None).is_none());
        let payload = usage_payload(&json!({ "last": { "totalTokens": 3 } }), None).unwrap();
        assert_eq!(payload, json!({ "total_tokens": 3 }));
    }

    #[tokio::test]
    async fn model_reroute_reports_the_served_model() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "jsonrpc": "2.0",
                "method": "model/rerouted",
                "params": {
                    "fromModel": "gpt-5.6-luna",
                    "reason": "highRiskCyberActivity",
                    "threadId": "t-1",
                    "toModel": "gpt-5.6-cyber",
                    "turnId": "u-1",
                },
            }),
        );
        let events = flushed(&core, &emitter);
        assert!(
            events.iter().any(|(kind, data)| {
                kind == "served"
                    && data.get("model").and_then(Value::as_str) == Some("gpt-5.6-cyber")
            }),
            "{events:?}"
        );
    }

    #[tokio::test]
    async fn route_parks_a_question_and_the_answer_frame_reads_what_it_parked() {
        let (core, registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        let handled = route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "jsonrpc": "2.0",
                "id": 12,
                "method": "item/tool/requestUserInput",
                "params": {
                    "itemId": "item-1",
                    "questions": [{
                        "id": "q1",
                        "question": "Which one?",
                        "options": [{ "label": "Alpha" }],
                    }],
                },
            }),
        );
        assert!(matches!(handled, Handled::Parked));
        let events = flushed(&core, &emitter);
        let question = events
            .iter()
            .find(|(kind, _)| kind == "question")
            .expect("the card must reach the UI");
        assert_eq!(question.1["requestId"], json!("12"));
        assert_eq!(question.1["toolUseId"], json!("item-1"));
        assert_eq!(question.1["input"]["questions"][0]["header"], json!("Q1"));
        let entry = registry.get("test-run").expect("registry entry");
        let parked = entry
            .questions
            .lock()
            .unwrap()
            .get("12")
            .cloned()
            .expect("the answer context must be parked under the rpc id");
        let frame = answer_frame(
            parked.get("codexApp").expect("codexApp context"),
            Some(&json!({ "Which one?": "Alpha" })),
        )
        .unwrap();
        assert_eq!(frame["id"], json!(12));
        assert_eq!(
            frame["result"],
            json!({ "answers": { "q1": { "answers": ["Alpha"] } } })
        );
    }

    #[tokio::test]
    async fn completed_agent_message_parks_async_question_even_after_text_streamed() {
        let (core, registry, emitter) = test_core();
        let mut state = TurnState::new(Some("thread_1".to_string()));
        let mut view = TurnView {
            streamed_message: Some("call_123".to_string()),
            turn_id: Some("turn_1".to_string()),
            ..TurnView::default()
        };
        let handled = route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "item/completed",
                "params": {
                    "threadId": "thread_1",
                    "turnId": "turn_1",
                    "item": {
                        "id": "call_123",
                        "type": "agentMessage",
                        "text": "Choose one.",
                        "questions": [{ "title": "Which route?", "options": ["Direct", "Queue"] }],
                    },
                },
            }),
        );
        assert!(matches!(handled, Handled::Ignore));
        let events = flushed(&core, &emitter);
        let question = events
            .iter()
            .find(|(kind, _)| kind == "question")
            .expect("async questions must reach the card UI");
        assert_eq!(question.1["requestId"], json!("call_123"));
        assert_eq!(question.1["toolUseId"], json!("call_123"));
        assert_eq!(
            question.1["input"]["questions"][0]["question"],
            json!("Which route?")
        );
        assert!(
            !events.iter().any(|(kind, _)| kind == "message"),
            "the already streamed message must not be duplicated"
        );
        let entry = registry.get("test-run").expect("registry entry");
        let parked = entry
            .questions
            .lock()
            .unwrap()
            .get("call_123")
            .cloned()
            .expect("the async answer context must be parked");
        let app = parked.get("codexAppAsync").expect("async Codex context");
        assert_eq!(app["threadId"], json!("thread_1"));
        assert_eq!(app["turnId"], json!("turn_1"));
        assert_eq!(app["callId"], json!("call_123"));
        let frame = async_answer_request(
            app,
            "ccgui-async-question-8",
            Some(&json!({ "Which route?": "Queue" })),
        )
        .unwrap();
        assert_eq!(frame["method"], json!("turn/steer"));
        assert!(frame["params"]["input"][0]["text"]
            .as_str()
            .unwrap()
            .contains("Queue"));
    }

    #[tokio::test]
    async fn route_resolves_an_async_question_steer_reply() {
        let (core, registry, _emitter) = test_core();
        let reply = registry
            .register_pending_rpc_reply("test-run", "steer-1")
            .unwrap();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        route(
            &core,
            &mut state,
            &mut view,
            &json!({ "jsonrpc": "2.0", "id": "steer-1", "result": { "turnId": "turn_1" } }),
        );
        assert_eq!(reply.await.unwrap().unwrap()["turnId"], json!("turn_1"));
    }

    #[tokio::test]
    async fn route_answers_an_unrenderable_question_instead_of_wedging_the_turn() {
        let (core, registry, _emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        let handled = route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "jsonrpc": "2.0",
                "id": 8,
                "method": "item/tool/requestUserInput",
                "params": { "questions": [] },
            }),
        );
        let Handled::Answer(frame) = handled else {
            panic!("a question the card cannot show must still be answered");
        };
        assert_eq!(frame["id"], json!(8));
        assert_eq!(frame["result"], json!({ "answers": {} }));
        let entry = registry.get("test-run").expect("registry entry");
        assert!(
            entry.questions.lock().unwrap().is_empty(),
            "nothing may be left waiting for an answer"
        );
    }

    #[tokio::test]
    async fn route_hands_an_approval_to_the_gate() {
        let (core, _registry, _emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        let handled = route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "jsonrpc": "2.0",
                "id": 4,
                "method": "item/commandExecution/requestApproval",
                "params": { "command": "rm -rf build" },
            }),
        );
        assert!(matches!(handled, Handled::Parked));
    }

    #[tokio::test]
    async fn a_streamed_message_is_not_repeated_by_its_completed_item() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "item/agentMessage/delta",
                "params": { "itemId": "m1", "delta": "Hel" },
            }),
        );
        route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "item/completed",
                "params": { "item": { "id": "m1", "type": "agentMessage", "text": "Hello" } },
            }),
        );
        let events = flushed(&core, &emitter);
        assert_eq!(
            events
                .iter()
                .map(|(kind, _)| kind.as_str())
                .collect::<Vec<_>>(),
            ["delta"]
        );
        assert_eq!(events[0].1, json!("Hel"));
    }

    #[tokio::test]
    async fn an_unstreamed_message_still_arrives_from_its_completed_item() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "item/completed",
                "params": { "item": { "id": "m2", "type": "agentMessage", "text": "Hello" } },
            }),
        );
        let events = flushed(&core, &emitter);
        assert_eq!(events.len(), 1, "{events:?}");
        assert_eq!(events[0].0, "message");
        assert_eq!(events[0].1["role"], json!("assistant"));
        assert_eq!(events[0].1["text"], json!("Hello"));
    }

    #[tokio::test]
    async fn a_token_usage_notification_is_held_for_the_turn_end() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "thread/tokenUsage/updated",
                "params": {
                    "threadId": "t1",
                    "turnId": "turn-1",
                    "tokenUsage": {
                        "last": { "totalTokens": 42 },
                        "modelContextWindow": 1000,
                    },
                },
            }),
        );
        assert_eq!(
            view.last_usage,
            Some(json!({ "total_tokens": 42, "model_context_window": 1000 }))
        );
        assert!(flushed(&core, &emitter).is_empty());
    }

    #[tokio::test]
    async fn a_failed_turn_settles_the_run_with_the_engines_own_message() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        let handled = route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "t1",
                    "turn": {
                        "id": "turn-1",
                        "status": "failed",
                        "error": { "message": "stream disconnected" },
                    },
                },
            }),
        );
        assert!(matches!(handled, Handled::Ended));
        let events = flushed(&core, &emitter);
        assert_eq!(events.len(), 1, "{events:?}");
        assert_eq!(events[0].0, "error");
        assert_eq!(events[0].1, json!("stream disconnected"));
    }

    #[tokio::test]
    async fn a_clean_turn_ends_without_erroring() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        let handled = route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "turn/completed",
                "params": { "threadId": "t1", "turn": { "id": "turn-1", "status": "completed" } },
            }),
        );
        assert!(matches!(handled, Handled::Ended));
        assert!(flushed(&core, &emitter).is_empty());
    }

    fn plan_view() -> TurnView {
        TurnView {
            plan_mode: true,
            workspace: "/tmp/ws".to_string(),
            ..TurnView::default()
        }
    }

    fn next_turn_review() -> PlanReview {
        PlanReview {
            plan_id: "thread-1/plan".into(),
            engine: "codex".into(),
            session_id: "thread-1".into(),
            workspace_path: "/tmp/ws".into(),
            run_id: Some("run-1".into()),
            revision: 1,
            title: "Plan".into(),
            content: "# Plan\n- a".into(),
            content_hash: plan_review::content_hash("# Plan\n- a"),
            complete: true,
            review_kind: PlanReviewKind::NextTurn,
            native_plan_id: Some("item-9".into()),
            exec_permission: "auto".into(),
            status: plan_review::PlanStatus::Submitting,
            execution: plan_review::PlanExecution::NotStarted,
            decision: None,
            decision_intent_at: None,
            applied_at: None,
            created_at: 0,
            updated_at: 0,
            superseded_by: None,
        }
    }

    #[test]
    fn collaboration_mode_carries_only_the_fields_that_have_values() {
        assert_eq!(
            collaboration_mode("plan", "gpt-5", Some("high")),
            json!({"mode": "plan", "settings": {"model": "gpt-5", "reasoning_effort": "high"}})
        );
        assert_eq!(
            collaboration_mode("default", "gpt-5", None),
            json!({"mode": "default", "settings": {"model": "gpt-5"}})
        );
        assert_eq!(
            collaboration_mode("plan", "gpt-5", Some("  ")),
            json!({"mode": "plan", "settings": {"model": "gpt-5"}})
        );
    }

    #[test]
    fn plan_collaboration_prefers_the_request_and_fails_closed_without_a_model() {
        assert_eq!(
            plan_collaboration(Some("gpt-5"), Some("thread-model"), Some("low")).unwrap(),
            json!({"mode": "plan", "settings": {"model": "gpt-5", "reasoning_effort": "low"}})
        );
        assert_eq!(
            plan_collaboration(None, Some("thread-model"), None).unwrap(),
            json!({"mode": "plan", "settings": {"model": "thread-model"}})
        );
        let error = plan_collaboration(None, None, None).unwrap_err();
        assert!(error.contains("model"), "{error}");
        let error = plan_collaboration(Some("  "), Some(" "), None).unwrap_err();
        assert!(error.contains("model"), "{error}");
    }

    #[test]
    fn decision_collaboration_restates_mode_and_inherits_thread_settings() {
        assert_eq!(
            decision_collaboration("default", Some("thread-model"), Some("high")).unwrap(),
            json!({"mode": "default", "settings": {"model": "thread-model", "reasoning_effort": "high"}})
        );
        assert_eq!(
            decision_collaboration("plan", Some("thread-model"), None).unwrap(),
            json!({"mode": "plan", "settings": {"model": "thread-model"}})
        );
        assert!(decision_collaboration("default", None, None).is_err());
    }

    #[tokio::test]
    async fn plan_deltas_stream_as_drafts_only_in_a_plan_run() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(Some("thread-1".into()));
        let mut view = plan_view();
        for delta in ["# Dra", "ft"] {
            route(
                &core,
                &mut state,
                &mut view,
                &json!({
                    "method": "item/plan/delta",
                    "params": {"threadId": "thread-1", "turnId": "turn-1", "itemId": "item-9", "delta": delta},
                }),
            );
        }
        let events = flushed(&core, &emitter);
        assert_eq!(
            events,
            vec![
                (
                    "plan_draft".to_string(),
                    json!({"planId": "thread-1/plan", "text": "# Dra", "replace": false})
                ),
                (
                    "plan_draft".to_string(),
                    json!({"planId": "thread-1/plan", "text": "ft", "replace": false})
                ),
            ]
        );
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(Some("thread-1".into()));
        let mut view = TurnView::default();
        route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "item/plan/delta",
                "params": {"threadId": "thread-1", "turnId": "turn-1", "itemId": "item-9", "delta": "# Dra"},
            }),
        );
        assert!(flushed(&core, &emitter).is_empty());
    }

    #[tokio::test]
    async fn the_completed_plan_item_is_the_authoritative_review_content() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(Some("thread-1".into()));
        let mut view = plan_view();
        route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "item/plan/delta",
                "params": {"threadId": "thread-1", "turnId": "turn-1", "itemId": "item-9", "delta": "# Draft that does not match"},
            }),
        );
        route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "item/completed",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "completedAtMs": 1,
                    "item": {"id": "item-9", "type": "plan", "text": "# Final plan\n- step one"},
                },
            }),
        );
        let events = flushed(&core, &emitter);
        let kinds: Vec<&str> = events.iter().map(|(kind, _)| kind.as_str()).collect();
        assert_eq!(kinds, ["plan_draft", "plan_review"]);
        let review = &events[1].1;
        assert_eq!(review["content"], json!("# Final plan\n- step one"));
        assert_eq!(
            review["contentHash"],
            json!(plan_review::content_hash("# Final plan\n- step one"))
        );
        assert_eq!(review["complete"], json!(true));
        assert_eq!(review["reviewKind"], json!("next_turn"));
        assert_eq!(review["planId"], json!("thread-1/plan"));
        assert_eq!(review["sessionId"], json!("thread-1"));
        assert_eq!(review["nativePlanId"], json!("item-9"));
        assert_eq!(review["title"], json!("Final plan"));
        assert_eq!(review["status"], json!("awaiting_review"));
        assert_eq!(review["execPermission"], json!("auto"));
        assert_eq!(review["workspacePath"], json!("/tmp/ws"));
        assert_eq!(review["engine"], json!("codex"));
        assert_eq!(review["runId"], json!("test-run"));
    }

    #[tokio::test]
    async fn a_plan_item_outside_a_plan_run_never_becomes_a_review() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(Some("thread-1".into()));
        let mut view = TurnView {
            workspace: "/tmp/ws".into(),
            ..Default::default()
        };
        route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "item/completed",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "completedAtMs": 1,
                    "item": {"id": "item-9", "type": "plan", "text": "# Plan"},
                },
            }),
        );
        assert!(flushed(&core, &emitter).is_empty());
    }

    #[tokio::test]
    async fn non_plan_items_and_the_task_checklist_never_trigger_a_review() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(Some("thread-1".into()));
        let mut view = plan_view();
        route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "turn/plan/updated",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "plan": [{"step": "do a", "status": "inProgress"}],
                },
            }),
        );
        route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "item/completed",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "completedAtMs": 1,
                    "item": {"id": "m1", "type": "agentMessage", "text": "working on it"},
                },
            }),
        );
        let events = flushed(&core, &emitter);
        assert_eq!(events.len(), 1, "{events:?}");
        assert_eq!(events[0].0, "message");
        assert_eq!(events[0].1["text"], json!("working on it"));
    }

    #[tokio::test]
    async fn an_empty_or_idless_plan_item_is_not_a_review() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(Some("thread-1".into()));
        let mut view = plan_view();
        for item in [
            json!({"id": "item-9", "type": "plan", "text": "   "}),
            json!({"type": "plan", "text": "# Plan"}),
        ] {
            route(
                &core,
                &mut state,
                &mut view,
                &json!({
                    "method": "item/completed",
                    "params": {"threadId": "thread-1", "turnId": "turn-1", "completedAtMs": 1, "item": item},
                }),
            );
        }
        assert!(flushed(&core, &emitter).is_empty());
    }

    #[test]
    fn check_plan_item_accepts_only_the_unchanged_final_item() {
        let page = json!({"data": [
            {"id": "turn-1", "itemsView": "full", "status": "completed", "items": [
                {"id": "m1", "type": "agentMessage", "text": "done"},
                {"id": "item-9", "type": "plan", "text": "# Plan\n- a"},
            ]},
        ], "nextCursor": null});
        let hash = plan_review::content_hash("# Plan\n- a");
        assert!(check_plan_item(&page, "item-9", &hash).is_ok());
        let error = check_plan_item(&page, "item-9", "0123456789abcdef").unwrap_err();
        assert!(error.starts_with(PLAN_STALE_PREFIX), "{error}");
        let error = check_plan_item(&page, "item-404", &hash).unwrap_err();
        assert!(error.starts_with(PLAN_STALE_PREFIX), "{error}");
        let error = check_plan_item(&json!({"data": []}), "item-9", &hash).unwrap_err();
        assert!(error.starts_with(PLAN_STALE_PREFIX), "{error}");
        let error = check_plan_item(&json!({}), "item-9", &hash).unwrap_err();
        assert!(!error.starts_with(PLAN_STALE_PREFIX), "{error}");
    }

    #[test]
    fn plan_title_takes_the_first_atx_heading() {
        assert_eq!(plan_title("# 实施方案\n- a"), "实施方案");
        assert_eq!(plan_title("intro\n## Steps\n- a"), "Steps");
        assert_eq!(plan_title("#tag\nbody"), DEFAULT_PLAN_TITLE);
        assert_eq!(plan_title("no heading here"), DEFAULT_PLAN_TITLE);
        assert_eq!(plan_title(""), DEFAULT_PLAN_TITLE);
    }

    #[test]
    fn decision_spec_builds_the_turn_from_the_record() {
        let review = next_turn_review();
        let spec = decision_spec(&review, PlanDecision::Approve, None).unwrap();
        assert_eq!(spec.mode, "default");
        assert_eq!(spec.prompt, EXECUTE_PLAN_PROMPT);
        assert_eq!(spec.permission, "auto");
        assert_eq!(spec.native_plan_id, "item-9");

        let spec =
            decision_spec(&review, PlanDecision::RequestChanges, Some("  收紧范围 ")).unwrap();
        assert_eq!(spec.mode, "plan");
        assert_eq!(spec.prompt, "收紧范围");
        assert_eq!(spec.permission, "plan");
    }

    #[test]
    fn decision_spec_rejects_before_touching_the_transport() {
        let review = next_turn_review();
        assert!(decision_spec(&review, PlanDecision::RequestChanges, None).is_err());
        assert!(decision_spec(&review, PlanDecision::RequestChanges, Some("  ")).is_err());
        assert!(decision_spec(&review, PlanDecision::Defer, None).is_err());
        let mut wrong_kind = next_turn_review();
        wrong_kind.review_kind = PlanReviewKind::NativeRequest;
        assert!(decision_spec(&wrong_kind, PlanDecision::Approve, None).is_err());
        let mut no_item = next_turn_review();
        no_item.native_plan_id = None;
        assert!(decision_spec(&no_item, PlanDecision::Approve, None).is_err());
        let mut no_permission = next_turn_review();
        no_permission.exec_permission = "  ".into();
        assert!(decision_spec(&no_permission, PlanDecision::Approve, None).is_err());
        let spec = decision_spec(&review, PlanDecision::Approve, Some("ignored")).unwrap();
        assert_eq!(spec.prompt, EXECUTE_PLAN_PROMPT);
    }

    #[tokio::test]
    async fn a_retryable_error_does_not_settle_the_turn() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        assert!(matches!(
            route(
                &core,
                &mut state,
                &mut view,
                &json!({
                    "method": "error",
                    "params": { "error": { "message": "upstream 502" }, "willRetry": true },
                }),
            ),
            Handled::Ignore
        ));
        let events = flushed(&core, &emitter);
        assert_eq!(events.len(), 1, "{events:?}");
        assert_eq!(events[0].0, "warn");
        assert_eq!(events[0].1, json!("upstream 502"));
        assert!(!state.saw_error, "a retry must not settle the run");
    }

    #[cfg(unix)]
    #[tokio::test(start_paused = true)]
    async fn a_turn_silent_past_thirty_minutes_runs_to_its_own_completion() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        let directory =
            std::env::temp_dir().join(format!("ccgui-codex-long-turn-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let release = directory.join("release");
        let completed = json!({
            "method": "turn/completed",
            "params": { "threadId": "t1", "turn": { "id": "turn-1", "status": "completed" } },
        });
        let mut command = Command::new("sh");
        command.args([
            "-c",
            &format!(
                "while [ ! -e '{}' ]; do sleep 0.05; done; echo '{completed}'; exec sleep 30",
                release.display(),
            ),
        ]);
        let mut spawned = spawn_app_server(&mut command, &directory).unwrap();
        let killed = Arc::new(AtomicBool::new(false));
        let started = TurnStarted {
            thread_id: "t1".into(),
            turn_id: Some("turn-1".into()),
        };
        let begun = Instant::now();
        let (result, ()) = tokio::join!(
            pump_turn_to_end(
                &mut spawned.server,
                &core,
                &mut state,
                &mut view,
                &started,
                &killed,
            ),
            async {
                tokio::time::sleep(Duration::from_secs(31 * 60)).await;
                std::fs::write(&release, b"").unwrap();
            },
        );
        let elapsed = begun.elapsed();
        teardown(&mut spawned.child).await;
        let _ = std::fs::remove_dir_all(&directory);
        result.unwrap();
        assert!(elapsed >= Duration::from_secs(31 * 60), "{elapsed:?}");
        assert!(flushed(&core, &emitter).is_empty());
    }

    #[cfg(unix)]
    #[tokio::test(start_paused = true)]
    async fn stopping_a_hung_turn_gives_up_after_the_settle_window() {
        let (core, _registry, _emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        let directory =
            std::env::temp_dir().join(format!("ccgui-codex-hung-turn-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let received = directory.join("received");
        let mut command = Command::new("sh");
        command.args([
            "-c",
            &format!("cat > '{}'; exec sleep 30", received.display()),
        ]);
        let mut spawned = spawn_app_server(&mut command, &directory).unwrap();
        let killed = Arc::new(AtomicBool::new(false));
        let started = TurnStarted {
            thread_id: "t1".into(),
            turn_id: Some("turn-1".into()),
        };
        let (result, stopped_at) = timeout(Duration::from_secs(40 * 60), async {
            tokio::join!(
                pump_turn_to_end(
                    &mut spawned.server,
                    &core,
                    &mut state,
                    &mut view,
                    &started,
                    &killed,
                ),
                async {
                    tokio::time::sleep(Duration::from_secs(31 * 60)).await;
                    killed.store(true, Ordering::SeqCst);
                    Instant::now()
                },
            )
        })
        .await
        .expect("Stop must end a hung turn");
        let settled_in = stopped_at.elapsed();
        let sent = recorded(&received, "\"turn/interrupt\"");
        teardown(&mut spawned.child).await;
        let _ = std::fs::remove_dir_all(&directory);
        assert_eq!(result.unwrap_err(), CANCELLED);
        assert!(
            settled_in <= INTERRUPT_SETTLE_TIMEOUT + KILL_POLL * 2,
            "{settled_in:?}"
        );
        assert!(sent.contains("\"turn/interrupt\""), "{sent}");
    }

    #[cfg(unix)]
    pub(super) fn recorded(path: &Path, needle: &str) -> String {
        for _ in 0..300 {
            let sent = std::fs::read_to_string(path).unwrap_or_default();
            if sent.contains(needle) {
                return sent;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        std::fs::read_to_string(path).unwrap_or_default()
    }
}
