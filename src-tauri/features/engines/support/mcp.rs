// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// src-tauri/src/mcp/runtime.rs: what a run reports about the MCP servers its CLI loaded. The
// report store belongs to the engine config feature (`engine_config::mcp::runtime`), which shows
// which servers each CLI actually started; the engines only feed it.

/// Remembers which folder a run works in, for the report its CLI sends later.
pub(crate) fn register_run(run_id: &str, workspace: &str) {
    crate::engine_config::mcp::runtime::register_run(run_id, workspace);
}

/// Keeps what a run's CLI said it loaded (Claude Code's `system/init`).
pub(crate) fn record_from_run(
    run_id: &str,
    session_id: Option<&str>,
    servers: Vec<(String, Option<String>)>,
    tools: Vec<String>,
) {
    crate::engine_config::mcp::runtime::record_from_run(run_id, session_id, servers, tools);
}

/// Forgets the run's folder as it ends.
pub(crate) fn mark_run_ended(run_id: &str) {
    crate::engine_config::mcp::runtime::mark_run_ended(run_id);
}
