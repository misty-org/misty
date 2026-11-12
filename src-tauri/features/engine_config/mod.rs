// Settings › Engines: what Misty manages of the agent engines themselves, on this computer only.
// Each engine's own MCP servers, a skills hub, a prompt library, plan limits and usage, installing
// and updating the CLIs, provider channels, the network proxy, fonts and a performance panel.
//
// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

use std::collections::HashMap;

pub mod support;

pub mod cc_switch;
pub mod channels;
pub mod cli_lifecycle;
pub mod fonts;
pub mod mcp;
pub mod metrics;
pub mod prompts;
pub mod provider_files;
pub mod provider_models;
pub mod proxy;
pub mod skills_hub;
pub mod usage_limits;
pub mod usage_stats;

/// The environment an engine is started with on top of Misty's own: the provider channel the
/// person chose for it (base URL, key and model variables) and the network proxy from Settings.
/// The engines call this when they spawn a CLI. Keys come from the keychain here and go only into
/// the CLI's environment, which sends them to the channel's provider.
pub fn env_for(engine: &str) -> HashMap<String, String> {
    let mut env = proxy::proxy_env();
    env.extend(channels::channel_env(engine));
    env
}

/// Runs once as the app starts, after the file gate is configured.
pub fn setup(app: &tauri::AppHandle) {
    support::set_app(app);
    support::allow_engine_config_locations();
    skills_hub::allow_skill_targets();
    metrics::init();
}

/// Runs once as the app exits.
pub fn shutdown() {
    metrics::shutdown();
}
