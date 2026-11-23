use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use super::{misty, row, turn, Command, Context, Output, Row, Section};
use crate::engines::codex_app::denials;
use crate::engines::codex_rpc::{self, RpcError, Session};

mod handoff;
mod hooks;
mod mcp;
mod plugins;
mod settings;
mod status;
mod thread;

use handoff::{desktop_app, feedback, import};
use hooks::hooks;
use mcp::mcp;
use plugins::{apps, plugins};
use settings::{debug_config, experimental, memories, personality};
use status::{status, usage};
use thread::{
    approve, archive, background_terminals, delete, fork, goal, rename, rollout, side,
    stop_background_terminals, subagents,
};

pub const COMMANDS: &[Command] = &[
    turn(
        "compact",
        "Summarize the conversation so far to free context",
    ),
    turn("review", "Review the current changes and find issues").hint("[instructions]"),
    turn(
        "init",
        "Create an AGENTS.md file with instructions for Codex",
    ),
    misty("rename", "Rename this Codex thread").hint("<name>"),
    misty("fork", "Fork this chat into a new Codex thread").hint("[prompt]"),
    misty(
        "side",
        "Ask a side question in a throwaway fork of this chat",
    )
    .hint("<question>"),
    misty(
        "btw",
        "Ask a side question in a throwaway fork of this chat",
    )
    .hint("<question>"),
    misty("archive", "Archive this Codex thread"),
    misty(
        "approve",
        "Approve one retry of the action Codex's auto-review last denied",
    ),
    misty(
        "delete",
        "Permanently delete this Codex thread and its subagents",
    ),
    misty("status", "Show this chat's Codex settings and account"),
    misty("usage", "Show account usage, or use a usage-limit reset")
        .hint("[daily|weekly|cumulative|reset]"),
    misty("mcp", "List MCP servers and their tools").hint("[verbose|reload|login <server>]"),
    misty("goal", "Set or view the goal for a long-running task")
        .hint("[<objective>|clear|pause|resume]"),
    misty("personality", "Choose a communication style for Codex")
        .hint("[none|friendly|pragmatic]"),
    misty("experimental", "List or toggle experimental features").hint("[<feature> on|off]"),
    misty("memories", "Show or change memory use and generation").hint("[on|off|reset]"),
    misty("hooks", "List lifecycle hooks"),
    misty("apps", "List apps"),
    misty("plugins", "Browse, install or remove plugins")
        .hint("[<plugin>|install <plugin>|uninstall <plugin>]"),
    misty(
        "import",
        "Import setup, this project and recent chats from Claude Code",
    )
    .hint("[yes]"),
    misty("feedback", "Send feedback and logs to Codex's maintainers")
        .hint("[bug|bad_result|good_result|safety_check|other] <text>"),
    misty("debug-config", "Show config layers and requirement sources"),
    misty("ps", "List background terminals"),
    misty("stop", "Stop all background terminals"),
    misty("agent", "List this chat's subagent threads"),
    misty("subagents", "List this chat's subagent threads"),
    misty("rollout", "Show where this thread's rollout file is"),
    misty("app", "Open this folder in the Codex desktop app"),
];

const CALL_TIMEOUT: Duration = Duration::from_secs(60);
const SIDE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const IMPORT_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const PAGES: usize = 20;
const APPROVAL_SAVE_TIMEOUT: Duration = Duration::from_secs(10);
const APPROVAL_NOTE: &str = "The user has manually approved a specific action that was previously";

const APP_DIRECTORY: &str = "https://chatgpt.com/apps";
const NO_THREAD: &str = "This chat has no Codex session yet. Send a message first.";
const PERSONALITIES: &[&str] = &["none", "friendly", "pragmatic"];
const FEEDBACK_KINDS: &[&str] = &["bug", "bad_result", "good_result", "safety_check", "other"];
const SUBAGENT_SOURCES: &[&str] = &[
    "subAgent",
    "subAgentThreadSpawn",
    "subAgentReview",
    "subAgentCompact",
    "subAgentOther",
];

pub async fn run(context: Context, name: &str) -> Result<Output, String> {
    match name {
        "rename" => rename(&context).await,
        "fork" => fork(&context).await,
        "side" | "btw" => side(&context, name).await,
        "archive" => archive(&context).await,
        "approve" => approve(&context).await,
        "delete" => delete(&context).await,
        "status" => status(&context).await,
        "usage" => usage(&context).await,
        "mcp" => mcp(&context).await,
        "goal" => goal(&context).await,
        "personality" => personality(&context).await,
        "experimental" => experimental(&context).await,
        "memories" => memories(&context).await,
        "hooks" => hooks(&context).await,
        "apps" => apps(&context).await,
        "plugins" => plugins(&context).await,
        "import" => import(&context).await,
        "feedback" => feedback(&context).await,
        "debug-config" => debug_config(&context).await,
        "ps" => background_terminals(&context).await,
        "stop" => stop_background_terminals(&context).await,
        "agent" | "subagents" => subagents(&context).await,
        "rollout" => rollout(&context).await,
        "app" => desktop_app(&context),
        _ => Err(format!("Misty doesn't run /{name} for Codex.")),
    }
}

async fn open(context: &Context) -> Result<Session, String> {
    let command = codex_rpc::chat_command(context.folder.as_deref())
        .await
        .map_err(text)?;
    Session::start(command, true, CALL_TIMEOUT)
        .await
        .map_err(text)
}

fn text(error: RpcError) -> String {
    error.to_string()
}

async fn call_once(context: &Context, method: &str, params: Value) -> Result<Value, String> {
    let mut rpc = open(context).await?;
    let result = rpc.call(method, params).await.map_err(text);
    rpc.stop().await;
    result
}

async fn on_thread(
    rpc: &mut Session,
    thread: &str,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match rpc.call(method, params.clone()).await {
        Err(error) if error.thread_not_loaded() => {
            rpc.call(
                "thread/resume",
                json!({ "threadId": thread, "excludeTurns": true }),
            )
            .await
            .map_err(text)?;
            rpc.call(method, params).await.map_err(text)
        }
        result => result.map_err(text),
    }
}

async fn on_thread_once(
    context: &Context,
    thread: &str,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let mut rpc = open(context).await?;
    let result = on_thread(&mut rpc, thread, method, params).await;
    rpc.stop().await;
    result
}

async fn loaded_thread(rpc: &mut Session, context: &Context) -> Option<String> {
    let thread = context.session.as_deref()?;
    rpc.call(
        "thread/resume",
        json!({ "threadId": thread, "excludeTurns": true }),
    )
    .await
    .ok()?;
    Some(thread.to_string())
}

async fn all_pages(
    rpc: &mut Session,
    method: &str,
    mut params: Value,
) -> Result<Vec<Value>, String> {
    let mut items = Vec::new();
    for _ in 0..PAGES {
        let page = rpc.call(method, params.clone()).await.map_err(text)?;
        if let Some(data) = page["data"].as_array() {
            items.extend(data.iter().cloned());
        }
        match page["nextCursor"]
            .as_str()
            .filter(|cursor| !cursor.is_empty())
        {
            Some(cursor) => params["cursor"] = json!(cursor),
            None => break,
        }
    }
    Ok(items)
}

fn folder(context: &Context) -> Option<String> {
    context
        .folder
        .as_ref()
        .map(|folder| folder.to_string_lossy().into_owned())
}

fn text_at<'a>(value: &'a Value, pointer: &str) -> Option<&'a str> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
}

fn shown(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(text) if text.trim().is_empty() => None,
        Value::String(text) => Some(text.clone()),
        other => Some(other.to_string()),
    }
}

fn split_first(args: &str) -> (&str, &str) {
    match args.split_once(char::is_whitespace) {
        Some((first, rest)) => (first, rest.trim()),
        None => (args, ""),
    }
}

fn rows_only(rows: Vec<Row>) -> Section {
    Section {
        rows,
        ..Default::default()
    }
}

fn heading_rows(heading: &str, rows: Vec<Row>) -> Section {
    Section {
        heading: Some(heading.to_string()),
        rows,
        text: None,
    }
}

fn text_section(heading: &str, text: String) -> Section {
    Section {
        heading: Some(heading.to_string()),
        rows: Vec::new(),
        text: Some(text),
    }
}

fn title_case(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

fn short(text: &str, limit: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let cut: String = text.chars().take(limit.saturating_sub(1)).collect();
    format!("{}…", cut.trim_end())
}

fn count(number: i64) -> String {
    let digits = number.unsigned_abs().to_string();
    let mut out = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    if number < 0 {
        format!("-{out}")
    } else {
        out
    }
}

fn amount(balance: &str) -> String {
    match balance.parse::<f64>() {
        Ok(value) if value.is_finite() => {
            let cents = (value.abs() * 100.0).round() as i64;
            let sign = if value < 0.0 { "-" } else { "" };
            format!("{sign}{}.{:02}", count(cents / 100), cents % 100)
        }
        _ => balance.to_string(),
    }
}

fn duration(seconds: i64) -> String {
    let (hours, minutes) = (seconds / 3_600, seconds % 3_600 / 60);
    match (hours, minutes) {
        (0, 0) => format!("{seconds}s"),
        (0, minutes) => format!("{minutes}m"),
        (hours, minutes) => format!("{hours}h {minutes}m"),
    }
}

fn local_time(seconds: i64) -> Option<String> {
    let at = chrono::DateTime::from_timestamp(seconds, 0)?;
    Some(
        at.with_timezone(&chrono::Local)
            .format("%b %-d, %H:%M")
            .to_string(),
    )
}

#[cfg(all(test, unix))]
mod live_tests;
