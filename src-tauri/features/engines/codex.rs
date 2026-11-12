// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/codex.rs.
use super::{
    command_for_binary, images, push_session_id, BuiltCommand, Engine, EngineEvent, SendRequest,
    Transport,
};
use serde_json::Value;

/// Codex child transport: `codex exec --json` (verified against codex CLI
/// live). A local workspace sends through the app-server instead — only that
/// protocol carries the model's question tool (`item/tool/requestUserInput`);
/// `codex exec` answers every question itself.
pub struct CodexEngine;

/// TOML basic-string literal for a `-c key=<value>` override. codex parses
/// the value as TOML, so a Windows path's backslashes would otherwise read
/// as escape sequences.
fn toml_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04X}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Mount Misty's Space MCP server, and an agent's own servers, on this one launch. codex
/// discovers MCP servers from `config.toml`, but `-c key=value` overrides apply to this process
/// only: no file is written, so nothing in the person's config changes. Values go in the
/// environment, never on the command line, where other programs could read them: a bearer token
/// and any other header through `bearer_token_env_var` and `env_http_headers`, and a stdio
/// server's env through Codex's own environment and that server's `env_vars`, which Codex passes
/// on to it.
///
/// `-c` is a top-level option, so every caller has to add these BEFORE the subcommand.
fn apply_misty_mcp(cmd: &mut tokio::process::Command, req: &SendRequest) {
    let Some(servers) = req.mcp_servers.as_ref().and_then(Value::as_object) else {
        return;
    };
    let mut args: Vec<String> = Vec::new();
    let mut env: Vec<(String, String)> = Vec::new();
    // What Codex's own environment holds by now: what the command sets, or the servers before.
    let mut held: std::collections::HashMap<String, String> = cmd
        .as_std()
        .get_envs()
        .filter_map(|(key, value)| {
            Some((key.to_str()?.to_string(), value?.to_str()?.to_string()))
        })
        .collect();
    for (name, server) in servers {
        if !bare_key(name) {
            continue;
        }
        let prefix = format!("mcp_servers.{name}");
        let tag = name.to_ascii_uppercase().replace('-', "_");
        if let Some(command) = server["command"].as_str() {
            // An agent's stdio server: command, arguments, env and folder as its config wrote them.
            let Some(forwarded) = stdio_env(&server["env"], &mut held) else {
                // A name that has to hold another value for Codex or an earlier server can't
                // reach this one without the command line, so the server is left out.
                continue;
            };
            args.push(format!("{prefix}.command={}", toml_string(command)));
            let list: Vec<String> = server["args"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(toml_string)
                .collect();
            args.push(format!("{prefix}.args=[{}]", list.join(",")));
            let mut names: Vec<String> = Vec::new();
            for (key, value) in forwarded {
                // Codex starts a stdio server with the variables it uses itself (PATH, HOME and
                // the like) as Codex has them, so a different one is set in `env`: those hold
                // paths and names, never keys. Every other value goes through the environment.
                if codex_own(&key) {
                    if std::env::var(&key).ok().as_deref() != Some(value.as_str()) {
                        args.push(format!("{prefix}.env.{key}={}", toml_string(&value)));
                    }
                } else {
                    names.push(toml_string(&key));
                    env.push((key, value));
                }
            }
            if !names.is_empty() {
                args.push(format!("{prefix}.env_vars=[{}]", names.join(",")));
            }
            if let Some(cwd) = server["cwd"].as_str() {
                args.push(format!("{prefix}.cwd={}", toml_string(cwd)));
            }
            continue;
        }
        let Some(url) = server["url"].as_str() else {
            continue;
        };
        args.push(format!("{prefix}.url={}", toml_string(url)));
        for (header, value) in server["headers"].as_object().into_iter().flatten() {
            let Some(value) = value.as_str() else {
                continue;
            };
            if !bare_key(header) {
                continue;
            }
            match value.strip_prefix("Bearer ").filter(|_| header.eq_ignore_ascii_case("authorization")) {
                Some(token) => {
                    let variable = format!("MISTY_MCP_TOKEN_{tag}");
                    args.push(format!("{prefix}.bearer_token_env_var={}", toml_string(&variable)));
                    env.push((variable, token.to_string()));
                }
                None => {
                    let variable = format!(
                        "MISTY_MCP_HEADER_{tag}_{}",
                        header.to_ascii_uppercase().replace('-', "_")
                    );
                    args.push(format!(
                        "{prefix}.env_http_headers.{header}={}",
                        toml_string(&variable)
                    ));
                    env.push((variable, value.to_string()));
                }
            }
        }
    }
    for arg in args {
        cmd.arg("-c").arg(arg);
    }
    for (key, value) in env {
        cmd.env(key, value);
    }
}

/// The variables Codex hands every stdio server from its own environment.
fn codex_own(key: &str) -> bool {
    const OWN: &[&str] = &[
        "HOME", "LOGNAME", "PATH", "SHELL", "USER", "LANG", "LC_ALL", "TERM", "TMPDIR", "TZ",
        "__CF_USER_TEXT_ENCODING", "APPDATA", "COMSPEC", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE",
        "TEMP", "TMP", "USERNAME", "USERPROFILE", "CODEX_HOME",
    ];
    OWN.iter().any(|own| own.eq_ignore_ascii_case(key))
}

/// A stdio server's env as the names Codex passes on, each claimed in `held`. None when one of
/// them already holds a different value, since Codex's environment can carry only one.
fn stdio_env(
    env: &Value,
    held: &mut std::collections::HashMap<String, String>,
) -> Option<Vec<(String, String)>> {
    let pairs: Vec<(String, String)> = env
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(key, _)| bare_key(key))
        .filter_map(|(key, value)| Some((key.clone(), value.as_str()?.to_string())))
        .collect();
    let clashes = pairs.iter().any(|(key, value)| {
        !codex_own(key) && held.get(key).is_some_and(|earlier| earlier != value)
    });
    if clashes {
        return None;
    }
    for (key, value) in &pairs {
        if !codex_own(key) {
            held.insert(key.clone(), value.clone());
        }
    }
    Some(pairs)
}

/// A key `-c` takes as one dotted-path segment.
fn bare_key(key: &str) -> bool {
    !key.is_empty()
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Process-scoped equivalents of the provider keys formerly written into
/// config.toml/auth.json. Explicit model/effort picks still win.
pub(super) fn apply_channel(
    command: &mut tokio::process::Command,
    provider: &Value,
    env: &std::collections::HashMap<String, String>,
    req: &SendRequest,
) -> Result<(), String> {
    use toml::Value as Toml;
    let text = provider
        .pointer("/settingsConfig/config")
        .and_then(Value::as_str)
        .unwrap_or("");
    // Do not put parser diagnostics here: they can contain credentials from TOML.
    let mut config: toml::Table =
        toml::from_str(text).map_err(|_| "Invalid Codex channel config.toml".to_string())?;
    let api_key = env.get("OPENAI_API_KEY");
    let base_url = env.get("OPENAI_BASE_URL");
    if text.trim().is_empty() {
        if let Some(model) = provider
            .get("model")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
        {
            config.insert("model".into(), Toml::String(model.into()));
        }
    }
    // A flat channel must select its own provider, even when the native file
    // selects a different relay. Credentials travel in env, never in argv.
    if !config.contains_key("model_provider") && (base_url.is_some() || api_key.is_some()) {
        config.insert("model_provider".into(), Toml::String("ccgui".into()));
        let table = toml::Table::from_iter([
            ("name".into(), Toml::String("CC GUI".into())),
            (
                "base_url".into(),
                Toml::String(
                    base_url
                        .cloned()
                        .unwrap_or_else(|| "https://api.openai.com/v1".into()),
                ),
            ),
            ("wire_api".into(), Toml::String("responses".into())),
        ]);
        config.insert(
            "model_providers".into(),
            Toml::Table(toml::Table::from_iter([(
                "ccgui".into(),
                Toml::Table(table),
            )])),
        );
    }
    if let Some(key) = api_key {
        let selected = config
            .get("model_provider")
            .and_then(Toml::as_str)
            .unwrap_or("openai")
            .to_string();
        let providers = config
            .entry("model_providers")
            .or_insert_with(|| Toml::Table(Default::default()))
            .as_table_mut()
            .ok_or("Codex channel model_providers must be a table")?;
        let table = providers
            .entry(selected.clone())
            .or_insert_with(|| Toml::Table(Default::default()))
            .as_table_mut()
            .ok_or("Codex channel provider must be a table")?;
        table
            .entry("name")
            .or_insert_with(|| Toml::String(selected));
        table.insert("env_key".into(), Toml::String("CCGUI_CODEX_API_KEY".into()));
        table.insert("requires_openai_auth".into(), Toml::Boolean(false));
        table.remove("experimental_bearer_token");
        command.env("CCGUI_CODEX_API_KEY", key);
    }
    // Provider documents may authenticate via literal headers or a bearer
    // token. Move those to env too, so process listings do not reveal them.
    if let Some(providers) = config
        .get_mut("model_providers")
        .and_then(Toml::as_table_mut)
    {
        for (provider_index, (_, table)) in providers.iter_mut().enumerate() {
            let table = table
                .as_table_mut()
                .ok_or("Codex channel provider must be a table")?;
            if let Some(token) = table.remove("experimental_bearer_token") {
                let token = token
                    .as_str()
                    .ok_or("Codex channel bearer token must be a string")?;
                let key = format!("CCGUI_CODEX_BEARER_{provider_index}");
                command.env(&key, token);
                table.insert("env_key".into(), Toml::String(key));
                table.insert("requires_openai_auth".into(), Toml::Boolean(false));
            }
            if let Some(headers) = table.remove("http_headers") {
                let headers = headers
                    .as_table()
                    .ok_or("Codex channel headers must be a table")?;
                let env_headers = table
                    .entry("env_http_headers")
                    .or_insert_with(|| Toml::Table(Default::default()))
                    .as_table_mut()
                    .ok_or("Codex channel env headers must be a table")?;
                for (header_index, (header, value)) in headers.iter().enumerate() {
                    let value = value
                        .as_str()
                        .ok_or("Codex channel header must be a string")?;
                    let key = env_headers
                        .entry(header.clone())
                        .or_insert_with(|| {
                            Toml::String(format!(
                                "CCGUI_CODEX_HEADER_{provider_index}_{header_index}"
                            ))
                        })
                        .as_str()
                        .ok_or("Codex channel header env key must be a string")?;
                    // Preserve the CLI's env-header-over-literal-header precedence.
                    if !env.contains_key(key) && std::env::var_os(key).is_none() {
                        command.env(key, value);
                    }
                }
            }
        }
    }
    // Keep the existing provider contract: unrelated native hooks, trust and
    // MCP settings are inherited, not replaced by a channel's document.
    // `disable_response_storage` is retired by current Codex versions: they
    // log it as an ignored session flag, so saved legacy channels must not
    // keep injecting it as a process override.
    for key in [
        "model",
        "model_provider",
        "model_reasoning_effort",
        "model_context_window",
        "model_auto_compact_token_limit",
        "preferred_auth_method",
        "model_providers",
    ] {
        if (key == "model" && req.model.is_some())
            || (key == "model_reasoning_effort" && req.effort.is_some())
        {
            continue;
        }
        if let Some(value) = config.get(key) {
            command.arg("-c").arg(format!("{key}={value}"));
        }
    }
    Ok(())
}

impl Engine for CodexEngine {
    fn id(&self) -> &'static str {
        "codex"
    }

    /// Codex's app-server is the only transport that can hand the user a
    /// question: `codex exec` declares `request_user_input is not supported in
    /// exec mode` and picks the answers itself.
    fn drives_own_transport(&self) -> bool {
        true
    }

    /// A remote workspace keeps the CLI child path: the app-server driver
    /// spawns the CLI locally and has no ssh path into the distro.
    fn transport_for(&self, wsl: bool) -> Transport {
        if wsl {
            Transport::Child
        } else {
            Transport::Own
        }
    }

    /// The command the driver spawns. Model/effort/provider flags land on it
    /// from [`apply_channel`] like any child; only the app-server's own
    /// switches live here (the question tool on, skill MCP auto-install off).
    fn host_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut cmd = command_for_binary(bin);
        apply_misty_mcp(&mut cmd, req);
        // The native client identity (codex_app::initialize_params) makes Codex
        // treat this client as first-party, which unlocks skill MCP-dependency
        // auto-install: with approval "never" and full access, naming a skill
        // (repo-provided ones included) writes its MCP servers into the global
        // config.toml without asking. Keep it off as before; Codex ignores
        // unknown feature keys, so older CLIs still start.
        cmd.arg("-c");
        cmd.arg("features.skill_mcp_dependency_install=false");
        cmd.arg("app-server");
        // Without this the model never asks: it emits a plain agent message
        // (plus a sleep item) instead of a client request.
        cmd.arg("--enable");
        cmd.arg("default_mode_request_user_input");
        // Fast mode is Codex's service_tier=priority; the driver's thread/start
        // carries model and sandbox, but not the tier.
        if let Some(tier) = req.service_tier.as_deref() {
            if !matches!(tier, "default" | "priority") {
                return Err("Invalid Codex service tier".to_string());
            }
            cmd.arg("-c");
            cmd.arg(format!("service_tier=\"{tier}\""));
        }
        if let Some(effort) = req.effort.as_deref() {
            cmd.arg("-c");
            cmd.arg(format!("model_reasoning_effort=\"{effort}\""));
        }
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: None,
            // The driver answers parked questions on this pipe.
            keep_stdin_open: true,
            cleanup_files: Vec::new(),
            // The app-server assigns the thread id; a resume passes
            // thread/resume with the id the conversation already holds.
            preassigned_session_id: None,
        })
    }

    fn supports_images(&self) -> bool {
        true // -i/--image FILE
    }
    fn supports_mcp(&self) -> bool {
        true
    }
    fn supports_effort(&self) -> bool {
        true
    }
    fn supported_permissions(&self) -> &'static [&'static str] {
        &["auto", "manual", "bypass", "plan"]
    }

    /// Human plan review follows the next_turn lifecycle (turn/start collaborationMode.plan →
    /// the complete plan item → on approval, one default execution turn), carried out by the
    /// local app-server transport (codex_app.rs); the exec/WSL fallback has no such protocol and
    /// refuses in build_command.
    fn plan_approval(&self) -> super::plan_review::PlanApproval {
        super::plan_review::PlanApproval::Typed {
            review_kind: super::plan_review::PlanReviewKind::NextTurn,
            evidence: "0.154.0 experimental schema TurnStartParams.collaborationMode + item/completed plan item",
            limitations: "every field involved is EXPERIMENTAL; the client arbitrates the approval point; after a restart the plan item must be fetched again and compared",
        }
    }

    fn build_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        if super::codex_read_only::requested(req) {
            return Err("Codex read-only planning requires the local app-server; exec/WSL fallback is forbidden".into());
        }
        // Human plan approval exists only on the app-server transport
        // (collaborationMode turns); the exec/WSL fallback has no such
        // protocol, so an explicit plan request fails closed here instead of
        // silently degrading to an auto run.
        if req.permission.as_deref() == Some("plan") {
            return Err("Codex plan approval runs on the local app-server transport; the exec/WSL fallback cannot honor it".into());
        }
        let mut cmd = command_for_binary(bin);
        cmd.arg("exec");
        let mut preassigned = None;
        if let Some(session_id) = req.session_id.as_deref() {
            // `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]`
            cmd.arg("resume");
            cmd.arg("--json");
            cmd.arg(session_id);
            preassigned = Some(session_id.to_string());
        } else {
            cmd.arg("--json");
        }
        cmd.arg("--skip-git-repo-check");
        // exec auto-declines approval prompts, so "manual" is enforced by the
        // sandbox instead: read-only means nothing can change without the
        // user re-sending in a writable mode. codex exec has no plan mode.
        // Sandbox goes through -c sandbox_mode (not --sandbox): `exec resume`
        // dropped the --sandbox flag, while -c works on both subcommands.
        match self.resolve_permission(req.permission.as_deref()) {
            "bypass" => {
                cmd.arg("--dangerously-bypass-approvals-and-sandbox");
            }
            "manual" => {
                cmd.arg("-c");
                cmd.arg("sandbox_mode=\"read-only\"");
            }
            _ => {
                cmd.arg("-c");
                cmd.arg("sandbox_mode=\"workspace-write\"");
            }
        }
        if let Some(model) = req.model.as_deref() {
            cmd.arg("-m");
            cmd.arg(model);
        }
        // Reasoning effort maps onto codex's config key (TOML value, so the
        // string needs quotes). Pass the level through as-is: current models
        // accept low…ultra (catalog-ordered), including max.
        if let Some(effort) = req.effort.as_deref() {
            cmd.arg("-c");
            cmd.arg(format!("model_reasoning_effort=\"{effort}\""));
        }
        // Fast mode is Codex's service_tier=priority (same id the desktop app
        // uses). Explicit default opts out; None leaves the CLI's config alone.
        if let Some(tier) = req.service_tier.as_deref() {
            if !matches!(tier, "default" | "priority") {
                return Err("Invalid Codex service tier".to_string());
            }
            cmd.arg("-c");
            cmd.arg(format!("service_tier=\"{tier}\""));
        }
        for raw in &req.images {
            if let Some(path) = images::absolutize_image_path(raw, &req.workspace) {
                cmd.arg("-i");
                cmd.arg(path);
            }
        }
        // Prompt travels through stdin (`-`), never argv: on Windows the codex
        // shim is a `.cmd` batch file and cmd.exe cuts a multiline argument at
        // the first newline — every line after the first was dropped (or worse,
        // executed as a command). stdin also dodges cmd's `%VAR%` expansion of
        // quoted args. `codex exec [resume] -` reads the prompt from stdin.
        cmd.arg("-");
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: Some(req.prompt.clone()),
            keep_stdin_open: false,
            cleanup_files: Vec::new(),
            preassigned_session_id: preassigned,
        })
    }

    fn parse_line(&self, line: &str, out: &mut Vec<EngineEvent>) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");
        match event_type {
            "thread.started" => {
                push_session_id(&value, "thread_id", out);
            }
            "item.completed" => {
                let Some(item) = value.get("item") else {
                    return;
                };
                match item.get("type").and_then(Value::as_str) {
                    Some("agent_message") => {
                        if let Some(text) = item.get("text").and_then(Value::as_str) {
                            if !text.is_empty() {
                                out.push(super::assistant_message(text.to_string()));
                            }
                        }
                    }
                    Some("reasoning") => {
                        if let Some(text) = item.get("text").and_then(Value::as_str) {
                            if !text.is_empty() {
                                out.push(EngineEvent::Thinking(text.to_string()));
                            }
                        }
                    }
                    // codex exec has no delta events; tool calls surface as
                    // command_execution items.
                    Some("command_execution") => {
                        let name = item
                            .get("command")
                            .and_then(Value::as_str)
                            .unwrap_or("tool");
                        // The command string itself is the payload; wrap it so
                        // the timeline can expand a dedicated args panel.
                        let command = name.to_string();
                        out.push(super::tool_call_message(
                            name.chars().take(120).collect::<String>(),
                            Some(&Value::String(command)),
                        ));
                    }
                    _ => {}
                }
            }
            "turn.completed" => {
                let usage = value
                    .get("usage")
                    .cloned()
                    .map(|usage| attach_context_window(usage, &value));
                out.push(EngineEvent::Done {
                    session_id: None,
                    usage,
                });
            }
            "turn.failed" => {
                out.push(EngineEvent::Error(error_message(&value)));
            }
            // Non-terminal: codex emits `error` for every retry it is about
            // to make ("Reconnecting... 1/5 (...)") and once more with the
            // final message just before `turn.failed`. Verified against a
            // live run: both a retryable stream drop and a terminal 401
            // produce retries, one bare error line, then turn.failed. Only
            // turn.failed ends the turn — treating `error` as terminal
            // settled the UI and killed the CLI on the first reconnect, so
            // the turn died at 1/5 instead of continuing.
            "error" => {
                // codex announces every retry as `Reconnecting... N/M (...)`:
                // that line is live progress for the run status strip, not an
                // error. The bare error right before `turn.failed` (or any
                // other line) stays a non-terminal notice — only turn.failed
                // ends the turn.
                match parse_reconnect_notice(&value) {
                    Some((attempt, max, message)) => out.push(EngineEvent::Retry {
                        attempt,
                        max,
                        message,
                    }),
                    None => out.push(EngineEvent::Warn(error_message(&value))),
                }
            }
            _ => {}
        }
    }
}

fn attach_context_window(mut usage: Value, source: &Value) -> Value {
    if usage.get("model_context_window").is_none() {
        if let Some(window) = source.get("model_context_window").or_else(|| {
            source
                .get("info")
                .and_then(|i| i.get("model_context_window"))
        }) {
            if let Some(obj) = usage.as_object_mut() {
                obj.insert("model_context_window".to_string(), window.clone());
            }
        }
    }
    usage
}

/// codex's reconnect notice: `Reconnecting... 3/5 (stream disconnected …)`.
/// Returns `(attempt, max, reason)` so the run status line can show
/// "Retrying 3 of 5"; `None` for every other error line.
fn parse_reconnect_notice(value: &Value) -> Option<(u64, u64, String)> {
    let text = error_message(value);
    let rest = text.strip_prefix("Reconnecting...")?.trim_start();
    let (counts, reason) = match rest.split_once('(') {
        Some((counts, reason)) => (counts.trim(), reason.trim_end_matches(')').trim()),
        None => (rest.trim(), ""),
    };
    let (attempt, max) = counts.split_once('/')?;
    Some((
        attempt.trim().parse().ok()?,
        max.trim().parse().ok()?,
        reason.to_string(),
    ))
}

/// Message text of a codex error payload: `error.message` when nested,
/// `error` or `message` when flat, with a generic fallback.
fn error_message(value: &Value) -> String {
    value
        .get("error")
        .and_then(|e| e.get("message").or(Some(e)).and_then(Value::as_str))
        .or_else(|| value.get("message").and_then(Value::as_str))
        .unwrap_or("codex turn failed")
        .to_string()
}

const UNSUPPORTED_EXEC_MESSAGE: &str = "This Codex CLI is too old for `codex exec --json`, which Misty uses to run it. Update it and try again: npm i -g @openai/codex@latest";

/// Probe outcomes cached per (bin, resuming) pair: re-probing every send
/// would add a full CLI startup (hundreds of ms through a Windows .cmd
/// shim) to each message. Only successes are cached — a cached failure
/// would keep blocking a user who already upgraded until an app restart.
static PREFLIGHT_CACHE: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, ()>>,
> = std::sync::LazyLock::new(Default::default);

/// Fail fast when the resolved codex binary predates the exec transport
/// (`codex exec --json`, plus `exec resume` for continuing sessions): such
/// CLIs exit 1 before emitting any event, which surfaced as a bare
/// "codex exited with status exit code: 1" banner. Probe flakes (spawn
/// failure, timeout, non-zero help exit) never block the send — the real
/// spawn surfaces its own error then.
pub(crate) async fn check_exec_support(bin: &str, resuming: bool) -> Result<(), String> {
    let key = format!("{bin}\u{0}{resuming}");
    if let Ok(cache) = PREFLIGHT_CACHE.lock() {
        if cache.contains_key(&key) {
            return Ok(());
        }
    }
    let result = match run_help_probe(bin).await {
        Some(help) if !exec_help_supported(&help, resuming) => {
            Err(UNSUPPORTED_EXEC_MESSAGE.to_string())
        }
        _ => Ok(()),
    };
    if result.is_ok() {
        if let Ok(mut cache) = PREFLIGHT_CACHE.lock() {
            cache.insert(key, ());
        }
    }
    result
}

/// `exec --help` output (stdout+stderr), or None on spawn failure/timeout/
/// non-zero exit. Verified live: current CLIs render `--json` under Options
/// and `resume` under Commands.
async fn run_help_probe(bin: &str) -> Option<String> {
    let mut cmd = command_for_binary(bin);
    cmd.args(["exec", "--help"]);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.kill_on_drop(true);
    #[cfg(windows)]
    super::hide_console(&mut cmd);
    let output = tokio::time::timeout(std::time::Duration::from_secs(8), cmd.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    Some(text)
}

/// `--json` is the hard requirement of the exec transport; continuing a
/// session additionally needs the `resume` subcommand.
fn exec_help_supported(help: &str, resuming: bool) -> bool {
    help.contains("--json") && (!resuming || help.contains("resume"))
}

#[cfg(test)]
#[path = "codex_tests.rs"]
mod tests;
