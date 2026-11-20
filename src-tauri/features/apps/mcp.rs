//! The tools of a running app's MCP server, offered to engines through Misty's local MCP server.
//!
//! An app with `mcp: frame` runs its MCP server in its own frame. The page talks to it over the SDK
//! channel, lists its tools and registers them here against the app's session. An app with `mcp: binary`
//! runs it as a program of its maker's on this computer (`program.rs`), which registers its tools here
//! itself, with no page involved. Native code then offers
//! them to an engine as `app_<id>_<tool>` and, on a call, hands the call to the same journal and gate
//! every other tool of a run goes through (`tool_policy::decide`), under the internal name
//! `app.<id>.<tool>`. A tool is allowed without asking only when the app itself marks it read-only,
//! which it can only claim for its own tools. What it answers is data, never instructions.

use std::collections::{HashMap, HashSet};
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

/// Where an app's server runs, and so who answers a call to it.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Source {
    /// In the frame of a running app session; the page answers.
    Frame { session: String, webview: String },
    /// As the maker's own program, which native code runs (`program.rs`).
    Program,
    /// On standby for an added app that isn't open: Misty's screen tools, offered by a window so an agent can
    /// reach the app; the window opens it on the first call and the page answers, as for a frame.
    Standby { webview: String },
}

struct Entry {
    source: Source,
    tools: Vec<Tool>,
    /// The app reaches a host its manifest marks as paid: driving it always asks.
    paid: bool,
}

/// The chats whose person said yes to an agent driving an app, by chat and app id, until Misty quits.
static APPROVED: LazyLock<Mutex<HashSet<(String, String)>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

fn approved() -> MutexGuard<'static, HashSet<(String, String)>> {
    APPROVED.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The app a tool's internal name belongs to, among those offering tools now.
fn app_of(internal: &str) -> Option<String> {
    find(internal).map(|(app_id, _)| app_id)
}

/// Whether the person already said yes, in this chat, to an agent working in the tool's app.
pub fn approved_for(chat: &str, internal: &str) -> bool {
    app_of(internal).is_some_and(|app_id| approved().contains(&(chat.to_owned(), app_id)))
}

/// Remembers a yes to an agent working in the tool's app, for this chat.
pub fn approve_for(chat: &str, internal: &str) {
    if let Some(app_id) = app_of(internal) {
        approved().insert((chat.to_owned(), app_id));
    }
}

/// Whether the tool's app reaches a host its manifest marks as paid.
pub fn is_paid(internal: &str) -> bool {
    let Some(rest) = internal.strip_prefix("app.") else { return false };
    registry()
        .iter()
        .any(|(app_id, entry)| entry.paid && rest.strip_prefix(app_id.as_str()).is_some_and(|tail| tail.starts_with('.')))
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
    let tools = parse_all(raw_tools)?;
    let count = tools.len();
    let source = Source::Frame { session: session.to_owned(), webview: webview.to_owned() };
    let paid = permissions::reaches_paid_host(session, webview);
    registry().insert(app_id, Entry { source, tools, paid });
    Ok(count)
}

fn parse_all(raw_tools: &[Value]) -> Result<Vec<Tool>, String> {
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
    Ok(tools)
}

/// Withdraws what a session offered. Another session's tools of the same app stay.
pub fn unregister(session: &str, webview: &str) {
    registry().retain(|_, entry| {
        !matches!(&entry.source, Source::Frame { session: s, webview: w } if s == session && w == webview)
    });
}

/// Offers an added app's tools on standby from a window, while the app isn't running anywhere: never over a running
/// app's or its program's own.
pub fn register_standby(webview: &str, app_id: &str, raw_tools: &[Value]) -> Result<usize, String> {
    if !super::manifest::valid_id(app_id) {
        return Err("That isn't an app id.".into());
    }
    let tools = parse_all(raw_tools)?;
    let count = tools.len();
    let mut registry = registry();
    if registry.get(app_id).is_some_and(|entry| !matches!(entry.source, Source::Standby { .. })) {
        return Ok(0);
    }
    registry.insert(
        app_id.to_owned(),
        Entry { source: Source::Standby { webview: webview.to_owned() }, tools, paid: false },
    );
    Ok(count)
}

/// Withdraws a window's standby tools for an app.
pub fn unregister_standby(webview: &str, app_id: &str) {
    let mut registry = registry();
    if registry
        .get(app_id)
        .is_some_and(|entry| matches!(&entry.source, Source::Standby { webview: w } if w == webview))
    {
        registry.remove(app_id);
    }
}

/// Offers the tools an app's own program listed (`program.rs`), replacing what the app offered before.
pub(super) fn register_program(app_id: &str, raw_tools: &[Value]) -> Result<usize, String> {
    let tools = parse_all(raw_tools)?;
    let count = tools.len();
    // A program runs confined with no network, so it reaches no paid host.
    registry().insert(app_id.to_owned(), Entry { source: Source::Program, tools, paid: false });
    Ok(count)
}

/// Withdraws an app's program tools. A frame's tools of the same app are left alone.
pub(super) fn unregister_program(app_id: &str) {
    let mut registry = registry();
    if registry.get(app_id).is_some_and(|entry| entry.source == Source::Program) {
        registry.remove(app_id);
    }
}

/// The app and the program's own name for a tool, when native code runs that app's server rather than a page.
pub fn served_by_program(internal: &str) -> Option<(String, String)> {
    let rest = internal.strip_prefix("app.")?;
    let registry = registry();
    let found = registry.iter().find_map(|(app_id, entry)| {
        if entry.source != Source::Program {
            return None;
        }
        let tool = rest.strip_prefix(app_id.as_str())?.strip_prefix('.')?;
        entry.tools.iter().find(|candidate| candidate.name == tool).map(|candidate| (app_id.clone(), candidate.original.clone()))
    });
    found
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
        assert!(!is_registered("app.mcp-demo.missing") && !is_registered("file.read"));
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

    #[test]
    fn a_programs_tools_are_served_natively_and_only_it_withdraws_them() {
        let tools = [json!({ "name": "mix.volume", "description": "Sets a track's volume." })];
        assert_eq!(register_program("program-demo", &tools).unwrap(), 1);
        assert!(offered().iter().any(|tool| tool["name"] == "app_program_demo_mix_volume"));
        assert_eq!(
            served_by_program("app.program-demo.mix_volume"),
            Some(("program-demo".into(), "mix.volume".into()))
        );
        // A page closing a session of the app doesn't take the program's tools down.
        unregister("some-session", "w1");
        assert!(is_registered("app.program-demo.mix_volume"));
        unregister_program("program-demo");
        assert!(!is_registered("app.program-demo.mix_volume"));
        assert_eq!(served_by_program("app.program-demo.mix_volume"), None);
    }

    #[test]
    fn a_frames_tools_are_never_served_natively() {
        let session = session_for("mcp-frame-only", "w1");
        register(&session, "w1", &[json!({ "name": "crop" })]).unwrap();
        assert_eq!(served_by_program("app.mcp-frame-only.crop"), None);
        unregister_program("mcp-frame-only");
        assert!(is_registered("app.mcp-frame-only.crop"));
        unregister(&session, "w1");
        permissions::close(&session, "w1");
    }
}
