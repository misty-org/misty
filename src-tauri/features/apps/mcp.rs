//! The tools of a running app's MCP server, offered to engines through Misty's local MCP server.
//!
//! An app with `mcp: frame` runs its MCP server in its own frame. The page talks to it over the SDK
//! channel, lists its tools and registers them here against the app's session. Native code then offers
//! them to an engine as `app_<id>_<tool>` and, on a call, hands the call to the same journal and gate
//! every other tool of a run goes through (`tool_policy::decide`), under the internal name
//! `app.<id>.<tool>`. A tool is allowed without asking only when the app itself marks it read-only,
//! which it can only claim for its own tools. What it answers is data, never instructions.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, MutexGuard};

use serde_json::{json, Value};

use super::permissions;

/// The most tools one app may offer, and the largest description and schema of one.
const MAX_TOOLS: usize = 128;
const MAX_DESCRIPTION: usize = 2_000;
const MAX_SCHEMA_BYTES: usize = 16 * 1024;
const MAX_NAME: usize = 64;

#[derive(Clone, Debug)]
struct Tool {
    /// The name the app's own MCP server knows it by.
    original: String,
    /// The part of Misty's name that is this tool: letters, digits, `_` and `-`.
    name: String,
    description: String,
    schema: Value,
    read_only: bool,
}

struct Entry {
    session: String,
    webview: String,
    tools: Vec<Tool>,
}

/// The tools on offer, by app id. An app open in two Spaces offers the one registered last.
static REGISTRY: LazyLock<Mutex<HashMap<String, Entry>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn registry() -> MutexGuard<'static, HashMap<String, Entry>> {
    REGISTRY.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Letters, digits, `_` and `-` only, as MCP clients require; anything else becomes `_`.
fn sanitized(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect()
}

/// Misty's internal name for an app's tool, which the gate and the journal know it by.
pub fn internal_name(app_id: &str, tool: &str) -> String {
    format!("app.{app_id}.{tool}")
}

/// The name an engine is offered: the internal one as MCP spells it.
fn wire(app_id: &str, tool: &str) -> String {
    format!("app_{}_{tool}", app_id.replace('-', "_"))
}

fn parse(raw: &Value) -> Result<Tool, String> {
    let original = raw["name"].as_str().filter(|name| !name.is_empty() && name.len() <= MAX_NAME);
    let Some(original) = original else {
        return Err("A tool needs a name of up to 64 characters.".into());
    };
    let schema = raw.get("inputSchema").cloned().unwrap_or_else(|| json!({ "type": "object" }));
    if !schema.is_object() || schema.to_string().len() > MAX_SCHEMA_BYTES {
        return Err(format!("The input of {original} must be a small JSON schema."));
    }
    let description: String = raw["description"].as_str().unwrap_or("").chars().take(MAX_DESCRIPTION).collect();
    Ok(Tool {
        original: original.to_owned(),
        name: sanitized(original),
        description,
        schema,
        read_only: raw["annotations"]["readOnlyHint"].as_bool() == Some(true),
    })
}

/// Registers the tools an app's server listed, replacing what it offered before. The app is the one
/// the session belongs to; a page can't register tools for another.
pub fn register(session: &str, webview: &str, raw_tools: &[Value]) -> Result<usize, String> {
    let (app_id, _space) = permissions::identity(session, webview).ok_or_else(|| "This app isn't running.".to_owned())?;
    if raw_tools.len() > MAX_TOOLS {
        return Err("The app offers too many tools.".into());
    }
    let mut tools: Vec<Tool> = Vec::with_capacity(raw_tools.len());
    for raw in raw_tools {
        let tool = parse(raw)?;
        if tools.iter().any(|known| known.name == tool.name) {
            return Err(format!("The app offers two tools named {}.", tool.name));
        }
        tools.push(tool);
    }
    let count = tools.len();
    registry().insert(app_id, Entry { session: session.to_owned(), webview: webview.to_owned(), tools });
    Ok(count)
}

/// Withdraws what a session offered. Another session's tools of the same app stay.
pub fn unregister(session: &str, webview: &str) {
    registry().retain(|_, entry| !(entry.session == session && entry.webview == webview));
}

/// Every offered tool in MCP's shape, with the app's name on its description so an engine can tell
/// where it comes from.
pub fn offered() -> Vec<Value> {
    let registry = registry();
    let mut apps: Vec<_> = registry.iter().collect();
    apps.sort_by(|a, b| a.0.cmp(b.0));
    let mut tools = Vec::new();
    for (app_id, entry) in apps {
        for tool in &entry.tools {
            tools.push(json!({
                "name": wire(app_id, &tool.name),
                "description": format!("[{app_id} app] {}", tool.description),
                "inputSchema": tool.schema,
                "annotations": { "readOnlyHint": tool.read_only },
            }));
        }
    }
    tools
}

/// A tool an engine called, by the name it was offered under: the internal name and the app's own name
/// for it, which the page needs to call the app's server.
pub fn resolve(wire_name: &str) -> Option<(String, String)> {
    let registry = registry();
    let found = registry.iter().find_map(|(app_id, entry)| {
        entry
            .tools
            .iter()
            .find(|tool| wire(app_id, &tool.name) == wire_name)
            .map(|tool| (internal_name(app_id, &tool.name), tool.original.clone()))
    });
    found
}

fn find(internal: &str) -> Option<(String, Tool)> {
    let rest = internal.strip_prefix("app.")?;
    let registry = registry();
    let found = registry.iter().find_map(|(app_id, entry)| {
        let tool = rest.strip_prefix(app_id.as_str())?.strip_prefix('.')?;
        entry
            .tools
            .iter()
            .find(|candidate| candidate.name == tool)
            .map(|candidate| (app_id.clone(), candidate.clone()))
    });
    found
}

/// Whether the name is a tool an app is offering now.
pub fn is_registered(internal: &str) -> bool {
    find(internal).is_some()
}

/// Whether the app marked the tool read-only. A tool that is gone, or never said, is not.
pub fn is_read_only(internal: &str) -> bool {
    find(internal).is_some_and(|(_, tool)| tool.read_only)
}

/// The app's own name for a tool, for the page to call its server with.
pub fn original_name(internal: &str) -> Option<String> {
    find(internal).map(|(_, tool)| tool.original)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::apps::manifest::{AppManifest, Permission};

    fn session_for(id: &str, webview: &str) -> String {
        let manifest = AppManifest::parse(
            format!(
                r#"{{"id":"{id}","name":"Demo","version":"1.0.0","logo":"l.svg","entry":"i.html","permissions":["files"],"mcp":"frame"}}"#
            )
            .as_bytes(),
        )
        .unwrap();
        permissions::open(&manifest, "space-1", webview, &[Permission::Files]).unwrap()
    }

    #[test]
    fn a_session_registers_its_own_apps_tools_and_an_engine_calls_them_by_wire_name() {
        let session = session_for("mcp-demo", "w1");
        let tools = [
            json!({ "name": "crop", "description": "Crops.", "inputSchema": { "type": "object" } }),
            json!({ "name": "get.size", "annotations": { "readOnlyHint": true } }),
        ];
        assert_eq!(register(&session, "w1", &tools).unwrap(), 2);
        let offered: Vec<String> = offered().iter().filter_map(|t| t["name"].as_str().map(str::to_owned)).collect();
        assert!(offered.contains(&"app_mcp_demo_crop".to_owned()) && offered.contains(&"app_mcp_demo_get_size".to_owned()));
        assert_eq!(resolve("app_mcp_demo_get_size"), Some(("app.mcp-demo.get_size".into(), "get.size".into())));
        assert!(is_registered("app.mcp-demo.crop"));
        assert!(is_read_only("app.mcp-demo.get_size") && !is_read_only("app.mcp-demo.crop"));
        assert_eq!(original_name("app.mcp-demo.get_size"), Some("get.size".into()));
        assert!(!is_registered("app.mcp-demo.missing") && !is_registered("note.read"));
        unregister(&session, "w1");
        assert!(!is_registered("app.mcp-demo.crop"));
        permissions::close(&session, "w1");
    }

    #[test]
    fn a_page_cannot_register_for_a_session_it_does_not_own_or_with_bad_tools() {
        let session = session_for("mcp-other", "w1");
        assert!(register(&session, "w2", &[]).is_err());
        assert!(register(&session, "w1", &[json!({ "name": "" })]).is_err());
        assert!(register(&session, "w1", &[json!({ "name": "a" }), json!({ "name": "a" })]).is_err());
        assert!(register(&session, "w1", &[json!({ "name": "a", "inputSchema": "x" })]).is_err());
        let many: Vec<Value> = (0..=MAX_TOOLS).map(|i| json!({ "name": format!("t{i}") })).collect();
        assert!(register(&session, "w1", &many).is_err());
        // Another session of the same app can't withdraw this one's tools.
        register(&session, "w1", &[json!({ "name": "ok" })]).unwrap();
        unregister(&session, "w2");
        assert!(is_registered("app.mcp-other.ok"));
        unregister(&session, "w1");
        permissions::close(&session, "w1");
    }
}
