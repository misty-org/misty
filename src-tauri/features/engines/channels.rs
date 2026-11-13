//! Provider channels: a third-party API (GLM, Kimi, DeepSeek, OpenRouter and the like) that an
//! engine is pointed at instead of its own sign-in. The channel store and its keychain entries
//! belong to `engine_config::channels`; the launch path only reads what the person chose there.

use std::collections::HashMap;

use serde_json::Value;

/// What every launch of `engine` adds to its environment whatever the channel: the proxy from
/// Settings › Network, when it is on.
pub fn env_for(engine: &str) -> HashMap<String, String> {
    let _ = engine;
    crate::engine_config::proxy::proxy_env()
}

/// The chosen channel's record for `engine`, secrets included, in desktop-cc-gui's channel shape
/// (`settingsConfig`, `model`, model slots), for the overlays: Claude Code's settings overlay,
/// Codex's config overrides, Grok's isolated config. None when the engine runs on its own
/// sign-in, or when the record can't be read.
pub fn channel_for(engine: &str) -> Option<Value> {
    match crate::engine_config::channels::resolve_provider(engine, None) {
        Ok(provider) => provider,
        Err(error) => {
            eprintln!("[engine channels] {engine}: {error}");
            None
        }
    }
}

/// Refuses a launch while the person has turned `engine` off in Settings › Engines.
pub fn ensure_enabled(engine: &str) -> Result<(), String> {
    crate::engine_config::channels::ensure_engine_enabled(engine)
}
