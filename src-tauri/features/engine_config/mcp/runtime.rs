// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

use super::{now_ms, McpRuntimeEntry, McpRuntimeSection};
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Clone)]
struct Snapshot {
    session_id: Option<String>,
    collected_at: i64,
    ended: bool,
    entries: Vec<McpRuntimeEntry>,
}

fn run_workspace() -> &'static parking_lot::Mutex<HashMap<String, String>> {
    static CELL: OnceLock<parking_lot::Mutex<HashMap<String, String>>> = OnceLock::new();
    CELL.get_or_init(|| parking_lot::Mutex::new(HashMap::new()))
}

fn snapshots() -> &'static parking_lot::Mutex<HashMap<String, Snapshot>> {
    static CELL: OnceLock<parking_lot::Mutex<HashMap<String, Snapshot>>> = OnceLock::new();
    CELL.get_or_init(|| parking_lot::Mutex::new(HashMap::new()))
}

pub fn register_run(run_id: &str, workspace: &str) {
    if run_id.is_empty() || workspace.is_empty() {
        return;
    }
    run_workspace()
        .lock()
        .insert(run_id.to_string(), workspace.to_string());
}

pub fn record_from_run(
    run_id: &str,
    session_id: Option<&str>,
    servers: Vec<(String, Option<String>)>,
    tools: Vec<String>,
) {
    let Some(workspace) = run_workspace().lock().get(run_id).cloned() else {
        return;
    };
    let entries: Vec<McpRuntimeEntry> = servers
        .into_iter()
        .map(|(name, status)| {
            let prefix = format!("mcp__{name}__");
            let lowered = prefix.to_lowercase();
            let mut tool_names: Vec<String> = tools
                .iter()
                .filter_map(|tool| {
                    if tool.to_lowercase().starts_with(&lowered) {
                        Some(tool[prefix.len()..].to_string())
                    } else {
                        None
                    }
                })
                .collect();
            tool_names.sort();
            tool_names.dedup();
            McpRuntimeEntry {
                builtin: name == crate::engine_config::mcp::MISTY_SERVER_NAME,
                name,
                status,
                tool_names,
                resources_count: 0,
                templates_count: 0,
            }
        })
        .collect();
    let collected_at = now_ms();
    let mut snapshots = snapshots().lock();
    let replace = snapshots
        .get(&workspace)
        .map(|existing| collected_at >= existing.collected_at)
        .unwrap_or(true);
    if replace {
        snapshots.insert(
            workspace,
            Snapshot {
                session_id: session_id.map(str::to_string),
                collected_at,
                ended: false,
                entries,
            },
        );
    }
}

pub fn mark_run_ended(run_id: &str) {
    let workspace = run_workspace().lock().remove(run_id);
    let Some(workspace) = workspace else {
        return;
    };
    if let Some(snapshot) = snapshots().lock().get_mut(&workspace) {
        if !snapshot.ended {
            snapshot.ended = true;
        }
    }
}

pub(crate) fn claude_section(workspace: Option<&str>) -> McpRuntimeSection {
    let Some(workspace) = workspace else {
        return McpRuntimeSection {
            status: "no_session".to_string(),
            reason: None,
            workspace: None,
            session_id: None,
            collected_at: None,
            entries: Vec::new(),
        };
    };
    match snapshots().lock().get(workspace).cloned() {
        Some(snapshot) => McpRuntimeSection {
            status: if snapshot.ended {
                "session_ended"
            } else {
                "ready"
            }
            .to_string(),
            reason: None,
            workspace: Some(workspace.to_string()),
            session_id: snapshot.session_id,
            collected_at: Some(snapshot.collected_at),
            entries: snapshot.entries,
        },
        None => McpRuntimeSection {
            status: "no_session".to_string(),
            reason: None,
            workspace: Some(workspace.to_string()),
            session_id: None,
            collected_at: None,
            entries: Vec::new(),
        },
    }
}
