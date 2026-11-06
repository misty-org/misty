//! What's left after the sandbox's actions. `src-tauri/sandbox/` decides which window can call which
//! command, and Tauri refuses anything no capability allows (docs/plans/app-permissions.md). Tauri's
//! window patterns are prefixes, though, so this also holds each kind of window to its exact label:
//! `window-1-spoof` or a cursor window with a name instead of a number gets nothing.
use crate::infra::profile_windows;

pub fn allows(label: &str) -> bool {
    profile_windows::is_app_window(label) || is_cursor_overlay(label)
}

fn is_cursor_overlay(label: &str) -> bool {
    label
        .strip_prefix("misty-cursor-")
        .and_then(|id| id.parse::<u32>().ok())
        .is_some()
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use super::*;

    const ACTIONS: &str = include_str!("../../sandbox/actions/actions.toml");
    const APP_COMMANDS: &[&str] = include!("../../sandbox/app_commands.in");
    const COMMAND_TABLES: [&str; 2] = [
        include_str!("../app/handlers.rs"),
        include_str!("../app/handlers/more_commands.rs"),
    ];
    const CAPABILITIES: [&str; 8] = [
        include_str!("../../sandbox/capabilities/default.json"),
        include_str!("../../sandbox/capabilities/person-window-actions.json"),
        include_str!("../../sandbox/capabilities/incognito-window-actions.json"),
        include_str!("../../sandbox/capabilities/cursor-companion.json"),
        include_str!("../../sandbox/capabilities/desktop-control.json"),
        include_str!("../../sandbox/capabilities/dictation-pill.json"),
        include_str!("../../sandbox/capabilities/live-subtitles.json"),
        include_str!("../../sandbox/capabilities/kiri.json"),
    ];

    fn capability(identifier: &str) -> serde_json::Value {
        CAPABILITIES
            .iter()
            .map(|raw| serde_json::from_str::<serde_json::Value>(raw).unwrap())
            .find(|capability| capability["identifier"] == identifier)
            .unwrap_or_else(|| panic!("no capability {identifier}"))
    }

    /// Each action set's Tauri permissions, by name, as `actions.toml` lists them.
    fn action_sets() -> BTreeMap<String, Vec<String>> {
        let mut sets = BTreeMap::new();
        let mut current = String::new();
        for line in ACTIONS.lines().map(str::trim) {
            if let Some(name) = line.strip_prefix("identifier = \"") {
                current = name.trim_end_matches('"').to_owned();
                sets.insert(current.clone(), Vec::new());
            } else if let Some(permission) = line.strip_prefix("\"allow-") {
                let permission = permission.trim_end_matches(['"', ',']).replace('-', "_");
                sets.get_mut(&current).unwrap().push(permission);
            }
        }
        sets
    }

    /// The commands a capability's action sets allow.
    fn commands_for(identifier: &str) -> BTreeSet<String> {
        let sets = action_sets();
        capability(identifier)["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|permission| permission.as_str())
            .filter_map(|permission| sets.get(permission))
            .flatten()
            .cloned()
            .collect()
    }

    fn table_commands() -> BTreeSet<String> {
        let mut commands = BTreeSet::new();
        for table in COMMAND_TABLES {
            for line in table.lines().map(str::trim) {
                let Some(path) = line.strip_suffix(',') else {
                    continue;
                };
                if path.contains("::") && path.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == ':') {
                    commands.insert(path.rsplit("::").next().unwrap().to_owned());
                }
            }
        }
        commands
    }

    /// A new command fails here until it's listed and given to an action set, so nothing can be
    /// callable without someone deciding which windows get it.
    #[test]
    fn every_command_is_listed_and_in_exactly_one_action_set() {
        let listed: BTreeSet<String> = APP_COMMANDS.iter().map(|name| (*name).to_owned()).collect();
        assert_eq!(table_commands(), listed, "sandbox/app_commands.in and the command table differ");
        let mut seen = BTreeSet::new();
        for (set, commands) in action_sets() {
            for command in commands {
                assert!(listed.contains(&command), "{set} names unknown command {command}");
                assert!(seen.insert(command.clone()), "{command} is in two action sets");
            }
        }
        assert_eq!(seen, listed, "some commands are in no action set");
    }

    #[test]
    fn a_persons_window_can_do_everything_on_the_list() {
        let listed: BTreeSet<String> = APP_COMMANDS.iter().map(|name| (*name).to_owned()).collect();
        assert_eq!(commands_for("person-window-actions"), listed);
    }

    #[test]
    fn labels_must_be_exact() {
        for label in ["window-1", "incognito-1", "misty-cursor-1", "misty-cursor-4294967295"] {
            assert!(allows(label), "{label}");
        }
        for label in [
            "window-1-spoof",
            "misty-cursor-controls",
            "misty-cursor-",
            "misty-cursor-spoof",
            "misty-browser-a",
            "misty-popup-01951d32-40ac-7000-8000-000000000001",
            "browser-a",
            "render-control",
            "misty-agent-01951d32-40ac-7000-8000-000000000001",
            "misty-main",
            "space-personal",
        ] {
            assert!(!allows(label), "{label}");
        }
    }

    #[test]
    fn cursor_overlays_can_only_read_their_presentation_snapshot() {
        let permissions = capability("cursor-companion")["permissions"].clone();
        let app_commands: Vec<_> = permissions
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|permission| permission.as_str())
            .filter(|permission| {
                permission.starts_with("allow-") || permission.starts_with("action-")
            })
            .collect();
        assert_eq!(app_commands, ["allow-cursor-companion-snapshot"]);
    }

    /// Incognito is entirely local and Misty does nothing with it.
    #[test]
    fn incognito_reaches_no_account_data() {
        let allowed = commands_for("incognito-window-actions");
        assert!(allowed.contains("browser_page_password_fill"));
        for prefix in [
            "agent",
            "profile_records_",
            "profile_tabs_",
            "profile_extensions_",
            "vault_",
            "browser_history",
            "browser_library",
            "cursor_companion_",
            "misty_screen",
            "browser_passwords",
            "browser_site_data",
            "voice_",
            "dictation_",
            "capture_",
            "extensions_",
            "browser_recovery_",
            "api_cache_",
            "browser_import_",
            "model_keys_",
        ] {
            let leaked: Vec<_> = allowed.iter().filter(|command| command.starts_with(prefix)).collect();
            assert!(leaked.is_empty(), "incognito can call {leaked:?}");
        }
    }

    /// Voice and live transcription are a person's own: the commands behind them belong to the voice
    /// set, which an incognito window doesn't have, and each one checks the window again.
    #[test]
    fn voice_sessions_open_only_in_a_persons_window() {
        let sets = action_sets();
        let voice = &sets["action-voice"];
        for command in [
            "agent_runtime_voice_open",
            "agent_runtime_live_open",
            "agent_runtime_session_send",
            "agent_runtime_session_close",
        ] {
            assert!(voice.iter().any(|name| name == command), "{command}");
            assert!(commands_for("person-window-actions").contains(command));
            assert!(!commands_for("incognito-window-actions").contains(command));
        }
        assert!(profile_windows::is_person_window("window-1"));
        assert!(!profile_windows::is_person_window("incognito-1"));
        assert!(!profile_windows::is_person_window("misty-browser-a"));
    }

    /// Capabilities scoped by window would also cover website views attached to that window, and one
    /// with remote URLs would grant commands to websites. Only Kiri's single entry point may reach
    /// them.
    #[test]
    fn capabilities_never_reach_website_views() {
        let website_labels = [
            "misty-browser-a",
            "misty-browser-storage-1",
            "misty-browser-capture-1",
            "render-control",
            // The small window an extension's popup page moves into.
            "misty-popup-01951d32-40ac-7000-8000-000000000001",
        ];
        for raw in CAPABILITIES {
            let capability: serde_json::Value = serde_json::from_str(raw).unwrap();
            let name = capability["identifier"].as_str().unwrap();
            assert!(capability.get("windows").is_none(), "{name} is scoped by window");
            if name == "kiri-pages" {
                assert_eq!(capability["permissions"], serde_json::json!(["kiri:default"]));
                // Extension pages sit in the same views, but under their own schemes, which
                // this list has to leave out for them to reach no command at all.
                assert_eq!(
                    capability["remote"]["urls"],
                    serde_json::json!(["https://*:*", "http://*:*"])
                );
                continue;
            }
            assert!(capability.get("remote").is_none(), "{name} grants remote URLs");
            for pattern in capability["webviews"].as_array().unwrap() {
                let pattern = pattern.as_str().unwrap();
                for label in website_labels {
                    let matches = match pattern.strip_suffix('*') {
                        Some(prefix) => label.starts_with(prefix),
                        None => label == pattern,
                    };
                    assert!(!matches, "{name}: {pattern} covers {label}");
                }
            }
        }
    }
}
