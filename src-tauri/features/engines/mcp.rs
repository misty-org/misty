// A local MCP server, so an outside engine can use the Space its chat is in: read and write
// notes, files and threads, and hand browser work to Misty's own agent.
//
// It listens on 127.0.0.1 only, and each run gets its own token for as long as it lasts. Every
// call goes through the same journal and gate as a tool call from Misty's own agent
// (`run_control/local_tools.rs`), with the mode the run started in: nothing here decides what a
// run may do.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use agent_runs::local_tools::{LocalToolCall, LocalToolHost, LocalToolOutcome};
use axum::{
    body::Bytes,
    extract::State as AxumState,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Router,
};
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::OnceCell;

use crate::agents::run_control::local_tools::AppToolHost;

/// The tools Misty's own agent is offered, in MCP's shape already.
const CATALOG: &str = include_str!("../agents/runs/local_prompt/catalog.json");

/// The families of tools that work on a Space. An outside engine brings its own tools for files
/// on disk, the shell and the web; these are what only Misty has.
const SPACE_TOOLS: [&str; 8] = [
    "space.", "note.", "file.", "thread.", "message.", "drawing.", "search.", "item.",
];

const ASK_MISTY: &str = "ask_misty";
const MISTY_WAIT: &str = "misty_wait";

const INSTRUCTIONS: &str = "These tools reach the Misty Space this chat belongs to: its notes, \
files, drawings and threads, shared with the people in it. Save anything worth keeping to the \
Space. To do something on a web page, or anything that needs a signed-in browser, hand it to \
Misty's own agent with ask_misty, which browses in its own page.";

static TOKENS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static PORT: OnceCell<u16> = OnceCell::const_new();

fn tokens() -> std::sync::MutexGuard<'static, HashMap<String, String>> {
    TOKENS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// MCP clients accept only letters, digits, `_` and `-` in a tool's name.
fn wire_name(name: &str) -> String {
    name.replace('.', "_")
}

fn space_tools() -> &'static Vec<Value> {
    static TOOLS: LazyLock<Vec<Value>> = LazyLock::new(|| {
        let catalog: Vec<Value> = serde_json::from_str(CATALOG).unwrap_or_default();
        let mut tools: Vec<Value> = catalog
            .into_iter()
            .filter(|tool| {
                tool["name"]
                    .as_str()
                    .is_some_and(|name| SPACE_TOOLS.iter().any(|family| name.starts_with(family)))
            })
            .map(|tool| {
                json!({
                    "name": wire_name(tool["name"].as_str().unwrap_or("")),
                    "description": tool["description"],
                    "inputSchema": tool["inputSchema"],
                    "annotations": tool["annotations"],
                })
            })
            .collect();
        tools.push(json!({
            "name": ASK_MISTY,
            "description": "Hand a task to Misty's own agent, which has a browser of its own and \
the person's signed-in sites. Use it for anything on a web page. State the finished result fully: \
it does not see this conversation. Waits up to about four minutes, then returns what is still \
running so you can call misty_wait.",
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "required": ["goal"],
                "properties": {
                    "goal": { "type": "string", "minLength": 1, "maxLength": 4000 },
                    "context": {
                        "type": "string",
                        "maxLength": 8000,
                        "description": "Facts, URLs or constraints it needs.",
                    },
                },
            },
        }));
        tools.push(json!({
            "name": MISTY_WAIT,
            "description": "Wait up to about four minutes for work handed to Misty with ask_misty, \
        and return its state and answer.",
            "inputSchema": { "type": "object", "additionalProperties": false, "properties": {} },
        }));
        tools
    });
    &TOOLS
}

/// Misty's own name for a tool an engine called, and the input Misty's tool takes.
fn misty_call(name: &str, arguments: Value) -> Option<(String, Value)> {
    if name == ASK_MISTY {
        let mut task = json!({ "goal": arguments["goal"] });
        if let Some(context) = arguments["context"]
            .as_str()
            .filter(|text| !text.is_empty())
        {
            task["context"] = json!(context);
        }
        return Some((
            "agent.delegate".into(),
            json!({ "tasks": [task], "browser": true }),
        ));
    }
    if name == MISTY_WAIT {
        return Some(("agent.wait".into(), json!({})));
    }
    let catalog: Vec<Value> = serde_json::from_str(CATALOG).unwrap_or_default();
    catalog.iter().find_map(|tool| {
        let known = tool["name"].as_str()?;
        let offered = SPACE_TOOLS.iter().any(|family| known.starts_with(family));
        (offered && wire_name(known) == name).then(|| (known.to_string(), arguments.clone()))
    })
}

fn reply(id: &Value, result: Value) -> Response {
    json_response(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn refusal(id: &Value, code: i64, message: &str) -> Response {
    json_response(json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message },
    }))
}

fn json_response(body: Value) -> Response {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        body.to_string(),
    )
        .into_response()
}

/// Who is calling: a run Misty started on an outside engine, or an agent the person connected.
enum Caller {
    Run(String),
    Connection(super::connections::Connection),
}

impl Caller {
    /// The id the call is journaled and gated under.
    fn run_id(&self) -> String {
        match self {
            Self::Run(run_id) => run_id.clone(),
            Self::Connection(connection) => super::connections::run_id(connection),
        }
    }

    /// A connected agent is offered the Space's tools only: handing work to Misty's own agent
    /// belongs to a chat the person started.
    fn offers(&self, tool: &Value) -> bool {
        matches!(self, Self::Run(_))
            || !matches!(tool["name"].as_str(), Some(ASK_MISTY | MISTY_WAIT))
    }
}

fn caller_of(headers: &HeaderMap) -> Option<Caller> {
    let token = headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")?;
    if let Some(run_id) = tokens().get(token).cloned() {
        return Some(Caller::Run(run_id));
    }
    super::connections::of_token(token).map(Caller::Connection)
}

async fn call_tool(app: &AppHandle, caller: &Caller, params: &Value) -> Value {
    let name = params["name"].as_str().unwrap_or("");
    let offered = caller.offers(&json!({ "name": name }));
    let found = offered
        .then(|| misty_call(name, params["arguments"].clone()))
        .flatten();
    let Some((tool, mut input)) = found else {
        return json!({
            "isError": true,
            "content": [{ "type": "text", "text": format!("There is no tool named {name}.") }],
        });
    };
    // A connection reaches the one Space it was made for, whatever the call names.
    if let Caller::Connection(connection) = caller {
        if !connection.space.is_empty() && input.is_object() && tool != "space.list" {
            input["space"] = json!(connection.space);
        }
    }
    let run_id = caller.run_id();
    let host = AppToolHost { app: app.clone() };
    let outcome = host
        .call(LocalToolCall {
            run_id,
            call_id: format!("mcp_{}", uuid::Uuid::new_v4().simple()),
            turn: 0,
            name: tool,
            input,
        })
        .await;
    match outcome {
        LocalToolOutcome::Result(value) => json!({
            "content": [{ "type": "text", "text": value.to_string() }],
        }),
        LocalToolOutcome::Rejected { code, message } => json!({
            "isError": true,
            "content": [{ "type": "text", "text": format!("{message} ({code})") }],
        }),
    }
}

async fn serve(AxumState(app): AxumState<AppHandle>, headers: HeaderMap, body: Bytes) -> Response {
    let Some(caller) = caller_of(&headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(message) = serde_json::from_slice::<Value>(&body) else {
        return refusal(&Value::Null, -32700, "That isn't JSON.");
    };
    let id = &message["id"];
    // A notification expects no answer.
    if id.is_null() {
        return StatusCode::ACCEPTED.into_response();
    }
    match message["method"].as_str().unwrap_or("") {
        "initialize" => reply(
            id,
            json!({
                "protocolVersion": message["params"]["protocolVersion"]
                    .as_str()
                    .unwrap_or("2025-03-26"),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "misty", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCTIONS,
            }),
        ),
        "ping" => reply(id, json!({})),
        "tools/list" => {
            let tools: Vec<&Value> = space_tools()
                .iter()
                .filter(|tool| caller.offers(tool))
                .collect();
            reply(id, json!({ "tools": tools }))
        }
        "tools/call" => reply(id, call_tool(&app, &caller, &message["params"]).await),
        _ => refusal(id, -32601, "Misty's server doesn't know that method."),
    }
}

/// The port a connected agent's config names, kept the same across launches when it is free.
const USUAL_PORT: u16 = 47600;

async fn port(app: &AppHandle) -> Option<u16> {
    let app = app.clone();
    PORT.get_or_try_init(|| async move {
        let listener = match tokio::net::TcpListener::bind(("127.0.0.1", USUAL_PORT)).await {
            Ok(listener) => listener,
            Err(_) => tokio::net::TcpListener::bind(("127.0.0.1", 0))
                .await
                .map_err(|error| error.to_string())?,
        };
        let port = listener
            .local_addr()
            .map_err(|error| error.to_string())?
            .port();
        let router = Router::new().route("/mcp", post(serve)).with_state(app);
        tauri::async_runtime::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        Ok::<u16, String>(port)
    })
    .await
    .ok()
    .copied()
}

/// The server's address on this computer, starting it if needed.
pub(crate) async fn address(app: &AppHandle) -> Option<String> {
    port(app)
        .await
        .map(|port| format!("http://127.0.0.1:{port}/mcp"))
}

/// The server as an engine's own MCP config names it, with a token only this run holds. Nothing
/// when the server could not start; the turn then goes on without the Space's tools.
pub(crate) async fn servers_for(app: &AppHandle, run_id: &str) -> Option<Value> {
    let url = address(app).await?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    tokens().insert(token.clone(), run_id.to_string());
    Some(json!({
        "misty": {
            "type": "http",
            "url": url,
            "headers": { "Authorization": format!("Bearer {token}") },
        },
    }))
}

/// Ends a run's access, as the run ends.
pub(crate) fn forget(run_id: &str) {
    tokens().retain(|_, run| run != run_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offers_space_tools_under_names_clients_accept() {
        let names: Vec<&str> = space_tools()
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect();
        assert!(names.contains(&"note_read"));
        assert!(names.contains(&ASK_MISTY));
        assert!(names.iter().all(|name| name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')));
        // What an engine already does itself is not offered a second time.
        assert!(!names
            .iter()
            .any(|name| name.starts_with("shell") || name.starts_with("browser")));
    }

    #[test]
    fn maps_a_call_back_to_misty_s_own_tool() {
        assert_eq!(
            misty_call("note_read", json!({ "id": "n1" })),
            Some(("note.read".to_string(), json!({ "id": "n1" })))
        );
        let (tool, input) = misty_call(ASK_MISTY, json!({ "goal": "Book it" })).unwrap();
        assert_eq!(tool, "agent.delegate");
        assert_eq!(input["tasks"][0]["goal"], "Book it");
        assert_eq!(misty_call("shell_run", json!({})), None);
    }
}
