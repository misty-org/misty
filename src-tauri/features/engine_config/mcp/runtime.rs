// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

//! The MCP runtime list: what real sessions observed, not guesses.
//!
//! Source: the Claude CLI's `system/init` event (`mcp_servers` plus `tools`). The engines pass it
//! to [`record_from_run`], which keeps a snapshot keyed by workspace with when and from which
//! session it was collected. When the session ends the status only becomes "session ended" and
//! the snapshot stays (the person still sees the last real connections); it never poses as live.
//!
//! Codex has no runtime channel for this: `engine_mcp_inventory` reports it as unsupported and
//! starts no extra CLI.

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

/// Records run → workspace: later events carry only the run id, and the workspace is known at spawn.
pub fn register_run(run_id: &str, workspace: &str) {
    if run_id.is_empty() || workspace.is_empty() {
        return;
    }
    run_workspace()
        .lock()
        .insert(run_id.to_string(), workspace.to_string());
}

/// Records one session's MCP snapshot (claude `system/init`).
pub fn record_from_run(
    run_id: &str,
    session_id: Option<&str>,
    servers: Vec<(String, Option<String>)>,
    tools: Vec<String>,
) {
    let Some(workspace) = run_workspace().lock().get(run_id).cloned() else {
        // A run that was never registered: don't guess the workspace; better to show nothing.
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

/// The session settled (done/error): the snapshot stays but is marked ended; the run is forgotten.
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

/// Claude's runtime section. No workspace, no session and no snapshot each give their own reason.
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
            // Statuses are enumerable; the UI localizes them. `reason` stays
            // for genuinely unexpected diagnostics only.
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
            // The status key carries the explanation; the UI localizes it.
            status: "no_session".to_string(),
            reason: None,
            workspace: Some(workspace.to_string()),
            session_id: None,
            collected_at: None,
            entries: Vec::new(),
        },
    }
}
