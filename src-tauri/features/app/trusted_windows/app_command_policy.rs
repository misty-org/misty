use crate::browser::app_windows;

pub fn allows(label: &str) -> bool {
    app_windows::is_app_window(label)
        || is_cursor_overlay(label)
        || label == PET_WINDOW
        || label == TUTOR_ASK_WINDOW
}

const PET_WINDOW: &str = "misty-pet";
const TUTOR_ASK_WINDOW: &str = "misty-tutor-ask";

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

    const ACTIONS: &str = include_str!("../../../tauri-permissions/actions/actions.toml");
    const APP_COMMANDS: &[&str] = include!("../../../tauri-permissions/app_commands.in");
    const COMMAND_TABLES: [&str; 2] = [
        include_str!("../handlers.rs"),
        include_str!("../handlers/more_commands.rs"),
    ];
    const CAPABILITIES: [&str; 8] = [
        include_str!("../../../tauri-permissions/capabilities/default.json"),
        include_str!("../../../tauri-permissions/capabilities/person-window-actions.json"),
        include_str!("../../../tauri-permissions/capabilities/cursor-companion.json"),
        include_str!("../../../tauri-permissions/capabilities/desktop-control.json"),
        include_str!("../../../tauri-permissions/capabilities/dictation-pill.json"),
        include_str!("../../../tauri-permissions/capabilities/kiri.json"),
        include_str!("../../../tauri-permissions/capabilities/pet-overlay.json"),
        include_str!("../../../tauri-permissions/capabilities/tutor-ask.json"),
    ];

    fn capability(identifier: &str) -> serde_json::Value {
        CAPABILITIES
            .iter()
            .map(|raw| serde_json::from_str::<serde_json::Value>(raw).unwrap())
            .find(|capability| capability["identifier"] == identifier)
            .unwrap_or_else(|| panic!("no capability {identifier}"))
    }

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
                if path.contains("::")
                    && path
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == ':')
                {
                    commands.insert(path.rsplit("::").next().unwrap().to_owned());
                }
            }
        }
        commands
    }

    #[test]
    fn every_command_is_listed_and_in_exactly_one_action_set() {
        let listed: BTreeSet<String> = APP_COMMANDS.iter().map(|name| (*name).to_owned()).collect();
        assert_eq!(
            table_commands(),
            listed,
            "tauri-permissions/app_commands.in and the command table differ"
        );
        let mut seen = BTreeSet::new();
        for (set, commands) in action_sets() {
            for command in commands {
                assert!(
                    listed.contains(&command),
                    "{set} names unknown command {command}"
                );
                assert!(
                    seen.insert(command.clone()),
                    "{command} is in two action sets"
                );
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
        for label in ["window-1", "misty-cursor-1", "misty-cursor-4294967295"] {
            assert!(allows(label), "{label}");
        }
        for label in [
            "window-1-spoof",
            "incognito-1",
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
    fn cursor_overlays_only_present_and_take_the_pointer_for_misty() {
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
        assert_eq!(
            app_commands,
            [
                "allow-cursor-companion-snapshot",
                "allow-cursor-companion-hit",
                "allow-cursor-companion-ask-open",
                "allow-cursor-companion-ask-dismiss",
                "allow-cursor-companion-ask-shot",
                "allow-cursor-companion-ask-part"
            ]
        );
    }

    #[test]
    fn capabilities_never_reach_website_views() {
        let website_labels = [
            "misty-browser-a",
            "misty-browser-storage-1",
            "misty-browser-capture-1",
            "render-control",
            "misty-popup-01951d32-40ac-7000-8000-000000000001",
        ];
        for raw in CAPABILITIES {
            let capability: serde_json::Value = serde_json::from_str(raw).unwrap();
            let name = capability["identifier"].as_str().unwrap();
            assert!(
                capability.get("windows").is_none(),
                "{name} is scoped by window"
            );
            if name == "kiri-pages" {
                assert_eq!(
                    capability["permissions"],
                    serde_json::json!(["kiri:default"])
                );
                assert_eq!(
                    capability["remote"]["urls"],
                    serde_json::json!(["https://*:*", "http://*:*"])
                );
                continue;
            }
            assert!(
                capability.get("remote").is_none(),
                "{name} grants remote URLs"
            );
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
