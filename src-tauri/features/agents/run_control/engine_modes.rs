//! What an outside engine may do, by the mode its run started with. Native on purpose, beside
//! `tool_policy.rs`: the mode comes from the request the run was started with, never from the
//! renderer at call time, the model or a page.
//!
//! Each of Misty's four modes maps to one permission level the engine layer passes to the
//! engine's own flags (`engines/*.rs`, `build_command` and `host_command`):
//!
//! - Ask: the engine stops before changing files or running a command, and each ask reaches the
//!   person through Misty's gate (`engines/gate.rs`).
//! - Auto: the engine works in its folder without stopping; the asks it still raises are
//!   allowed by the gate.
//! - Plan: the engine's own plan mode where it has a reviewed one; otherwise it runs as in Ask
//!   and the gate refuses every change.
//! - Bypass: the engine's own skip-permissions flag (`--dangerously-skip-permissions`, `-y`,
//!   `--yolo` and the like), chosen by the person. Calls into a Space or the browser still pass
//!   Misty's gate.

use crate::engines::{Engine, PlanApproval};

/// Misty's mode for a run, as the request names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EngineMode {
    Ask,
    Auto,
    Plan,
    Bypass,
}

impl EngineMode {
    /// The run's mode, from the facts its request was started with.
    pub(crate) fn of(facts: &super::tool_policy::RunFacts) -> Self {
        if facts.planning {
            Self::Plan
        } else if facts.bypass {
            Self::Bypass
        } else if facts.auto {
            Self::Auto
        } else {
            Self::Ask
        }
    }

    pub(crate) fn id(self) -> &'static str {
        match self {
            Self::Ask => "ask",
            Self::Auto => "auto",
            Self::Plan => "plan",
            Self::Bypass => "bypass",
        }
    }
}

fn supports(engine: &dyn Engine, level: &str) -> bool {
    engine.supported_permissions().contains(&level)
}

/// Whether the engine has a plan mode of its own that Misty can show for review.
fn reviews_plans(engine: &dyn Engine) -> bool {
    supports(engine, "plan") && !matches!(engine.plan_approval(), PlanApproval::Unavailable { .. })
}

/// The engine layer's permission level for this mode on this engine. Never the skip-permissions
/// level unless the person chose Bypass; a mode the engine can't honor falls to the closest one
/// that asks no less.
pub(crate) fn permission_for(
    engine: &dyn Engine,
    mode: EngineMode,
) -> Result<&'static str, String> {
    let name = crate::engines::engine_name(engine.id());
    match mode {
        EngineMode::Bypass if supports(engine, "bypass") => Ok("bypass"),
        EngineMode::Bypass => Err(format!(
            "{name} has no mode that skips its own permission asks."
        )),
        EngineMode::Plan if reviews_plans(engine) => Ok("plan"),
        EngineMode::Plan | EngineMode::Ask if supports(engine, "manual") => Ok("manual"),
        EngineMode::Plan => Err(format!(
            "{name} can't plan without changing anything. Choose Auto."
        )),
        EngineMode::Auto | EngineMode::Ask if supports(engine, "auto") => Ok("auto"),
        EngineMode::Auto | EngineMode::Ask => Err(format!(
            "{name} runs only in Bypass, where it doesn't stop to ask."
        )),
    }
}

/// The modes the composer offers for this engine.
pub(crate) fn offered(engine: &dyn Engine) -> Vec<&'static str> {
    [
        EngineMode::Ask,
        EngineMode::Auto,
        EngineMode::Plan,
        EngineMode::Bypass,
    ]
    .into_iter()
    .filter(|mode| match mode {
        // Ask is offered only where the engine can actually stop to ask.
        EngineMode::Ask => supports(engine, "manual"),
        other => permission_for(engine, *other).is_ok(),
    })
    .map(EngineMode::id)
    .collect()
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
            return Err("One of this agent's engine arguments is too long or has control characters.".into());
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
            || RESERVED_WORDS.iter().any(|word| letters.to_ascii_lowercase().contains(word))
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
