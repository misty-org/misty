// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// src-tauri/src/provider_files.rs: how a channel record becomes the environment a launch gets,
// and the Grok config render the launch path uses. The channel store itself belongs to the
// provider channel feature (`engines::channels`).

use std::collections::{HashMap, HashSet};

use serde_json::Value;
use toml_edit::{value, DocumentMut, Item, Table};

fn is_blocked_env_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    if upper.starts_with("DYLD_")
        || upper.starts_with("LD_")
        || upper.starts_with("GIT_CONFIG_KEY_")
        || upper.starts_with("GIT_CONFIG_VALUE_")
    {
        return true;
    }
    matches!(
        upper.as_str(),
        "NODE_OPTIONS"
            | "NODE_REPL_EXTERNAL_MODULE"
            | "NODE_EXTRA_CA_CERTS"
            | "BASH_ENV"
            | "ENV"
            | "SHELLOPTS"
            | "PYTHONSTARTUP"
            | "PYTHONINSPECT"
            | "PYTHONPATH"
            | "RUBYOPT"
            | "PERL5OPT"
            | "PATH"
            | "HTTP_PROXY"
            | "HTTPS_PROXY"
            | "ALL_PROXY"
            | "GIT_SSH"
            | "GIT_SSH_COMMAND"
            | "GIT_CONFIG_GLOBAL"
            | "GIT_CONFIG_SYSTEM"
            | "GIT_CONFIG_COUNT"
            | "GIT_TEMPLATE_DIR"
            | "GIT_EXEC_PATH"
            | "SSH_ASKPASS"
            | "PROMPT_COMMAND"
            | "EDITOR"
            | "GIT_PAGER"
            | "PAGER"
            | "IFS"
    )
}

fn env_mapping(engine: &str) -> [(&'static str, &'static str); 3] {
    match engine {
        "claude" => [
            ("baseUrl", "ANTHROPIC_BASE_URL"),
            ("apiKey", "ANTHROPIC_AUTH_TOKEN"),
            ("model", "ANTHROPIC_MODEL"),
        ],
        "kimi" => [
            ("baseUrl", "KIMI_BASE_URL"),
            ("apiKey", "KIMI_API_KEY"),
            ("model", "KIMI_MODEL_NAME"),
        ],
        "grok" => [
            ("baseUrl", "GROK_BASE_URL"),
            ("apiKey", "GROK_API_KEY"),
            ("model", "GROK_MODEL"),
        ],
        "codex" => [
            ("baseUrl", "OPENAI_BASE_URL"),
            ("apiKey", "OPENAI_API_KEY"),
            ("model", ""),
        ],
        "codebuddy" => [
            ("baseUrl", "CODEBUDDY_BASE_URL"),
            ("apiKey", "CODEBUDDY_API_KEY"),
            ("model", "CODEBUDDY_MODEL"),
        ],
        _ => [("baseUrl", ""), ("apiKey", ""), ("model", "")],
    }
}

fn non_empty_str(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn channel_env_maps(
    provider: &Value,
) -> impl Iterator<Item = &serde_json::Map<String, Value>> + '_ {
    [
        provider.get("settingsConfig").and_then(|s| s.get("env")),
        provider.get("env"),
    ]
    .into_iter()
    .flatten()
    .filter_map(Value::as_object)
}

fn channel_field(engine: &str, provider: &Value, field: &str) -> Option<String> {
    if let Some(v) = non_empty_str(provider.get(field)) {
        return Some(v);
    }
    let (_, var) = env_mapping(engine).into_iter().find(|(f, _)| *f == field)?;
    if var.is_empty() {
        return None;
    }
    channel_env_maps(provider).find_map(|map| non_empty_str(map.get(var)))
}

pub(crate) fn channel_env(
    engine: &str,
    provider: &Value,
) -> Result<HashMap<String, String>, String> {
    let mut out: HashMap<String, String> = HashMap::new();
    let mut seen = HashSet::new();
    for map in channel_env_maps(provider) {
        for (key, val) in map {
            if seen.contains(key) || is_blocked_env_key(key) {
                if is_blocked_env_key(key) {
                    eprintln!("[provider_files] refusing to inject blocked env key: {key}");
                }
                continue;
            }
            let scalar = match val {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => b.to_string(),
                _ => continue,
            };
            if scalar.trim().is_empty() {
                continue;
            }
            seen.insert(key.clone());
            out.insert(key.clone(), scalar);
        }
    }
    for (field, var) in env_mapping(engine) {
        if var.is_empty() || seen.contains(var) {
            continue;
        }
        if let Some(v) = channel_field(engine, provider, field) {
            seen.insert(var.to_string());
            out.insert(var.to_string(), v);
        }
    }
    if engine == "codex" && !seen.contains("OPENAI_API_KEY") {
        if let Some(key) = non_empty_str(
            provider
                .get("settingsConfig")
                .and_then(|s| s.get("auth"))
                .and_then(|a| a.get("OPENAI_API_KEY")),
        ) {
            out.insert("OPENAI_API_KEY".to_string(), key);
        }
    }
    if engine == "grok" {
        if let Some(base) = out.remove("GROK_BASE_URL") {
            let base = base.trim_end_matches('/');
            for key in [
                "GROK_MODELS_BASE_URL",
                "GROK_XAI_API_BASE_URL",
                "GROK_CLI_CHAT_PROXY_BASE_URL",
            ] {
                out.entry(key.into()).or_insert_with(|| base.to_string());
            }
            out.entry("GROK_MODELS_LIST_URL".into())
                .or_insert_with(|| format!("{base}/models"));
        }
        if let Some(key) = out.remove("GROK_API_KEY") {
            out.entry("XAI_API_KEY".into()).or_insert(key);
        }
    }
    if engine == "codebuddy" && !seen.contains("CODEBUDDY_INTERNET_ENVIRONMENT") {
        if let Some(edition) = out
            .get("CODEBUDDY_BASE_URL")
            .and_then(|base| codebuddy_edition_for(base))
        {
            out.insert(
                "CODEBUDDY_INTERNET_ENVIRONMENT".to_string(),
                edition.to_string(),
            );
        }
    }
    Ok(out)
}

fn codebuddy_edition_for(base_url: &str) -> Option<&'static str> {
    let rest = base_url
        .split_once("://")
        .map_or(base_url, |(scheme, rest)| {
            if scheme.is_empty() || scheme.contains(['/', '?', '#']) {
                base_url
            } else {
                rest
            }
        });
    let authority = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    let host_port = authority.rsplit('@').next().unwrap_or(authority);
    let host = host_port
        .split_once(':')
        .map(|(host, _)| host)
        .unwrap_or(host_port);
    match host.to_ascii_lowercase().as_str() {
        "tencent.sso.copilot.tencent.com" => Some("ioa"),
        "copilot.tencent.com" => Some("internal"),
        _ => None,
    }
}

pub(crate) fn render_grok(base: &str, provider: &Value) -> Result<String, String> {
    let mut doc = base
        .parse::<DocumentMut>()
        .map_err(|_| "Invalid legacy Grok config TOML")?;
    for key in ["endpoints", "models", "model"] {
        if doc
            .get(key)
            .is_some_and(|item| item.as_table_like().is_none())
        {
            return Err(format!("Grok config {key} must be a table"));
        }
    }
    if let Some(base_url) = channel_field("grok", provider, "baseUrl") {
        let base_url = base_url.trim_end_matches('/').to_string();
        for key in [
            "models_base_url",
            "xai_api_base_url",
            "cli_chat_proxy_base_url",
        ] {
            doc["endpoints"][key] = value(base_url.clone());
        }
        doc["endpoints"]["models_list_url"] = value(format!("{base_url}/models"));
    }
    let api_key = channel_field("grok", provider, "apiKey");
    if let Some(model) = channel_field("grok", provider, "model") {
        doc["models"]["default"] = value(model.clone());
        let mut table = existing_table(&doc, &["model", model.as_str()])
            .unwrap_or_else(|| Item::Table(Table::new()));
        upsert_str(&mut table, "model", &model);
        if let Some(key) = api_key {
            upsert_str(&mut table, "api_key", &key);
        }
        upsert_table(&mut doc, &["model", model.as_str()], table);
    }
    Ok(doc.to_string())
}

fn existing_table(doc: &DocumentMut, path: &[&str]) -> Option<Item> {
    let mut item = doc.as_item();
    for key in path {
        item = item.get(*key)?;
    }
    item.as_table_like().map(clone_table_like)
}

fn upsert_table(doc: &mut DocumentMut, path: &[&str], table: Item) {
    let mut current = doc.as_item_mut();
    for key in &path[..path.len() - 1] {
        if current.get(*key).is_none() {
            let mut t = Table::new();
            t.set_implicit(true);
            current[*key] = Item::Table(t);
        }
        current = &mut current[*key];
    }
    if let Some(parent) = current.as_table_like_mut() {
        parent.insert(path[path.len() - 1], table);
    }
}

fn clone_table_like(table: &dyn toml_edit::TableLike) -> Item {
    let mut copy = Table::new();
    for (key, item) in table.iter() {
        copy[key] = item.clone();
    }
    Item::Table(copy)
}

fn upsert_str(table: &mut Item, key: &str, val: &str) {
    if let Some(t) = table.as_table_like_mut() {
        t.insert(key, value(val));
    }
}
