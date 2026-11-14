//! `/mcps`: connecting, disconnecting and signing in to OpenCode's MCP servers.

use super::status::mcp_state;
use super::*;

/// `/mcps <name> on|off` connects or disconnects one of OpenCode's MCP servers;
/// `/mcps auth <name>` signs in to one.
pub(super) async fn mcp(server: &Server, args: &str) -> Result<Output, String> {
    let words: Vec<&str> = args.split_whitespace().collect();
    match words.as_slice() {
        ["auth", name] => mcp_sign_in(server, name).await,
        [name, switch @ ("on" | "off")] => {
            let action = if *switch == "on" {
                "connect"
            } else {
                "disconnect"
            };
            let segment = path_segment(name);
            server
                .call(
                    Method::POST,
                    &server.path(
                        format!("/mcp/{segment}/{action}"),
                        format!("/api/experimental/mcp/{segment}/{action}"),
                    ),
                    None,
                )
                .await?;
            let state = server
                .get(&server.path("/mcp", "/api/mcp"))
                .await
                .ok()
                .and_then(|all| mcp_status(&all, name))
                .map(|status| mcp_state(name, &status));
            Ok(Output::done(match state {
                Some(state) => format!("{name}: {state}"),
                None if *switch == "on" => format!("Turned {name} on."),
                None => format!("Turned {name} off."),
            }))
        }
        _ => Err("Use /mcps <name> on|off, or /mcps auth <name>.".into()),
    }
}

/// Signs in to an MCP server through OpenCode's own flow (`POST /mcp/:name/auth/authenticate`):
/// OpenCode opens the server's sign-in page in the browser and catches the redirect on its own
/// local callback. That call answers only once the sign-in is done, so it is left running, and
/// only an answer that comes at once (a refusal, or a server signed in already) is shown.
async fn mcp_sign_in(server: &Server, name: &str) -> Result<Output, String> {
    if server.v2 {
        return mcp_sign_in_v2(server, name).await;
    }
    let (origin, directory) = (server.origin.clone(), server.directory.clone());
    let path = format!("/mcp/{}/auth/authenticate", path_segment(name));
    let mut task = tokio::spawn(async move {
        opencode_server::call(
            Method::POST,
            &origin,
            &path,
            directory.as_deref(),
            None,
            SIGN_IN_TIMEOUT,
        )
        .await
    });
    match tokio::time::timeout(SIGN_IN_WAIT, &mut task).await {
        Ok(Ok(Ok(status))) => Ok(Output::done(format!(
            "{name}: {}",
            mcp_state(name, &status)
        ))),
        Ok(Ok(Err(error))) => Err(error),
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => Ok(Output::done(format!(
            "Finish signing in to {name} on the page OpenCode opened in your browser."
        ))),
    }
}

/// A server's status in `GET /mcp`'s answer: 1.x's map by name, 2.x's list of `{name, status}`.
fn mcp_status(all: &Value, name: &str) -> Option<Value> {
    if let Some(list) = data(all).as_array() {
        return list
            .iter()
            .find(|server| text_at(server, "/name") == Some(name))
            .and_then(|server| server.get("status").cloned());
    }
    all.get(name).cloned()
}

/// 2.x signs in to an MCP server through its integration: the server's `integrationID` in
/// `GET /api/mcp`, that integration's OAuth method, and `POST …/connect/oauth`, which gives the
/// page to open. OpenCode catches the redirect itself when the attempt's mode is `auto`.
async fn mcp_sign_in_v2(server: &Server, name: &str) -> Result<Output, String> {
    let all = server.get("/api/mcp").await?;
    let integration = data(&all)
        .as_array()
        .into_iter()
        .flatten()
        .find(|entry| text_at(entry, "/name") == Some(name))
        .ok_or_else(|| format!("OpenCode has no MCP server called {name}."))?
        .get("integrationID")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{name} has no sign-in in OpenCode."))?
        .to_owned();
    let segment = path_segment(&integration);
    let info = server.get(&format!("/api/integration/{segment}")).await?;
    let method = data(&info)
        .get("methods")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|method| text_at(method, "/type") == Some("oauth"))
        .and_then(|method| text_at(method, "/id"))
        .ok_or_else(|| format!("{name} has no browser sign-in in OpenCode."))?
        .to_owned();
    let attempt = server
        .call(
            Method::POST,
            &format!("/api/integration/{segment}/connect/oauth"),
            Some(json!({ "methodID": method })),
        )
        .await?;
    let attempt = data(&attempt);
    let url = text_at(attempt, "/url").ok_or("OpenCode gave no sign-in page")?;
    if text_at(attempt, "/mode") == Some("code") {
        return Err(format!(
            "{name} signs in with a code to paste back, which only OpenCode's terminal app takes: {url}"
        ));
    }
    Ok(Output::open(format!("url:{url}")))
}
