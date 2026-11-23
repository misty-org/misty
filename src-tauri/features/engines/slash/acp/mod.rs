use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use serde_json::{json, Value};

use super::{misty, row, turn, Command, Context, Output, Section};
use crate::engines::qoder_session::{
    answer_agent_request, initialize_params, jsonrpc_error_response, jsonrpc_result_response,
    spawn_piped_acp, teardown, AcpLine, SpawnedAcp, JSONRPC_METHOD_NOT_FOUND,
    RPC_HANDSHAKE_TIMEOUT, SESSION_NEW_TIMEOUT, SESSION_RESUME_TIMEOUT,
};
use crate::engines::{BuiltCommand, SendRequest};

mod grok;
mod hermes;
mod out_of_turn;
use grok::{grok_fork, grok_rename, grok_status};
use hermes::{
    hermes_agents, hermes_btw, hermes_reload, hermes_rollback, hermes_save, hermes_save_usage,
};
use out_of_turn::OutOfTurn;

const KIMI: &[Command] = &[
    turn("compact", "Compact the conversation context")
        .hint("<optional custom summarization instructions>"),
    turn("status", "Show current session status"),
    turn("mcp", "Show MCP server status"),
    turn("tasks", "List background tasks"),
    misty("fork", "Fork this session into a new chat").hint("[title]"),
];

const GROK: &[Command] = &[
    turn(
        "compact",
        "Compress conversation history to save context window",
    ),
    turn("context", "Show context window usage and session stats"),
    turn(
        "session-info",
        "Show session details (model, turns, context usage)",
    ),
    misty(
        "status",
        "Show session details (model, turns, context usage)",
    ),
    misty("fork", "Branch the current session into a new chat").hint("[title]"),
    misty("rename", "Rename the current session").hint("<title>"),
];

const MINIMAX: &[Command] = &[
    turn("status", "Show account and model status"),
    turn("doctor", "Check the local config file"),
    turn("context", "Show the Runtime-owned context snapshot"),
    turn("skills", "List built-in and user Skills").hint("[filter]"),
    turn("mcp", "Inspect MCP capabilities and project configuration").hint("[filter]"),
    turn("usage", "Show session usage"),
    turn("compact", "Shorten the active conversation").hint("[instructions]"),
    misty("fork", "Fork this session into a new chat").hint("[title]"),
];

const HERMES: &[Command] = &[
    turn("status", "Show session, model, token, and context info"),
    turn(
        "context",
        "Show detailed context window view with usage gauge, category breakdown, compression stats, and throughput",
    )
    .hint("[all]"),
    turn("usage", "Show token usage and rate limits"),
    turn(
        "compress",
        "Compress conversation context (add 'here [N]' to keep recent N turns; --preview shows what would happen)",
    )
    .hint("[here [N] | focus topic | --preview|--dry-run]"),
    turn("title", "Set a title for the current session").hint("[name]"),
    turn("undo", "Back up N user turns and re-prompt (default 1)").hint("[N]"),
    turn("retry", "Retry the last message (resend to agent)"),
    turn("tools", "List available tools"),
    turn("version", "Show Hermes Agent version"),
    turn(
        "goal",
        "Set a standing goal Hermes works on across turns until achieved",
    )
    .hint("[text | -- <text> | draft <text> | show | gate add <cmd> | pause | resume | clear | status | wait <pid> | unwait]"),
    turn("subgoal", "Add or manage extra criteria on the active goal")
        .hint("[text | remove N | clear]"),
    turn(
        "heartbeat",
        "Set a recurring prompt that re-enters this session when idle",
    )
    .hint("[every <interval> <prompt> | status | pause | resume | clear]"),
    turn("loop", "Re-run a prompt on a recurring interval in this session")
        .hint("[interval] <prompt> [--times N] [--until <condition>] | status | pause | resume | stop"),
    turn(
        "review",
        "Spawn an independent subagent to review the work just discussed (PR, code, docs)",
    )
    .hint("[review instructions]"),
    turn(
        "refine",
        "Review this conversation now and save lessons to memory/skills",
    )
    .hint("[focus instructions]"),
    turn(
        "plan",
        "Write a markdown implementation plan to .hermes/plans/ without executing anything",
    )
    .hint("[task]"),
    turn(
        "moa",
        "Run one prompt through the default Mixture of Agents preset, then restore your model",
    )
    .hint("<prompt>"),
    turn(
        "init",
        "Generate or update AGENTS.md project instructions from a repo scan",
    )
    .hint("[notes]"),
    turn(
        "learn",
        "Learn a reusable skill from anything you describe (dirs, URLs, this chat, notes)",
    )
    .hint("<what to learn from>"),
    turn("insights", "Show usage insights and analytics").hint("[days]"),
    turn(
        "memory",
        "Review pending memory writes / toggle the approval gate",
    )
    .hint("[pending|approve|reject|approval] [id|on|off]"),
    turn("reasoning", "Manage reasoning effort and display")
        .hint("[level|show|hide|full|clamp] [--global]"),
    turn(
        "fast",
        "Fast mode — OpenAI Priority Processing / Anthropic Fast Mode (normal/fast/auto/cold/ultrafast)",
    )
    .hint("[normal|fast|auto|cold|ultrafast|status] [--global]"),
    turn("busy", "Control how messages behave while Hermes is working")
        .hint("[queue|steer|interrupt|status]"),
    turn("personality", "Set a predefined personality").hint("[name]"),
    turn(
        "footer",
        "Toggle gateway runtime-metadata footer on final replies",
    )
    .hint("[on|off|status]"),
    turn(
        "autoprune",
        "Turn automatic pruning of old sessions on or off",
    )
    .hint("[on|off|later|status]"),
    turn(
        "kanban",
        "Multi-profile collaboration board (tasks, links, comments)",
    )
    .hint("[subcommand]"),
    turn(
        "curator",
        "Background skill maintenance (status, run, pin, archive, list-archived)",
    )
    .hint("[subcommand]"),
    turn("blueprint", "Set up an automation from a blueprint template")
        .hint("[name] [slot=value ...]"),
    turn("suggestions", "Review suggested automations (accept/dismiss)"),
    turn(
        "bundles",
        "List skill bundles (aliases /<name> for multiple skills)",
    ),
    turn("whoami", "Show your slash command access (admin / user)"),
    turn("profile", "Show active profile name and home directory"),
    turn(
        "topup",
        "Show your Nous balance and manage billing on the portal",
    ),
    turn(
        "debug",
        "Debug report (versions, config keys, error counts; no log text): shows the privacy notice; /debug upload shares links",
    )
    .hint("[upload|nous upload|local]"),
    turn(
        "codex-runtime",
        "Toggle codex app-server runtime for OpenAI/Codex models",
    )
    .hint("[auto|codex_app_server]"),
    turn("egress", "Show Docker egress proxy status").hint("[status]"),
    misty("fork", "Fork this session into a new chat").hint("[title]"),
    misty(
        "btw",
        "Ask a side question about the current conversation without interrupting it",
    )
    .hint("<question>"),
    misty("bg", "Run a prompt in a separate background session").hint("<prompt>"),
    misty(
        "save",
        "Export the current conversation (bare /save shows usage)",
    )
    .hint("<json|md|html> [filename] [redact]"),
    misty(
        "rollback",
        "List or restore filesystem checkpoints (restores keep your hand-edits; --all overrides)",
    )
    .hint("[number] [--all]"),
    misty("agents", "Show active agents and running tasks"),
    misty("reload-mcp", "Reload MCP servers from config"),
    misty(
        "reload-skills",
        "Re-scan ~/.hermes/skills/ for newly installed or removed skills",
    ),
];

pub fn withheld(engine: &str) -> &'static [&'static str] {
    match engine {
        "grok" => &["always-approve"],
        "hermes" => &["yolo"],
        _ => &[],
    }
}

pub fn commands(engine: &str) -> &'static [Command] {
    match engine {
        "kimi" => KIMI,
        "grok" => GROK,
        "minimax" => MINIMAX,
        "hermes" => HERMES,
        _ => &[],
    }
}

pub async fn run(context: Context, name: &str) -> Result<Output, String> {
    if context.engine == "hermes" {
        match name {
            "reload-mcp" | "reload-skills" => return Ok(hermes_reload(name)),
            "agents" => return hermes_agents(),
            "save" if context.args.is_empty() => return Ok(hermes_save_usage()),
            "btw" if context.args.is_empty() => return Err("Usage: /btw <question>".into()),
            "bg" if context.args.is_empty() => return Err("Usage: /bg <prompt>".into()),
            _ => {}
        }
    }
    let folder = context
        .folder
        .clone()
        .ok_or("Link this chat to a folder first.")?;
    let session = context
        .session
        .clone()
        .ok_or("This chat has no session yet. Send a message first.")?;
    match (context.engine.as_str(), name) {
        ("grok", "fork") => grok_fork(&context, &folder, &session).await,
        ("grok", "rename") => grok_rename(&context, &folder, &session).await,
        ("grok", "status") => grok_status(&context, &folder, &session).await,
        ("kimi" | "minimax" | "hermes", "fork") => {
            fork(&context, &folder, &session, fork_title(&context), None).await
        }
        ("hermes", "bg") => {
            let prompt = Some(context.args.clone());
            fork(&context, &folder, &session, None, prompt).await
        }
        ("hermes", "btw") => hermes_btw(&context, &folder, &session).await,
        ("hermes", "save") => hermes_save(&context, &folder, &session).await,
        ("hermes", "rollback") => hermes_rollback(&context, &folder).await,
        _ => Err(format!("Misty doesn't run /{name} for this engine.")),
    }
}

fn fork_title(context: &Context) -> Option<String> {
    Some(context.args.clone()).filter(|title| !title.is_empty())
}

async fn fork(
    context: &Context,
    folder: &Path,
    session: &str,
    title: Option<String>,
    prompt: Option<String>,
) -> Result<Output, String> {
    let mut live = OutOfTurn::open(context, folder).await?;
    let params = json!({ "sessionId": session, "cwd": live.cwd(), "mcpServers": [] });
    let result = async {
        if !live.can("fork") {
            return Err("This version of the engine can't fork a session.".to_string());
        }
        live.attach(session).await?;
        live.call("session/fork", params, SESSION_NEW_TIMEOUT).await
    }
    .await;
    live.close().await;
    let forked =
        text(&result.map_err(fork_refusal)?, "sessionId").ok_or("The engine forked no session.")?;
    Ok(Output::Fork {
        session: forked,
        title,
        prompt,
    })
}

fn fork_refusal(error: String) -> String {
    if error.contains("message-boundary-not-found") || error.contains("message-boundary-invalid") {
        "MiniMax Code forks a session only after a reply has finished.".into()
    } else {
        error
    }
}

fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn unwrapped(value: &Value) -> &Value {
    value
        .get("result")
        .filter(|result| result.is_object())
        .unwrap_or(value)
}

#[cfg(test)]
mod tests;

#[cfg(test)]
#[path = "live_tests.rs"]
mod live;
