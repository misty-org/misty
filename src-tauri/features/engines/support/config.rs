// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// src-tauri/src/config.rs: the engine ids and the launch-time channel lookup. Misty keeps no
// config.json of its own: a third-party channel comes from the provider channel store through
// `engines::channels`, and an engine is never switched off here.

use serde_json::Value;

pub const ENGINES: [&str; 11] = [
    "claude",
    "kimi",
    "grok",
    "codex",
    "agy",
    "qoder",
    "qoder-cn",
    "minimax",
    "gemini",
    "qwen",
    "hermes",
];

pub fn ensure_engine_enabled(engine: &str) -> Result<(), String> {
    if ENGINES.contains(&engine) {
        crate::engines::channels::ensure_enabled(engine)
    } else {
        Err(format!("unknown engine: {engine}"))
    }
}

pub(crate) fn resolve_provider(
    engine: &str,
    _provider_id: Option<&str>,
) -> Result<Option<Value>, String> {
    ensure_engine_enabled(engine)?;
    Ok(crate::engines::channels::channel_for(engine))
}
