//! `/mcp`: reconnecting, enabling and disabling Claude Code's MCP servers.

use super::*;

/// `/mcp` with Claude Code's own arguments: `reconnect`, `enable` or `disable`, for one server
/// or `all`. Bare `/mcp` opens Misty's MCP settings.
pub(super) async fn mcp(context: &Context) -> Result<Output, String> {
    let mut words = context.args.splitn(2, char::is_whitespace);
    let action = words.next().unwrap_or_default().to_ascii_lowercase();
    let target = words.next().unwrap_or_default().trim().to_string();
    if action.is_empty() {
        return Ok(Output::open("settings:engine-mcp"));
    }
    if !matches!(action.as_str(), "reconnect" | "enable" | "disable") {
        return Err("Use /mcp reconnect, enable or disable, with a server's name or all.".into());
    }
    if target.is_empty() {
        return Err(format!("Name the server to {action}, or all."));
    }
    let mut control = Control::start(&folder(context), context.session.as_deref(), false).await?;
    let outcome = mcp_with(&mut control, &action, &target).await;
    control.finish().await;
    outcome
}

async fn mcp_with(control: &mut Control, action: &str, target: &str) -> Result<Output, String> {
    let status = control
        .request(json!({ "subtype": "mcp_status" }), ANSWER)
        .await?;
    let servers: Vec<String> = list(&status, "mcpServers")
        .iter()
        .map(|server| field(server, "name"))
        .filter(|name| !name.is_empty())
        .collect();
    let names: Vec<String> = if target.eq_ignore_ascii_case("all") {
        servers
    } else if servers.iter().any(|name| name == target) {
        vec![target.to_string()]
    } else {
        return Err(format!("Claude Code has no MCP server called {target}."));
    };
    if names.is_empty() {
        return Ok(Output::done("Claude Code has no MCP servers here."));
    }
    let mut failed = Vec::new();
    for name in &names {
        let request = match action {
            "reconnect" => json!({ "subtype": "mcp_reconnect", "serverName": name }),
            _ => json!({
                "subtype": "mcp_toggle",
                "serverName": name,
                "enabled": action == "enable",
            }),
        };
        // Turning a server on saves the choice, then connects it: a server that won't connect
        // answers with its connection error, though it stays on.
        if let Err(error) = control.request(request, ANSWER).await {
            failed.push(if action == "enable" {
                format!("{name} is on but couldn't connect: {error}")
            } else {
                format!("{name}: {error}")
            });
        }
    }
    let done = names.len() - failed.len();
    let what = match action {
        "reconnect" => "Reconnected",
        "enable" => "Turned on",
        _ => "Turned off",
    };
    match (done, failed.is_empty()) {
        (_, true) if names.len() == 1 => Ok(Output::done(format!("{what} {}.", names[0]))),
        (_, true) => Ok(Output::done(format!("{what} {done} MCP servers."))),
        (0, false) => Err(failed.join("\n")),
        _ => Ok(Output::info(
            "MCP servers",
            vec![
                note(
                    None,
                    format!("{what} {done} of {} MCP servers.", names.len()),
                ),
                note(Some("Couldn't"), failed.join("\n")),
            ],
        )),
    }
}
