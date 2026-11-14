// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/mod.rs.
//! Outside agent engines: Claude Code, Codex, OpenCode, Kimi, Grok, MiniMax, Qoder, CodeBuddy,
//! Antigravity, Pi, Oh My Pi, DeepSeek Harness, and Gemini CLI and Qwen Code over the Agent Client
//! Protocol. Each is a program the person installed and signed in to; Misty starts it in a linked
//! folder and turns what it reports into the same run events Misty's own agent produces, so one
//! chat shows them all. Misty holds none of their keys and never reads or reuses their sign-in.
//!
//! The engine layer and the session history are desktop-cc-gui's (MIT, Copyright (c) 2026
//! zhukunpenglinyutong), src-tauri/src/engine and src-tauri/src/history, adapted to Misty: its
//! storage lives in misty.db, its events reach the chat through `bridge.rs`, and what an engine
//! may do is decided by the run's mode in native code (`agents/run_control/engine_modes.rs`), with
//! every permission ask answered by Misty's own gate (`gate.rs`). See NOTICE.

pub mod agent_folder;
pub mod agent_folder_history;
pub mod agy;
mod bridge;
pub mod catalog;
pub mod channels;
pub mod claude;
mod claude_channel;
pub mod reported;

pub mod codebuddy;
pub mod codex;
mod codex_app;
mod codex_provider_env;
mod codex_read_only;
pub(crate) mod codex_rpc;
mod codex_usage;
pub mod commands;
mod companion;
pub mod dsh;
mod dsh_images;
mod dsh_session;
mod events;
pub mod folder_grant;
pub(crate) mod gate;
pub mod gemini;
pub mod grok;
mod grok_acp;
pub mod hermes;
pub mod history;
pub mod history_commands;
pub mod images;
#[cfg(windows)]
pub(crate) mod job;
pub mod kimi;
mod kimi_acp;
pub(crate) mod mcp;
pub mod minimax;
mod minimax_acp;
pub mod models;
pub mod modes;
pub mod multirun;
pub mod opencode;
pub mod opencode_server;
mod opencode_session;
pub mod pi_family;
pub mod pi_family_auth;
mod pi_family_env;
pub mod plan_review;
pub mod qoder;
mod qoder_session;
mod reader;
mod registry;
pub mod resolve;
mod run_prompt;
pub mod runs;
mod shell_env;
pub mod slash;
pub mod store;
pub mod support;
pub mod turn;

pub(crate) use resolve::command_for_binary;

// Event types and tool-call/todo payload helpers (events.rs).
pub(crate) use events::{
    assistant_message, parse_todo_args, parse_todo_result, parse_tool_args_value, push_session_id,
    tool_call_message, tool_call_message_with_id, tool_call_patch_with_id, tool_path_arg,
    tool_result_patch, tool_result_patch_with_id,
};
pub use events::{EngineEvent, TodosPayload};
pub use plan_review::{PlanApproval, PlanReview, PlanReviewKind};
// Live child-process registry (registry.rs).
pub(crate) use registry::{kill_process_group, next_virtual_pid};
pub use registry::{ChildEntry, ProcessRegistry};
// Stdout reader / per-turn streaming plumbing (reader.rs).
pub use reader::sweep_staging_dirs;
pub(crate) use reader::{
    cleanup_staged_files, read_line_capped, run_reader, spawn_stderr_capture, spawn_stdin_writer,
    LineRead, RunContext, TurnCore, TurnState, VirtualRunGuard, MAX_LINE_BYTES,
};

use crate::engines::support::event_sink;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::process::Command;
use tokio::sync::Mutex as TokioMutex;

/// Windows pops a visible console window for every console-subsystem child a
/// GUI process spawns (engine CLIs are node/.cmd shims, so every probe and
/// run flashes one). Suppress it — the child's stdio is piped, the console
/// would be useless anyway.
#[cfg(windows)]
pub(crate) fn hide_console(command: &mut Command) {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PromptPlacement {
    SystemTail,
    RequestTail,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptContribution {
    pub id: String,
    pub content: String,
    pub placement: PromptPlacement,
    pub visibility: String,
    pub persistence: String,
}

fn effective_prompt(prompt: &str, contributions: Vec<PromptContribution>) -> String {
    let mut effective = prompt.to_string();
    for (placement, label) in [
        (PromptPlacement::SystemTail, "system-tail"),
        (PromptPlacement::RequestTail, "request-tail"),
    ] {
        for contribution in contributions.iter().filter(|contribution| {
            matches!(
                (&contribution.placement, &placement),
                (PromptPlacement::SystemTail, PromptPlacement::SystemTail)
                    | (PromptPlacement::RequestTail, PromptPlacement::RequestTail)
            )
        }) {
            if contribution.visibility != "internal" || contribution.content.trim().is_empty() {
                continue;
            }
            effective.push_str("\n\n[CCGUI internal ");
            effective.push_str(label);
            effective.push_str("]\n");
            effective.push_str(&contribution.content);
        }
    }
    effective
}

#[derive(Clone)]
pub struct SendRequest {
    pub session_id: Option<String>,
    pub workspace: PathBuf,
    pub prompt: String,
    pub prompt_contributions: Vec<PromptContribution>,
    /// True only for ccgui's intercepted `/compact`; a user-defined catalog
    /// command with the same text remains an ordinary CLI prompt.
    pub native_compact: bool,
    pub images: Vec<String>,
    pub model: Option<String>,
    /// Reasoning effort ("low" | "medium" | "high" | "xhigh" | "max" | "ultra"); engines without an
    /// effort knob ignore it. Engines that accept a level pass the requested string through.
    pub effort: Option<String>,
    /// OpenAI service tier override (OMP `--service-tier` / Codex `-c service_tier`),
    /// independent of reasoning effort.
    pub service_tier: Option<String>,
    /// Launch level of the run's engine mode ("auto" | "manual" | "plan" | "bypass", or an
    /// adapter's own; `modes.rs`); each engine resolves it against the levels it can honor at
    /// spawn (see `Engine::resolve_permission`).
    pub permission: Option<String>,
    /// User-granted extra directories (db `granted_roots`); claude launches
    /// pass them as `--add-dir` so reads outside the workspace stop hitting
    /// headless permission denials. Engines without an equivalent flag
    /// ignore them.
    pub additional_dirs: Vec<String>,
    /// Session-scoped channel id. Official / empty injects nothing; spawn
    /// falls back to the engine's `current` when this is None.
    pub provider_id: Option<String>,
    /// Misty's Space MCP server for this run, as an engine's own config object
    /// (`{"misty": {"type": "http", "url": ..., "headers": {...}}}`). Engines with an MCP launch
    /// flag or an ACP `mcpServers` list mount it; the others run without the Space's tools.
    pub mcp_servers: Option<Value>,
    /// Per-call tool whitelist (read-only workflow nodes): the engine must really enforce it
    /// at runtime, or prepare_launch refuses the launch; a node name never stands in for it.
    pub allowed_tools: Option<Vec<String>>,
}
pub struct BuiltCommand {
    pub command: Command,
    /// Written to stdin after spawn; stdin is then closed.
    pub stdin_payload: Option<String>,
    /// Keep the child's stdin open after the payload instead of closing it:
    /// claude answers control-protocol requests (permission asks, the
    /// AskUserQuestion dialog) on the same pipe via `control_response` lines.
    pub keep_stdin_open: bool,
    /// Private staging files/directories to remove once the process exits.
    pub cleanup_files: Vec<PathBuf>,
    /// Session id assigned before spawn (grok `-s <uuid>`).
    pub preassigned_session_id: Option<String>,
}
pub trait Engine: Send + Sync {
    fn id(&self) -> &'static str;
    /// The child command for one turn, for engines Misty reads over stdout. An engine that
    /// drives its own transport has none.
    fn build_command(&self, _req: &SendRequest, _bin: &str) -> Result<BuiltCommand, String> {
        Err(format!(
            "{} runs over its own transport; it has no child command",
            self.id()
        ))
    }
    /// The command a host-transport driver spawns, for engines whose `Own`
    /// transport is a process of their own (codex app-server, grok ACP). The
    /// driver spawns it verbatim, so channel flags/env land here exactly as
    /// they do for a child command.
    ///
    /// Default: the placeholder a driver that spawns no local child (qoder,
    /// dsh, opencode) never touches.
    fn host_command(&self, _req: &SendRequest, _bin: &str) -> Result<BuiltCommand, String> {
        Ok(BuiltCommand {
            command: Command::new("unused-virtual-engine"),
            stdin_payload: None,
            keep_stdin_open: false,
            cleanup_files: Vec::new(),
            preassigned_session_id: None,
        })
    }
    /// Parse one NDJSON stdout line into zero or more events. An engine that drives its own
    /// transport reports through its driver, never through stdout lines.
    fn parse_line(&self, _line: &str, _out: &mut Vec<EngineEvent>) {}
    /// Attach this run's served-model sidecar before the reader starts.
    /// Engines whose injected extension records the provider's own `model`
    /// read it back; the default is a no-op.
    fn set_served_models_file(&self, _path: &std::path::Path) {}
    /// True when this run's stream can report what served it (`Served`).
    /// The response check keeps its badge while that report is pending;
    /// a run that can never report shows nothing until evidence arrives,
    /// instead of an "unreported" badge on every turn.
    fn reports_served(&self) -> bool {
        false
    }
    /// True when the engine drives its own transport (e.g. a host WS session)
    /// instead of spawning a child process. send_message routes these to a
    /// virtual run: no spawn, no pid — the registry entry carries only the
    /// abort handle, and the transport task settles the turn itself.
    fn drives_own_transport(&self) -> bool {
        false
    }
    /// Whether this engine accepts image attachments.
    fn supports_images(&self) -> bool;
    /// Whether the engine mounts Misty's Space MCP server (`SendRequest::mcp_servers`).
    fn supports_mcp(&self) -> bool {
        false
    }
    /// Whether this engine supports reasoning effort configuration.
    fn supports_effort(&self) -> bool {
        false
    }
    /// Whether this engine can enforce a per-call tool whitelist (an agent
    /// limited to read-only tools). Engines that return false are rejected before
    /// spawn rather than silently running without the constraint.
    fn supports_tool_constraints(&self) -> bool {
        false
    }
    /// The engine's own modes, in its own order and with its own names (`modes.rs`). A
    /// no-asking mode is listed only where the engine's folder sandbox can hold it
    /// (`folder_sandbox`); `modes::offered` leaves it out elsewhere.
    fn modes(&self) -> &'static [modes::EngineMode];
    /// The flag whose `--help` choices are the installed engine's own list of modes
    /// (`modes::learn_reported`). None when the engine lists them nowhere Misty can read.
    fn modes_help_flag(&self) -> Option<&'static str> {
        None
    }
    /// The values the engine may list for one of `modes()` (an engine that renamed a mode lists
    /// either name).
    fn mode_values(&self, id: &'static str) -> Vec<&'static str> {
        vec![id]
    }
    /// Whether the engine's own folder sandbox runs on this computer, so a no-asking mode
    /// writes only inside its folder.
    fn folder_sandbox(&self) -> bool {
        false
    }
    /// The launch levels this engine can honor here, from its offered modes ("auto" | "manual"
    /// | "plan" | "bypass", or an adapter's own).
    fn supported_permissions(&self) -> Vec<&'static str> {
        modes::launch_levels(self.modes(), self.folder_sandbox())
    }
    /// Effective mode for one send: the requested mode when this engine
    /// supports it, otherwise the engine's first supported mode.
    fn resolve_permission(&self, requested: Option<&str>) -> &'static str {
        let supported = self.supported_permissions();
        requested
            .and_then(|mode| supported.iter().copied().find(|m| *m == mode))
            .or_else(|| supported.first().copied())
            .unwrap_or("auto")
    }
    /// Plan preview and human review (engine/plan_review.rs). Default Legacy: the engine's own
    /// plan entry point keeps its behavior. When this returns Unavailable, an explicit plan request
    /// is refused before sending: plan approval is the person's decision, and auto/bypass, a silent
    /// fallback or an auto-approve flag can never stand in for it (OMP/Codex/DSH/Grok/Qoder stay
    /// Unavailable until their adapters are wired).
    fn plan_approval(&self) -> PlanApproval {
        PlanApproval::Legacy
    }
}
pub fn engine_by_id(id: &str) -> Option<Box<dyn Engine>> {
    match id {
        "claude" => Some(Box::new(claude::ClaudeEngine::new())),
        "kimi" => Some(Box::new(kimi::KimiEngine)),
        "hermes" => Some(Box::new(hermes::HermesEngine)),
        "minimax" => Some(Box::new(minimax::MiniMaxEngine)),
        "codebuddy" => Some(Box::new(codebuddy::CodeBuddyEngine::new())),
        "grok" => Some(Box::new(grok::GrokEngine)),
        "codex" => Some(Box::new(codex::CodexEngine)),
        "pi" => Some(Box::new(pi_family::pi())),
        "omp" => Some(Box::new(pi_family::omp())),
        "dsh" => Some(Box::new(dsh::DshEngine)),
        "agy" => Some(Box::new(agy::AgyEngine)),
        "opencode" => Some(Box::new(opencode::OpenCodeEngine)),
        "qoder" => Some(Box::new(qoder::QoderEngine::new(
            qoder::QoderDistribution::Global,
        ))),
        "qoder-cn" => Some(Box::new(qoder::QoderEngine::new(
            qoder::QoderDistribution::Cn,
        ))),
        "gemini" => Some(Box::new(gemini::gemini())),
        "qwen" => Some(Box::new(gemini::qwen())),
        _ => None,
    }
}
/// Engine home dir: `$ENV_KEY` (with `~` expansion, as the CLIs resolve it)
/// when set and non-empty, else `~/<default_dir>`.
pub(crate) fn engine_home(env_key: Option<&str>, default_dir: &str) -> PathBuf {
    if let Some(key) = env_key {
        if let Some(value) = std::env::var_os(key).filter(|v| !v.is_empty()) {
            let text = value.to_string_lossy();
            if let Ok(expanded) = crate::engines::support::open_app::expand_user_path(&text) {
                return expanded;
            }
            return PathBuf::from(value);
        }
    }
    fallback_home().join(default_dir)
}
/// Codex config/session home. Settings override wins in production so CLI
/// management's directory is what history, official config, and `codex exec` all
/// read — not a leftover `~/.codex` default. Tests keep using `CODEX_HOME`
/// / `HOME/.codex` so HomeGuard scratch dirs stay isolated.
pub(crate) fn codex_home() -> PathBuf {
    #[cfg(not(test))]
    if let Some(path) = settings_codex_home() {
        return path;
    }
    engine_home(Some("CODEX_HOME"), ".codex")
}
#[cfg(not(test))]
fn settings_codex_home() -> Option<PathBuf> {
    let custom = crate::engines::support::settings::read_settings()
        .ok()?
        .codex_home?;
    let trimmed = custom.trim();
    if trimmed.is_empty() {
        return None;
    }
    crate::engines::support::open_app::expand_user_path(trimmed).ok()
}
/// Home dir for the default engine path. Production uses `dirs` (Known
/// Folder API on Windows); tests steer the fallback through HOME /
/// USERPROFILE env instead, because `dirs` ignores env on Windows and would
/// scan the real profile.
fn fallback_home() -> PathBuf {
    #[cfg(test)]
    {
        if let Some(home) = std::env::var_os("HOME").filter(|v| !v.is_empty()) {
            return PathBuf::from(home);
        }
        #[cfg(windows)]
        if let Some(profile) = std::env::var_os("USERPROFILE").filter(|v| !v.is_empty()) {
            return PathBuf::from(profile);
        }
    }
    dirs::home_dir().unwrap_or_default()
}
// ==================== Commands ====================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    pub run_id: String,
    pub session_id: Option<String>,
}
/// An engine as the settings, the agent editor and the composer list it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub id: String,
    pub name: &'static str,
    pub installed: bool,
    pub version: Option<String>,
    pub supports_images: bool,
    /// Whether the engine can mount the Space's MCP server.
    pub supports_mcp: bool,
    /// Whether this engine supports reasoning effort configuration.
    pub supports_effort: bool,
    /// The engine's own modes offered here (id, label and kind), in its own order, for the
    /// composer's mode menu. What each one passes to the engine is decided in native code.
    pub modes: Vec<modes::NamedMode>,
    /// Plan preview and review: typed = the review flow is wired; legacy = the engine's own
    /// plan entry point; unavailable + reason = Plan runs read-only and asks are refused.
    pub plan: PlanApproval,
}
fn codex_bin_from_home(
    settings: &crate::engines::support::settings::AppSettings,
) -> Option<String> {
    let home = settings.codex_home.as_deref()?.trim();
    if home.is_empty() {
        return None;
    }
    let expanded = crate::engines::support::open_app::expand_user_path(home).ok()?;
    let candidate = expanded.join("bin").join("codex");
    candidate
        .exists()
        .then(|| resolve::resolve_launchable_cli_binary(&candidate.to_string_lossy()))
}
/// CLI binary name behind an engine id, when they differ: qoder's engine ids
/// name the product/distribution, but only the `qodercli*` binaries speak
/// ACP (the `qoder` binary is the IDE launcher and is rejected at spawn).
pub(crate) fn cli_binary_name(engine_id: &str) -> &str {
    match engine_id {
        "qoder" => qoder::QoderDistribution::Global.cli_name(),
        "qoder-cn" => qoder::QoderDistribution::Cn.cli_name(),
        // MiniMax Code ships its CLI under the product-independent `mcode`
        // command, not the engine id.
        "minimax" => "mcode",
        _ => engine_id,
    }
}
/// Whether `engine_id`'s CLI can be found on this computer, honoring a program path set in
/// Settings, for lists that show which engines are there.
pub fn installed(engine_id: &str) -> bool {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = engine_bin(&settings, engine_id);
    let path = Path::new(&bin);
    (path.is_absolute() && path.is_file()) || resolve::find_program(&bin).is_some()
}

pub(crate) fn engine_bin(
    settings: &crate::engines::support::settings::AppSettings,
    engine_id: &str,
) -> String {
    // An explicit bin override always wins: it predates the codex-home row
    // (hidden for codex in the UI), and a stale codexBin in an upgraded
    // settings.json must not be silently overridden by $home/bin/codex.
    if let Some(custom) = settings.bin_override(engine_id) {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            // Defense in depth: settings write validates too, but the file
            // may have been hand-edited since.
            match crate::engines::support::settings::validate_bin_override(trimmed) {
                Ok(path) => return resolve::resolve_launchable_cli_binary(&path.to_string_lossy()),
                Err(reason) => {
                    eprintln!("[engine] ignoring invalid {engine_id} bin override: {reason}");
                }
            }
        }
    }
    if engine_id == "codex" {
        if let Some(from_home) = codex_bin_from_home(settings) {
            return from_home;
        }
    }
    resolve::resolve_launchable_cli_binary(cli_binary_name(engine_id))
}
/// The engines this computer has, with their versions.
pub async fn list() -> Vec<EngineInfo> {
    let found = tauri::async_runtime::spawn_blocking(list_engines_blocking)
        .await
        .unwrap_or_default();
    // Each installed engine is asked for its version at once: one after another, a few slow CLIs
    // held every list (the agent switcher, Access › Approvals) for their timeouts added up.
    futures_util::future::join_all(found.into_iter().map(|(mut info, bin)| async move {
        if info.installed {
            info.version = resolve::version_of(&bin).await;
            // The installed engine says which modes it has; the list offers only those.
            if let Some(engine) = engine_by_id(&info.id) {
                modes::learn_reported(engine.as_ref(), &bin).await;
                info.modes = modes::named(engine.as_ref());
            }
        }
        info
    }))
    .await
}

fn list_engines_blocking() -> Vec<(EngineInfo, String)> {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    crate::engines::support::config::ENGINES
        .iter()
        .map(|id| {
            let engine = engine_by_id(id).expect("known engine");
            let installed = match settings.bin_override(id) {
                Some(custom) if !custom.trim().is_empty() => {
                    crate::engines::support::settings::validate_bin_override(custom).is_ok()
                }
                _ if *id == "codex" && codex_bin_from_home(&settings).is_some() => true,
                _ => resolve::find_cli_binary(cli_binary_name(id), None).is_some(),
            };
            let info = EngineInfo {
                id: id.to_string(),
                name: engine_name(id),
                installed,
                version: None,
                supports_images: engine.supports_images(),
                supports_mcp: engine.supports_mcp(),
                supports_effort: engine.supports_effort(),
                modes: modes::named(engine.as_ref()),
                plan: engine.plan_approval(),
            };
            (info, engine_bin(&settings, id))
        })
        .collect()
}

/// The engine's name, as the person knows it.
pub fn engine_name(id: &str) -> &'static str {
    match id {
        "claude" => "Claude Code",
        "codex" => "Codex",
        "opencode" => "OpenCode",
        "gemini" => "Gemini CLI",
        "qwen" => "Qwen Code",
        "kimi" => "Kimi CLI",
        "grok" => "Grok CLI",
        "minimax" => "MiniMax Code",
        "qoder" => "Qoder CLI",
        "qoder-cn" => "Qoder CLI (China)",
        "omp" => "Oh My Pi",
        "codebuddy" => "CodeBuddy",
        "agy" => "Antigravity",
        "pi" => "Pi",
        "dsh" => "DeepSeek Harness",
        "hermes" => "Hermes Agent",
        _ => "Engine",
    }
}

/// Whether Misty drives this engine.
pub fn is_engine(id: &str) -> bool {
    crate::engines::support::config::ENGINES.contains(&id)
}

/// A model an engine can be asked for, as the composer and the agent editor list it. Every field
/// is the engine's own (`models::ModelDetails`); Misty only lays it out.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineModel {
    pub id: String,
    /// What a menu row calls it: the engine's name for it ("Opus 5.5"), else its id.
    pub label: String,
    /// The row's second line: the engine's description, or the concrete model id.
    pub detail: Option<String>,
    /// The model it runs, by name, for the composer's button ("Opus 5.5" for "default").
    pub runs: Option<String>,
    /// The reasoning-effort levels the engine says this model takes, weakest first, with the
    /// engine's own names and notes. None when the engine doesn't say; empty when it takes none.
    pub efforts: Option<Vec<models::EffortLevel>>,
    /// The level the engine itself would use for it (its remembered one, else its default).
    pub default_effort: Option<String>,
    pub context_window: Option<u64>,
    /// Where the engine's own menu puts it: `main`, or "more" for its "More models".
    pub section: Option<String>,
    /// The engine's fast mode for it, by the engine's own name.
    pub fast: Option<models::FastMode>,
    /// A note the engine shows with it.
    pub notice: Option<String>,
    /// The engine's own current pick, which a chat that names no model gets.
    pub default: bool,
}

/// The models an engine offers on this computer, from its own catalog (its CLI, config, cache,
/// shipped registry or handshake). Empty when it can't say; the person can still type one.
pub async fn models(engine: &str) -> Vec<EngineModel> {
    if support::state().is_none() {
        return Vec::new();
    }
    let catalog = match models::list_engine_models(engine.to_string()).await {
        Ok(catalog) => catalog,
        Err(_) => return Vec::new(),
    };
    let details = catalog.details;
    catalog
        .models
        .into_iter()
        .map(|model| {
            let facts = details.get(&model.id);
            let named = facts
                .and_then(|facts| facts.name.clone())
                .or_else(|| model.name.clone());
            // Claude Code's "default" alias follows its settings: "Default", and the line says
            // what it runs now.
            let label = if model.id == "default" {
                "Default".to_string()
            } else {
                named.clone().unwrap_or_else(|| model.id.clone())
            };
            let detail = facts
                .and_then(|facts| facts.detail.clone())
                .or_else(|| model.description.clone())
                .or_else(|| (label != model.id).then(|| model.id.clone()));
            EngineModel {
                default: model.id == "default" || facts.is_some_and(|facts| facts.current),
                label,
                detail,
                runs: named,
                efforts: facts.and_then(|facts| facts.efforts.clone()),
                default_effort: facts.and_then(|facts| facts.default_effort.clone()),
                context_window: facts
                    .and_then(|facts| facts.context_window)
                    .or(model.context_window),
                section: facts.and_then(|facts| facts.section.clone()),
                fast: facts.and_then(|facts| facts.fast.clone()),
                notice: facts.and_then(|facts| facts.notice.clone()),
                id: model.id,
            }
        })
        .collect()
}

/// Why the engine layer didn't open at launch, kept so a run can say so instead of only that the
/// engines aren't ready.
static INSTALL_ERROR: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// The reason a run gives when the engine layer isn't open.
pub(crate) fn not_ready() -> String {
    match INSTALL_ERROR.get() {
        Some(error) => format!("The engine layer could not open: {error}"),
        None => "The engines aren't ready yet.".to_string(),
    }
}

/// Opens the engine layer as the app starts: its tables in misty.db, its events to the run
/// bridge, the gate's decider, then the background work desktop-cc-gui does at launch (stale
/// staging sweeps, the history scan of the linked folders, the DeepSeek Harness host).
pub fn start(app: &tauri::App) {
    let state = match runs::install(app.handle()) {
        Ok(state) => state,
        Err(error) => {
            eprintln!("[engines] the engine layer could not open: {error}");
            let _ = INSTALL_ERROR.set(error);
            return;
        }
    };
    tauri::Manager::manage(app, state.clone());
    let store = tauri::Manager::state::<crate::app::runtime::MistyRuntime>(app)
        .environment
        .store();
    tauri::async_runtime::spawn_blocking(move || {
        sweep_staging_dirs();
        images::sweep_pasted_images();
        run_prompt::sweep_attached_files();
        // Every folder linked to a Space on this computer is a workspace whose engine sessions
        // are listed and searched.
        for folder in store::all_folders(&store).unwrap_or_default() {
            folder_linked(&folder.to_string_lossy());
        }
        history::scanner::spawn_scan(Arc::clone(&state.db), Arc::clone(&state.sink));
        tauri::async_runtime::spawn(async move {
            let settings = support::settings::read_settings().unwrap_or_default();
            if support::dsh_host::autostart_allowed(&settings) {
                if let Err(error) = support::dsh_host::ensure_host(&state.dsh_host, &settings).await
                {
                    eprintln!("[dsh] autostart failed: {error}");
                }
            }
        });
    });
}

/// Registers a newly linked folder, so its engine sessions show up.
pub fn folder_linked(folder: &str) {
    if let Some(state) = support::state() {
        if std::path::Path::new(folder).is_dir() {
            let _ = history::reader::add_workspace_inner(&state.db, &state.sink, folder);
        }
    }
}

/// Ends what the engines left running, as the app quits.
pub async fn shutdown() {
    runs::stop_all();
    if let Some(state) = support::state() {
        state.processes.kill_all();
        state.opencode_server.kill_spawned();
        state.dsh_host.kill_spawned();
    }
}

/// Concurrent engine runs; past this the machine thrashes and the registry
/// fan-out makes interrupts unreliable anyway.
/// Counted as distinct runs (run ids), not map entries: one run is keyed
/// under both its run id and its session alias, so an entry count would
/// halve the real ceiling.
const MAX_CONCURRENT_RUNS: usize = 64;
/// Capability gate for an explicit plan request: plan approval is the person's decision, so
/// a missing capability is an error, never a downgrade; auto/bypass, resolve_permission's silent
/// fallback and auto-approve flags (such as --plan-yolo) can never replace the person's approval.
/// prepare_launch calls this before building the command and spawning; Typed/Legacy pass.
fn ensure_plan_approval(
    engine: &str,
    engine_impl: &dyn Engine,
    permission: Option<&str>,
) -> Result<(), String> {
    if permission == Some("plan") {
        if let PlanApproval::Unavailable { reason } = engine_impl.plan_approval() {
            return Err(format!(
                "engine {engine} cannot run a human-approved plan: {reason}"
            ));
        }
    }
    Ok(())
}

/// Resolved launch parameters for one send: request, binary, built command.
struct Launch {
    comparison_model: Option<Option<String>>,
    req: SendRequest,
    bin: String,
    built: BuiltCommand,
    engine_impl: Box<dyn Engine>,
}
fn prepare_launch(
    engine: &str,
    workspace_path: &str,
    session_id: Option<String>,
    prompt: String,
    prompt_contributions: Vec<PromptContribution>,
    native_compact: Option<bool>,
    image_paths: Option<Vec<String>>,
    model: Option<String>,
    effort: Option<String>,
    permission: Option<String>,
    additional_dirs: Vec<String>,
    provider_id: Option<String>,
    mcp_servers: Option<Value>,
    allowed_tools: Option<Vec<String>>,
    extra_args: Vec<String>,
) -> Result<Launch, String> {
    let engine_impl = engine_by_id(engine).ok_or_else(|| format!("unknown engine: {engine}"))?;
    // Channel settings apply to this child below; native CLI files remain the official
    // configuration.
    crate::engines::support::config::ensure_engine_enabled(engine)?;
    ensure_plan_approval(engine, engine_impl.as_ref(), permission.as_deref())?;
    // A no-asking mode runs only inside the engine's folder sandbox: an engine that doesn't offer
    // one has none on this system, and is refused rather than run with its own asks skipped.
    if permission.as_deref() == Some("bypass")
        && !engine_impl.supported_permissions().contains(&"bypass")
    {
        return Err(format!(
            "{} can't work without asking inside its folder here. Choose another mode.",
            engine_name(engine)
        ));
    }
    // A tool whitelist is a hard constraint: an engine that can't honor it is refused at
    // launch, never run unconstrained.
    let allowed_tools = match allowed_tools {
        Some(tools) if !tools.is_empty() => {
            if !engine_impl.supports_tool_constraints() {
                return Err(format!(
                    "engine {engine} does not support per-call tool constraints"
                ));
            }
            Some(
                tools
                    .into_iter()
                    .map(|tool| tool.trim().to_string())
                    .filter(|tool| !tool.is_empty())
                    .take(32)
                    .collect::<Vec<_>>(),
            )
        }
        Some(_) => return Err("tool constraints must not be empty".into()),
        None => None,
    };
    let provider_id = provider_id.filter(|s| !s.trim().is_empty());
    let provider =
        crate::engines::support::config::resolve_provider(engine, provider_id.as_deref())?;
    let mut channel_env = match provider.as_ref() {
        Some(p) => crate::engines::support::provider_files::channel_env(engine, p)?,
        None => HashMap::new(),
    };
    channel_env.extend(crate::engines::channels::env_for(engine));
    // The person's own variables for this engine come first: a channel chosen for this chat is
    // more specific, so its variables win.
    let channel_env = {
        let mut env = crate::engine_config::engine_env::env_for(engine)?;
        env.extend(channel_env);
        env
    };
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let model = model
        .filter(|m| !m.trim().is_empty())
        .or_else(|| settings.default_models.get(engine).cloned())
        .filter(|m| !m.trim().is_empty());
    let model = if engine == "claude" {
        claude_channel::resolve_model(model.as_deref(), provider.as_ref(), &channel_env)
    } else {
        model
    };
    let effort = effort
        .filter(|e| !e.trim().is_empty())
        .or_else(|| settings.default_efforts.get(engine).cloned())
        .filter(|e| !e.trim().is_empty());
    let req = SendRequest {
        session_id: session_id.filter(|s| !s.trim().is_empty()),
        workspace: PathBuf::from(workspace_path),
        prompt: effective_prompt(&prompt, prompt_contributions),
        prompt_contributions: Vec::new(),
        native_compact: native_compact.unwrap_or(false) && engine == "omp",
        images: image_paths.unwrap_or_default(),
        model,
        effort,
        service_tier: match engine {
            "omp" => settings.omp_openai_service_tier.clone(),
            "codex" => settings.codex_service_tier.clone(),
            // Claude Code's fast mode, turned on where its catalog offers it (`claude.rs`).
            "claude" => (settings.claude_fast_mode == Some(true)).then(|| "fast".to_string()),
            _ => None,
        },
        permission: permission.filter(|p| !p.trim().is_empty()),
        // Cap defensively: the list lands on a command line, and a
        // hand-edited db should not produce an argv bomb.
        additional_dirs: additional_dirs
            .into_iter()
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty() && Path::new(d).is_absolute())
            .take(32)
            .collect(),
        provider_id,
        // Only an engine that can mount it gets the Space's server.
        mcp_servers: mcp_servers.filter(|_| engine_impl.supports_mcp()),
        allowed_tools,
    };
    let bin = engine_bin(&settings, engine);
    // Host-transport engines spawn through their driver instead: codex/grok
    // hand back the real app-server / ACP command the driver spawns verbatim
    // (channel flags and env land on it below, as for any child), while the
    // session-only engines keep the placeholder their driver never touches.
    let mut built = if engine_impl.drives_own_transport() {
        let mut own = engine_impl.host_command(&req, &bin)?;
        // The driver spawns this command with the workspace as its cwd.
        own.command.current_dir(&req.workspace);
        own
    } else {
        engine_impl.build_command(&req, &bin)?
    };
    if !extra_args.is_empty() {
        with_extra_args(&mut built, &bin, &extra_args);
    }
    for (key, value) in &channel_env {
        built.command.env(key, value);
    }
    if engine == "codex" && codex_read_only::requested(&req) {
        codex_read_only::stage(
            &req,
            &mut built,
            &codex_home(),
            &crate::engines::support::paths::app_home().join("codex-plan-staging"),
        )?;
    }
    let configured = match (engine, provider.as_ref()) {
        ("claude", Some(provider)) => {
            claude_channel::apply(&mut built, provider, &channel_env, &req)
        }
        ("codebuddy", Some(_)) => codebuddy::apply_channel(
            &mut built,
            &channel_env,
            req.model.as_deref(),
            &crate::engines::support::paths::app_home().join("codebuddy-staging"),
        ),
        ("kimi", Some(_)) => kimi::apply_channel(&mut built.command, &channel_env, &req),
        ("codex", Some(provider)) => {
            codex::apply_channel(&mut built.command, provider, &channel_env, &req)
        }
        ("grok", Some(provider)) => grok::isolate_channel(&mut built, provider, &req),
        _ => Ok(()),
    };
    if let Err(error) = configured {
        cleanup_staged_files(&built.cleanup_files);
        return Err(error);
    }
    let comparison_model = (engine == "claude").then(|| {
        models::claude_comparison_model(
            req.model.as_deref().unwrap_or("default"),
            &bin,
            provider.as_ref().map(|_| &channel_env),
            &req.workspace,
        )
    });
    Ok(Launch {
        comparison_model,
        req,
        bin,
        built,
        engine_impl,
    })
}

/// An agent's own engine arguments, right after the program (and any wrapper the binary needs),
/// ahead of the adapter's: options there reach the CLI however its adapter ends the line (a
/// trailing prompt, codex's `-` for stdin). A driver that spawns no process has nothing to add to.
fn with_extra_args(built: &mut BuiltCommand, bin: &str, extra: &[String]) {
    let std = built.command.as_std();
    if std.get_program() == "unused-virtual-engine" {
        return;
    }
    let lead = command_for_binary(bin).as_std().get_args().count();
    let mut args: Vec<std::ffi::OsString> = std.get_args().map(ToOwned::to_owned).collect();
    let at = lead.min(args.len());
    args.splice(at..at, extra.iter().map(std::ffi::OsString::from));
    let mut command = Command::new(std.get_program());
    command.args(args);
    for (key, value) in std.get_envs() {
        match value {
            Some(value) => command.env(key, value),
            None => command.env_remove(key),
        };
    }
    if let Some(dir) = std.get_current_dir() {
        command.current_dir(dir);
    }
    built.command = command;
}

#[allow(clippy::too_many_arguments)]
pub async fn send_message_inner(
    state: &crate::engines::support::EngineState,
    engine: String,
    workspace_path: String,
    session_id: Option<String>,
    prompt: String,
    prompt_contributions: Vec<PromptContribution>,
    native_compact: Option<bool>,
    image_paths: Option<Vec<String>>,
    model: Option<String>,
    effort: Option<String>,
    permission: Option<String>,
    provider_id: Option<String>,
    run_id: Option<String>,
    mcp_servers: Option<Value>,
    allowed_tools: Option<Vec<String>>,
    extras: LaunchExtras,
) -> Result<SendResult, String> {
    send_message_inner_with_sink(
        state,
        Arc::clone(&state.sink),
        engine,
        workspace_path,
        session_id,
        prompt,
        prompt_contributions,
        native_compact,
        image_paths,
        model,
        effort,
        permission,
        provider_id,
        run_id,
        mcp_servers,
        allowed_tools,
        extras,
    )
    .await
}

/// What a Misty run adds to a launch beyond desktop-cc-gui's request: the agent's own engine
/// arguments (checked in `agents/run_control/engine_modes.rs`, never a permission flag), and what
/// else tells two launches apart, so a background follow-up only reuses a live process that was
/// started the same way.
#[derive(Debug, Clone, Default)]
pub struct LaunchExtras {
    pub args: Vec<String>,
    pub key: Vec<String>,
}

#[allow(clippy::too_many_arguments)]
async fn send_message_inner_with_sink(
    state: &crate::engines::support::EngineState,
    sink: Arc<event_sink::EventSink>,
    engine: String,
    workspace_path: String,
    session_id: Option<String>,
    prompt: String,
    prompt_contributions: Vec<PromptContribution>,
    native_compact: Option<bool>,
    image_paths: Option<Vec<String>>,
    model: Option<String>,
    effort: Option<String>,
    permission: Option<String>,
    provider_id: Option<String>,
    run_id: Option<String>,
    mcp_servers: Option<Value>,
    allowed_tools: Option<Vec<String>>,
    extras: LaunchExtras,
) -> Result<SendResult, String> {
    // A claude process may still be alive for a background task's follow-up
    // turn on this very session. A new process would stop that task, so the
    // prompt goes into the live one instead; the bridge shows its events under
    // this send's run id (`bridge::redirect`). Chat sends only.
    let followup =
        (engine == "claude" && Arc::ptr_eq(&sink, &state.sink)).then(|| registry::FollowupPrefs {
            model: model.clone(),
            effort: effort.clone(),
            permission: permission.clone(),
            provider_id: provider_id.clone(),
            allowed_tools: allowed_tools.clone(),
            launch: extras.key.clone(),
        });
    if let Some(prefs) = followup.as_ref() {
        let workspace = PathBuf::from(&workspace_path);
        let images = image_paths.clone().unwrap_or_default();
        let effective = effective_prompt(&prompt, prompt_contributions.clone());
        if let Some(live_run) = deliver_to_idle_followup(
            &state.processes,
            session_id.as_deref(),
            prefs,
            run_id.as_deref(),
            || images::claude_stdin_message(&effective, &images, &workspace),
        )
        .await?
        {
            return Ok(SendResult {
                run_id: live_run,
                session_id,
            });
        }
    }
    let run_id = run_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    if run_id.is_empty()
        || run_id.len() > 128
        || !run_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err("invalid run id".into());
    }
    // Reserve the run id atomically, before the first await: a contains_key
    // check here with the registry insert after spawn would let two
    // concurrent sends carrying the same client id both pass, and the second
    // insert would overwrite the first entry — orphaning its child (no key
    // routes an interrupt to it) and streaming two runs under one runId.
    // The placeholder owns the run's killed/reader_abort handles, so a Stop
    // landing inside the launch window still settles the turn; every error
    // path before the real registration drops the reservation.
    let killed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let reader_abort = Arc::new(std::sync::OnceLock::new());
    {
        let mut map = state.processes.0.lock().map_err(|e| e.to_string())?;
        if map.contains_key(&run_id) {
            return Err("run id already active".into());
        }
        if registry::active_run_count(&map) >= MAX_CONCURRENT_RUNS {
            return Err(format!(
                "too many concurrent runs ({MAX_CONCURRENT_RUNS}); wait for one to finish"
            ));
        }
        let entry = ChildEntry {
            child: None,
            pid: 0,
            run_id: run_id.clone(),
            killed: Arc::clone(&killed),
            reader_abort: Arc::clone(&reader_abort),
            stdin: None,
            questions: Arc::new(Mutex::new(HashMap::new())),
            plans: Arc::new(Mutex::new(HashMap::new())),
        };
        if let Some(session_id) = session_id.as_ref() {
            map.entry(session_id.clone())
                .or_insert_with(|| entry.clone());
        }
        map.insert(run_id.clone(), entry);
    }
    let reserved = run_id.clone();
    let result = send_reserved(
        state,
        sink,
        engine,
        workspace_path,
        session_id,
        prompt,
        prompt_contributions,
        native_compact,
        image_paths,
        model,
        effort,
        permission,
        provider_id,
        run_id,
        killed,
        reader_abort,
        mcp_servers,
        allowed_tools,
        extras.args,
        followup,
    )
    .await;
    if result.is_err() {
        state.processes.remove_reservation(&reserved);
    }
    result
}
/// Write a new prompt into the process that settled its turn but stays alive
/// for a background task's follow-up turn on `session_id`. Returns that run's
/// id, or None when no such process exists, its launch settings no longer
/// match this send (a live process cannot take new launch flags), or it can
/// no longer take input — a mismatched or unwritable one is killed so the
/// caller's normal `--resume` launch cannot race it on the same session.
///
/// Misty: the live run's events are pointed at `next_run` (the chat's new
/// turn) before the prompt is written, so none of its reply is missed.
async fn deliver_to_idle_followup(
    registry: &Arc<ProcessRegistry>,
    session_id: Option<&str>,
    prefs: &registry::FollowupPrefs,
    next_run: Option<&str>,
    message: impl FnOnce() -> Result<String, String>,
) -> Result<Option<String>, String> {
    let Some(awaiting) = session_id.and_then(|id| registry.take_awaiting_followup(id)) else {
        return Ok(None);
    };
    let idle_run = awaiting.run_id;
    let kill_idle = |registry: &Arc<ProcessRegistry>, run: &str| {
        let registry = Arc::clone(registry);
        let run = run.to_string();
        async move {
            let _ = tauri::async_runtime::spawn_blocking(move || registry.kill(&run)).await;
        }
    };
    if &awaiting.prefs != prefs {
        kill_idle(registry, &idle_run).await;
        return Ok(None);
    }
    let line = match message() {
        Ok(line) => line,
        Err(error) => {
            // The process stays parked for a later send; only this one failed.
            if let Some(id) = session_id {
                registry.set_awaiting_followup(id, &idle_run, awaiting.prefs);
            }
            return Err(error);
        }
    };
    if let Some(next) = next_run {
        bridge::redirect(&idle_run, next);
    }
    if registry.write_line(&idle_run, line).await.is_ok() {
        return Ok(Some(idle_run));
    }
    bridge::unredirect(&idle_run);
    kill_idle(registry, &idle_run).await;
    Ok(None)
}
/// Body of [`send_message_inner`] once the run id is reserved: the caller id
/// is used as-is (never regenerated — the frontend pre-routes events by it),
/// and the placeholder's killed/reader_abort handles carry into the real
/// registry entry so an interrupt from the launch window is honored.
#[allow(clippy::too_many_arguments)]
async fn send_reserved(
    state: &crate::engines::support::EngineState,
    sink: Arc<event_sink::EventSink>,
    engine: String,
    workspace_path: String,
    session_id: Option<String>,
    prompt: String,
    prompt_contributions: Vec<PromptContribution>,
    native_compact: Option<bool>,
    image_paths: Option<Vec<String>>,
    model: Option<String>,
    effort: Option<String>,
    permission: Option<String>,
    provider_id: Option<String>,
    run_id: String,
    killed: Arc<std::sync::atomic::AtomicBool>,
    reader_abort: Arc<std::sync::OnceLock<tokio::task::AbortHandle>>,
    mcp_servers: Option<Value>,
    allowed_tools: Option<Vec<String>>,
    extra_args: Vec<String>,
    followup: Option<registry::FollowupPrefs>,
) -> Result<SendResult, String> {
    let mut launch = prepare_launch(
        &engine,
        &workspace_path,
        session_id,
        prompt,
        prompt_contributions,
        native_compact,
        image_paths,
        model,
        effort,
        permission,
        // Every user-granted directory rides along as a launch argument, so
        // a grant approved mid-conversation takes effect on the next send
        // (each send is a fresh process).
        {
            let mut dirs = state.db.granted_roots().unwrap_or_default();
            // The documents attached to this turn, so the engine may read them (run_prompt.rs).
            let attached = run_prompt::attached_files_dir(&run_id);
            if file_access::fs::is_dir(&attached) {
                dirs.push(attached.to_string_lossy().into_owned());
            }
            dirs
        },
        provider_id,
        mcp_servers,
        allowed_tools,
        extra_args,
    )?;
    if matches!(engine.as_str(), "pi" | "omp") {
        // Ask the login shell only for the variables the engine's current config names: Pi uses $VAR,
        // OMP bare names. Injected into this child only.
        pi_family_env::apply(&mut launch.built.command, &engine).await;
    }
    // pi/omp: the injected extension observes the provider response's own
    // `model` field and appends it to a per-run sidecar. The reader consults
    // that file when `message_end` has no `upstreamModel`; runs without the
    // extension have nothing to write it.
    if pi_family::loads_served_model_bridge(&engine, &launch.req) {
        if let Some(path) = pi_family::prepare_served_models_file(&run_id) {
            launch.engine_impl.set_served_models_file(&path);
            launch
                .built
                .command
                .env("CCGUI_SERVED_MODEL_FILE", path.as_os_str());
        }
    }
    // Host-stream engines drive their own transport: no child process — the
    // registry entry only routes interrupts to the transport task.
    // An explicit OMP plan session always runs on the ACP transport (elicitation.form handshake plus
    // the whole plan file, see omp_acp.rs); every other omp/pi request keeps the child-process path.
    if launch.engine_impl.drives_own_transport()
        || (engine == "omp" && pi_family::acp_plan_requested(&launch.req))
    {
        // The app-server driver owns its own process, so codex's provider credentials are
        // resolved here.
        if engine == "codex" && !codex_read_only::requested(&launch.req) {
            codex_provider_env::apply(&mut launch.built.command).await;
        }
        return send_host_stream(state, launch, engine, run_id, killed, reader_abort).await;
    }
    let mut command = launch.built.command;
    let cleanup_files = launch.built.cleanup_files;
    command
        .stdin(
            if launch.built.stdin_payload.is_some() || launch.built.keep_stdin_open {
                std::process::Stdio::piped()
            } else {
                std::process::Stdio::null()
            },
        )
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    command.current_dir(&launch.req.workspace);
    // Own process group so interrupt can kill the whole tree (grandchildren
    // inherit the stdout pipe and would otherwise block EOF forever).
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    hide_console(&mut command);
    // Shebang shims (`#!/usr/bin/env node`) need the CLI search dirs in
    // PATH: when adopt_login_shell_path failed/timed out, the process PATH
    // is a stale launchd snapshot and an absolute shim path alone cannot
    // find the interpreter. Same dirs find_cli_binary searched; appended
    // after the process PATH, so normal resolution order is unchanged.
    command.env("PATH", resolve::cli_search_path());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            // Never strand the staging files build_command wrote (grok).
            cleanup_staged_files(&cleanup_files);
            return Err(format!("failed to spawn {}: {error}", launch.bin));
        }
    };

    let kept_stdin = spawn_stdin_writer(
        &mut child,
        launch.built.stdin_payload,
        launch.built.keep_stdin_open,
    );
    let questions: Arc<Mutex<HashMap<String, Value>>> = Arc::new(Mutex::new(HashMap::new()));
    let plans: Arc<Mutex<HashMap<String, Value>>> = Arc::new(Mutex::new(HashMap::new()));

    // The reserved caller id keys the real entry too: inserting under the
    // same run_id replaces the placeholder, and the shared killed/reader_abort
    // Arcs keep interrupts from the launch window routed to this child.
    // Join a kill-on-close job before the run can settle: an orphaned
    // grandchild (claude's pwsh.exe/conhost.exe) must die with the run's
    // context, not accumulate outside every tree taskkill can still walk.
    #[cfg(windows)]
    let tree_guard = job::assign_kill_on_close(&child);
    let pid = child.id().unwrap_or(0);
    // Detach both pipes while we still own the child outright. A missing pipe
    // after spawn is fatal: kill the child so it cannot run unobserved and
    // unregistered.
    let (stdout, stderr) = {
        let pipes = child.stdout.take().zip(child.stderr.take());
        match pipes {
            Some(pair) => pair,
            None => {
                let _ = child.start_kill();
                cleanup_staged_files(&cleanup_files);
                return Err("missing stdout/stderr pipe after spawn".to_string());
            }
        }
    };
    let child = Arc::new(TokioMutex::new(child));
    state.processes.insert(
        run_id.clone(),
        ChildEntry {
            child: Some(Arc::clone(&child)),
            pid,
            run_id: run_id.clone(),
            killed: Arc::clone(&killed),
            reader_abort: Arc::clone(&reader_abort),
            stdin: kept_stdin.clone(),
            questions: Arc::clone(&questions),
            plans: Arc::clone(&plans),
        },
    );
    if let Some(session_id) = launch.built.preassigned_session_id.as_deref() {
        state.processes.insert_alias(
            session_id.to_string(),
            ChildEntry {
                child: Some(Arc::clone(&child)),
                pid,
                run_id: run_id.clone(),
                killed: Arc::clone(&killed),
                reader_abort: Arc::clone(&reader_abort),
                stdin: kept_stdin.clone(),
                questions: Arc::clone(&questions),
                plans: Arc::clone(&plans),
            },
        );
    }

    let stderr_buf = spawn_stderr_capture(stderr);
    let initial_model = if engine == "claude" {
        launch
            .req
            .model
            .clone()
            .or_else(|| Some(models::resolve_claude_launch_model("default")))
            .filter(|m| !m.is_empty())
    } else {
        launch.req.model.clone()
    };
    let initial_effort = launch.req.effort.clone().filter(|e| !e.trim().is_empty());
    // MCP runtime snapshots are workspace-scoped; the event dispatcher only
    // has the run id, so remember the mapping for the run's lifetime.
    crate::engines::support::mcp::register_run(&run_id, &launch.req.workspace.to_string_lossy());
    let ctx = RunContext {
        core: TurnCore {
            sink: Arc::clone(&sink),
            registry: Arc::clone(&state.processes),
            engine_id: engine.clone(),
            run_id: run_id.clone(),
            db: Some(Arc::clone(&state.db)),
            // Only chat claude runs park for a background follow-up turn; the
            // launch settings snapshot lets a later send detect drift.
            followup,
        },
        engine_impl: launch.engine_impl,
        pid,
        preassigned_session_id: launch.built.preassigned_session_id.clone(),
        initial_model,
        comparison_model: launch.comparison_model,
        initial_effort,
        child,
        killed,
        cleanup_files,
        stderr_buf,
        stdout_plain_buf: Arc::new(Mutex::new(String::new())),
        #[cfg(windows)]
        _tree_guard: tree_guard,
    };
    let reader = tokio::spawn(run_reader(stdout, ctx));
    // Registration order is unchanged (entries land before the task can
    // settle); the OnceLock just hands kill()/kill_all() the handle.
    let _ = reader_abort.set(reader.abort_handle());

    Ok(SendResult {
        run_id,
        session_id: launch.built.preassigned_session_id,
    })
}

/// Virtual run path for engines that drive their own transport
/// ([`Engine::drives_own_transport`]): register a child-less entry whose
/// `killed` flag and abort handle route interrupts into the transport task,
/// then detach it. The task dispatches the same event kinds as `run_reader`
/// and settles the turn itself (done/error + registry cleanup).
async fn send_host_stream(
    state: &crate::engines::support::EngineState,
    launch: Launch,
    engine: String,
    run_id: String,
    killed: Arc<std::sync::atomic::AtomicBool>,
    reader_abort: Arc<std::sync::OnceLock<tokio::task::AbortHandle>>,
) -> Result<SendResult, String> {
    let pid = next_virtual_pid();
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
    state.processes.insert(run_id.clone(), entry.clone());
    if let Some(session_id) = launch.req.session_id.as_deref() {
        // A resumed host session is keyed up front (same contract as grok's
        // preassigned id): interrupt by conversation session id must route.
        state.processes.insert_alias(session_id.to_string(), entry);
    }

    let core = TurnCore {
        sink: Arc::clone(&state.sink),
        registry: Arc::clone(&state.processes),
        engine_id: engine.clone(),
        run_id: run_id.clone(),
        db: Some(Arc::clone(&state.db)),
        // Host-stream engines never emit BackgroundTasks; no follow-up parking.
        followup: None,
    };
    let resume_session_id = launch.req.session_id.clone();
    let task = match engine.as_str() {
        "dsh" => tokio::spawn(dsh_session::run_host_turn(
            core,
            launch.req,
            state.dsh_host.clone(),
            killed,
            pid,
        )),
        "opencode" => tokio::spawn(opencode_session::run_server_turn(
            core,
            launch.req,
            launch.bin,
            state.opencode_server.clone(),
            killed,
            pid,
        )),
        "qoder" | "qoder-cn" => tokio::spawn(qoder_session::run_acp_turn(
            core, launch.req, launch.bin, killed, pid,
        )),
        "grok" | "kimi" | "gemini" | "qwen" | "hermes" | "agy" => tokio::spawn(
            grok_acp::run_acp_turn(core, launch.req, launch.built, killed, pid),
        ),
        "minimax" => tokio::spawn(minimax_acp::run_acp_turn(
            core,
            launch.req,
            launch.built,
            killed,
            pid,
        )),
        "codex" => tokio::spawn(codex_app::run_app_server_turn(
            core,
            launch.req,
            launch.built,
            killed,
            pid,
        )),
        "omp" => tokio::spawn(pi_family::omp_acp::run_acp_turn(
            core,
            launch.req,
            launch.built,
            killed,
            pid,
        )),
        _ => unreachable!("send_host_stream only routes drives_own_transport engines: {engine}"),
    };
    let _ = reader_abort.set(task.abort_handle());
    Ok(SendResult {
        run_id,
        session_id: resume_session_id,
    })
}
/// Answer a pending question card. Multiple transports share this command:
/// - claude / codebuddy (control protocol): the answers merge into the parked tool input
///   and ride stdin as a `control_response`.
/// - omp (rpc-ui): the parked value carries the dialog method; the answer is
///   an `extension_ui_response` frame on the CLI's stdin.
/// - dsh (host session): the parked value is an answer context (origin +
///   clientId + eventId + original request); the answer is an HTTP
///   `$events/result` outcome.
/// - grok (ACP) and codex (app-server): the parked value carries the server
///   request's JSON-RPC id — codex additionally the question-text→id map its
///   protocol answers by; the answer is the response frame on the CLI's stdin.
/// - Codex async questions: the app-server item id is the original call id; the answer is sent
///   through `turn/steer` and confirmed by the running app-server pump.
/// `answers` maps each question's text to the chosen option label — an array
/// of labels for multiSelect questions. `None` means the user
/// skipped/dismissed. Accepts either the run id or the conversation session
/// id.
#[tauri::command]
pub async fn answer_question(
    state: tauri::State<'_, crate::engines::support::EngineState>,
    session_id: String,
    request_id: String,
    answers: Option<Value>,
) -> Result<(), String> {
    let entry = state
        .processes
        .get(&session_id)
        .ok_or_else(|| "no running session for this answer".to_string())?;
    // Peek, don't remove: a failed write leaves the question parked so the
    // user can retry (or the EOF drain settles the card honestly).
    let input = entry
        .questions
        .lock()
        .map_err(|_| "question state is poisoned".to_string())?
        .get(&request_id)
        .cloned()
        .ok_or_else(|| "question is no longer pending".to_string())?;
    if let Some(context) = input.get("kimiAcp") {
        let frame = kimi_acp::answer_frame(context, answers.as_ref())?;
        state
            .processes
            .write_line(&session_id, frame.to_string())
            .await?;
        if let Ok(mut questions) = entry.questions.lock() {
            questions.remove(&request_id);
        }
        return Ok(());
    }
    // grok's ACP driver parks the server's `_x.ai/ask_user_question` request:
    // the answer is the JSON-RPC response line on the CLI's stdin.
    if let Some(acp) = input.get("grokAcp") {
        let frame = grok_acp::answer_frame(acp, answers.as_ref())?;
        state
            .processes
            .write_line(&session_id, frame.to_string())
            .await?;
        if let Ok(mut questions) = entry.questions.lock() {
            questions.remove(&request_id);
        }
        return Ok(());
    }
    // A Codex async question rides on an AgentMessage, not a parked JSON-RPC server request. Send
    // the choice to the current turn and close the card once Codex confirms it.
    if let Some(app) = input.get("codexAppAsync") {
        let rpc_id = codex_app::next_async_question_rpc_id();
        let frame = codex_app::async_answer_request(app, &rpc_id, answers.as_ref())?;
        let response = state
            .processes
            .register_pending_rpc_reply(&entry.run_id, &rpc_id)?;
        if let Err(error) = state
            .processes
            .write_line(&session_id, frame.to_string())
            .await
        {
            state
                .processes
                .remove_pending_rpc_reply(&entry.run_id, &rpc_id);
            return Err(error);
        }
        let reply = tokio::time::timeout(codex_app::ASYNC_QUESTION_REPLY_TIMEOUT, response)
            .await
            .map_err(|_| {
                state
                    .processes
                    .remove_pending_rpc_reply(&entry.run_id, &rpc_id);
                "Codex did not acknowledge the question answer; it is still available to retry"
                    .to_string()
            })?
            .map_err(|_| {
                "Codex app-server stopped before acknowledging the answer".to_string()
            })??;
        if reply.get("turnId").and_then(Value::as_str).is_none() {
            return Err("Codex returned an invalid turn/steer response".to_string());
        }
        if let Ok(mut questions) = entry.questions.lock() {
            questions.remove(&request_id);
        }
        return Ok(());
    }
    // codex's app-server driver parks `item/tool/requestUserInput`: same stdin
    // response, but its answer map is keyed by the question ids the server
    // issued — the card answers by question text.
    if let Some(app) = input.get("codexApp") {
        let frame = codex_app::answer_frame(app, answers.as_ref())?;
        state
            .processes
            .write_line(&session_id, frame.to_string())
            .await?;
        if let Ok(mut questions) = entry.questions.lock() {
            questions.remove(&request_id);
        }
        return Ok(());
    }
    // pi/omp rpc sessions park the render input plus the dialog method: the
    // answer is an extension_ui_response frame on the CLI's stdin.
    if let Some(extui) = input.get("extui") {
        let method = extui.get("method").and_then(Value::as_str).unwrap_or("");
        let frame = pi_family::extension_ui_answer_frame(method, &request_id, answers.as_ref());
        // A failed write must surface: the frontend keeps the card pending on
        // Err instead of falsely marking the question answered.
        state
            .processes
            .write_line(&session_id, frame.to_string())
            .await?;
        if let Ok(mut questions) = entry.questions.lock() {
            questions.remove(&request_id);
        }
        return Ok(());
    }
    // opencode attached sessions park an answer context: the reply is an HTTP
    // POST to the managed server, not a stdin line.
    if let Some(opencode) = input.get("opencode") {
        // 1.x replies to the question, 2.x to the form the question tool opened.
        // A failed post must surface: the frontend keeps the card pending on
        // Err instead of falsely marking the question answered.
        opencode_session::answer_question(opencode, answers.as_ref()).await?;
        if let Ok(mut questions) = entry.questions.lock() {
            questions.remove(&request_id);
        }
        return Ok(());
    }
    // dsh host sessions park an answer context instead of a tool input: the
    // answer is an HTTP outcome, not a stdin line.
    if let Some(dsh) = input.get("dsh") {
        let origin = dsh
            .get("origin")
            .and_then(Value::as_str)
            .ok_or_else(|| "question answer context is missing the host origin".to_string())?;
        let client_id = dsh
            .get("clientId")
            .and_then(Value::as_str)
            .ok_or_else(|| "question answer context is missing the events client id".to_string())?;
        let event_id = dsh
            .get("eventId")
            .and_then(Value::as_str)
            .ok_or_else(|| "question answer context is missing the event id".to_string())?;
        let request = dsh.get("request").cloned().unwrap_or(Value::Null);
        let outcome = dsh_session::question_outcome(&request, answers.as_ref());
        // A failed post must surface: the frontend keeps the card pending on
        // Err instead of falsely marking the question answered.
        crate::engines::support::dsh_host::host_call(
            origin,
            "$events/result",
            serde_json::json!({
                "clientId": client_id,
                "eventId": event_id,
                "outcome": outcome,
            }),
        )
        .await?;
        // Delivered: drop the parked copy so the turn-end drain skips it.
        if let Ok(mut questions) = entry.questions.lock() {
            questions.remove(&request_id);
        }
        return Ok(());
    }
    if let Some(context) = input.get("codebuddyQuestion") {
        let frame = codebuddy::question_response(&request_id, context, answers)?;
        state
            .processes
            .write_line(&session_id, frame.to_string())
            .await?;
        if let Ok(mut questions) = entry.questions.lock() {
            questions.remove(&request_id);
        }
        return Ok(());
    }
    let mut updated = match input {
        Value::Object(map) => map,
        // Defensive: a non-object input cannot merge answers; rebuild the
        // minimal shape the question reader expects.
        questions => {
            let mut map = serde_json::Map::new();
            map.insert("questions".to_string(), questions);
            map
        }
    };
    if let Some(answers) = answers {
        updated.insert("answers".to_string(), answers);
    }
    let line = serde_json::json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": { "behavior": "allow", "updatedInput": Value::Object(updated) },
        },
    })
    .to_string();
    // A failed write must surface: the frontend keeps the card pending on
    // Err instead of falsely marking the question answered.
    state.processes.write_line(&session_id, line).await?;
    // Delivered: drop the parked copy so the EOF drain skips it.
    if let Ok(mut questions) = entry.questions.lock() {
        questions.remove(&request_id);
    }
    Ok(())
}

/// Result of respond_plan_review: the decision took effect, or a conflict (the current state is
/// returned as it is, so the UI can show "replaced by another window or a newer revision" rather than
/// running twice). A repeated click returns the same result or an explicit conflict.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "outcome")]
pub enum PlanRespondOutcome {
    Applied { review: PlanReview },
    Conflict { review: PlanReview },
}

/// Plan review decision entry point. The frontend submits only planId + expectedRevision + decision +
/// optional feedback; the native reply context never leaves the backend. Flow:
/// 1. Atomically claim expectedRevision under its status condition (plan_review::submit_decision),
///    persisting the decision intent first;
/// 2. Build the reply from the parked native context and write it; a failed write reverts to
///    awaiting review with the intent kept, so an approval never reads as success;
/// 3. Record mark_applied after the native confirmation. A successful write is not proof the remote
///    ran it: a lost connection can only be marked unknown and checked upstream, and this client
///    never submits the same approval twice.
#[tauri::command]
pub async fn respond_plan_review(
    state: tauri::State<'_, crate::engines::support::EngineState>,
    plan_id: String,
    expected_revision: i64,
    decision: plan_review::PlanDecision,
    feedback: Option<String>,
) -> Result<PlanRespondOutcome, String> {
    let claimed = match plan_review::submit_decision(
        &state.db,
        &plan_id,
        expected_revision,
        decision,
        feedback.as_deref(),
    )? {
        plan_review::SubmitOutcome::Conflict(review) => {
            return Ok(PlanRespondOutcome::Conflict { review: *review });
        }
        plan_review::SubmitOutcome::Claimed { previous } => previous,
    };
    let fail = |message: String| -> Result<PlanRespondOutcome, String> {
        // The claim succeeded but routing or the write failed: revert to awaiting review, keep the intent.
        plan_review::revert_submission(&state.db, &plan_id, expected_revision, claimed)?;
        Err(message)
    };
    let review = plan_review::get_review(&state.db, &plan_id, expected_revision)?
        .ok_or_else(|| "plan review vanished mid-decision".to_string())?;

    // Defer: no lifecycle needs a native reply; the native wait point stays parked and the person
    // can come back to the same session to decide (deferred may be submitted again).
    if decision == plan_review::PlanDecision::Defer {
        plan_review::mark_applied(&state.db, &plan_id, expected_revision, decision)?;
        let review = plan_review::get_review(&state.db, &plan_id, expected_revision)?
            .ok_or_else(|| "plan review vanished mid-decision".to_string())?;
        return Ok(PlanRespondOutcome::Applied { review });
    }

    if review.review_kind == plan_review::PlanReviewKind::NextTurn {
        // next_turn: the planning turn ended normally, with no parked native request; approve = atomically
        // create one default execution turn, request changes = a new plan turn carrying the feedback. The
        // executor checks the thread exists and the final plan item is unchanged (expiring a stale one in
        // place). Only codex is next_turn today; another engine declaring next_turn without an executor is
        // a programming error, so this fails closed instead of silently doing nothing.
        if review.engine != "codex" {
            return fail(format!(
                "no next_turn plan executor is wired for engine {}",
                review.engine
            ));
        }
        if let Err(message) =
            codex_app::run_plan_decision(&state, &review, decision, feedback.as_deref()).await
        {
            return fail(format!("plan decision was NOT delivered: {message}"));
        }
        plan_review::mark_applied(&state.db, &plan_id, expected_revision, decision)?;
        if decision == plan_review::PlanDecision::Approve {
            // The server confirmed creating the execution turn (exactly once); completion or failure is driven
            // by that run's later events. Approved is not the same as executed.
            plan_review::mark_execution(
                &state.db,
                &plan_id,
                expected_revision,
                plan_review::PlanExecution::Starting,
            )?;
        }
        let review = plan_review::get_review(&state.db, &plan_id, expected_revision)?
            .ok_or_else(|| "plan review vanished mid-decision".to_string())?;
        return Ok(PlanRespondOutcome::Applied { review });
    }

    // native_request: take the parked context and check it belongs to the same revision and unchanged body.
    let session_key = review
        .run_id
        .clone()
        .unwrap_or_else(|| review.session_id.clone());
    let entry = state
        .processes
        .get(&session_key)
        .or_else(|| state.processes.get(&review.session_id))
        .ok_or_else(|| "no running session holds this plan's native request".to_string());
    let entry = match entry {
        Ok(entry) => entry,
        Err(message) => return fail(message),
    };
    let parked = entry
        .plans
        .lock()
        .map_err(|_| "plan state is poisoned".to_string())
        .ok()
        .and_then(|plans| plans.get(&plan_id).cloned());
    let Some(parked) = parked else {
        return fail("the native plan request is no longer parked for this session".to_string());
    };
    if parked.get("revision").and_then(Value::as_i64) != Some(expected_revision) {
        return fail("the parked native request belongs to a different plan revision".to_string());
    }
    if let Some(hash) = parked.get("contentHash").and_then(Value::as_str) {
        if hash != review.content_hash {
            // The body changed while awaiting review: the claimed revision must not run with the old body;
            // expire it first and ask for a fresh review.
            let _ = plan_review::expire_reviews(&state.db, &[(plan_id.clone(), expected_revision)]);
            return Err(
                "plan content changed while awaiting review; the revision was expired".to_string(),
            );
        }
    }

    let frame_key = match decision {
        plan_review::PlanDecision::Approve => "approve",
        plan_review::PlanDecision::RequestChanges => "changes",
        plan_review::PlanDecision::Defer => unreachable!("defer returned above"),
    };
    let frame = parked
        .get("frames")
        .and_then(|frames| frames.get(frame_key))
        .cloned()
        .ok_or_else(|| {
            "the parked native context carries no reply frame for this decision".to_string()
        });
    let frame = match frame {
        Ok(frame) => frame,
        Err(message) => return fail(message),
    };
    let frame = substitute_plan_feedback(frame, feedback.as_deref());

    let written = match parked.get("route").and_then(Value::as_str) {
        Some("stdin") => {
            state
                .processes
                .write_line(&session_key, frame_to_line(&frame))
                .await
        }
        Some("http") => {
            let origin = parked.get("origin").and_then(Value::as_str).unwrap_or("");
            let path = parked.get("path").and_then(Value::as_str).unwrap_or("");
            if origin.is_empty() || path.is_empty() {
                Err("the parked native context is missing its http origin/path".to_string())
            } else {
                crate::engines::support::dsh_host::host_call(origin, path, frame)
                    .await
                    .map(|_| ())
            }
        }
        _ => Err("the parked native context does not declare a reply route".to_string()),
    };
    if let Err(message) = written {
        return fail(format!("plan decision was NOT delivered: {message}"));
    }

    plan_review::mark_applied(&state.db, &plan_id, expected_revision, decision)?;
    if decision == plan_review::PlanDecision::Approve {
        // The native confirmation arrived and execution starts; approved is not the same as executed,
        // completion or failure is driven by later run events.
        plan_review::mark_execution(
            &state.db,
            &plan_id,
            expected_revision,
            plan_review::PlanExecution::Starting,
        )?;
    }
    if let Ok(mut plans) = entry.plans.lock() {
        plans.remove(&plan_id);
    }
    let review = plan_review::get_review(&state.db, &plan_id, expected_revision)?
        .ok_or_else(|| "plan review vanished mid-decision".to_string())?;
    Ok(PlanRespondOutcome::Applied { review })
}

/// Feedback injected into the native reply frame: when parking, an adapter writes this placeholder
/// into the frame's string leaves that must carry the person's feedback, and it is replaced on send
/// (such as DSH's custom field). A frame without the placeholder passes through as it is; what an
/// empty feedback means is the adapter's call. DSH's rule: a feedback answer is selected: [] plus the
/// custom text, and an approval answer never carries custom.
pub(crate) const PLAN_FEEDBACK_PLACEHOLDER: &str = "__CCGUI_PLAN_FEEDBACK__";
fn substitute_plan_feedback(frame: Value, feedback: Option<&str>) -> Value {
    match frame {
        Value::String(text) if text.contains(PLAN_FEEDBACK_PLACEHOLDER) => {
            Value::String(text.replace(PLAN_FEEDBACK_PLACEHOLDER, feedback.unwrap_or("")))
        }
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|item| substitute_plan_feedback(item, feedback))
                .collect(),
        ),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| (key, substitute_plan_feedback(value, feedback)))
                .collect(),
        ),
        other => other,
    }
}
fn frame_to_line(frame: &Value) -> String {
    match frame {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}
#[cfg(test)]
mod prompt_contribution_tests {
    use super::*;

    #[test]
    fn internal_contributions_append_after_the_visible_prompt_in_stable_order() {
        let prompt = effective_prompt(
            "visible",
            vec![
                PromptContribution {
                    id: "system".into(),
                    content: "system context".into(),
                    placement: PromptPlacement::SystemTail,
                    visibility: "internal".into(),
                    persistence: "turn".into(),
                },
                PromptContribution {
                    id: "request".into(),
                    content: "request context".into(),
                    placement: PromptPlacement::RequestTail,
                    visibility: "internal".into(),
                    persistence: "turn".into(),
                },
            ],
        );

        assert_eq!(
            prompt,
            "visible\n\n[CCGUI internal system-tail]\nsystem context\n\n[CCGUI internal request-tail]\nrequest context"
        );
    }
}

#[cfg(test)]
mod permission_tests {
    use super::*;

    #[test]
    fn every_registered_engine_has_an_adapter() {
        for id in crate::engines::support::config::ENGINES {
            assert!(engine_by_id(id).is_some(), "{id}");
        }
    }

    /// A tool whitelist is an explicit capability: only engines that implement the constraint may run
    /// read-only workflow nodes; the rest must be refused at launch.
    #[test]
    fn tool_constraint_support_is_explicit() {
        assert!(engine_by_id("claude").unwrap().supports_tool_constraints());
        assert!(engine_by_id("pi").unwrap().supports_tool_constraints());
        for id in ["codex", "omp", "grok", "kimi"] {
            assert!(
                !engine_by_id(id).unwrap().supports_tool_constraints(),
                "{id}"
            );
        }
    }

    fn req(permission: Option<&str>) -> SendRequest {
        SendRequest {
            session_id: None,
            workspace: PathBuf::from("/tmp"),
            prompt: "hi".to_string(),
            prompt_contributions: Vec::new(),
            native_compact: false,
            images: Vec::new(),
            model: None,
            effort: None,
            service_tier: None,
            permission: permission.map(str::to_string),
            additional_dirs: Vec::new(),
            provider_id: None,
            mcp_servers: None,
            allowed_tools: None,
        }
    }

    #[test]
    fn pi_read_only_launch_disables_all_extensions_on_start_and_resume() {
        for session_id in [None, Some("existing-session".to_string())] {
            let mut request = req(None);
            request.session_id = session_id;
            request.allowed_tools = Some(vec![
                "read".into(),
                "grep".into(),
                "find".into(),
                "ls".into(),
            ]);
            let args = argv(&pi_family::pi(), &request);
            assert!(args
                .windows(2)
                .any(|args| args == ["--tools", "read,grep,find,ls"]));
            assert!(args.contains(&"--no-extensions".to_string()));
            assert!(!args.contains(&"--extension".to_string()));
            assert!(!args.contains(&"--auto-approve".to_string()));
        }
    }

    #[test]
    fn pi_read_only_rejects_empty_writable_and_custom_tools() {
        for tools in [
            vec![],
            vec![""],
            vec!["read", "bash"],
            vec!["write"],
            vec!["edit"],
            vec!["custom"],
            vec!["read,bash"],
        ] {
            let mut request = req(None);
            request.allowed_tools = Some(tools.into_iter().map(str::to_string).collect());
            assert!(pi_family::pi().build_command(&request, "pi").is_err());
        }
    }

    #[test]
    fn pi_read_only_rejects_session_file_destinations() {
        for session in ["/tmp/plan.jsonl", "relative.jsonl", "../plan", "C:\\plan"] {
            let mut request = req(None);
            request.allowed_tools = Some(vec!["read".into()]);
            request.session_id = Some(session.into());
            assert!(
                pi_family::pi().build_command(&request, "pi").is_err(),
                "{session}"
            );
        }
    }

    #[test]
    fn pi_unrestricted_launch_keeps_the_ask_extension() {
        let args = argv(&pi_family::pi(), &req(None));
        assert!(args.contains(&"--extension".to_string()));
        assert!(!args.contains(&"--no-extensions".to_string()));
        assert!(!args.contains(&"--tools".to_string()));
    }

    /// `build_command` with `HOME` held still. pi and omp write their ask bridge extension under
    /// `~/.misty/engines` while building, and tests that point `HOME` at a scratch folder (the
    /// history scanner's, CodeBuddy's, DSH's) delete that folder when they end: built mid-swap,
    /// the write landed in a folder being removed and failed now and then ("write pi ask
    /// bridge …/ccgui-scan-home-…: No such file or directory"). Those tests hold this lock while
    /// `HOME` is moved.
    fn build(engine: &dyn Engine, req: &SendRequest) -> Result<BuiltCommand, String> {
        let _home = crate::engines::support::paths::HOME_ENV_LOCK.lock();
        engine.build_command(req, "fake-bin")
    }

    fn argv(engine: &dyn Engine, req: &SendRequest) -> Vec<String> {
        let built = build(engine, req).unwrap();
        built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect()
    }

    #[test]
    fn pi_prompt_rides_the_rpc_prompt_command() {
        // pi runs in rpc mode too (the question bridge extension needs it): the prompt is the message
        // field of an NDJSON command on stdin, so multiline text is no longer cut by the Windows cmd.exe shim.
        let mut request = req(None);
        request.prompt = "first line\nsecond line\n%PATH%".to_string();
        let built = build(&pi_family::pi(), &request).unwrap();
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(args.windows(2).any(|w| w == ["--mode", "rpc"]), "{args:?}");
        // The ask bridge extension rides along via --extension.
        let at = args
            .iter()
            .position(|a| a == "--extension")
            .expect("{args:?}");
        assert!(args[at + 1].ends_with("ccgui-ask-bridge.ts"), "{args:?}");
        assert!(!args.iter().any(|a| a.contains("first line")), "{args:?}");
        let payload = built.stdin_payload.expect("rpc prompt must ride stdin");
        let mut lines = payload.lines();
        // pi only has v1: no negotiate_protocol preamble.
        let state: Value = serde_json::from_str(lines.next().unwrap()).unwrap();
        assert_eq!(state["type"], "get_state");
        // Then pi's own command list for the `/` menu (pi doesn't announce it).
        let commands: Value = serde_json::from_str(lines.next().unwrap()).unwrap();
        assert_eq!(commands["type"], "get_commands");
        let prompt: Value = serde_json::from_str(lines.next().unwrap()).unwrap();
        assert_eq!(prompt["type"], "prompt");
        assert_eq!(prompt["message"], request.prompt);
        assert!(
            lines.next().is_none(),
            "unexpected extra command: {payload}"
        );
        // No trailing newline of its own: the writer appends `\n`, and an extra one would put an empty line
        // on the rpc stdin, which pi answers with a failed `command:"parse"` frame (a parse error banner).
        assert!(
            !payload.ends_with('\n'),
            "writer appends the terminator: {payload:?}"
        );
        assert!(built.keep_stdin_open);
    }

    #[test]
    fn omp_prompt_rides_the_rpc_prompt_command() {
        // rpc-ui mode rejects positional arguments and @file: the prompt is the message field of an NDJSON
        // command on stdin, images are base64 payloads in that command, and argv carries only protocol flags.
        // Images ride the prompt command's base64 field (covered by load_image); plain text is enough here.
        let mut request = req(None);
        request.prompt = "first line\nsecond line".to_string();
        let built = build(&pi_family::omp(), &request)
            .unwrap();
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(
            args.windows(2).any(|w| w == ["--mode", "rpc-ui"]),
            "{args:?}"
        );
        assert!(!args.contains(&"--print".to_string()), "{args:?}");
        assert!(!args.iter().any(|a| a.contains("first line")), "{args:?}");
        let payload = built.stdin_payload.expect("rpc prompt must ride stdin");
        let mut lines = payload.lines();
        assert!(lines.next().unwrap().contains("negotiate_protocol"));
        assert!(lines.next().unwrap().contains("get_state"));
        let prompt: Value = serde_json::from_str(lines.next().unwrap()).unwrap();
        assert_eq!(prompt["type"], "prompt");
        assert_eq!(prompt["message"], "first line\nsecond line");
        assert!(
            lines.next().is_none(),
            "unexpected extra command: {payload}"
        );
        // The question answer frames write back over this same stdin.
        assert!(built.keep_stdin_open);
    }

    #[test]
    fn omp_fast_tier_is_explicit_and_independent_of_effort() {
        let mut request = req(None);
        request.model = Some("openai-codex/gpt-5.4".into());
        request.effort = Some("high".into());
        for tier in [None, Some("priority"), Some("default")] {
            request.service_tier = tier.map(str::to_string);
            let args = argv(&pi_family::omp(), &request);
            let actual = args
                .iter()
                .position(|a| a == "--service-tier")
                .map(|i| args[i + 1].as_str());
            assert_eq!(actual, tier);
            assert!(args.windows(2).any(|a| a == ["--thinking", "high"]));
        }
    }

    #[test]
    fn omp_fast_tier_does_not_leak_to_other_models_or_pi() {
        let mut request = req(None);
        request.service_tier = Some("priority".into());
        for model in [
            None,
            Some("anthropic/claude"),
            Some("google/gemini"),
            Some("gpt-5.4"),
            Some("openai/"),
            Some("openai/gpt-5.4"),
            Some("openai-codex/"),
            Some("custom/gpt-5.4"),
        ] {
            request.model = model.map(str::to_string);
            assert!(!argv(&pi_family::omp(), &request)
                .iter()
                .any(|a| a == "--service-tier"));
        }
        request.model = Some("openai-codex/gpt-5.4".into());
        assert!(!argv(&pi_family::pi(), &request)
            .iter()
            .any(|a| a == "--service-tier"));
        assert!(argv(&pi_family::omp(), &request)
            .iter()
            .any(|a| a == "--service-tier"));
        request.service_tier = Some("invalid".into());
        assert!(build(&pi_family::omp(), &request)
            .is_err());
    }

    #[test]
    fn omp_tier_settings_are_backward_compatible_and_roundtrip() {
        let mut settings: crate::engines::support::settings::AppSettings =
            serde_json::from_str("{}").unwrap();
        assert_eq!(settings.omp_openai_service_tier, None);
        for tier in [Some("priority"), Some("default"), None] {
            settings.omp_openai_service_tier = tier.map(str::to_string);
            let encoded = serde_json::to_string(&settings).unwrap();
            let decoded: crate::engines::support::settings::AppSettings =
                serde_json::from_str(&encoded).unwrap();
            assert_eq!(decoded.omp_openai_service_tier.as_deref(), tier);
        }
    }

    #[test]
    fn unsupported_mode_falls_back_to_first_supported() {
        // The typed plan adapters for codex/omp/dsh are wired: plan no longer falls back to auto.
        let codex = codex::CodexEngine;
        assert_eq!(codex.resolve_permission(Some("plan")), "plan");
        assert_eq!(codex.resolve_permission(Some("read-only")), "read-only");
        // A level Codex lists no mode for falls to its first, Read only.
        assert_eq!(codex.resolve_permission(Some("manual")), "read-only");
        assert_eq!(codex.resolve_permission(None), "read-only");
        assert_eq!(pi_family::omp().resolve_permission(Some("plan")), "plan");
        assert_eq!(dsh::DshEngine.resolve_permission(Some("plan")), "plan");
        // Engines not wired yet keep the fallback (the ensure_plan_approval gate refuses an explicit plan
        // first; the fallback is only a defensive layer).
        assert_eq!(pi_family::pi().resolve_permission(Some("plan")), "auto");
        // Grok's Default asks; its Ask mode only answers, so a legacy choice keeps to Default.
        let grok = grok::GrokEngine;
        assert_eq!(grok.resolve_permission(Some("auto")), "manual");
        assert_eq!(grok.resolve_permission(Some("plan")), "manual");
    }

    #[test]
    fn claude_maps_modes_to_permission_flags() {
        let e = claude::ClaudeEngine::new();
        let auto = argv(&e, &req(Some("auto")));
        assert!(auto.contains(&"--permission-mode".to_string()));
        assert!(auto.contains(&"acceptEdits".to_string()));
        assert!(!auto.contains(&"--dangerously-skip-permissions".to_string()));
        // Headless cannot prompt: auto pre-approves the read-only network
        // tools acceptEdits does not cover, or every web call is denied.
        assert!(auto
            .windows(3)
            .any(|w| w == ["--allowedTools", "WebSearch", "WebFetch"]));

        let manual = argv(&e, &req(Some("manual")));
        assert!(manual.contains(&"default".to_string()));
        assert!(!manual.contains(&"--allowedTools".to_string()));

        let plan = argv(&e, &req(Some("plan")));
        assert!(plan.contains(&"plan".to_string()));

        // Bypass skips the asks only inside Claude Code's sandbox, where it runs.
        let bypass = argv(&e, &req(Some("bypass")));
        if e.supported_permissions().contains(&"bypass") {
            assert!(bypass.contains(&"--dangerously-skip-permissions".to_string()));
            assert!(bypass.contains(&"--settings".to_string()));
            assert!(!bypass.contains(&"--permission-mode".to_string()));
        } else {
            assert!(!bypass.contains(&"--dangerously-skip-permissions".to_string()));
        }
    }

    #[test]
    fn plan_capability_matrix_matches_the_adapter_evidence() {
        // Capability matrix: engines whose adapter is wired declare Typed (with a reviewKind matching the
        // protocol lifecycle) and the gate lets plan through; the rest stay fail-closed, refusing an explicit
        // plan request before building the command or spawning, never downgrading to auto/bypass. Each
        // adapter's detailed assertions (command line, frames, body) live in its own module's tests; this
        // only locks the matrix and the gate.
        let typed: Vec<(Box<dyn Engine>, plan_review::PlanReviewKind)> = vec![
            (
                Box::new(pi_family::omp()),
                plan_review::PlanReviewKind::NativeRequest,
            ),
            (
                Box::new(codex::CodexEngine),
                plan_review::PlanReviewKind::NextTurn,
            ),
            (
                Box::new(dsh::DshEngine),
                plan_review::PlanReviewKind::NativeRequest,
            ),
        ];
        for (engine, kind) in typed {
            let id = engine.id().to_string();
            match engine.plan_approval() {
                PlanApproval::Typed { review_kind, .. } => assert_eq!(review_kind, kind, "{id}"),
                other => panic!("{id} must be Typed, got {other:?}"),
            }
            assert!(
                engine.supported_permissions().contains(&"plan"),
                "{id} picker must offer plan"
            );
            assert!(
                ensure_plan_approval(&id, engine.as_ref(), Some("plan")).is_ok(),
                "{id} plan request must pass the gate"
            );
            assert!(ensure_plan_approval(&id, engine.as_ref(), Some("auto")).is_ok());
        }

        let unavailable: Vec<Box<dyn Engine>> = vec![
            Box::new(pi_family::pi()),
            Box::new(grok::GrokEngine),
            Box::new(qoder::QoderEngine::new(qoder::QoderDistribution::Global)),
            Box::new(qoder::QoderEngine::new(qoder::QoderDistribution::Cn)),
        ];
        for engine in unavailable {
            let id = engine.id().to_string();
            assert!(
                matches!(engine.plan_approval(), PlanApproval::Unavailable { .. }),
                "{id} must stay fail-closed until its adapter is proven"
            );
            assert!(
                !engine.supported_permissions().contains(&"plan"),
                "{id} picker must not offer plan"
            );
            let refusal = ensure_plan_approval(&id, engine.as_ref(), Some("plan"));
            let Err(message) = refusal else {
                panic!("{id} plan request must be refused before spawn");
            };
            assert!(
                message.contains("cannot run a human-approved plan"),
                "{message}"
            );
            assert!(ensure_plan_approval(&id, engine.as_ref(), Some("auto")).is_ok());
        }

        // An omp plan session really enters through the ACP transport (--mode acp), not the auto-approving
        // --plan-yolo; detailed assertions are in pi_family::tests.
        let mut plan_req = req(Some("plan"));
        plan_req.model = Some("openai-codex/gpt-5.4".into());
        let plan = argv(&pi_family::omp(), &plan_req);
        assert!(plan.contains(&"--mode".to_string()));
        assert!(!plan.contains(&"--plan-yolo".to_string()));
        assert!(!plan.contains(&"--plan-yolo-into".to_string()));
        assert!(!plan.contains(&"--auto-approve".to_string()));

        // auto/bypass paths aren't affected by the plan gate: the model passes through, nothing is downgraded.
        let mut auto_req = req(Some("auto"));
        auto_req.model = Some("openai-codex/gpt-5.4".into());
        let auto = argv(&pi_family::omp(), &auto_req);
        let pin = auto
            .iter()
            .position(|a| a == "--model")
            .expect("model flag");
        assert_eq!(auto[pin + 1], "openai-codex/gpt-5.4");
        assert!(!auto.contains(&"--auto-approve".to_string()));
        // omp has no folder sandbox, so no Bypass: never --auto-approve.
        let bypass = argv(&pi_family::omp(), &req(Some("bypass")));
        assert!(!bypass.contains(&"--auto-approve".to_string()));
        assert!(!bypass.contains(&"--plan-yolo".to_string()));

        // pi never receives approval flags either, whatever it is asked for.
        for mode in [Some("plan"), Some("bypass"), Some("manual")] {
            let args = argv(&pi_family::pi(), &req(mode));
            assert!(!args.contains(&"--plan-yolo".to_string()), "{args:?}");
            assert!(!args.contains(&"--auto-approve".to_string()), "{args:?}");
        }
    }

    #[test]
    fn claude_passes_granted_dirs_as_add_dir() {
        let e = claude::ClaudeEngine::new();
        let mut r = req(Some("auto"));
        // Workspace itself, blanks and duplicates must not reach argv.
        r.additional_dirs = vec![
            "/data/shared".to_string(),
            "/tmp".to_string(),
            "   ".to_string(),
            "/data/shared".to_string(),
        ];
        let args = argv(&e, &r);
        let pairs: Vec<&[String]> = args.windows(2).filter(|w| w[0] == "--add-dir").collect();
        assert_eq!(pairs.len(), 1, "{args:?}");
        assert_eq!(pairs[0][1], "/data/shared");
    }
}
#[cfg(test)]
mod retry_lifecycle_tests {
    use super::*;

    #[derive(Default)]
    struct CollectingEmitter(Mutex<Vec<Value>>);

    impl event_sink::Emit for CollectingEmitter {
        fn emit_json(&self, _name: &str, raw_json: &str) {
            self.0
                .lock()
                .unwrap()
                .extend(serde_json::from_str::<Vec<Value>>(raw_json).unwrap());
        }
    }

    fn test_followup_prefs() -> registry::FollowupPrefs {
        registry::FollowupPrefs {
            model: None,
            effort: None,
            permission: None,
            provider_id: None,
            allowed_tools: None,
            launch: Vec::new(),
        }
    }

    /// Done with a background task pending settles the turn but parks the run
    /// as idle-for-follow-up; the follow-up's first content reopens it, and a
    /// done with nothing pending closes it for good.
    #[tokio::test]
    async fn done_with_pending_background_task_parks_and_resumes_the_run() {
        let emitter = Arc::new(CollectingEmitter::default());
        let registry = Arc::new(ProcessRegistry::default());
        let core = TurnCore {
            sink: event_sink::EventSink::new(emitter.clone()),
            registry: Arc::clone(&registry),
            engine_id: "claude".to_string(),
            run_id: "bg-run".to_string(),
            db: None,
            followup: Some(test_followup_prefs()),
        };
        let mut state = TurnState::new(Some("s-1".to_string()));
        let done = || EngineEvent::Done {
            session_id: None,
            usage: None,
        };

        core.dispatch_event(&mut state, EngineEvent::BackgroundTasks { pending: 1 });
        core.dispatch_event(&mut state, done());
        assert!(
            !state.saw_done,
            "the run must stay open for the follow-up turn"
        );
        assert_eq!(
            registry
                .take_awaiting_followup("s-1")
                .map(|a| a.run_id)
                .as_deref(),
            Some("bg-run")
        );
        registry.set_awaiting_followup("s-1", "bg-run", test_followup_prefs());

        core.dispatch_event(&mut state, EngineEvent::BackgroundTasks { pending: 0 });
        core.dispatch_event(&mut state, EngineEvent::Delta("later".to_string()));
        assert!(
            registry.take_awaiting_followup("s-1").is_none(),
            "resumed run is no longer idle"
        );

        core.dispatch_event(&mut state, done());
        assert!(state.saw_done);
        core.sink.flush();
        let kinds: Vec<_> = emitter
            .0
            .lock()
            .unwrap()
            .iter()
            // The background-task count is reported on its own; these follow the turn.
            .filter(|event| {
                !matches!(
                    event["kind"].as_str(),
                    Some("background_tasks" | "process_closed")
                )
            })
            .map(|event| event["kind"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(kinds, ["done", "turn_resumed", "delta", "done"]);
    }

    #[tokio::test]
    async fn terminal_error_cannot_be_followed_by_live_retry_events() {
        let emitter = Arc::new(CollectingEmitter::default());
        let core = TurnCore {
            sink: event_sink::EventSink::new(emitter.clone()),
            registry: Arc::new(ProcessRegistry::default()),
            engine_id: "omp".to_string(),
            run_id: "settled-run".to_string(),
            db: None,
            followup: None,
        };
        let mut state = TurnState::new(Some("session".to_string()));
        for event in [
            EngineEvent::Error("retry exhausted".to_string()),
            EngineEvent::Retry {
                attempt: 1,
                max: 50,
                message: "socket closed".to_string(),
            },
            EngineEvent::Warn("late request error".to_string()),
            EngineEvent::Done {
                session_id: None,
                usage: None,
            },
        ] {
            core.dispatch_event(&mut state, event);
        }
        core.sink.flush();
        let events = emitter.0.lock().unwrap();
        let kinds: Vec<_> = events
            .iter()
            // The background-task count is reported on its own; these follow the turn.
            .filter(|event| {
                !matches!(
                    event["kind"].as_str(),
                    Some("background_tasks" | "process_closed")
                )
            })
            .map(|event| event["kind"].as_str().unwrap())
            .collect();
        assert_eq!(kinds, ["error"], "a settled run must not send live events");
    }

    async fn replay_cli_output(lines: &[Value]) -> Vec<Value> {
        replay_engine_output("omp", Box::new(pi_family::omp()), lines).await
    }

    async fn replay_engine_output(
        engine_id: &str,
        engine_impl: Box<dyn Engine>,
        lines: &[Value],
    ) -> Vec<Value> {
        let path = std::env::temp_dir().join(format!("ccgui-retry-{}.jsonl", uuid::Uuid::new_v4()));
        let mut text = lines
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        text.push('\n');
        std::fs::write(&path, text).unwrap();
        let mut command = tokio::process::Command::new(if cfg!(windows) { "cmd" } else { "cat" });
        if cfg!(windows) {
            command.args(["/d", "/c", "type"]);
        }
        let mut child = command
            .arg(&path)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let emitter = Arc::new(CollectingEmitter::default());
        let ctx = RunContext {
            core: TurnCore {
                sink: event_sink::EventSink::new(emitter.clone()),
                registry: Arc::new(ProcessRegistry::default()),
                engine_id: engine_id.to_string(),
                run_id: "pipe-retry-run".to_string(),
                db: None,
                // Chat-eligible so claude replays exercise follow-up parking.
                followup: Some(test_followup_prefs()),
            },
            engine_impl,
            pid: child.id().unwrap(),
            preassigned_session_id: Some("session".to_string()),
            initial_model: None,
            comparison_model: None,
            initial_effort: None,
            child: Arc::new(TokioMutex::new(child)),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            cleanup_files: vec![path],
            stderr_buf: Arc::new(Mutex::new(String::new())),
            stdout_plain_buf: Arc::new(Mutex::new(String::new())),
            // Windows-only guard field the production constructor fills; this
            // test spawns a plain child, so there is no job object to hold.
            #[cfg(windows)]
            _tree_guard: None,
        };
        run_reader(stdout, ctx).await;
        let events = std::mem::take(&mut *emitter.0.lock().unwrap());
        events
    }

    /// Old CLIs print startup failures (usage/config errors, node crashes)
    /// to stdout as plain text: parse_line drops non-JSON lines, so the
    /// settle path must fall back to the captured plain tail when stderr
    /// is empty — otherwise the banner is a bare exit code.
    #[tokio::test]
    async fn plain_stdout_tail_surfaces_on_failed_exit_without_stderr() {
        let mut command = tokio::process::Command::new(if cfg!(windows) { "cmd" } else { "sh" });
        if cfg!(windows) {
            command.args(["/c", "echo error: unrecognized arguments: --json & exit 1"]);
        } else {
            command.args(["-c", "echo 'error: unrecognized arguments: --json'; exit 1"]);
        }
        let mut child = command
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let emitter = Arc::new(CollectingEmitter::default());
        let ctx = RunContext {
            core: TurnCore {
                sink: event_sink::EventSink::new(emitter.clone()),
                registry: Arc::new(ProcessRegistry::default()),
                engine_id: "codex".to_string(),
                run_id: "plain-stdout-run".to_string(),
                db: None,
                followup: None,
            },
            engine_impl: Box::new(codex::CodexEngine),
            pid: child.id().unwrap(),
            preassigned_session_id: None,
            initial_model: None,
            comparison_model: None,
            initial_effort: None,
            child: Arc::new(TokioMutex::new(child)),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            cleanup_files: Vec::new(),
            stderr_buf: Arc::new(Mutex::new(String::new())),
            stdout_plain_buf: Arc::new(Mutex::new(String::new())),
            // See the pipe-retry constructor above.
            #[cfg(windows)]
            _tree_guard: None,
        };
        run_reader(stdout, ctx).await;
        let events = std::mem::take(&mut *emitter.0.lock().unwrap());
        let last = events.last().unwrap();
        assert_eq!(last["kind"], "error");
        let data = last["data"].as_str().unwrap();
        assert!(data.contains("codex exited with status"), "{data}");
        assert!(data.contains("unrecognized arguments"), "{data}");
    }

    fn claude_text_delta(text: &str) -> Value {
        serde_json::json!({"type":"stream_event","event":{
            "type":"content_block_delta","index":0,
            "delta":{"type":"text_delta","text":text}}})
    }

    fn claude_result() -> Value {
        serde_json::json!({"type":"result","subtype":"success","is_error":false,
            "usage":{"input_tokens":10,"output_tokens":1,"total_tokens":11}})
    }

    fn claude_tasks_changed(task_ids: &[&str]) -> Value {
        let tasks: Vec<Value> = task_ids
            .iter()
            .map(|id| serde_json::json!({"task_id":id,"task_type":"local_bash"}))
            .collect();
        serde_json::json!({"type":"system","subtype":"background_tasks_changed","tasks":tasks})
    }

    /// Event order captured from the real CLI (`run_in_background` Bash):
    /// result #1 lands while the task still runs, the CLI then starts a
    /// second turn on its own when the task completes and reports there.
    #[tokio::test]
    async fn claude_background_task_followup_turn_is_not_dropped() {
        let events = replay_engine_output(
            "claude",
            Box::new(claude::ClaudeEngine::new()),
            &[
                serde_json::json!({"type":"system","subtype":"init"}),
                claude_tasks_changed(&["bg1"]),
                serde_json::json!({"type":"system","subtype":"task_started","task_id":"bg1"}),
                claude_text_delta("started"),
                claude_result(),
                serde_json::json!({"type":"system","subtype":"task_notification","task_id":"bg1","status":"completed"}),
                claude_tasks_changed(&[]),
                serde_json::json!({"type":"system","subtype":"init"}),
                claude_text_delta("background task finished"),
                claude_result(),
            ],
        )
        .await;
        let kinds: Vec<_> = events
            .iter()
            // The background-task count is reported on its own; these follow the turn.
            .filter(|event| {
                !matches!(
                    event["kind"].as_str(),
                    Some("background_tasks" | "process_closed")
                )
            })
            .map(|event| event["kind"].as_str().unwrap())
            .collect();
        assert_eq!(
            kinds,
            ["delta", "done", "turn_resumed", "delta", "done"],
            "{events:?}"
        );
        let turn: Vec<_> = events
            .iter()
            .filter(|event| {
                !matches!(
                    event["kind"].as_str(),
                    Some("background_tasks" | "process_closed")
                )
            })
            .collect();
        assert_eq!(turn[3]["data"], "background task finished");
    }

    /// Raw stream captured from the real CLI (`run_in_background` Bash,
    /// `sleep 8`): the first result fires while the task runs, the follow-up
    /// turn arrives after `task_notification` and must reach the user.
    #[tokio::test]
    async fn claude_real_cli_background_capture_delivers_followup_text() {
        let lines: Vec<Value> = include_str!("testdata/claude_background_task.jsonl")
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        let events =
            replay_engine_output("claude", Box::new(claude::ClaudeEngine::new()), &lines).await;
        let kinds: Vec<_> = events
            .iter()
            // The background-task count is reported on its own; these follow the turn.
            .filter(|event| {
                !matches!(
                    event["kind"].as_str(),
                    Some("background_tasks" | "process_closed")
                )
            })
            .map(|event| event["kind"].as_str().unwrap())
            .collect();
        assert_eq!(
            kinds.iter().filter(|kind| **kind == "done").count(),
            2,
            "{events:?}"
        );
        assert_eq!(
            kinds.iter().filter(|kind| **kind == "turn_resumed").count(),
            1,
            "{events:?}"
        );
        assert_eq!(kinds.last(), Some(&"done"), "{events:?}");
        let first_done = kinds.iter().position(|kind| *kind == "done").unwrap();
        let resumed = kinds
            .iter()
            .position(|kind| *kind == "turn_resumed")
            .unwrap();
        assert!(first_done < resumed, "{events:?}");
        let text: String = events
            .iter()
            .filter(|event| event["kind"] == "delta")
            .filter_map(|event| event["data"].as_str())
            .collect();
        assert!(
            text.contains("BGFINISHED"),
            "follow-up turn text lost: {text:?}"
        );
    }

    /// Raw stream captured from a real `--resume` process started while a
    /// background task of the previous process was still pending: the CLI
    /// stops that task and emits an empty `num_turns: 0` result before it
    /// answers the new message. That result is not the end of the user's turn.
    #[tokio::test]
    async fn claude_resume_after_background_task_keeps_the_reply() {
        let lines: Vec<Value> = include_str!("testdata/claude_resume_after_background.jsonl")
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        let events =
            replay_engine_output("claude", Box::new(claude::ClaudeEngine::new()), &lines).await;
        let kinds: Vec<_> = events
            .iter()
            // The background-task count is reported on its own; these follow the turn.
            .filter(|event| {
                !matches!(
                    event["kind"].as_str(),
                    Some("background_tasks" | "process_closed")
                )
            })
            .map(|event| event["kind"].as_str().unwrap())
            .collect();
        let text: String = events
            .iter()
            .filter(|event| event["kind"] == "delta")
            .filter_map(|event| event["data"].as_str())
            .collect();
        assert_eq!(text, "PONG2", "{events:?}");
        assert_eq!(
            kinds.iter().filter(|kind| **kind == "done").count(),
            1,
            "{events:?}"
        );
        assert_eq!(kinds.last(), Some(&"done"), "{events:?}");
    }

    /// Raw stream captured from one real process that got a second user
    /// message while its background task was still running: both replies
    /// arrive in order, the task is never stopped, and the run is reopened for
    /// each turn that follows a settled one.
    #[tokio::test]
    async fn claude_message_during_background_task_gets_its_own_reply() {
        let lines: Vec<Value> = include_str!("testdata/claude_message_during_background.jsonl")
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        let events =
            replay_engine_output("claude", Box::new(claude::ClaudeEngine::new()), &lines).await;
        let kinds: Vec<_> = events
            .iter()
            // The background-task count is reported on its own; these follow the turn.
            .filter(|event| {
                !matches!(
                    event["kind"].as_str(),
                    Some("background_tasks" | "process_closed")
                )
            })
            .map(|event| event["kind"].as_str().unwrap())
            .collect();
        let replies: Vec<String> = events
            .iter()
            .fold(vec![String::new()], |mut replies, event| {
                match event["kind"].as_str().unwrap() {
                    "delta" => replies
                        .last_mut()
                        .unwrap()
                        .push_str(event["data"].as_str().unwrap()),
                    "done" => replies.push(String::new()),
                    _ => {}
                }
                replies
            })
            .into_iter()
            .filter(|reply| !reply.is_empty())
            .collect();
        assert_eq!(replies, ["started", "PONG2", "BGFINISHED"], "{events:?}");
        assert_eq!(
            kinds.iter().filter(|kind| **kind == "done").count(),
            3,
            "{events:?}"
        );
        assert_eq!(
            kinds.iter().filter(|kind| **kind == "turn_resumed").count(),
            2,
            "{events:?}"
        );
        assert_eq!(kinds.last(), Some(&"done"), "{events:?}");
    }

    /// The first turn settles at its own result even with a task pending, so
    /// the UI is idle; a CLI that then dies without a follow-up adds nothing.
    #[tokio::test]
    async fn claude_pending_background_task_still_settles_on_eof() {
        let events = replay_engine_output(
            "claude",
            Box::new(claude::ClaudeEngine::new()),
            &[
                claude_tasks_changed(&["bg1"]),
                claude_text_delta("started"),
                claude_result(),
            ],
        )
        .await;
        let kinds: Vec<_> = events
            .iter()
            // The background-task count is reported on its own; these follow the turn.
            .filter(|event| {
                !matches!(
                    event["kind"].as_str(),
                    Some("background_tasks" | "process_closed")
                )
            })
            .map(|event| event["kind"].as_str().unwrap())
            .collect();
        assert_eq!(kinds, ["delta", "done"], "{events:?}");
    }

    /// No background task: the first result is the end of the turn, exactly
    /// as before.
    #[tokio::test]
    async fn claude_plain_turn_still_settles_on_first_result() {
        let events = replay_engine_output(
            "claude",
            Box::new(claude::ClaudeEngine::new()),
            &[claude_text_delta("hi"), claude_result()],
        )
        .await;
        let kinds: Vec<_> = events
            .iter()
            // The background-task count is reported on its own; these follow the turn.
            .filter(|event| {
                !matches!(
                    event["kind"].as_str(),
                    Some("background_tasks" | "process_closed")
                )
            })
            .map(|event| event["kind"].as_str().unwrap())
            .collect();
        assert_eq!(kinds, ["delta", "done"], "{events:?}");
    }

    #[tokio::test]
    async fn legacy_agent_end_can_retry_and_recover_before_eof() {
        let events = replay_cli_output(&[
            serde_json::json!({"type":"turn_end","message":{"role":"assistant","stopReason":"error","errorMessage":"socket closed"}}),
            serde_json::json!({"type":"agent_end","messages":[{"role":"assistant","stopReason":"error","errorMessage":"socket closed"}]}),
            serde_json::json!({"type":"auto_retry_start","attempt":1,"maxAttempts":50}),
            serde_json::json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"recovered"}}),
            serde_json::json!({"type":"turn_end","message":{"role":"assistant","stopReason":"stop"}}),
            serde_json::json!({"type":"agent_end","messages":[{"role":"assistant","stopReason":"stop"}]}),
        ]).await;
        let kinds: Vec<_> = events
            .iter()
            // The background-task count is reported on its own; these follow the turn.
            .filter(|event| {
                !matches!(
                    event["kind"].as_str(),
                    Some("background_tasks" | "process_closed")
                )
            })
            .map(|event| event["kind"].as_str().unwrap())
            .collect();
        assert_eq!(kinds, ["retry", "delta", "done"]);
        assert_eq!(events[1]["data"], "recovered");
    }

    #[tokio::test]
    async fn clean_eof_preserves_a_final_model_failure() {
        for failure in [
            serde_json::json!({"type":"turn_end","message":{"role":"assistant","stopReason":"error","errorMessage":"401 Invalid token"}}),
            serde_json::json!({"type":"auto_retry_end","success":false,"finalError":"socket closed"}),
        ] {
            let events = replay_cli_output(&[failure]).await;
            let last = events.last().unwrap();
            assert_eq!(
                last["kind"], "error",
                "clean process exit must not turn a failed request into success"
            );
            assert!(matches!(
                last["data"].as_str(),
                Some("401 Invalid token" | "socket closed")
            ));
            assert!(!events.iter().any(|event| event["kind"] == "done"));
        }
    }
    /// A background grandchild inheriting stdout keeps the pipe open after
    /// the CLI exits, so EOF never comes. The child-exit watch must settle
    /// the run anyway — drain the buffered lines, emit done, drain the
    /// registry — instead of parking the reader (and the run's concurrency
    /// slots) on the held pipe forever.
    #[cfg(unix)]
    #[tokio::test]
    async fn child_exit_settles_run_despite_pipe_holding_grandchild() {
        let done_lines = [
            serde_json::json!({"type":"turn_end","message":{"role":"assistant","stopReason":"stop"}}),
            serde_json::json!({"type":"agent_end","messages":[{"role":"assistant","stopReason":"stop"}]}),
        ];
        let script = format!(
            "printf '%s\\n' {}; sleep 600 & exit 0",
            done_lines
                .iter()
                .map(|line| format!("'{line}'"))
                .collect::<Vec<_>>()
                .join(" ")
        );
        let mut command = tokio::process::Command::new("sh");
        command
            .arg("-c")
            .arg(script)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        // Match production: own process group, so the settle path's group
        // sweep also reaps the pipe-holding grandchild.
        command.process_group(0);
        let mut child = command.spawn().unwrap();
        let pid = child.id().unwrap();
        let stdout = child.stdout.take().unwrap();
        let child = Arc::new(TokioMutex::new(child));
        let emitter = Arc::new(CollectingEmitter::default());
        let registry = Arc::new(ProcessRegistry::default());
        let killed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        for key in ["pipe-held-run", "session-held"] {
            registry.insert(
                key.to_string(),
                ChildEntry {
                    child: Some(Arc::clone(&child)),
                    pid,
                    run_id: "pipe-held-run".to_string(),
                    killed: Arc::clone(&killed),
                    reader_abort: Arc::new(std::sync::OnceLock::new()),
                    stdin: None,
                    questions: Arc::new(Mutex::new(HashMap::new())),
                    plans: Arc::new(Mutex::new(HashMap::new())),
                },
            );
        }
        let ctx = RunContext {
            core: TurnCore {
                sink: event_sink::EventSink::new(emitter.clone()),
                registry: Arc::clone(&registry),
                engine_id: "omp".to_string(),
                run_id: "pipe-held-run".to_string(),
                db: None,
                followup: None,
            },
            engine_impl: Box::new(pi_family::omp()),
            pid,
            preassigned_session_id: Some("session-held".to_string()),
            initial_model: None,
            comparison_model: None,
            initial_effort: None,
            child,
            killed,
            cleanup_files: Vec::new(),
            stderr_buf: Arc::new(Mutex::new(String::new())),
            stdout_plain_buf: Arc::new(Mutex::new(String::new())),
            // See the pipe-retry constructor above.
            #[cfg(windows)]
            _tree_guard: None,
        };
        // Unbounded on the old EOF-only reader: the sleep holds the pipe
        // for 600s. POST_EXIT_DRAIN settles this in well under a second.
        tokio::time::timeout(std::time::Duration::from_secs(5), run_reader(stdout, ctx))
            .await
            .expect("reader must settle after child exit, not park on the held pipe");
        let events = std::mem::take(&mut *emitter.0.lock().unwrap());
        let kinds: Vec<_> = events
            .iter()
            // The background-task count is reported on its own; these follow the turn.
            .filter(|event| {
                !matches!(
                    event["kind"].as_str(),
                    Some("background_tasks" | "process_closed")
                )
            })
            .map(|event| event["kind"].as_str().unwrap())
            .collect();
        assert_eq!(
            kinds,
            ["done"],
            "buffered turn events must survive the drain"
        );
        assert_eq!(
            registry.0.lock().unwrap().len(),
            0,
            "settled run must drain its registry entries"
        );
    }
}
#[cfg(test)]
mod codex_home_bin_tests {
    use super::*;

    #[test]
    fn engine_bin_prefers_codex_home_bin() {
        let dir =
            std::env::temp_dir().join(format!("ccgui-codex-home-bin-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("bin")).unwrap();
        let candidate = dir.join("bin").join("codex");
        std::fs::write(&candidate, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&candidate, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let mut settings = crate::engines::support::settings::AppSettings::default();
        settings.codex_home = Some(dir.to_string_lossy().into_owned());
        let resolved = engine_bin(&settings, "codex");
        assert_eq!(PathBuf::from(&resolved), candidate);

        // An explicit codexBin override (set before the home row existed, or
        // hand-edited) still wins over $home/bin/codex.
        #[cfg(unix)]
        {
            settings.bin_overrides.insert(
                "codexBin".to_string(),
                serde_json::Value::String("/bin/sh".to_string()),
            );
            assert_eq!(engine_bin(&settings, "codex"), "/bin/sh");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
#[cfg(test)]
#[path = "plan_respond_tests.rs"]
mod plan_respond_tests;
