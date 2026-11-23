// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/codex.rs.
use super::{command_for_binary, BuiltCommand, Engine, SendRequest};
use serde_json::Value;

pub struct CodexEngine;

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

fn apply_misty_mcp(cmd: &mut tokio::process::Command, req: &SendRequest) {
    let Some(servers) = req.mcp_servers.as_ref().and_then(Value::as_object) else {
        return;
    };
    let mut args: Vec<String> = Vec::new();
    let mut env: Vec<(String, String)> = Vec::new();
    let mut held: std::collections::HashMap<String, String> = cmd
        .as_std()
        .get_envs()
        .filter_map(|(key, value)| Some((key.to_str()?.to_string(), value?.to_str()?.to_string())))
        .collect();
    for (name, server) in servers {
        if !bare_key(name) {
            continue;
        }
        let prefix = format!("mcp_servers.{name}");
        let tag = name.to_ascii_uppercase().replace('-', "_");
        if let Some(command) = server["command"].as_str() {
            let Some(forwarded) = stdio_env(&server["env"], &mut held) else {
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
            match value
                .strip_prefix("Bearer ")
                .filter(|_| header.eq_ignore_ascii_case("authorization"))
            {
                Some(token) => {
                    let variable = format!("MISTY_MCP_TOKEN_{tag}");
                    args.push(format!(
                        "{prefix}.bearer_token_env_var={}",
                        toml_string(&variable)
                    ));
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

fn codex_own(key: &str) -> bool {
    const OWN: &[&str] = &[
        "HOME",
        "LOGNAME",
        "PATH",
        "SHELL",
        "USER",
        "LANG",
        "LC_ALL",
        "TERM",
        "TMPDIR",
        "TZ",
        "__CF_USER_TEXT_ENCODING",
        "APPDATA",
        "COMSPEC",
        "PATHEXT",
        "SYSTEMROOT",
        "SYSTEMDRIVE",
        "TEMP",
        "TMP",
        "USERNAME",
        "USERPROFILE",
        "CODEX_HOME",
    ];
    OWN.iter().any(|own| own.eq_ignore_ascii_case(key))
}

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

fn bare_key(key: &str) -> bool {
    !key.is_empty()
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

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
                    if !env.contains_key(key) && std::env::var_os(key).is_none() {
                        command.env(key, value);
                    }
                }
            }
        }
    }
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

pub(crate) const READ_ONLY: &str = "read-only";

impl Engine for CodexEngine {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn drives_own_transport(&self) -> bool {
        true
    }

    fn host_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut cmd = command_for_binary(bin);
        apply_misty_mcp(&mut cmd, req);
        cmd.arg("-c");
        cmd.arg("features.skill_mcp_dependency_install=false");
        cmd.arg("app-server");
        cmd.arg("--enable");
        cmd.arg("default_mode_request_user_input");
        if let Some(tier) = req.service_tier.as_deref() {
            if tier.is_empty()
                || !tier
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            {
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
            keep_stdin_open: true,
            cleanup_files: Vec::new(),
            preassigned_session_id: None,
        })
    }

    fn supports_images(&self) -> bool {
        true
    }
    fn supports_mcp(&self) -> bool {
        true
    }

    fn supports_web_search(&self) -> bool {
        true
    }
    fn supports_effort(&self) -> bool {
        true
    }
    fn modes(&self) -> &'static [super::modes::EngineMode] {
        use super::modes::{mode, ModeKind::*};
        const MODES: &[super::modes::EngineMode] = &[
            mode("read-only", "Read only", Asks, READ_ONLY),
            mode("default", "Default", Edits, "auto"),
            mode("plan", "Plan", Plans, "plan"),
        ];
        MODES
    }

    fn plan_approval(&self) -> super::plan_review::PlanApproval {
        super::plan_review::PlanApproval::Typed {
            review_kind: super::plan_review::PlanReviewKind::NextTurn,
            evidence: "0.154.0 experimental schema TurnStartParams.collaborationMode + item/completed plan item",
            limitations: "every field involved is EXPERIMENTAL; the client arbitrates the approval point; after a restart the plan item must be fetched again and compared",
        }
    }
}

#[cfg(test)]
#[path = "codex_tests.rs"]
mod tests;
