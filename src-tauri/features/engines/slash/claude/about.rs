//! Claude Code itself: `/help`, `/version` and `/doctor`.

use super::*;

async fn initialize(context: &Context) -> Result<Value, String> {
    ask(context, json!({ "subtype": "initialize" })).await
}

/// Claude Code's commands: the ones its `initialize` answer lists (its local commands, skills
/// and plugins' commands), then its terminal app's own that Misty runs (`/status`, `/hooks`,
/// …), which a headless Claude Code doesn't list. `__`-named ones are its internal plumbing.
pub(super) async fn help(context: &Context) -> Result<Output, String> {
    let answer = initialize(context).await?;
    let listed = list(&answer, "commands");
    let rows: Vec<Row> = listed
        .iter()
        .filter(|command| !field(command, "name").starts_with("__"))
        .map(|command| {
            let hint = field(command, "argumentHint");
            let name = format!("/{} {hint}", field(command, "name"));
            row(name.trim_end(), brief(&field(command, "description")))
        })
        .collect();
    let misty_runs: Vec<Row> = COMMANDS
        .iter()
        .filter(|command| command.runs == super::super::Runs::Misty)
        .filter(|command| {
            !listed
                .iter()
                .any(|known| field(known, "name") == command.name)
        })
        .map(|command| {
            let name = match command.argument_hint {
                Some(hint) => format!("/{} {hint}", command.name),
                None => format!("/{}", command.name),
            };
            row(name, command.description)
        })
        .collect();
    let mut sections = vec![section("Claude Code", rows)];
    if !misty_runs.is_empty() {
        sections.push(section("Run by Misty", misty_runs));
    }
    Ok(Output::info("Commands", sections))
}

pub(super) async fn version(context: &Context) -> Result<Output, String> {
    let answer = initialize(context).await?;
    let version = field(&answer, "claude_code_version");
    if version.is_empty() {
        return Err("Claude Code didn't say its version.".into());
    }
    Ok(Output::done(format!("Claude Code {version}")))
}

/// What Claude Code's `/doctor` checks that Misty can read: its status, the MCP servers that
/// failed and the sandbox's missing pieces. Its own `/doctor` is a terminal-bound skill.
pub(super) async fn doctor(context: &Context) -> Result<Output, String> {
    let mut control = Control::start(&folder(context), context.session.as_deref(), false).await?;
    let outcome = doctor_with(&mut control, context.session.as_deref()).await;
    control.finish().await;
    outcome
}

async fn doctor_with(control: &mut Control, session: Option<&str>) -> Result<Output, String> {
    let status = control
        .request(json!({ "subtype": "get_status" }), ANSWER)
        .await?;
    let mut sections = status_sections(&status, session);
    let servers = control
        .request(json!({ "subtype": "mcp_status" }), ANSWER)
        .await?;
    let failed: Vec<Row> = list(&servers, "mcpServers")
        .iter()
        .filter(|server| field(server, "status") == "failed")
        .map(|server| {
            let error = field(server, "error");
            row(
                field(server, "name"),
                if error.is_empty() {
                    "Failed".into()
                } else {
                    error
                },
            )
        })
        .collect();
    if failed.is_empty() {
        sections.push(note(Some("MCP servers"), "None failed."));
    } else {
        sections.push(section("MCP servers that failed", failed));
    }
    let sandbox = control
        .request(json!({ "subtype": "get_sandbox_dialog" }), ANSWER)
        .await?;
    if sandbox.get("supported").and_then(Value::as_bool) == Some(true) {
        let dependencies = sandbox.get("dependencies").unwrap_or(&Value::Null);
        let problems: Vec<String> = list(dependencies, "errors")
            .iter()
            .chain(list(dependencies, "warnings"))
            .map(text)
            .filter(|problem| !problem.is_empty())
            .collect();
        if !problems.is_empty() {
            sections.push(note(Some("Sandbox"), problems.join("\n")));
        }
    }
    Ok(Output::info("Doctor", sections))
}
