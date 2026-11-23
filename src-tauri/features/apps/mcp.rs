use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex, MutexGuard};

use serde_json::{json, Value};

use super::permissions;

const MAX_TOOLS: usize = 128;
const MAX_DESCRIPTION: usize = 2_000;
const MAX_SCHEMA_BYTES: usize = 16 * 1024;
const MAX_NAME: usize = 64;

#[derive(Clone, Debug)]
struct Tool {
    original: String,
    name: String,
    description: String,
    schema: Value,
    read_only: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Source {
    Frame { session: String, webview: String },
    Program,
    Standby { webview: String },
}

struct Entry {
    app_id: String,
    space_id: Option<String>,
    source: Source,
    tools: Vec<Tool>,
    paid: bool,
    order: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Route {
    pub webview: String,
    pub instance: String,
}

static APPROVED: LazyLock<Mutex<HashSet<(String, String)>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

fn approved() -> MutexGuard<'static, HashSet<(String, String)>> {
    APPROVED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn app_of(internal: &str) -> Option<String> {
    find(internal).map(|(app_id, _)| app_id)
}

pub fn approved_for(chat: &str, internal: &str) -> bool {
    app_of(internal).is_some_and(|app_id| approved().contains(&(chat.to_owned(), app_id)))
}

pub fn approve_for(chat: &str, internal: &str) {
    if let Some(app_id) = app_of(internal) {
        approved().insert((chat.to_owned(), app_id));
    }
}

fn tool_of<'a>(internal: &'a str, app_id: &str) -> Option<&'a str> {
    internal
        .strip_prefix("app.")?
        .strip_prefix(app_id)?
        .strip_prefix('.')
}

pub fn is_paid(internal: &str) -> bool {
    registry()
        .values()
        .any(|entry| entry.paid && tool_of(internal, &entry.app_id).is_some())
}

static REGISTRY: LazyLock<Mutex<HashMap<String, Entry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static ORDER: AtomicU64 = AtomicU64::new(0);

static WITHDRAWN: tokio::sync::Notify = tokio::sync::Notify::const_new();

pub fn withdrawn() -> tokio::sync::futures::Notified<'static> {
    WITHDRAWN.notified()
}

fn tell_withdrawn() {
    WITHDRAWN.notify_waiters();
}

fn registry() -> MutexGuard<'static, HashMap<String, Entry>> {
    REGISTRY
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn next_order() -> u64 {
    ORDER.fetch_add(1, Ordering::Relaxed)
}

fn frame_key(session: &str) -> String {
    format!("frame:{session}")
}

fn standby_key(webview: &str, app_id: &str) -> String {
    format!("standby:{webview}:{app_id}")
}

fn program_key(app_id: &str) -> String {
    format!("program:{app_id}")
}

fn sanitized(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

pub fn internal_name(app_id: &str, tool: &str) -> String {
    format!("app.{app_id}.{tool}")
}

fn wire(app_id: &str, tool: &str) -> String {
    format!("app_{}_{tool}", app_id.replace('-', "_"))
}

fn parse(raw: &Value) -> Result<Tool, String> {
    let original = raw["name"]
        .as_str()
        .filter(|name| !name.is_empty() && name.len() <= MAX_NAME);
    let Some(original) = original else {
        return Err("A tool needs a name of up to 64 characters.".into());
    };
    let schema = raw
        .get("inputSchema")
        .cloned()
        .unwrap_or_else(|| json!({ "type": "object" }));
    if !schema.is_object() || schema.to_string().len() > MAX_SCHEMA_BYTES {
        return Err(format!(
            "The input of {original} must be a small JSON schema."
        ));
    }
    let description: String = raw["description"]
        .as_str()
        .unwrap_or("")
        .chars()
        .take(MAX_DESCRIPTION)
        .collect();
    Ok(Tool {
        original: original.to_owned(),
        name: sanitized(original),
        description,
        schema,
        read_only: raw["annotations"]["readOnlyHint"].as_bool() == Some(true),
    })
}

pub fn register(session: &str, webview: &str, raw_tools: &[Value]) -> Result<usize, String> {
    let (app_id, space) = permissions::identity(session, webview)
        .ok_or_else(|| "This app isn't running.".to_owned())?;
    let tools = parse_all(raw_tools)?;
    let count = tools.len();
    let source = Source::Frame {
        session: session.to_owned(),
        webview: webview.to_owned(),
    };
    let paid = permissions::reaches_paid_host(session, webview);
    let mut registry = registry();
    let order = registry
        .get(&frame_key(session))
        .map_or_else(next_order, |entry| entry.order);
    registry.insert(
        frame_key(session),
        Entry {
            app_id,
            space_id: Some(space),
            source,
            tools,
            paid,
            order,
        },
    );
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

pub fn unregister(session: &str, webview: &str) {
    registry().retain(|_, entry| {
        !matches!(&entry.source, Source::Frame { session: s, webview: w } if s == session && w == webview)
    });
    tell_withdrawn();
}

pub fn has_instance(instance: &str) -> bool {
    instance.is_empty() || registry().contains_key(&frame_key(instance))
}

fn webview_of(source: &Source) -> Option<&str> {
    match source {
        Source::Frame { webview, .. } | Source::Standby { webview } => Some(webview),
        Source::Program => None,
    }
}

pub fn close_window(webview: &str) {
    registry().retain(|_, entry| webview_of(&entry.source) != Some(webview));
    permissions::close_window(webview);
    tell_withdrawn();
}

fn close_unless(open: impl Fn(&str) -> bool, offers: impl Fn(&Entry) -> bool) {
    let gone: HashSet<String> = registry()
        .values()
        .filter(|&entry| offers(entry))
        .filter_map(|entry| webview_of(&entry.source))
        .filter(|&webview| !open(webview))
        .map(str::to_owned)
        .collect();
    for webview in gone {
        close_window(&webview);
    }
}

pub fn forget_closed(open: impl Fn(&str) -> bool) {
    close_unless(open, |_| true);
}

pub fn route_open(
    internal: &str,
    space: Option<&str>,
    open: impl Fn(&str) -> bool,
) -> Result<Route, String> {
    close_unless(open, |entry| tool_of(internal, &entry.app_id).is_some());
    route(internal, space)
}

pub fn register_standby(
    webview: &str,
    app_id: &str,
    space_id: Option<&str>,
    raw_tools: &[Value],
) -> Result<usize, String> {
    if !super::manifest::valid_id(app_id) {
        return Err("That isn't an app id.".into());
    }
    let tools = parse_all(raw_tools)?;
    let count = tools.len();
    registry().insert(
        standby_key(webview, app_id),
        Entry {
            app_id: app_id.to_owned(),
            space_id: space_id.filter(|space| !space.is_empty()).map(str::to_owned),
            source: Source::Standby {
                webview: webview.to_owned(),
            },
            tools,
            paid: false,
            order: next_order(),
        },
    );
    Ok(count)
}

pub fn unregister_standby(webview: &str, app_id: &str) {
    registry().remove(&standby_key(webview, app_id));
    tell_withdrawn();
}

pub(super) fn register_program(app_id: &str, raw_tools: &[Value]) -> Result<usize, String> {
    let tools = parse_all(raw_tools)?;
    let count = tools.len();
    registry().insert(
        program_key(app_id),
        Entry {
            app_id: app_id.to_owned(),
            space_id: None,
            source: Source::Program,
            tools,
            paid: false,
            order: next_order(),
        },
    );
    Ok(count)
}

pub(super) fn unregister_program(app_id: &str) {
    registry().remove(&program_key(app_id));
}

pub fn served_by_program(internal: &str) -> Option<(String, String)> {
    let registry = registry();
    let found = registry.values().find_map(|entry| {
        if entry.source != Source::Program {
            return None;
        }
        let tool = tool_of(internal, &entry.app_id)?;
        entry
            .tools
            .iter()
            .find(|candidate| candidate.name == tool)
            .map(|candidate| (entry.app_id.clone(), candidate.original.clone()))
    });
    found
}

pub fn route(internal: &str, space: Option<&str>) -> Result<Route, String> {
    let space = space.filter(|space| !space.is_empty());
    let registry = registry();
    let mut found: Vec<&Entry> = registry
        .values()
        .filter(|entry| entry.source != Source::Program)
        .filter(|entry| {
            tool_of(internal, &entry.app_id)
                .is_some_and(|tool| entry.tools.iter().any(|candidate| candidate.name == tool))
        })
        .collect();
    match space {
        Some(space) => found.retain(|entry| entry.space_id.as_deref().is_none_or(|own| own == space)),
        None => {
            let spaces: HashSet<&str> = found
                .iter()
                .filter_map(|entry| entry.space_id.as_deref())
                .collect();
            if spaces.len() > 1 {
                return Err("That app is open in more than one Space, so Misty can't tell which one to use. Ask the person which Space they mean.".into());
            }
        }
    }
    found.sort_by_key(|entry| {
        (
            matches!(entry.source, Source::Standby { .. }),
            std::cmp::Reverse(entry.order),
        )
    });
    found
        .first()
        .and_then(|entry| match &entry.source {
            Source::Frame { session, webview } => Some(Route {
                webview: webview.clone(),
                instance: session.clone(),
            }),
            Source::Standby { webview } => Some(Route {
                webview: webview.clone(),
                instance: String::new(),
            }),
            Source::Program => None,
        })
        .ok_or_else(|| "That app isn't open in this agent's Space.".to_owned())
}

pub fn offered() -> Vec<Value> {
    offered_in(None)
}

pub fn offered_in(space: Option<&str>) -> Vec<Value> {
    let space = space.filter(|space| !space.is_empty());
    let registry = registry();
    let mut entries: Vec<&Entry> = registry
        .values()
        .filter(|entry| {
            space.is_none_or(|space| entry.space_id.as_deref().is_none_or(|own| own == space))
        })
        .collect();
    entries.sort_by(|a, b| {
        a.app_id
            .cmp(&b.app_id)
            .then(matches!(a.source, Source::Standby { .. }).cmp(&matches!(b.source, Source::Standby { .. })))
            .then(b.order.cmp(&a.order))
    });
    let mut seen = HashSet::new();
    let mut tools = Vec::new();
    for entry in entries {
        for tool in &entry.tools {
            let name = wire(&entry.app_id, &tool.name);
            if !seen.insert(name.clone()) {
                continue;
            }
            tools.push(json!({
                "name": name,
                "description": format!("[{} app] {}", entry.app_id, tool.description),
                "inputSchema": tool.schema,
                "annotations": { "readOnlyHint": tool.read_only },
            }));
        }
    }
    tools
}

pub fn resolve(wire_name: &str) -> Option<(String, String)> {
    let registry = registry();
    let found = registry.values().find_map(|entry| {
        entry
            .tools
            .iter()
            .find(|tool| wire(&entry.app_id, &tool.name) == wire_name)
            .map(|tool| (internal_name(&entry.app_id, &tool.name), tool.original.clone()))
    });
    found
}

fn find(internal: &str) -> Option<(String, Tool)> {
    let registry = registry();
    let found = registry.values().find_map(|entry| {
        let tool = tool_of(internal, &entry.app_id)?;
        entry
            .tools
            .iter()
            .find(|candidate| candidate.name == tool)
            .map(|candidate| (entry.app_id.clone(), candidate.clone()))
    });
    found
}

pub fn is_registered(internal: &str) -> bool {
    find(internal).is_some()
}

pub fn is_read_only(internal: &str) -> bool {
    find(internal).is_some_and(|(_, tool)| tool.read_only)
}

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
        let offered: Vec<String> = offered()
            .iter()
            .filter_map(|t| t["name"].as_str().map(str::to_owned))
            .collect();
        assert!(
            offered.contains(&"app_mcp_demo_crop".to_owned())
                && offered.contains(&"app_mcp_demo_get_size".to_owned())
        );
        assert_eq!(
            resolve("app_mcp_demo_get_size"),
            Some(("app.mcp-demo.get_size".into(), "get.size".into()))
        );
        assert!(is_registered("app.mcp-demo.crop"));
        assert!(is_read_only("app.mcp-demo.get_size") && !is_read_only("app.mcp-demo.crop"));
        assert_eq!(
            original_name("app.mcp-demo.get_size"),
            Some("get.size".into())
        );
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
        assert!(register(
            &session,
            "w1",
            &[json!({ "name": "a" }), json!({ "name": "a" })]
        )
        .is_err());
        assert!(register(
            &session,
            "w1",
            &[json!({ "name": "a", "inputSchema": "x" })]
        )
        .is_err());
        let many: Vec<Value> = (0..=MAX_TOOLS)
            .map(|i| json!({ "name": format!("t{i}") }))
            .collect();
        assert!(register(&session, "w1", &many).is_err());
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
        assert!(offered()
            .iter()
            .any(|tool| tool["name"] == "app_program_demo_mix_volume"));
        assert_eq!(
            served_by_program("app.program-demo.mix_volume"),
            Some(("program-demo".into(), "mix.volume".into()))
        );
        unregister("some-session", "w1");
        assert!(is_registered("app.program-demo.mix_volume"));
        unregister_program("program-demo");
        assert!(!is_registered("app.program-demo.mix_volume"));
        assert_eq!(served_by_program("app.program-demo.mix_volume"), None);
    }

    #[test]
    fn a_call_goes_to_the_instance_in_the_runs_space() {
        let manifest = AppManifest::parse(
            br#"{"id":"mcp-route","name":"Demo","version":"1.0.0","logo":"l.svg","entry":"i.html","permissions":["files"],"mcp":"frame"}"#,
        )
        .unwrap();
        let here = permissions::open(&manifest, "space-a", "w1", &[Permission::Files]).unwrap();
        let there = permissions::open(&manifest, "space-b", "w2", &[Permission::Files]).unwrap();
        register(&here, "w1", &[json!({ "name": "crop" })]).unwrap();
        register(&there, "w2", &[json!({ "name": "crop" })]).unwrap();
        assert_eq!(
            route("app.mcp-route.crop", Some("space-a")),
            Ok(Route {
                webview: "w1".into(),
                instance: here.clone()
            })
        );
        assert_eq!(
            route("app.mcp-route.crop", Some("space-b")).map(|found| found.webview),
            Ok("w2".into())
        );
        assert!(route("app.mcp-route.crop", Some("space-c")).is_err());
        assert!(route("app.mcp-route.crop", None).is_err());
        assert_eq!(
            offered()
                .iter()
                .filter(|tool| tool["name"] == "app_mcp_route_crop")
                .count(),
            1
        );
        unregister(&there, "w2");
        assert!(!has_instance(&there) && has_instance(&here));
        assert_eq!(
            route("app.mcp-route.crop", None).map(|found| found.instance),
            Ok(here.clone())
        );
        unregister(&here, "w1");
        permissions::close(&here, "w1");
        permissions::close(&there, "w2");
    }

    #[test]
    fn a_closed_window_is_dropped_and_the_call_goes_to_a_live_one() {
        let manifest = AppManifest::parse(
            br#"{"id":"mcp-closed","name":"Demo","version":"1.0.0","logo":"l.svg","entry":"i.html","permissions":["files"],"mcp":"frame"}"#,
        )
        .unwrap();
        let gone = permissions::open(&manifest, "space-a", "closed-w", &[Permission::Files]).unwrap();
        register(&gone, "closed-w", &[json!({ "name": "crop" })]).unwrap();
        register_standby("live-w", "mcp-closed", Some("space-a"), &[json!({ "name": "crop" })])
            .unwrap();
        let open = |label: &str| label == "live-w";
        assert_eq!(
            route_open("app.mcp-closed.crop", Some("space-a"), open),
            Ok(Route {
                webview: "live-w".into(),
                instance: String::new()
            })
        );
        assert!(!has_instance(&gone));
        assert_eq!(permissions::identity(&gone, "closed-w"), None);
        assert!(route_open("app.mcp-closed.crop", Some("space-a"), |_| false).is_err());
        assert!(!is_registered("app.mcp-closed.crop"));
    }

    #[test]
    fn closing_a_window_withdraws_everything_it_offered() {
        let session = session_for("mcp-window", "shut-w");
        register(&session, "shut-w", &[json!({ "name": "crop" })]).unwrap();
        register_standby("shut-w", "mcp-window-standby", None, &[json!({ "name": "trim" })])
            .unwrap();
        close_window("shut-w");
        assert!(!is_registered("app.mcp-window.crop"));
        assert!(!is_registered("app.mcp-window-standby.trim"));
        assert_eq!(permissions::identity(&session, "shut-w"), None);
    }

    #[test]
    fn a_run_is_offered_only_the_tools_of_apps_open_in_its_space() {
        let manifest = AppManifest::parse(
            br#"{"id":"mcp-offer","name":"Demo","version":"1.0.0","logo":"l.svg","entry":"i.html","permissions":["files"],"mcp":"frame"}"#,
        )
        .unwrap();
        let here = permissions::open(&manifest, "space-a", "offer-w", &[Permission::Files]).unwrap();
        register(&here, "offer-w", &[json!({ "name": "crop" })]).unwrap();
        register_program("mcp-offer-program", &[json!({ "name": "mix" })]).unwrap();
        let names = |space| -> Vec<String> {
            offered_in(space)
                .iter()
                .filter_map(|tool| tool["name"].as_str().map(str::to_owned))
                .collect()
        };
        assert!(names(Some("space-a")).contains(&"app_mcp_offer_crop".to_owned()));
        assert!(!names(Some("space-b")).contains(&"app_mcp_offer_crop".to_owned()));
        assert!(names(Some("space-b")).contains(&"app_mcp_offer_program_mix".to_owned()));
        assert!(names(None).contains(&"app_mcp_offer_crop".to_owned()));
        unregister(&here, "offer-w");
        unregister_program("mcp-offer-program");
        permissions::close(&here, "offer-w");
    }

    #[test]
    fn withdrawing_a_window_wakes_whoever_waits_on_it() {
        let session = session_for("mcp-wake", "wake-w");
        register(&session, "wake-w", &[json!({ "name": "crop" })]).unwrap();
        let waiting = withdrawn();
        tokio::pin!(waiting);
        close_window("wake-w");
        assert!(futures_util::FutureExt::now_or_never(waiting.as_mut()).is_some());
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
