//! The agy commands Misty lists and runs (see `slash/mod.rs`).
//!
//! Antigravity runs over ACP (`agy acp`, `agy.rs`), and its server names the commands and skills
//! it runs from a prompt in `available_commands_update` (`reported.rs`): on 1.5.9 `goal`,
//! `compact`, `schedule`, `browser`, `plan`, `grill-me`, `teamwork`, `learn`, `boost` and the
//! skills (`agy-customizations`, `antigravity-guide`, `run-workflow`, `swarm`, the person's own).
//! The `Runs::Turn` rows here are those, with the descriptions from Antigravity's slash command
//! docs (antigravity.google/docs/slash-commands), so the menu has them before the first run.
//! `/grill-me` is back: its `ask_question` calls reach the person as question cards over ACP.
//!
//! The `Runs::Misty` rows are the ones the terminal app answers itself, without the model, which
//! the ACP server doesn't run (sent there, they'd reach the model as plain text). Misty runs each
//! the way print mode answers it, `agy --print /<name>`, which streams a `result` whose
//! `response` is the answer and makes no model call (checked on 1.5.9: `num_turns` 0, no tokens);
//! `/plugin` is the `agy plugin` subcommand.
//!
//! Left out on purpose: `/btw` (no turn runs between Misty's turns to interject into),
//! `/automation` and `/generative_ui` (the desktop app only), and the terminal app's own
//! `/rename`, `/fork` and `/context`, which work on a conversation store (sqlite with protobuf
//! steps) that isn't documented, so the composer's own versions answer them.

use std::time::Duration;

use serde_json::Value;

use super::{misty, row, turn, Command, Context, Output, Section};

/// How long an out-of-turn print-mode answer may take; each is local or one account lookup.
const LOCAL_TIMEOUT: Duration = Duration::from_secs(90);

pub const COMMANDS: &[Command] = &[
    turn(
        "goal",
        "Keep working on its own until the objective is met, without stopping to confirm",
    )
    .hint("<objective>"),
    turn(
        "boost",
        "Multi-agent deep reasoning for hard bugs, race conditions and algorithms",
    )
    .hint("<task>"),
    turn(
        "teamwork",
        "An agent team for multi-day, repo-scale work such as migrations, after a scoping interview",
    )
    .hint("<objective>"),
    turn(
        "grill-me",
        "Interview you one question at a time to align on a plan",
    )
    .hint("<plan>"),
    turn(
        "run-workflow",
        "Write a reviewable Python script that runs many agents in parallel and in phases",
    )
    .hint("<task>"),
    turn(
        "swarm",
        "Named workers and a verifier split the task and coordinate on a shared board",
    )
    .hint("<task>"),
    turn(
        "learn",
        "Turn this session's corrections into lasting rules or skills, once you approve them",
    )
    .hint("<instruction>"),
    turn(
        "schedule",
        "Run an instruction once on a timer, or on a recurring cron schedule",
    )
    .hint("\"<cron>\" <instruction>"),
    turn(
        "browser",
        "Hand web testing, screenshots and console or network checks to a browser subagent",
    )
    .hint("<task>"),
    turn(
        "agy-customizations",
        "Create, fix or explain rules, skills, plugins, hooks and MCP servers",
    )
    .hint("<request>"),
    turn(
        "antigravity-guide",
        "Answer a question about using Antigravity from its documentation",
    )
    .hint("<question>"),
    misty(
        "plugin",
        "List, install, remove, turn on or turn off Antigravity plugins",
    )
    .hint("list | install <name>@antigravity-plugins-official | uninstall | enable | disable <name>"),
    misty("usage", "Show your model quota usage"),
    misty("credits", "Show your remaining credits and where to buy more"),
    misty("skills", "List Antigravity's skills"),
    misty("agents", "List your custom agents"),
    misty("hooks", "List the hooks set up for tool events"),
    misty("changelog", "Show Antigravity's release notes"),
];

pub async fn run(context: Context, name: &str) -> Result<Output, String> {
    let (title, args): (&str, Vec<String>) = match name {
        "plugin" => {
            let mut args = vec!["plugin".to_string()];
            args.extend(context.args.split_whitespace().map(str::to_string));
            if args.len() == 1 {
                args.push("list".into());
            }
            ("Antigravity plugins", args)
        }
        "usage" => ("Antigravity usage", print_args(name, &context.args)),
        "credits" => ("Antigravity credits", print_args(name, &context.args)),
        "skills" => ("Antigravity skills", print_args(name, &context.args)),
        "agents" => ("Antigravity agents", print_args(name, &context.args)),
        "hooks" => ("Antigravity hooks", print_args(name, &context.args)),
        "changelog" => ("Antigravity changelog", print_args(name, &context.args)),
        _ => {
            return Err(format!(
                "Misty doesn't run /{name} for Antigravity itself; it's sent to Antigravity."
            ))
        }
    };
    let stdout = run_agy(&context, &args).await?;
    if name == "plugin" {
        let text = stdout.trim();
        let text = if text.is_empty() { "Done." } else { text };
        return Ok(Output::info(
            title,
            vec![text_section(format!("```\n{text}\n```"))],
        ));
    }
    let result = stdout
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .find(|line| line["event"] == "result")
        .map(|line| line["result"].clone())
        .ok_or("Antigravity gave no answer.")?;
    shown(title, &result)
}

/// `/name args` as print mode answers it, in plan mode so nothing could be changed.
fn print_args(name: &str, args: &str) -> Vec<String> {
    let prompt = format!("/{name} {args}").trim().to_string();
    [
        "--output-format",
        "stream-json",
        "--mode",
        "plan",
        "--print-timeout",
        "1m",
        "--print",
    ]
    .iter()
    .map(|arg| arg.to_string())
    .chain([prompt])
    .collect()
}

async fn run_agy(context: &Context, args: &[String]) -> Result<String, String> {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = crate::engines::engine_bin(&settings, "agy");
    let mut command = crate::engines::command_for_binary(&bin);
    command.args(args);
    command.current_dir(context.folder.clone().unwrap_or_else(std::env::temp_dir));
    for (key, value) in crate::engine_config::engine_env::env_for("agy").unwrap_or_default() {
        command.env(key, value);
    }
    command.stdin(std::process::Stdio::null());
    command.kill_on_drop(true);
    let output = tokio::time::timeout(LOCAL_TIMEOUT, command.output())
        .await
        .map_err(|_| "Antigravity didn't answer in time.".to_string())?
        .map_err(|error| format!("Couldn't start Antigravity: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    if !output.status.success() && stdout.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let reason = stderr.trim();
        return Err(if reason.is_empty() {
            "Antigravity stopped without an answer.".into()
        } else {
            reason.to_string()
        });
    }
    Ok(stdout)
}

/// A print-mode `result` as facts: its tab-separated lines as rows (`Gemini Models · Weekly
/// Limit Remaining · 98% · …`), the rest as text, and the command's own description.
pub(super) fn shown(title: &str, result: &Value) -> Result<Output, String> {
    let status = result["status"].as_str().unwrap_or("");
    if !status.is_empty() && !status.eq_ignore_ascii_case("success") {
        let error = result["error"]
            .as_str()
            .or_else(|| result["message"].as_str())
            .unwrap_or(status);
        return Err(error.to_string());
    }
    let response = result["response"].as_str().unwrap_or("").trim();
    let mut rows = Vec::new();
    let mut text = Vec::new();
    for line in response.lines() {
        match line.split_once('\t') {
            Some((label, rest)) => {
                let value = rest.split('\t').collect::<Vec<_>>().join(" · ");
                rows.push(row(label.trim(), value.trim()));
            }
            None => text.push(line),
        }
    }
    let data = &result["command"]["data"];
    let mut sections = Vec::new();
    let text = text.join("\n").trim().to_string();
    if !rows.is_empty() || !text.is_empty() {
        sections.push(Section {
            heading: None,
            rows,
            text: (!text.is_empty()).then_some(text),
        });
    } else if data.as_object().is_some_and(|data| {
        data.values()
            .all(|value| value.as_array().is_some_and(Vec::is_empty))
    }) {
        sections.push(text_section("None set up yet.".into()));
    } else if !data.is_null() {
        let pretty = serde_json::to_string_pretty(data).unwrap_or_default();
        sections.push(text_section(format!("```json\n{pretty}\n```")));
    }
    if let Some(about) = data["description"]
        .as_str()
        .filter(|about| !about.is_empty())
    {
        sections.push(text_section(about.to_string()));
    }
    Ok(Output::info(title, sections))
}

fn text_section(text: String) -> Section {
    Section {
        heading: None,
        rows: Vec::new(),
        text: Some(text),
    }
}

#[cfg(test)]
#[path = "agy_tests.rs"]
mod tests;
