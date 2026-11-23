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

pub mod agy;
mod bridge;
pub mod catalog;
pub mod channels;
pub mod chat_folder;
pub mod chat_media;
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
pub mod open_in_code;
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
pub(crate) mod recall;
mod registry;
pub mod resolve;
mod run_prompt;
pub mod runs;
mod shell_env;
pub mod slash;
pub mod store;
pub mod support;
pub mod turn;
mod warm;
pub(crate) mod warm_up;

pub(crate) use resolve::command_for_binary;

pub(crate) use events::{
    assistant_message, parse_todo_args, parse_todo_result, parse_tool_args_value, push_session_id,
    tool_call_message, tool_call_message_with_id, tool_call_patch_with_id, tool_path_arg,
    tool_result_patch, tool_result_patch_with_id,
};
pub use events::{EngineEvent, TodosPayload};
pub use plan_review::{PlanApproval, PlanReview, PlanReviewKind};
pub use reader::sweep_staging_dirs;
pub(crate) use reader::{
    cleanup_staged_files, read_line_capped, run_reader, spawn_stderr_capture, spawn_stdin_writer,
    LineRead, RunContext, TurnCore, TurnState, VirtualRunGuard, MAX_LINE_BYTES,
};
pub(crate) use registry::{kill_process_group, next_virtual_pid};
pub use registry::{ChildEntry, ProcessRegistry};

use crate::engines::support::event_sink;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::process::Command;
use tokio::sync::Mutex as TokioMutex;

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
    pub native_compact: bool,
    pub images: Vec<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub service_tier: Option<String>,
    pub permission: Option<String>,
    pub additional_dirs: Vec<String>,
    pub provider_id: Option<String>,
    pub mcp_servers: Option<Value>,
    pub allowed_tools: Option<Vec<String>>,
}
pub struct BuiltCommand {
    pub command: Command,
    pub stdin_payload: Option<String>,
    pub keep_stdin_open: bool,
    pub cleanup_files: Vec<PathBuf>,
    pub preassigned_session_id: Option<String>,
}
pub trait Engine: Send + Sync {
    fn id(&self) -> &'static str;
    fn build_command(&self, _req: &SendRequest, _bin: &str) -> Result<BuiltCommand, String> {
        Err(format!(
            "{} runs over its own transport; it has no child command",
            self.id()
        ))
    }
    fn host_command(&self, _req: &SendRequest, _bin: &str) -> Result<BuiltCommand, String> {
        Ok(BuiltCommand {
            command: Command::new("unused-virtual-engine"),
            stdin_payload: None,
            keep_stdin_open: false,
            cleanup_files: Vec::new(),
            preassigned_session_id: None,
        })
    }
    fn parse_line(&self, _line: &str, _out: &mut Vec<EngineEvent>) {}
    fn set_served_models_file(&self, _path: &std::path::Path) {}
    fn reports_served(&self) -> bool {
        false
    }
    fn drives_own_transport(&self) -> bool {
        false
    }
    fn supports_images(&self) -> bool;
    fn supports_mcp(&self) -> bool {
        false
    }
    fn supports_web_search(&self) -> bool {
        false
    }
    fn supports_effort(&self) -> bool {
        false
    }
    fn supports_tool_constraints(&self) -> bool {
        false
    }
    fn modes(&self) -> &'static [modes::EngineMode];
    fn modes_help_flag(&self) -> Option<&'static str> {
        None
    }
    fn mode_values(&self, id: &'static str) -> Vec<&'static str> {
        vec![id]
    }
    fn folder_sandbox(&self) -> bool {
        false
    }
    fn supported_permissions(&self) -> Vec<&'static str> {
        modes::launch_levels(self.modes(), self.folder_sandbox())
    }
    fn resolve_permission(&self, requested: Option<&str>) -> &'static str {
        let supported = self.supported_permissions();
        requested
            .and_then(|mode| supported.iter().copied().find(|m| *m == mode))
            .or_else(|| supported.first().copied())
            .unwrap_or("auto")
    }
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    pub run_id: String,
    pub session_id: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub id: String,
    pub name: &'static str,
    pub installed: bool,
    pub version: Option<String>,
    pub supports_images: bool,
    pub supports_mcp: bool,
    pub supports_effort: bool,
    pub supports_web_search: bool,
    pub modes: Vec<modes::NamedMode>,
    pub plan: PlanApproval,
}
#[allow(
    clippy::disallowed_methods,
    reason = "resolves Codex's installed program under the home the person set, which lives outside the gate"
)]
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
pub(crate) fn cli_binary_name(engine_id: &str) -> &str {
    match engine_id {
        "qoder" => qoder::QoderDistribution::Global.cli_name(),
        "qoder-cn" => qoder::QoderDistribution::Cn.cli_name(),
        "minimax" => "mcode",
        _ => engine_id,
    }
}
#[allow(
    clippy::disallowed_methods,
    reason = "resolves an engine's installed program, which lives outside the gate"
)]
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
    if let Some(custom) = settings.bin_override(engine_id) {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
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
pub async fn list() -> Vec<EngineInfo> {
    let found = tauri::async_runtime::spawn_blocking(list_engines_blocking)
        .await
        .unwrap_or_default();
    futures_util::future::join_all(found.into_iter().map(|(mut info, bin)| async move {
        if info.installed {
            info.version = resolve::version_of(&bin).await;
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
                supports_web_search: engine.supports_web_search(),
                modes: modes::named(engine.as_ref()),
                plan: engine.plan_approval(),
            };
            (info, engine_bin(&settings, id))
        })
        .collect()
}

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

pub fn is_engine(id: &str) -> bool {
    crate::engines::support::config::ENGINES.contains(&id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineModel {
    pub id: String,
    pub label: String,
    pub detail: Option<String>,
    pub runs: Option<String>,
    pub efforts: Option<Vec<models::EffortLevel>>,
    pub default_effort: Option<String>,
    pub context_window: Option<u64>,
    pub section: Option<String>,
    pub fast: Option<models::FastMode>,
    pub notice: Option<String>,
    pub default: bool,
}

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

static INSTALL_ERROR: std::sync::OnceLock<String> = std::sync::OnceLock::new();

pub(crate) fn not_ready() -> String {
    match INSTALL_ERROR.get() {
        Some(error) => format!("The engine layer could not open: {error}"),
        None => "The engines aren't ready yet.".to_string(),
    }
}

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

#[allow(
    clippy::disallowed_methods,
    reason = "checks the person's project folder, which may not be granted yet when Misty starts"
)]
pub fn folder_linked(folder: &str) {
    if let Some(state) = support::state() {
        if std::path::Path::new(folder).is_dir() {
            let _ = history::reader::add_workspace_inner(&state.db, &state.sink, folder);
        }
    }
}

pub async fn shutdown() {
    runs::stop_all();
    if let Some(state) = support::state() {
        state.processes.kill_all();
        warm::shutdown();
        state.opencode_server.kill_spawned();
        state.dsh_host.kill_spawned();
    }
}

const MAX_CONCURRENT_RUNS: usize = 64;
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

struct Launch {
    comparison_model: Option<Option<String>>,
    channel: u64,
    req: SendRequest,
    bin: String,
    built: BuiltCommand,
    engine_impl: Box<dyn Engine>,
}
#[allow(clippy::too_many_arguments)]
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
    crate::engines::support::config::ensure_engine_enabled(engine)?;
    ensure_plan_approval(engine, engine_impl.as_ref(), permission.as_deref())?;
    if permission.as_deref() == Some("bypass")
        && !engine_impl.supported_permissions().contains(&"bypass")
    {
        return Err(format!(
            "{} can't work without asking inside its folder here. Choose another mode.",
            engine_name(engine)
        ));
    }
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
            "claude" => (settings.claude_fast_mode == Some(true)).then(|| "fast".to_string()),
            _ => None,
        },
        permission: permission.filter(|p| !p.trim().is_empty()),
        additional_dirs: additional_dirs
            .into_iter()
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty() && Path::new(d).is_absolute())
            .take(32)
            .collect(),
        provider_id,
        mcp_servers: mcp_servers.filter(|_| engine_impl.supports_mcp()),
        allowed_tools,
    };
    let bin = engine_bin(&settings, engine);
    let mut built = if engine_impl.drives_own_transport() {
        let mut own = engine_impl.host_command(&req, &bin)?;
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
    let channel = {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        provider.as_ref().map(Value::to_string).hash(&mut hasher);
        hasher.finish()
    };
    Ok(Launch {
        comparison_model,
        channel,
        req,
        bin,
        built,
        engine_impl,
    })
}

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

#[derive(Debug, Clone, Default)]
pub struct LaunchExtras {
    pub args: Vec<String>,
    pub key: Vec<String>,
    pub warm: bool,
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
    let model = match model.filter(|model| !model.trim().is_empty()) {
        Some(model) => Some(model),
        None if provider_id.is_none() => models::usable::model_for_run(&engine).await,
        None => None,
    };
    let followup = (matches!(engine.as_str(), "claude" | "codebuddy")
        && Arc::ptr_eq(&sink, &state.sink))
    .then(|| registry::FollowupPrefs {
        model: model.clone(),
        effort: effort.clone(),
        permission: permission.clone(),
        provider_id: provider_id.clone(),
        allowed_tools: allowed_tools.clone(),
        launch: extras.key.clone(),
        dirs: launch_dirs(state, run_id.as_deref()),
        warm: extras.warm,
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
        extras.warm.then_some(extras.key),
    )
    .await;
    if result.is_err() {
        state.processes.remove_reservation(&reserved);
    }
    result
}
fn launch_dirs(state: &crate::engines::support::EngineState, run_id: Option<&str>) -> Vec<String> {
    let mut dirs = state.db.granted_roots().unwrap_or_default();
    if let Some(run_id) = run_id {
        dirs.extend(runs::space_dirs(run_id));
    }
    if let Some(run_id) = run_id {
        let attached = run_prompt::attached_files_dir(run_id);
        if file_access::fs::is_dir(&attached) {
            dirs.push(attached.to_string_lossy().into_owned());
        }
    }
    dirs
}

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
            if let Some(id) = session_id {
                registry.restore_awaiting_followup(
                    id,
                    registry::AwaitingFollowup {
                        run_id: idle_run,
                        prefs: awaiting.prefs,
                        idle_since: awaiting.idle_since,
                    },
                );
            }
            return Err(error);
        }
    };
    if let Some(next) = next_run {
        bridge::redirect(&idle_run, next);
    }
    if registry.write_line(&idle_run, line).await.is_ok() {
        if let Some(id) = session_id {
            warm_up::born(id);
        }
        return Ok(Some(idle_run));
    }
    bridge::unredirect(&idle_run);
    kill_idle(registry, &idle_run).await;
    Ok(None)
}
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
    warm: Option<Vec<String>>,
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
        launch_dirs(state, Some(&run_id)),
        provider_id,
        mcp_servers,
        allowed_tools,
        extra_args,
    )?;
    if matches!(engine.as_str(), "pi" | "omp") {
        pi_family_env::apply(&mut launch.built.command, &engine).await;
    }
    if pi_family::loads_served_model_bridge(&engine, &launch.req) {
        if let Some(path) = pi_family::prepare_served_models_file(&run_id) {
            launch.engine_impl.set_served_models_file(&path);
            launch
                .built
                .command
                .env("CCGUI_SERVED_MODEL_FILE", path.as_os_str());
        }
    }
    if launch.engine_impl.drives_own_transport()
        || (engine == "omp" && pi_family::acp_plan_requested(&launch.req))
    {
        if engine == "codex" && !codex_read_only::requested(&launch.req) {
            codex_provider_env::apply(&mut launch.built.command).await;
        }
        return send_host_stream(state, launch, engine, run_id, killed, reader_abort, warm).await;
    }
    let warm_up = (engine == "claude"
        && launch.built.stdin_payload.is_none()
        && launch.built.keep_stdin_open)
        .then(|| launch.built.preassigned_session_id.clone())
        .flatten()
        .zip(followup.clone());
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
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    hide_console(&mut command);
    command.env("PATH", resolve::cli_search_path());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
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

    #[cfg(windows)]
    let tree_guard = job::assign_kill_on_close(&child);
    let pid = child.id().unwrap_or(0);
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
    crate::engines::support::mcp::register_run(&run_id, &launch.req.workspace.to_string_lossy());
    let ctx = RunContext {
        core: TurnCore {
            sink: Arc::clone(&sink),
            registry: Arc::clone(&state.processes),
            engine_id: engine.clone(),
            run_id: run_id.clone(),
            db: Some(Arc::clone(&state.db)),
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
    let _ = reader_abort.set(reader.abort_handle());
    if let Some((session, prefs)) = warm_up {
        let (since, evicted) = state.processes.set_warm_followup(&session, &run_id, prefs);
        for run in evicted {
            state.processes.close_stdin(&run);
        }
        registry::reap_when_idle(Arc::clone(&state.processes), session, run_id.clone(), since);
    }

    Ok(SendResult {
        run_id,
        session_id: launch.built.preassigned_session_id,
    })
}

async fn send_host_stream(
    state: &crate::engines::support::EngineState,
    launch: Launch,
    engine: String,
    run_id: String,
    killed: Arc<std::sync::atomic::AtomicBool>,
    reader_abort: Arc<std::sync::OnceLock<tokio::task::AbortHandle>>,
    warm: Option<Vec<String>>,
) -> Result<SendResult, String> {
    if let Some(launch_key) =
        warm.filter(|_| !matches!(engine.as_str(), "dsh" | "opencode" | "omp"))
    {
        warm::intend(
            &run_id,
            warm::fingerprint(
                &engine,
                &launch.bin,
                &launch.req,
                launch.channel,
                &launch_key,
            ),
        );
    }
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
        state.processes.insert_alias(session_id.to_string(), entry);
    }

    let core = TurnCore {
        sink: Arc::clone(&state.sink),
        registry: Arc::clone(&state.processes),
        engine_id: engine.clone(),
        run_id: run_id.clone(),
        db: Some(Arc::clone(&state.db)),
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
    if let Some(extui) = input.get("extui") {
        let method = extui.get("method").and_then(Value::as_str).unwrap_or("");
        let frame = pi_family::extension_ui_answer_frame(method, &request_id, answers.as_ref());
        state
            .processes
            .write_line(&session_id, frame.to_string())
            .await?;
        if let Ok(mut questions) = entry.questions.lock() {
            questions.remove(&request_id);
        }
        return Ok(());
    }
    if let Some(opencode) = input.get("opencode") {
        opencode_session::answer_question(opencode, answers.as_ref()).await?;
        if let Ok(mut questions) = entry.questions.lock() {
            questions.remove(&request_id);
        }
        return Ok(());
    }
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
    state.processes.write_line(&session_id, line).await?;
    if let Ok(mut questions) = entry.questions.lock() {
        questions.remove(&request_id);
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "outcome")]
pub enum PlanRespondOutcome {
    Applied { review: PlanReview },
    Conflict { review: PlanReview },
}

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
        plan_review::revert_submission(&state.db, &plan_id, expected_revision, claimed)?;
        Err(message)
    };
    let review = plan_review::get_review(&state.db, &plan_id, expected_revision)?
        .ok_or_else(|| "plan review vanished mid-decision".to_string())?;

    if decision == plan_review::PlanDecision::Defer {
        plan_review::mark_applied(&state.db, &plan_id, expected_revision, decision)?;
        let review = plan_review::get_review(&state.db, &plan_id, expected_revision)?
            .ok_or_else(|| "plan review vanished mid-decision".to_string())?;
        return Ok(PlanRespondOutcome::Applied { review });
    }

    if review.review_kind == plan_review::PlanReviewKind::NextTurn {
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
        let at = args
            .iter()
            .position(|a| a == "--extension")
            .expect("{args:?}");
        assert!(args[at + 1].ends_with("ccgui-ask-bridge.ts"), "{args:?}");
        assert!(!args.iter().any(|a| a.contains("first line")), "{args:?}");
        let payload = built.stdin_payload.expect("rpc prompt must ride stdin");
        let mut lines = payload.lines();
        let state: Value = serde_json::from_str(lines.next().unwrap()).unwrap();
        assert_eq!(state["type"], "get_state");
        let commands: Value = serde_json::from_str(lines.next().unwrap()).unwrap();
        assert_eq!(commands["type"], "get_commands");
        let prompt: Value = serde_json::from_str(lines.next().unwrap()).unwrap();
        assert_eq!(prompt["type"], "prompt");
        assert_eq!(prompt["message"], request.prompt);
        assert!(
            lines.next().is_none(),
            "unexpected extra command: {payload}"
        );
        assert!(
            !payload.ends_with('\n'),
            "writer appends the terminator: {payload:?}"
        );
        assert!(built.keep_stdin_open);
    }

    #[test]
    fn omp_prompt_rides_the_rpc_prompt_command() {
        let mut request = req(None);
        request.prompt = "first line\nsecond line".to_string();
        let built = build(&pi_family::omp(), &request).unwrap();
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
        assert!(build(&pi_family::omp(), &request).is_err());
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
        let codex = codex::CodexEngine;
        assert_eq!(codex.resolve_permission(Some("plan")), "plan");
        assert_eq!(codex.resolve_permission(Some("read-only")), "read-only");
        assert_eq!(codex.resolve_permission(Some("manual")), "read-only");
        assert_eq!(codex.resolve_permission(None), "read-only");
        assert_eq!(pi_family::omp().resolve_permission(Some("plan")), "plan");
        assert_eq!(dsh::DshEngine.resolve_permission(Some("plan")), "plan");
        assert_eq!(pi_family::pi().resolve_permission(Some("plan")), "auto");
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
        assert!(auto
            .windows(3)
            .any(|w| w == ["--allowedTools", "WebSearch", "WebFetch"]));

        let manual = argv(&e, &req(Some("manual")));
        assert!(manual.contains(&"default".to_string()));
        assert!(!manual.contains(&"--allowedTools".to_string()));

        let plan = argv(&e, &req(Some("plan")));
        assert!(plan.contains(&"plan".to_string()));

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

        let mut plan_req = req(Some("plan"));
        plan_req.model = Some("openai-codex/gpt-5.4".into());
        let plan = argv(&pi_family::omp(), &plan_req);
        assert!(plan.contains(&"--mode".to_string()));
        assert!(!plan.contains(&"--plan-yolo".to_string()));
        assert!(!plan.contains(&"--plan-yolo-into".to_string()));
        assert!(!plan.contains(&"--auto-approve".to_string()));

        let mut auto_req = req(Some("auto"));
        auto_req.model = Some("openai-codex/gpt-5.4".into());
        let auto = argv(&pi_family::omp(), &auto_req);
        let pin = auto
            .iter()
            .position(|a| a == "--model")
            .expect("model flag");
        assert_eq!(auto[pin + 1], "openai-codex/gpt-5.4");
        assert!(!auto.contains(&"--auto-approve".to_string()));
        let bypass = argv(&pi_family::omp(), &req(Some("bypass")));
        assert!(!bypass.contains(&"--auto-approve".to_string()));
        assert!(!bypass.contains(&"--plan-yolo".to_string()));

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
            dirs: Vec::new(),
            warm: false,
        }
    }

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
            #[cfg(windows)]
            _tree_guard: None,
        };
        run_reader(stdout, ctx).await;
        let events = std::mem::take(&mut *emitter.0.lock().unwrap());
        events
    }

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
    async fn claude_plain_turn_still_settles_on_first_result() {
        let events = replay_engine_output(
            "claude",
            Box::new(claude::ClaudeEngine::new()),
            &[claude_text_delta("hi"), claude_result()],
        )
        .await;
        let kinds: Vec<_> = events
            .iter()
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
            #[cfg(windows)]
            _tree_guard: None,
        };
        tokio::time::timeout(std::time::Duration::from_secs(5), run_reader(stdout, ctx))
            .await
            .expect("reader must settle after child exit, not park on the held pipe");
        let events = std::mem::take(&mut *emitter.0.lock().unwrap());
        let kinds: Vec<_> = events
            .iter()
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
        let mut settings = crate::engines::support::settings::AppSettings {
            codex_home: Some(dir.to_string_lossy().into_owned()),
            ..Default::default()
        };
        let resolved = engine_bin(&settings, "codex");
        assert_eq!(PathBuf::from(&resolved), candidate);

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
