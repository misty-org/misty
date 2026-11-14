//! `/mcp`: Codex's MCP servers, listed, and signed in to.

use super::*;

pub(super) async fn mcp(context: &Context) -> Result<Output, String> {
    let args = context.args.trim();
    let (verb, rest) = split_first(args);
    match verb {
        "" | "verbose" => mcp_list(context, verb == "verbose").await,
        "reload" => {
            call_once(context, "config/mcpServer/reload", Value::Null).await?;
            Ok(Output::done(
                "Reloaded the MCP servers from Codex's config.",
            ))
        }
        "login" if !rest.is_empty() => mcp_login(context, rest).await,
        "login" => Err("Write the server's name: /mcp login <server>".into()),
        _ => Err("Use /mcp, /mcp verbose, /mcp reload or /mcp login <server>.".into()),
    }
}

async fn mcp_list(context: &Context, verbose: bool) -> Result<Output, String> {
    let detail = if verbose { "full" } else { "toolsAndAuthOnly" };
    let mut params = json!({ "detail": detail });
    let mut rpc = open(context).await?;
    if let Some(thread) = loaded_thread(&mut rpc, context).await {
        params["threadId"] = json!(thread);
    }
    let listed = all_pages(&mut rpc, "mcpServerStatus/list", params).await;
    rpc.stop().await;
    let servers = listed?;
    if servers.is_empty() {
        return Ok(Output::done("Codex has no MCP servers set up."));
    }
    let tools_of = |server: &Value| -> Vec<(String, String)> {
        let mut tools: Vec<(String, String)> = server["tools"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(name, tool)| {
                let about = text_at(tool, "/description").unwrap_or_default();
                (
                    name.clone(),
                    short(about.lines().next().unwrap_or_default(), 100),
                )
            })
            .collect();
        tools.sort();
        tools
    };
    if !verbose {
        let rows = servers
            .iter()
            .map(|server| {
                let tools = tools_of(server).len();
                row(
                    server["name"].as_str().unwrap_or("server"),
                    format!("{} · {tools} tools", auth_status(server)),
                )
            })
            .collect();
        return Ok(Output::info(
            "MCP servers",
            vec![Section {
                rows,
                text: Some("See every tool with /mcp verbose.".into()),
                ..Default::default()
            }],
        ));
    }
    let sections = servers
        .iter()
        .map(|server| {
            let name = server["name"].as_str().unwrap_or("server");
            let mut rows = vec![row("Sign-in", auth_status(server))];
            if let Some(version) = text_at(server, "/serverInfo/version") {
                rows.push(row("Version", version));
            }
            let resources = server["resources"].as_array().map_or(0, Vec::len);
            if resources > 0 {
                rows.push(row("Resources", resources.to_string()));
            }
            rows.extend(
                tools_of(server)
                    .into_iter()
                    .map(|(tool, about)| row(tool, about)),
            );
            heading_rows(name, rows)
        })
        .collect();
    Ok(Output::info("MCP servers", sections))
}

fn auth_status(server: &Value) -> &'static str {
    match server["authStatus"].as_str() {
        Some("oAuth") => "signed in",
        Some("bearerToken") => "token",
        Some("notLoggedIn") => "signed out",
        Some("unsupported") => "no sign-in",
        _ => "unknown",
    }
}

/// Starts an MCP server's sign-in and opens its page. Codex finishes the sign-in on its own
/// callback, inside this app-server, so the app-server keeps running until the sign-in ends or
/// times out, after Misty has opened the page.
async fn mcp_login(context: &Context, server: &str) -> Result<Output, String> {
    let mut params = json!({ "name": server, "timeoutSecs": LOGIN_TIMEOUT.as_secs() });
    let mut rpc = open(context).await?;
    if let Some(thread) = loaded_thread(&mut rpc, context).await {
        params["threadId"] = json!(thread);
    }
    let started = rpc
        .call("mcpServer/oauth/login", params)
        .await
        .map_err(text);
    let url = started
        .as_ref()
        .ok()
        .and_then(|result| text_at(result, "/authorizationUrl"))
        .map(str::to_string);
    let Some(url) = url else {
        rpc.stop().await;
        return Err(started
            .err()
            .unwrap_or_else(|| "Codex gave no sign-in page for this server.".into()));
    };
    let name = server.to_string();
    tokio::spawn(async move {
        rpc.allow(LOGIN_TIMEOUT);
        while let Ok(message) = rpc.next_notification().await {
            if message["method"].as_str() == Some("mcpServer/oauthLogin/completed")
                && message["params"]["name"].as_str() == Some(name.as_str())
            {
                break;
            }
        }
        rpc.stop().await;
    });
    Ok(Output::open(format!("url:{url}")))
}
