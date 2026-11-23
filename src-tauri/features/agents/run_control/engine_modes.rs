use crate::engines::modes::{self, EngineMode, ModeKind};
use crate::engines::Engine;

pub(crate) fn of_request(body: &serde_json::Value) -> Option<EngineMode> {
    let text = |name: &str| {
        body.get(name)
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
    };
    let engine = body["engine"]["id"].as_str().unwrap_or("");
    modes::chosen(
        &modes::offered_by_id(engine),
        text("engine_mode"),
        legacy_kind(body),
    )
    .ok()
    .copied()
}

fn legacy_kind(body: &serde_json::Value) -> Option<ModeKind> {
    let text = |name: &str| {
        body.get(name)
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
    };
    let chat = !text("conversation_id").is_empty();
    let mut collaboration = text("collaboration_mode");
    if collaboration.is_empty() && chat {
        collaboration = body["collaboration"]["mode"].as_str().unwrap_or("").trim();
    }
    if collaboration == "plan" && chat {
        return Some(ModeKind::Plans);
    }
    ModeKind::of_legacy(text("permission_mode"))
}

pub(crate) fn launch_for(
    engine: &dyn Engine,
    body: &serde_json::Value,
) -> Result<&'static str, String> {
    let name = crate::engines::engine_name(engine.id());
    let text = |name: &str| {
        body.get(name)
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
    };
    let offered = modes::offered(engine);
    let wanted = modes::chosen(&offered, text("engine_mode"), legacy_kind(body)).map_err(|_| {
        if engine
            .modes()
            .iter()
            .any(|mode| mode.id == text("engine_mode").trim())
        {
            format!("{name} can't work without asking inside its folder here. Choose another mode.")
        } else {
            format!(
                "{name} has no mode called “{}”.",
                text("engine_mode").trim()
            )
        }
    })?;
    Ok(wanted.launch)
}

const CLAUDE_READ_ONLY: &[&str] = &["Read", "Glob", "Grep", "WebFetch", "WebSearch"];
const PI_READ_ONLY: &[&str] = &["read", "grep", "find", "ls"];

fn allows_shell(tools: &[String]) -> bool {
    tools.iter().any(|tool| {
        let tool = tool.trim();
        tool == "*"
            || tool == "shell.run"
            || tool
                .strip_suffix(".*")
                .or_else(|| tool.strip_suffix('*'))
                .is_some_and(|family| "shell.run".starts_with(family))
    })
}

pub(crate) fn engine_tools(
    engine: &dyn Engine,
    facts: &super::tool_policy::RunFacts,
) -> Result<Option<Vec<String>>, String> {
    if facts.allowed_tools.is_empty() || allows_shell(&facts.allowed_tools) {
        return Ok(None);
    }
    let names: &[&str] = match engine.id() {
        "claude" | "codebuddy" => CLAUDE_READ_ONLY,
        "pi" => PI_READ_ONLY,
        _ => &[],
    };
    if names.is_empty() || !engine.supports_tool_constraints() {
        let name = crate::engines::engine_name(engine.id());
        return Err(format!(
            "{name} can't be limited to this agent's tools. Allow the shell, or run it on Claude Code."
        ));
    }
    Ok(Some(names.iter().map(|name| name.to_string()).collect()))
}

const MAX_ENGINE_ARGS: usize = 24;
const MAX_ENGINE_ARG_LEN: usize = 1000;

const RESERVED_OPTIONS: &[&str] = &[
    "dangerously-skip-permissions",
    "dangerously-bypass-approvals-and-sandbox",
    "allow-dangerously-skip-permissions",
    "permission-mode",
    "permission-prompt-tool",
    "allowedtools",
    "allowed-tools",
    "disallowedtools",
    "disallowed-tools",
    "tools",
    "add-dir",
    "mcp-config",
    "strict-mcp-config",
    "settings",
    "setting-sources",
    "yolo",
    "yes",
    "always-approve",
    "auto-approve",
    "approval-mode",
    "ask-for-approval",
    "sandbox",
    "full-auto",
    "config",
    "profile",
    "enable",
    "disable",
    "plan-yolo",
    "plan-yolo-into",
    "no-extensions",
    "extension",
    "resume",
    "continue",
    "session-id",
    "fork-session",
    "input-format",
    "output-format",
    "print",
    "mode",
    "cd",
    "experimental-acp",
    "acp",
];
const RESERVED_SHORT: &[char] = &['y', 'a', 's', 'c', 'p', 'r', 'e', 'C'];
const RESERVED_WORDS: &[&str] = &[
    "permission",
    "approv",
    "sandbox",
    "yolo",
    "bypass",
    "dangerous",
    "trust",
];

pub(crate) fn engine_args(body: &serde_json::Value) -> Result<Vec<String>, String> {
    let Some(list) = body["engine"]["args"].as_array() else {
        return Ok(Vec::new());
    };
    let args: Vec<String> = list
        .iter()
        .filter_map(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|arg| !arg.is_empty())
        .map(str::to_string)
        .collect();
    if args.len() > MAX_ENGINE_ARGS {
        return Err(format!(
            "This agent passes its engine more than {MAX_ENGINE_ARGS} arguments."
        ));
    }
    for arg in &args {
        if arg.chars().count() > MAX_ENGINE_ARG_LEN || arg.chars().any(char::is_control) {
            return Err(
                "One of this agent's engine arguments is too long or has control characters."
                    .into(),
            );
        }
        if let Some(reason) = reserved(arg) {
            return Err(format!(
                "This agent's engine arguments can't include {reason}: what an engine may do comes from the chat's mode."
            ));
        }
    }
    Ok(args)
}

fn reserved(arg: &str) -> Option<String> {
    let lower = arg.to_ascii_lowercase();
    if let Some(long) = arg.strip_prefix("--") {
        let name = long.split('=').next().unwrap_or("").to_ascii_lowercase();
        if RESERVED_OPTIONS.contains(&name.as_str())
            || RESERVED_WORDS.iter().any(|word| name.contains(word))
        {
            return Some(format!("--{name}"));
        }
        return None;
    }
    if let Some(short) = arg.strip_prefix('-') {
        let letters = short.split('=').next().unwrap_or("");
        if letters.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            return None;
        }
        if RESERVED_OPTIONS.contains(&letters.to_ascii_lowercase().as_str())
            || RESERVED_WORDS
                .iter()
                .any(|word| letters.to_ascii_lowercase().contains(word))
            || (letters.len() <= 4 && letters.chars().any(|c| RESERVED_SHORT.contains(&c)))
        {
            return Some(format!("-{letters}"));
        }
        return None;
    }
    const MODE_VALUES: &[&str] = &[
        "bypasspermissions",
        "acceptedits",
        "dontask",
        "danger-full-access",
        "yolo",
    ];
    MODE_VALUES
        .contains(&lower.as_str())
        .then(|| format!("“{arg}”"))
}

#[cfg(test)]
#[path = "engine_modes_tests.rs"]
mod tests;
