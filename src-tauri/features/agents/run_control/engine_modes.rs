//! What an outside engine may do, by the mode its run started with. Native on purpose, beside
//! `tool_policy.rs`: the mode comes from the request the run was started with, never from the
//! renderer at call time, the model or a page.
//!
//! Misty has no modes of its own. Each engine lists its own (`engines/modes.rs`, each adapter's
//! `Engine::modes`), by its own ids and names, and the request names one of them. Native code
//! checks it is in that engine's list here and starts the engine with that mode's flags; Misty's
//! gate reads only the mode's fixed kind:
//!
//! - asks: the engine stops before changing files or running a command, and each ask reaches the
//!   person through Misty's gate (`engines/gate.rs`);
//! - edits: the engine works without asking for ordinary work; the asks it still raises are
//!   allowed by the gate;
//! - plans: read-only planning, and the gate refuses every change;
//! - no asking: the engine works on its own without asking, but only inside its folder (the run's
//!   working folder and its extra folders), held there by the engine's own sandbox. Claude Code
//!   skips its asks inside its sandbox, with its file tools held to the folder (macOS, and Linux
//!   with bubblewrap); Gemini CLI and Qwen Code run `--yolo --sandbox` on macOS's Seatbelt. An
//!   engine with no folder sandbox here doesn't list such a mode, so it isn't offered. Calls into
//!   a Space or the browser go on as they do when the engine works without asking.

use crate::engines::modes::{self, EngineMode, ModeKind};
use crate::engines::Engine;

/// The mode a run names, from its request: the engine mode id (`engine_mode`), or for an old
/// request without one, its former Misty mode mapped to the engine's own. None when the engine
/// doesn't offer such a mode here, which reads as asking.
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

/// What an old request's Misty modes stood for: Plan in a chat, else its Ask, Auto or Bypass.
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

/// The engine layer's launch level for the mode the request names on this engine. Refused when
/// the engine doesn't offer that mode here: an unknown id, or a no-asking mode where the
/// engine's folder sandbox doesn't run.
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
    // An old request without a mode id takes the closest mode offered here.
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

/// What a read-only engine run may use, in the engine's own names: the read tools for Claude Code
/// and CodeBuddy, and Pi's built-in read tools, the only list its adapter accepts.
const CLAUDE_READ_ONLY: &[&str] = &["Read", "Glob", "Grep", "WebFetch", "WebSearch"];
const PI_READ_ONLY: &[&str] = &["read", "grep", "find", "ls"];

/// Whether a run's list (Misty's tool names, `family.*` allowed) lets it run commands. A run that
/// may use the shell can change anything in its folder, so its engine keeps its own tools.
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

/// The engine's own tool list for a run limited to some of Misty's tools (its agent's list), or None when the engine keeps all of its tools. Misty's own tools are held to
/// the list by `tool_policy.rs` whatever the engine; this limits the engine's built-in ones. A
/// list without the shell leaves the engine reading only, which the engine enforces itself (its
/// plan mode and tool whitelist); an engine that can't is refused, never run unlimited.
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

/// The most arguments an agent passes to its engine, and the longest one.
const MAX_ENGINE_ARGS: usize = 24;
const MAX_ENGINE_ARG_LEN: usize = 1000;

/// Options that decide what an engine may do, or how Misty talks to it. Those come only from the
/// run's mode and the engine layer, never from an agent's arguments.
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
/// Single-letter options among those (`-y`, codex's `-a`, `-s`, `-c`, `-p`, claude's `-r`…).
const RESERVED_SHORT: &[char] = &['y', 'a', 's', 'c', 'p', 'r', 'e', 'C'];
/// Words no allowed option has in its name.
const RESERVED_WORDS: &[&str] = &[
    "permission",
    "approv",
    "sandbox",
    "yolo",
    "bypass",
    "dangerous",
    "trust",
];

/// An agent's own arguments for its engine (`engine.args`, from its runtime settings), checked:
/// at most 24, none longer than 1000 characters, no control characters, and no option that
/// changes what the engine may do. Refused whole rather than passed in part.
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

/// The reserved option an argument names, if it does.
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
        // A negative number is a value, not an option.
        if letters.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            return None;
        }
        // `-yolo`-style long options with one dash, and bundled short flags (`-ya`).
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
    // A value can still name a mode on its own (`--foo bypassPermissions`).
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
