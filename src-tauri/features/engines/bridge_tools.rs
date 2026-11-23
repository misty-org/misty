use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Instant;

use serde_json::{json, Value};

use super::values::{clip_value, output_text, summary};
use super::{held, runs, send_to, RunView};

pub(super) struct OpenTool {
    pub(super) wire: Option<String>,
    pub(super) name: String,
    pub(super) id: String,
    pub(super) started: Instant,
}

static MCP_CALLS: LazyLock<Mutex<HashMap<String, (String, Value)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
const MCP_CALLS_KEPT: usize = 512;

pub(crate) fn note_mcp_call(wire: &str, name: &str, args: &Value) {
    let mut calls = held(&MCP_CALLS);
    if calls.len() >= MCP_CALLS_KEPT {
        calls.clear();
    }
    calls.insert(wire.to_string(), (name.to_string(), args.clone()));
}

pub(super) fn find_tool(view: &RunView, wire: Option<&str>, name: &str) -> Option<usize> {
    if let Some(wire) = wire {
        if let Some(index) = view
            .tools
            .iter()
            .position(|tool| tool.wire.as_deref() == Some(wire))
        {
            return Some(index);
        }
        return view
            .tools
            .iter()
            .position(|tool| tool.wire.is_none() && !name.is_empty() && tool.name == name);
    }
    view.tools
        .iter()
        .position(|tool| tool.name == name || name.is_empty())
}

pub(super) fn start_tool(run_id: &str, wire: Option<String>, name: &str, args: Option<&Value>) {
    let (id, parent) = {
        let mut held = runs();
        let Some(view) = held.get_mut(run_id) else {
            return;
        };
        if let Some(open) = wire.as_deref().and_then(|wire| {
            view.tools
                .iter()
                .find(|tool| tool.wire.as_deref() == Some(wire))
        }) {
            let id = open.id.clone();
            drop(held);
            if let Some(args) = args {
                detail(run_id, &id, name, args);
            }
            return;
        }
        view.rows += 1;
        view.thinking = false;
        if let Some(wire) = wire.as_deref() {
            MCP_CALLS
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(wire);
        }
        let id = wire
            .clone()
            .unwrap_or_else(|| format!("{run_id}-tool-{}", view.rows));
        view.tools.push(OpenTool {
            wire,
            name: name.to_string(),
            id: id.clone(),
            started: Instant::now(),
        });
        if view.parent.is_none() {
            view.answer.clear();
        }
        (id, view.parent.clone())
    };
    let mut event = json!({ "type": "tool.started", "toolCallId": id, "toolName": name });
    if let Some(parent) = parent {
        event["parentToolCallId"] = json!(parent);
    }
    if let Some(args) = args {
        event["args"] = clip_value(args);
        if let Some(path) = ["file_path", "path", "notebook_path"]
            .iter()
            .find_map(|k| args[*k].as_str())
        {
            event["path"] = json!(path);
        }
    }
    send_to(run_id, event);
    if let Some(args) = args {
        detail(run_id, &id, name, args);
    }
}

pub(super) fn detail(run_id: &str, id: &str, name: &str, args: &Value) {
    let line = summary(args);
    let mut activity = json!({ "input": args });
    if !line.is_empty() {
        activity["detail"] = json!(line);
    }
    send_to(
        run_id,
        json!({ "type": "tool.detail", "toolCallId": id, "toolName": name, "activity": activity }),
    );
}

pub(super) fn close_tool(
    run_id: &str,
    wire: Option<&str>,
    name: &str,
    failed: Option<String>,
    result: Option<&Value>,
) {
    let closed = {
        let mut held = runs();
        let Some(view) = held.get_mut(run_id) else {
            return;
        };
        find_tool(view, wire, name).map(|index| view.tools.remove(index))
    };
    let Some(tool) = closed else {
        if let Some(wire) = wire {
            let noted = held(&MCP_CALLS).remove(wire);
            let (name, args) = match noted {
                Some((name, args)) => (name, Some(args)),
                None if !name.is_empty() => (name.to_string(), None),
                None => ("tool".to_string(), None),
            };
            start_tool(run_id, Some(wire.to_string()), &name, args.as_ref());
            if runs().get(run_id).is_some_and(|view| {
                view.tools
                    .iter()
                    .any(|tool| tool.wire.as_deref() == Some(wire))
            }) {
                close_tool(run_id, Some(wire), &name, failed, result);
            }
        }
        return;
    };
    if let Some(wire) = tool.wire.as_deref() {
        held(&MCP_CALLS).remove(wire);
    }
    let took = tool.started.elapsed().as_millis() as u64;
    match failed {
        Some(error) => send_to(
            run_id,
            json!({
                "type": "tool.failed",
                "toolCallId": tool.id,
                "toolName": tool.name,
                "durationMs": took,
                "error": error,
                "result": result.map(clip_value),
            }),
        ),
        None => send_to(
            run_id,
            json!({
                "type": "tool.completed",
                "toolCallId": tool.id,
                "toolName": tool.name,
                "durationMs": took,
                "result": result.map(clip_value),
            }),
        ),
    }
    if let Some(result) = result {
        let text = output_text(result);
        if !text.is_empty() {
            send_to(
                run_id,
                json!({
                    "type": "tool.detail",
                    "toolCallId": tool.id,
                    "toolName": tool.name,
                    "activity": { "output": text },
                }),
            );
        }
    }
}
