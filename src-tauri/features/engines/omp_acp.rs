// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/omp_acp.rs.
//! The ACP plan-session driver for OMP 18.0.11.
//!
//! Every protocol fact comes from OMP's installed source (@oh-my-pi/pi-coding-agent):
//! - Entry: `omp --mode acp` (the `omp acp` subcommand is equivalent). A bare `--plan <value>`
//!   is the plan **model role** flag, not a mode switch.
//! - initialize's clientCapabilities **must declare elicitation.form**: OMP checks it before a
//!   review and **silently auto-approves when it is missing** (`if (!supportsForm) return
//!   true;`). It is checked before starting, and its absence fails closed.
//! - session/new {cwd, mcpServers} → session/set_mode {modeId:"plan"} (plan.enabled defaults
//!   to true; a failed set_mode returns an rpc error).
//! - Model and effort go over the ACP config protocol: session/set_config_option
//!   {configId:"model"|"thinking", value}, keeping the person's choice, never downgraded.
//! - After the model writes xd://propose, the proposal handler blocks on
//!   `unstable_createElicitation` (the wire method `elicitation/create`). The elicitation carries
//!   only a **12-line preview**, never used as the body; the body is the plan file on disk,
//!   local://<slug>-plan.md.
//! - The approve frame: only a select answer exactly equal to "Approve and execute" approves;
//!   cancel, dismiss and timeout all mean refine and **never authorize**. After approval the
//!   same prompt turn returns the tool result and carries on.
//! - Resume: planModeState and the proposal handler live only in memory and session/load
//!   doesn't re-register them, so a review point can't survive a restart and a resume request
//!   is refused outright.
//!
//! The plan file is read from an allowlist: only the OMP session's artifacts directory
//! (~/.omp/agent/sessions/<encoded cwd>/<timestamp>_<sessionId>/local/), refusing symlink
//! escapes, at most 1 MiB, with content_hash computed after reading. The final plan file is
//! bound to this proposal by "the file's first 12 lines == the elicitation preview", and a
//! mismatch fails closed.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use serde_json::{json, Map, Value};

use crate::engines::plan_review::{self, PlanExecution, PlanReview, PlanReviewKind, PlanStatus};
use crate::engines::qoder_session::{
    initialize_params, jsonrpc_id_key, jsonrpc_result_response, session_update_from_notification,
    spawn_piped_acp, teardown, AcpLine, AcpProcess, QoderSessionUpdate, PROMPT_TIMEOUT,
    RPC_HANDSHAKE_TIMEOUT, SESSION_NEW_TIMEOUT,
};
use crate::engines::{
    cleanup_staged_files, BuiltCommand, EngineEvent, SendRequest, TurnCore, TurnState,
    VirtualRunGuard,
};

/// The elicitation select's approve label; OMP compares it exactly
/// (`const APPROVE_OPTION = "Approve and execute";`, `return value === APPROVE_OPTION;`).
/// Any drift in the text means refine.
const APPROVE_OPTION: &str = "Approve and execute";
/// The refine label. ACP feedback is only this yes/no signal with no text; the person's
/// feedback text stays in the review record and can't go into the reply frame.
const REFINE_OPTION: &str = "Refine plan";
/// The wire method an OMP plan proposal arrives on.
const ELICITATION_METHOD: &str = "elicitation/create";
/// The ACP plan mode id (`const ACP_PLAN_MODE_ID = "plan";`).
const PLAN_MODE_ID: &str = "plan";
/// The plan file's read limit (the adapter's own safety bound; OMP itself has no limit).
const MAX_PLAN_BYTES: usize = 1024 * 1024;

/// Why a resume request is refused (shared by build_command and the driver, which both check).
pub(crate) const RESUME_REFUSAL: &str = "An OMP plan session must start from a new session: the review point (planModeState and the proposal handler) lives only in memory and session/load doesn't re-register it, so a resumed session has no verifiable wait point for your review. Start a new chat to ask for a plan.";

/// Per-turn projection state: the usage from the prompt result, the tool_call name table for
/// patches, and the context window usage_update pushes.
#[derive(Default)]
struct TurnView {
    last_usage: Option<Value>,
    tool_names: HashMap<String, String>,
    context_window: Option<i64>,
}

/// Drive one send as an OMP ACP plan-mode turn. Settle contract mirrors
/// grok_acp::run_acp_turn: parked question cards and plan reviews settle or expire first, then
/// the terminal event goes out, and last the registry is cleaned by run and session key.
/// Interrupt works as for grok: when killed, partial output commits as a normal turn end.
pub(crate) async fn run_acp_turn(
    core: TurnCore,
    req: SendRequest,
    built: BuiltCommand,
    killed: Arc<AtomicBool>,
    virtual_pid: u32,
) {
    let BuiltCommand {
        mut command,
        cleanup_files,
        ..
    } = built;
    let mut state = TurnState::new(None);
    let mut view = TurnView::default();
    // Abort-safe backstop (as for grok): an aborted or panicking task must not leak registry keys.
    let _registry_guard =
        VirtualRunGuard::new(Arc::clone(&core.registry), core.run_id.clone(), virtual_pid);
    let result = if req.session_id.is_some() {
        // Belt and braces: build_command already refused before spawning; even if that layer
        // were bypassed, no plan may run in a resumed session without a human wait point.
        Err(RESUME_REFUSAL.to_string())
    } else {
        turn_inner(&core, &mut state, &mut view, &req, &mut command, &killed).await
    };
    // Parked interactions die with the run: settle the question cards and expire parked plan
    // reviews (once per registry key) before the terminal event, after which the monotonic
    // guard drops every dispatch. Resume is refused, so the only keys are the run_id and the
    // native session id from the handshake.
    for key in [state.native_session_id.clone(), Some(core.run_id.clone())]
        .into_iter()
        .flatten()
    {
        for request_id in core.registry.take_questions(&key) {
            core.dispatch_event(&mut state, EngineEvent::QuestionSettled { request_id });
        }
        crate::engines::reader::expire_parked_plans(&core, &mut state, &key);
    }
    if let Err(error) = result {
        if !killed.load(Ordering::SeqCst) {
            core.dispatch_event(&mut state, EngineEvent::Error(error));
        }
    }
    if !state.saw_done && !state.saw_error {
        let usage = if killed.load(Ordering::SeqCst) {
            None
        } else {
            view.last_usage.clone()
        };
        let session_id = state.native_session_id.clone();
        core.dispatch_event(&mut state, EngineEvent::Done { session_id, usage });
    }
    core.registry.remove_if_pid(&core.run_id, virtual_pid);
    if let Some(session_id) = state.native_session_id.clone() {
        core.registry.remove_if_pid(&session_id, virtual_pid);
    }
    core.sink.flush();
    cleanup_staged_files(&cleanup_files);
}

async fn turn_inner(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    command: &mut tokio::process::Command,
    killed: &Arc<AtomicBool>,
) -> Result<(), String> {
    let mut spawned = spawn_piped_acp(command, &core.engine_id, &req.workspace)?;
    spawned.acp.reports_as = Some(core.engine_id.clone());
    // Review frames are written back on this stdin through the registry (respond_plan_review's
    // route:"stdin" path), so it must be attached before the handshake.
    core.registry
        .set_stdin(&core.run_id, Arc::clone(&spawned.acp.stdin));
    let result = handshake_and_prompt(&mut spawned.acp, core, state, view, req, killed).await;
    // ACP is a resident session protocol: the CLI stays after the prompt answer, so every exit
    // path tears the tree down.
    teardown(&mut spawned.child).await;
    match result {
        Ok(()) => Ok(()),
        Err(error) => Err(terminal_message(error, &spawned.stderr_buf)),
    }
}

async fn handshake_and_prompt(
    acp: &mut AcpProcess,
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    killed: &AtomicBool,
) -> Result<(), String> {
    // The key safety fact: OMP hands plan review to the client only when the client declares
    // elicitation.form, and silently auto-approves otherwise. Check it after building and fail
    // closed before any session action if it is missing.
    let init = omp_initialize_params();
    if !elicitation_form_declared(&init) {
        return Err(
            "The OMP ACP handshake lacks the clientCapabilities.elicitation.form declaration: without it OMP silently auto-approves plans, so this fails closed and won't start"
                .to_string(),
        );
    }
    let agent = acp
        .routed(
            "initialize",
            init,
            RPC_HANDSHAKE_TIMEOUT,
            killed,
            None,
            &mut |_| None,
        )
        .await?;
    let servers = crate::engines::gate::acp_mcp_servers(req, &agent);
    let gate = crate::engines::gate::AcpGate::of(core, req);
    let cwd = req.workspace.to_string_lossy().to_string();
    let session_result = acp
        .routed(
            "session/new",
            json!({ "cwd": cwd, "mcpServers": servers }),
            SESSION_NEW_TIMEOUT,
            killed,
            None,
            &mut |_| None,
        )
        .await?;
    let session_id = extract_session_id(&session_result)
        .ok_or_else(|| "OMP session/new returned no sessionId".to_string())?;
    if !plan_mode_advertised(&session_result) {
        return Err(
            "The OMP session offers no plan mode (plan.enabled is off), so plan review can't start"
                .to_string(),
        );
    }
    core.dispatch_event(state, EngineEvent::SessionId(session_id.clone()));
    // Model and effort go over the ACP config protocol (setSessionConfigOption's
    // MODEL/THINKING_CONFIG_ID), passed as the person chose them; an unknown value is the CLI's
    // error and fails before the prompt.
    if let Some(model) = req
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        acp.routed(
            "session/set_config_option",
            json!({ "sessionId": session_id, "configId": "model", "value": model }),
            RPC_HANDSHAKE_TIMEOUT,
            killed,
            None,
            &mut |_| None,
        )
        .await
        .map_err(|error| format!("OMP couldn't apply the chosen model `{model}`: {error}"))?;
    }
    if let Some(effort) = req
        .effort
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        acp.routed(
            "session/set_config_option",
            json!({ "sessionId": session_id, "configId": "thinking", "value": effort }),
            RPC_HANDSHAKE_TIMEOUT,
            killed,
            None,
            &mut |_| None,
        )
        .await
        .map_err(|error| format!("OMP couldn't apply the reasoning effort `{effort}`: {error}"))?;
    }
    // Prompt only after set_mode succeeds (plan.enabled defaults to true; when it is off this
    // returns an "Unsupported ACP mode" error and fails instead of falling back to a normal session).
    acp.routed(
        "session/set_mode",
        json!({ "sessionId": session_id, "modeId": PLAN_MODE_ID }),
        RPC_HANDSHAKE_TIMEOUT,
        killed,
        None,
        &mut |_| None,
    )
    .await
    .map_err(|error| format!("OMP couldn't enter plan mode: {error}"))?;

    let blocks = prompt_blocks(&req.prompt, &req.images, &req.workspace)?;
    let workspace = req.workspace.clone();
    let result = {
        let mut router = |line: &AcpLine| match line {
            AcpLine::Notification { method, params } if method == "session/update" => {
                handle_session_update(core, state, view, params);
                None
            }
            // A plan proposal's elicitation belongs to the review path: park it until
            // respond_plan_review writes the frame back on the registry's stdin. Never answer it
            // here; cancel, timeout and dismiss are never approval.
            AcpLine::AgentRequest { id, method, params }
                if method == ELICITATION_METHOD && is_plan_approval_elicitation(params) =>
            {
                park_plan_review(core, state, &workspace, &session_id, id, params)
            }
            // Other elicitations in a plan session (the ask tool's select/confirm/input) mean no
            // approval. The ACP plan transport has no ordinary question channel yet, so they are
            // closed as cancelled and the CLI carries on as if dismissed (never an approval).
            AcpLine::AgentRequest { id, method, .. } if method == ELICITATION_METHOD => {
                Some(jsonrpc_result_response(id, json!({ "action": "cancel" })))
            }
            AcpLine::AgentRequest { id, method, params } => {
                crate::engines::gate::acp_agent_request(Some(&gate), &workspace, id, method, params)
            }
            _ => None,
        };
        acp.routed(
            "session/prompt",
            json!({ "sessionId": session_id, "prompt": blocks }),
            PROMPT_TIMEOUT,
            killed,
            Some(&session_id),
            &mut router,
        )
        .await?
    };
    if let Some(usage) = prompt_usage(&result, view.context_window) {
        view.last_usage = Some(usage.clone());
        core.dispatch_event(state, EngineEvent::Usage(usage));
    }
    Ok(())
}

// ==================== handshake and capability check ====================

/// OMP's initialize params: the shared ones + the elicitation.form declaration
/// (ClientCapabilities.elicitation.form).
fn omp_initialize_params() -> Value {
    let mut params = initialize_params();
    params["clientCapabilities"]["elicitation"] = json!({ "form": {} });
    params
}

/// The preflight check: without the form declaration OMP silently auto-approves, so a missing
/// declaration must fail.
fn elicitation_form_declared(params: &Value) -> bool {
    params
        .get("clientCapabilities")
        .and_then(|caps| caps.get("elicitation"))
        .and_then(|elic| elic.get("form"))
        .is_some_and(|form| !form.is_null())
}

/// Whether session/new's modes.availableModes includes plan (offered only when plan.enabled).
/// Without modes, set_mode's real result decides (no field is made up).
fn plan_mode_advertised(session_result: &Value) -> bool {
    session_result
        .get("modes")
        .and_then(|modes| modes.get("availableModes"))
        .and_then(Value::as_array)
        .map(|modes| {
            modes
                .iter()
                .any(|mode| mode.get("id").and_then(Value::as_str) == Some(PLAN_MODE_ID))
        })
        .unwrap_or(true)
}

fn extract_session_id(value: &Value) -> Option<String> {
    value
        .get("sessionId")
        .or_else(|| value.get("session_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// ACP prompt content blocks: text plus base64 image blocks (OMP declares
/// promptCapabilities.image=true).
fn prompt_blocks(text: &str, images: &[String], workspace: &Path) -> Result<Vec<Value>, String> {
    let mut blocks = vec![json!({ "type": "text", "text": text })];
    for raw in images {
        let (mime, base64) = crate::engines::images::load_image(raw, workspace)?;
        blocks.push(json!({
            "type": "image",
            "data": base64,
            "mimeType": mime,
        }));
    }
    Ok(blocks)
}

// ==================== elicitation recognition and review frames ====================

/// Strictly recognizes a plan review elicitation: mode=form and the value property's enum is
/// exactly the two plan options (enum:[APPROVE_OPTION, REFINE_OPTION]). The ask tool's
/// elicitations (another schema) don't match.
fn is_plan_approval_elicitation(params: &Value) -> bool {
    if params.get("mode").and_then(Value::as_str) != Some("form") {
        return false;
    }
    let Some(enum_values) = params
        .get("requestedSchema")
        .and_then(|schema| schema.get("properties"))
        .and_then(|props| props.get("value"))
        .and_then(|value| value.get("enum"))
        .and_then(Value::as_array)
    else {
        return false;
    };
    enum_values.len() == 2
        && enum_values
            .iter()
            .any(|value| value.as_str() == Some(APPROVE_OPTION))
        && enum_values
            .iter()
            .any(|value| value.as_str() == Some(REFINE_OPTION))
}

/// The approve and refine reply frames, reproduced exactly from OMP's elicitation handling:
/// elicitFormFromAcpClient reads the form result as `content.value`, and approval is the exact
/// comparison `value === "Approve and execute"`. The result shape is CreateElicitationResponse
/// (`{action:"accept", content:{...}}`).
fn approval_frames(rpc_id: &Value) -> Value {
    json!({
        "approve": jsonrpc_result_response(rpc_id, json!({
            "action": "accept",
            "content": { "value": APPROVE_OPTION },
        })),
        "changes": jsonrpc_result_response(rpc_id, json!({
            "action": "accept",
            "content": { "value": REFINE_OPTION },
        })),
    })
}

/// Parses the elicitation message:
/// `Approve plan "<title>" and start implementation?\n\n<12-line preview><\n…?>`.
/// Returns (title, preview text).
fn parse_approval_message(message: &str) -> Option<(String, String)> {
    let rest = message.strip_prefix("Approve plan \"")?;
    let (title, after) = rest.split_once("\" and start implementation?")?;
    let title = title.trim();
    if title.is_empty() {
        return None;
    }
    let preview = after.strip_prefix("\n\n").unwrap_or(after);
    Some((title.to_string(), preview.to_string()))
}

/// Binds the file body to the elicitation preview exactly: the preview is the first 12 lines
/// joined with "\n", plus a trailing "\n…" past 12 lines. The ellipsis is checked both ways;
/// a mismatch means it isn't this proposal's body.
fn preview_matches(content: &str, preview: &str) -> bool {
    let (preview_body, had_ellipsis) = match preview.strip_suffix("\n…") {
        Some(body) => (body, true),
        None => (preview, false),
    };
    let lines: Vec<&str> = content.split('\n').collect();
    let head = lines
        .iter()
        .take(12)
        .copied()
        .collect::<Vec<_>>()
        .join("\n");
    head == preview_body && (lines.len() > 12) == had_ellipsis
}

// ==================== locating and reading the plan file from the allowlist ====================

/// Candidate OMP session roots (getAgentDir, getSessionsDir): PI_CODING_AGENT_DIR overrides
/// the agent directory; in the default layout an existing XDG_DATA_HOME/omp flattens the agent/
/// prefix; otherwise ~/.<PI_CONFIG_DIR=.omp>/agent/sessions. The profile layout
/// (profiles/<name>/agent) isn't covered: not found fails closed.
fn omp_sessions_roots() -> Vec<PathBuf> {
    if let Some(agent_dir) = std::env::var("PI_CODING_AGENT_DIR")
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        return vec![PathBuf::from(agent_dir).join("sessions")];
    }
    let mut roots = Vec::new();
    if let Some(xdg) = std::env::var("XDG_DATA_HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        let flattened = PathBuf::from(xdg).join("omp");
        if flattened.is_dir() {
            roots.push(flattened.join("sessions"));
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let config = std::env::var("PI_CONFIG_DIR").unwrap_or_else(|_| ".omp".to_string());
        roots.push(
            PathBuf::from(home)
                .join(config)
                .join("agent")
                .join("sessions"),
        );
    }
    roots
}

/// path.resolve without the filesystem: make absolute and normalize `.`/`..`.
fn normalize_absolute(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    };
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

/// resolveEquivalentPath: the realpath, or the resolved path as it is when that fails.
fn realpath_or(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// encodeRelativeSessionDirName.
fn encode_relative(prefix: &str, rel: &Path) -> String {
    let encoded = rel.to_string_lossy().replace(['/', '\\', ':'], "-");
    if encoded.is_empty() {
        prefix.to_string()
    } else if prefix.ends_with('-') {
        format!("{prefix}{encoded}")
    } else {
        format!("{prefix}-{encoded}")
    }
}

/// encodeLegacyAbsoluteSessionDirName.
fn encode_legacy(resolved: &Path) -> String {
    let text = resolved.to_string_lossy();
    let without_root = text.trim_start_matches(['/', '\\']);
    format!("--{}--", without_root.replace(['/', '\\', ':'], "-"))
}

/// getDefaultSessionDirName: relative to home → `-…`, relative to tmp → `-tmp-…`, otherwise the
/// legacy absolute-path encoding. Prefixes compare canonical paths (realpath); the legacy name
/// uses the resolved path (not the realpath, as upstream does).
fn encode_session_dir_name(
    canonical: &Path,
    home: Option<&Path>,
    tmp: &Path,
    legacy_basis: &Path,
) -> String {
    if let Some(home) = home {
        if let Ok(rel) = canonical.strip_prefix(home) {
            return encode_relative("-", rel);
        }
    }
    if let Ok(rel) = canonical.strip_prefix(tmp) {
        return encode_relative("-tmp", rel);
    }
    encode_legacy(legacy_basis)
}

fn session_dir_name(workspace: &Path) -> String {
    let resolved = normalize_absolute(workspace);
    let canonical = realpath_or(&resolved);
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| realpath_or(&normalize_absolute(&home)));
    let tmp = realpath_or(&std::env::temp_dir());
    encode_session_dir_name(&canonical, home.as_deref(), &tmp, &resolved)
}

/// Candidate local:// roots for the session: `<root>/<encoded cwd>/<timestamp>_<sessionId>/local`.
/// The artifacts directory is the session file without .jsonl (artifactsDirectoryFor), and the
/// local root is artifactsDir/local.
fn session_local_roots(roots: &[PathBuf], workspace: &Path, session_id: &str) -> Vec<PathBuf> {
    let mut locals = Vec::new();
    let dir_name = session_dir_name(workspace);
    let suffix = format!("_{session_id}");
    for root in roots {
        let parent = root.join(&dir_name);
        let Ok(entries) = std::fs::read_dir(&parent) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if !name.ends_with(&suffix) || name.ends_with(".jsonl") {
                continue;
            }
            let local = entry.path().join("local");
            if local.is_dir() {
                locals.push(local);
            }
        }
    }
    locals
}

/// normalizePlanTitle's sanitizing rule. The elicitation title is already sanitized; this
/// recomputes it defensively so the file name built from it stays inside the allowlist.
fn sanitize_title(title: &str) -> String {
    let trimmed = title.trim();
    let without_ext = if trimmed.len() >= 3 && trimmed.to_ascii_lowercase().ends_with(".md") {
        &trimmed[..trimmed.len() - 3]
    } else {
        trimmed
    };
    let mut out = String::new();
    let mut last_dash = false;
    for ch in without_ext.chars() {
        if ch.is_whitespace() {
            if !last_dash && !out.is_empty() {
                out.push('-');
                last_dash = true;
            }
        } else if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            out.push(ch);
            last_dash = ch == '-';
        }
    }
    out.trim_matches('-').to_string()
}

/// planSlugFromSupplied: the sanitized title without a trailing `-plan` (case-insensitive),
/// falling back to the sanitized title when that leaves nothing.
fn slug_from_title(title: &str) -> Option<String> {
    let sanitized = sanitize_title(title);
    if sanitized.is_empty() {
        return None;
    }
    let lower = sanitized.to_ascii_lowercase();
    let slug = lower
        .strip_suffix("-plan")
        .map(|stem| sanitized[..stem.len()].to_string())
        .filter(|stem| !stem.is_empty());
    Some(slug.unwrap_or(sanitized))
}

/// Candidate plan file names, in resolveApprovedPlan's order: the one derived from the slug →
/// the state path PLAN.md → scanned *plan.md files newest first (/plan\.md$/i) → PLAN.md as a
/// fallback. Deduplicated, order kept.
fn plan_candidate_names(local_root: &Path, slug: Option<&str>) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    if let Some(slug) = slug {
        names.push(format!("{slug}-plan.md"));
    }
    let mut scanned: Vec<(String, SystemTime)> = std::fs::read_dir(local_root)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    let is_plan = name.to_ascii_lowercase().ends_with("plan.md");
                    let is_file = entry
                        .file_type()
                        .map(|kind| kind.is_file())
                        .unwrap_or(false);
                    if is_plan && is_file {
                        let mtime = entry
                            .metadata()
                            .and_then(|meta| meta.modified())
                            .unwrap_or(SystemTime::UNIX_EPOCH);
                        Some((name, mtime))
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    scanned.sort_by(|left, right| right.1.cmp(&left.1));
    let scanned_names: Vec<String> = scanned.into_iter().map(|(name, _)| name).collect();
    if !scanned_names.iter().any(|name| name == "PLAN.md") {
        names.push("PLAN.md".to_string());
    }
    names.extend(scanned_names);
    names.push("PLAN.md".to_string());
    let mut seen = std::collections::HashSet::new();
    names.retain(|name| seen.insert(name.clone()));
    names
}

/// Reads one plan file candidate from the allowlist: the name must be a single-level *plan.md; a
/// symlink escaping the local root is refused; at most 1 MiB; a missing file returns Ok(None)
/// so the next candidate is tried. The caller computes the body's content_hash.
fn read_plan_candidate(local_root: &Path, name: &str) -> Result<Option<String>, String> {
    if name.is_empty()
        || name.contains(['/', '\\'])
        || name.contains("..")
        || !name.to_ascii_lowercase().ends_with("plan.md")
    {
        return Err(format!(
            "The plan file name `{name}` isn't in the allowlist"
        ));
    }
    let candidate = local_root.join(name);
    let root_canonical = std::fs::canonicalize(local_root).map_err(|error| {
        format!(
            "The plan directory {} can't be read: {error}",
            local_root.display()
        )
    })?;
    let file_canonical = match std::fs::canonicalize(&candidate) {
        Ok(path) => path,
        // Missing (a dangling symlink included) = this candidate misses; try the next.
        Err(_) => return Ok(None),
    };
    if !file_canonical.starts_with(&root_canonical) {
        return Err(format!(
            "The plan file `{name}` escapes the OMP session artifacts directory through a symlink, so it isn't read"
        ));
    }
    let meta = std::fs::metadata(&file_canonical).map_err(|error| error.to_string())?;
    if !meta.is_file() {
        return Ok(None);
    }
    if meta.len() > MAX_PLAN_BYTES as u64 {
        return Err(format!(
            "The plan file `{name}` is over the 1 MiB limit, so it isn't read"
        ));
    }
    let bytes = std::fs::read(&file_canonical).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_PLAN_BYTES {
        return Err(format!(
            "The plan file `{name}` is over the 1 MiB limit, so it isn't read"
        ));
    }
    String::from_utf8(bytes).map(Some).map_err(|_| {
        format!("The plan file `{name}` isn't valid UTF-8, so it isn't taken as the plan")
    })
}

/// Locates and verifies this proposal's plan file: the elicitation carries only a 12-line
/// preview, so the full text must come from the plan file; "first 12 lines == preview" binds
/// the proposal to that version of the body, and a mismatch is never approved. Returns (full
/// text, elicitation title).
fn load_verified_plan(local_roots: &[PathBuf], params: &Value) -> Result<(String, String), String> {
    let message = params
        .get("message")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            "The OMP plan elicitation has no message, so the body can't be verified".to_string()
        })?;
    let (title, preview) = parse_approval_message(message)
        .ok_or_else(|| "The OMP plan elicitation's message isn't a plan review, and a summary is never approved".to_string())?;
    if local_roots.is_empty() {
        return Err(
            "The session's artifacts directory isn't in the OMP session directories on this computer (a custom session-dir or profile layout isn't covered), so this fails closed and isn't approved"
                .to_string(),
        );
    }
    let slug = slug_from_title(&title);
    let mut saw_plan_file = false;
    for root in local_roots {
        for name in plan_candidate_names(root, slug.as_deref()) {
            let Some(content) = read_plan_candidate(root, &name)? else {
                continue;
            };
            saw_plan_file = true;
            if preview_matches(&content, &preview) {
                return Ok((content, title));
            }
        }
    }
    Err(if saw_plan_file {
        "The plan file doesn't match the elicitation preview (changed after the proposal?), so this fails closed and isn't approved; ask the engine to propose again"
            .to_string()
    } else {
        "There's no plan file (local://*plan.md) in the OMP session artifacts directory, so this fails closed and isn't approved".to_string()
    })
}

/// The body's first level-one markdown heading (firstLevelOneHeading:
/// `/^[ \t]*#[ \t]+(.+?)[ \t]*$/m`).
fn first_heading(content: &str) -> Option<String> {
    for line in content.lines() {
        let line = line.trim_start_matches([' ', '\t']);
        let Some(rest) = line.strip_prefix('#') else {
            continue;
        };
        if rest.starts_with('#') || !rest.starts_with([' ', '\t']) {
            continue;
        }
        let title = rest.trim_matches([' ', '\t']);
        if !title.is_empty() {
            return Some(title.to_string());
        }
    }
    None
}

// ==================== parking and event projection ====================

/// Parks one plan proposal: once the full body is verified, dispatch PlanReviewReady (the
/// context follows the stdin parking shape: {route, contentHash, frames} at the top level, with
/// the revision added by the backend). A failed check fails closed: dispatch an Error so the
/// wait point can never be approved with an unverifiable body; the Error kills the process
/// tree, and the CLI's elicitation falls to refine as the connection drops. Neither outcome
/// writes a reply frame: it returns None, and the read loop waits or exits accordingly.
fn park_plan_review(
    core: &TurnCore,
    state: &mut TurnState,
    workspace: &Path,
    session_id: &str,
    rpc_id: &Value,
    params: &Value,
) -> Option<Value> {
    match build_review(core, workspace, session_id, rpc_id, params) {
        Ok((record, context)) => {
            core.dispatch_event(
                state,
                EngineEvent::PlanReviewReady {
                    record: Box::new(record),
                    context,
                },
            );
        }
        Err(error) => {
            core.dispatch_event(state, EngineEvent::Error(error));
        }
    }
    None
}

fn build_review(
    core: &TurnCore,
    workspace: &Path,
    session_id: &str,
    rpc_id: &Value,
    params: &Value,
) -> Result<(PlanReview, Value), String> {
    let roots = omp_sessions_roots();
    let locals = session_local_roots(&roots, workspace, session_id);
    let (content, proposed_title) = load_verified_plan(&locals, params)?;
    let title = first_heading(&content).unwrap_or(proposed_title);
    let hash = plan_review::content_hash(&content);
    let now = plan_review::now_ms();
    let record = PlanReview {
        // Each new proposal in the same session bumps the same plan_id's revision (record_review
        // supersedes the old one); the elicitation's rpc id goes in native_plan_id.
        plan_id: format!("omp-acp-plan/{session_id}"),
        engine: core.engine_id.clone(),
        session_id: session_id.to_string(),
        workspace_path: workspace.to_string_lossy().into_owned(),
        run_id: Some(core.run_id.clone()),
        revision: 0,
        title,
        content,
        content_hash: hash.clone(),
        complete: true,
        review_kind: PlanReviewKind::NativeRequest,
        native_plan_id: Some(jsonrpc_id_key(rpc_id).unwrap_or_else(|| rpc_id.to_string())),
        // After approval the same turn carries on with this launch's non-bypass tool policy
        // (no --auto-approve on the command line; approving never changes permissions).
        exec_permission: "auto".to_string(),
        status: PlanStatus::AwaitingReview,
        execution: PlanExecution::NotStarted,
        decision: None,
        decision_intent_at: None,
        applied_at: None,
        created_at: now,
        updated_at: now,
        superseded_by: None,
    };
    let context = json!({
        "route": "stdin",
        "contentHash": hash,
        "frames": approval_frames(rpc_id),
    });
    Ok((record, context))
}

/// One `session/update` notification projected to engine events. OMP's update vocabulary is
/// the same as qoder's and grok's, so the shared mapping is reused; usage_update gives the
/// context's size and window, and the turn's token totals come from the prompt answer.
fn handle_session_update(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    params: &Value,
) {
    let update_kind = params
        .get("update")
        .and_then(|update| update.get("sessionUpdate"))
        .and_then(Value::as_str);
    if update_kind == Some("usage_update") {
        if let Some(size) = params
            .get("update")
            .and_then(|update| update.get("size"))
            .and_then(Value::as_i64)
            .filter(|size| *size > 0)
        {
            view.context_window = Some(size);
        }
        // How full the context is: the prompt answer's total adds up every call in the turn.
        if let Some(usage) = crate::engines::kimi_acp::usage(params) {
            core.dispatch_event(state, EngineEvent::Usage(usage));
        }
        return;
    }
    match session_update_from_notification(params) {
        QoderSessionUpdate::AgentMessageChunk { text } => {
            core.dispatch_event(state, EngineEvent::Delta(text));
        }
        QoderSessionUpdate::AgentThoughtChunk { text } => {
            core.dispatch_event(state, EngineEvent::Thinking(text));
        }
        QoderSessionUpdate::ToolStarted {
            tool_id,
            tool_name,
            input,
        } => {
            view.tool_names.insert(tool_id, tool_name.clone());
            core.dispatch_event(
                state,
                crate::engines::tool_call_message(tool_name, input.as_ref()),
            );
        }
        QoderSessionUpdate::ToolCompleted {
            tool_id,
            tool_name,
            output,
            error,
        } => {
            let name = tool_name
                .or_else(|| view.tool_names.get(&tool_id).cloned())
                .unwrap_or_else(|| "tool".to_string());
            let result = match (output, error) {
                (Some(output), _) => output,
                (None, Some(error)) => json!({ "text": error, "isError": true }),
                (None, None) => Value::Null,
            };
            core.dispatch_event(
                state,
                crate::engines::tool_result_patch(name, Some(&result)),
            );
        }
        QoderSessionUpdate::Ignore => {}
    }
}

/// The prompt answer's usage (buildTurnUsage: top-level
/// `usage.{input,output,total}Tokens(+cached*)`).
fn prompt_usage(result: &Value, context_window: Option<i64>) -> Option<Value> {
    let usage = result.get("usage").filter(|usage| usage.is_object())?;
    let total = usage.get("totalTokens").and_then(Value::as_u64)?;
    if total == 0 {
        return None;
    }
    let mut out = Map::new();
    out.insert("totalTokens".to_string(), json!(total));
    if let Some(input) = usage.get("inputTokens").and_then(Value::as_u64) {
        out.insert("inputTokens".to_string(), json!(input));
    }
    if let Some(output) = usage.get("outputTokens").and_then(Value::as_u64) {
        out.insert("outputTokens".to_string(), json!(output));
    }
    if let Some(cached) = usage.get("cachedReadTokens").and_then(Value::as_u64) {
        out.insert("cacheRead".to_string(), json!(cached));
    }
    if let Some(cached) = usage.get("cachedWriteTokens").and_then(Value::as_u64) {
        out.insert("cacheWrite".to_string(), json!(cached));
    }
    if let Some(window) = context_window.filter(|window| *window > 0) {
        out.insert("model_context_window".to_string(), json!(window));
    }
    Some(Value::Object(out))
}

/// Terminal message precedence (as for grok): the rpc error's message → the tail of the CLI's
/// stderr → the raw error.
fn terminal_message(raw: String, stderr_buf: &Arc<Mutex<String>>) -> String {
    let bare = raw
        .strip_prefix("rpc:")
        .and_then(|rest| rest.split_once(':'))
        .map(|(_, message)| message.trim())
        .filter(|message| !message.is_empty());
    if let Some(message) = bare {
        return message.to_string();
    }
    let stderr_tail = stderr_buf
        .lock()
        .map(|tail| tail.trim().to_string())
        .unwrap_or_default();
    if !stderr_tail.is_empty() {
        return stderr_tail;
    }
    raw
}

#[cfg(test)]
#[path = "omp_acp_tests.rs"]
mod tests;
