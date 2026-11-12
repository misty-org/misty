// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// src-tauri/src/config.rs: the engine ids and the launch-time channel lookup. Misty keeps no
// config.json of its own: a third-party channel comes from the provider channel store through
// `engines::channels`, and an engine is never switched off here.

use serde_json::Value;

/// Every engine the layer drives, by id.
pub const ENGINES: [&str; 15] = [
    "claude",
    "kimi",
    "grok",
    "codex",
    "pi",
    "omp",
    "dsh",
    "agy",
    "opencode",
    "qoder",
    "qoder-cn",
    "minimax",
    "codebuddy",
    "gemini",
    "qwen",
];

/// Launch gate. Misty has no disabled pseudo-channel, so every known engine may start.
pub fn ensure_engine_enabled(engine: &str) -> Result<(), String> {
    if ENGINES.contains(&engine) {
        crate::engines::channels::ensure_enabled(engine)
    } else {
        Err(format!("unknown engine: {engine}"))
    }
}

/// The channel one launch uses: the record the person chose for this engine, or None for the
/// engine's own sign-in and files. A session-scoped id is not kept by Misty; the store's
/// current choice applies.
pub(crate) fn resolve_provider(
    engine: &str,
    _provider_id: Option<&str>,
) -> Result<Option<Value>, String> {
    ensure_engine_enabled(engine)?;
    Ok(crate::engines::channels::channel_for(engine))
}
