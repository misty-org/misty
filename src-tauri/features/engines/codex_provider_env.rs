// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/codex_provider_env.rs.
//! Resolve provider-scoped environment variables for GUI-launched Codex.
//!
//! Finder/Dock launches do not necessarily inherit the user's interactive
//! shell environment. Codex providers name their credential variable through
//! `model_providers.*.env_key`; resolve only those validated names and inject
//! missing values into the Codex child process.

use std::collections::{BTreeSet, HashMap};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use tokio::process::Command;

use super::shell_env::{
    env_has_non_empty_value, is_valid_env_name, login_probe, resolve_from_shell,
};

pub(crate) async fn apply(command: &mut Command) {
    let config_path = crate::engines::codex_home().join("config.toml");
    let contents = tokio::fs::read_to_string(config_path)
        .await
        .unwrap_or_default();
    let mut keys = collect_env_keys(&contents);
    // A channel can introduce an env_key via -c without changing config.toml.
    let args: Vec<_> = command.as_std().get_args().collect();
    for pair in args.windows(2) {
        if pair[0] == "-c" {
            keys.extend(collect_env_keys(&pair[1].to_string_lossy()));
        }
    }
    let missing: Vec<String> = keys
        .into_iter()
        .filter(|key| !env_has_non_empty_value(command, key))
        .collect();
    if missing.is_empty() {
        return;
    }
    // Misty: what the login shell said, for a while. Asking it starts an interactive login
    // shell, which took up to its five-second limit before every Codex message; a variable the
    // shell doesn't have is remembered too, so it isn't asked again each time.
    let mut known = HashMap::new();
    let mut unknown = Vec::new();
    {
        let mut cache = CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        cache.retain(|_, (at, _)| at.elapsed() < CACHE_TTL);
        for key in missing {
            match cache.get(&key) {
                Some((_, value)) => {
                    known.insert(key, value.clone());
                }
                None => unknown.push(key),
            }
        }
    }
    if !unknown.is_empty() {
        let Some(probe) = login_probe() else {
            return;
        };
        if let Some(resolved) = resolve_from_shell(&probe, &unknown).await {
            let now = Instant::now();
            let mut cache = CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            for key in unknown {
                let value = resolved.get(&key).cloned();
                cache.insert(key.clone(), (now, value.clone()));
                known.insert(key, value);
            }
        }
    }
    for (key, value) in known {
        if let Some(value) = value {
            command.env(key, value);
        }
    }
}

/// As long as a warm process keeps what it was started with (`warm.rs`).
const CACHE_TTL: Duration = super::registry::WARM_IDLE;

/// The login shell's answer per variable name: its value, or None when it has none. In memory
/// only, never written or logged.
static CACHE: LazyLock<Mutex<HashMap<String, (Instant, Option<String>)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn collect_env_keys(contents: &str) -> BTreeSet<String> {
    let Ok(value) = toml::from_str::<toml::Value>(contents) else {
        return BTreeSet::new();
    };
    value
        .get("model_providers")
        .and_then(toml::Value::as_table)
        .into_iter()
        .flat_map(|providers| providers.values())
        .filter_map(|provider| provider.get("env_key"))
        .filter_map(toml::Value::as_str)
        .map(str::trim)
        .filter(|key| is_valid_env_name(key))
        .map(ToOwned::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_credentials_never_replace_explicit_child_env() {
        let mut command = Command::new("codex");
        command.env("CCGUI_TEST_CHANNEL_KEY", "channel-key");
        assert!(env_has_non_empty_value(&command, "CCGUI_TEST_CHANNEL_KEY"));
        // An explicit removal is also intentional, not a missing inherited key.
        command.env_remove("CCGUI_TEST_CHANNEL_KEY");
        assert!(env_has_non_empty_value(&command, "CCGUI_TEST_CHANNEL_KEY"));
    }

    #[test]
    fn collects_only_valid_provider_env_keys() {
        let keys = collect_env_keys(
            r#"
[model_providers.a]
env_key = "OPENAI_API_KEY"
[model_providers.b]
env_key = "TEAM_OPENAI_KEY"
[model_providers.c]
env_key = "bad-name"
"#,
        );
        assert_eq!(
            keys.into_iter().collect::<Vec<_>>(),
            ["OPENAI_API_KEY", "TEAM_OPENAI_KEY"]
        );
    }

    #[test]
    fn rejects_injection_like_names() {
        assert!(!is_valid_env_name("OPENAI_API_KEY; touch /tmp/pwned"));
        assert!(!is_valid_env_name("1INVALID"));
        assert!(is_valid_env_name("CUSTOM_RELAY_TOKEN"));
    }
}
