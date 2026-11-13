//! One Claude Code plugin up close: what it adds (its skills, commands, agents, hooks and MCP
//! servers), read from its own folder, and turning an installed one on or off with Claude Code's
//! own command. A plugin's folder is its install folder once installed; before that, the copy in
//! its marketplace's clone when it lives there (`./plugins/code-review`). A plugin fetched from a
//! repository of its own has no folder until it is installed, so its contents aren't known yet.

use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

use super::listings::read_json;
use super::parse::valid_id;
use super::{checked_engine, person_window, run_ok, CHANGE_LIMIT};

/// What a plugin adds to its engine, by kind, each by name.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginContents {
    /// Whether its folder was found; without it the lists are empty because they're unknown.
    pub known: bool,
    pub version: Option<String>,
    pub skills: Vec<String>,
    /// Slash commands, as typed: `/review`.
    pub commands: Vec<String>,
    pub agents: Vec<String>,
    /// The events its hooks run on: `SessionStart`, `PreToolUse`.
    pub hooks: Vec<String>,
    pub mcp_servers: Vec<String>,
}

/// Most of any one kind a plugin's contents list; a plugin with more shows the first ones.
const MOST: usize = 200;

/// What a plugin adds. Only Claude Code's plugins have a folder Misty can read; any other
/// engine's answer with nothing known.
#[tauri::command]
pub async fn engine_market_details(
    webview: tauri::Webview,
    engine: String,
    id: String,
) -> Result<PluginContents, String> {
    person_window(&webview)?;
    let engine = checked_engine(&engine)?;
    if engine != "claude" || !valid_id(&id) {
        return Ok(PluginContents::default());
    }
    tokio::task::spawn_blocking(move || {
        let home = crate::engine_config::support::claude_home().join("plugins");
        claude_folder(&home, &id).map_or_else(PluginContents::default, |folder| contents(&folder))
    })
    .await
    .map_err(|_| "Reading the plugin failed.".to_string())
}

/// Turns an installed plugin on or off with Claude Code's own `plugin enable` / `disable`.
#[tauri::command]
pub async fn engine_market_set_enabled(
    webview: tauri::Webview,
    engine: String,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    person_window(&webview)?;
    let engine = checked_engine(&engine)?;
    if engine != "claude" {
        return Err("Only Claude Code can turn its plugins on and off.".into());
    }
    if !valid_id(&id) {
        return Err("That isn't a plugin Misty can change.".into());
    }
    let action = if enabled { "enable" } else { "disable" };
    run_ok(
        engine,
        &["plugin", action, "--json", "--", &id],
        CHANGE_LIMIT,
    )
    .await
    .map(drop)
}

/// A plugin's folder: where Claude Code installed it, else its copy in its marketplace's clone.
pub(super) fn claude_folder(plugins: &Path, id: &str) -> Option<PathBuf> {
    let installed = read_json(&plugins.join("installed_plugins.json")).and_then(|value| {
        value["plugins"][id][0]["installPath"]
            .as_str()
            .map(PathBuf::from)
    });
    if let Some(folder) = installed.filter(|folder| is_dir(folder)) {
        return Some(folder);
    }
    let (name, marketplace) = id.rsplit_once('@')?;
    let known = read_json(&plugins.join("known_marketplaces.json"))?;
    let clone = known[marketplace]["installLocation"]
        .as_str()
        .map(PathBuf::from)
        .unwrap_or_else(|| plugins.join("marketplaces").join(marketplace));
    let catalog = read_json(&clone.join(".claude-plugin").join("marketplace.json"))?;
    let entry = catalog["plugins"]
        .as_array()?
        .iter()
        .find(|plugin| plugin["name"].as_str() == Some(name))?;
    let path = entry["source"].as_str()?.trim_start_matches("./");
    // Inside the clone only: no way out of it, whatever the catalog says.
    if path.is_empty() || path.starts_with('/') || path.split('/').any(|part| part == "..") {
        return None;
    }
    let folder = clone.join(path);
    is_dir(&folder).then_some(folder)
}

fn is_file(path: &Path) -> bool {
    file_access::fs::metadata(path).is_ok_and(|meta| meta.is_file())
}

fn is_dir(path: &Path) -> bool {
    file_access::fs::metadata(path).is_ok_and(|meta| meta.is_dir())
}

/// The names in a folder: each subfolder holding `marker`, or each file ending in `extension`.
fn names(folder: &Path, marker: Option<&str>, extension: Option<&str>) -> Vec<String> {
    let Ok(entries) = file_access::fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut found: Vec<String> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_str()?.to_string();
            if name.starts_with('.') {
                return None;
            }
            match (marker, extension) {
                (Some(marker), _) => is_file(&path.join(marker)).then_some(name),
                (_, Some(extension)) => name
                    .strip_suffix(extension)
                    .filter(|stem| !stem.is_empty() && is_file(&path))
                    .map(str::to_string),
                _ => None,
            }
        })
        .collect();
    found.sort();
    found.truncate(MOST);
    found
}

/// The keys of a JSON object, sorted.
fn keys(value: &Value) -> Vec<String> {
    let mut keys: Vec<String> = value
        .as_object()
        .map(|object| object.keys().cloned().collect())
        .unwrap_or_default();
    keys.sort();
    keys.truncate(MOST);
    keys
}

/// What a plugin folder adds, by the layout Claude Code reads: `skills/<name>/SKILL.md`,
/// `commands/<name>.md`, `agents/<name>.md`, `hooks/hooks.json` and `.mcp.json`, or the same
/// declared in its manifest.
pub(super) fn contents(folder: &Path) -> PluginContents {
    let manifest =
        read_json(&folder.join(".claude-plugin").join("plugin.json")).unwrap_or_default();
    let hooks = match &manifest["hooks"] {
        Value::Object(_) => manifest["hooks"].clone(),
        _ => read_json(&folder.join("hooks").join("hooks.json")).unwrap_or_default(),
    };
    let servers = match &manifest["mcpServers"] {
        Value::Object(_) => manifest["mcpServers"].clone(),
        _ => read_json(&folder.join(".mcp.json"))
            .map(|value| value["mcpServers"].clone())
            .unwrap_or_default(),
    };
    PluginContents {
        known: true,
        version: manifest["version"].as_str().map(str::to_string),
        skills: names(&folder.join("skills"), Some("SKILL.md"), None),
        commands: names(&folder.join("commands"), None, Some(".md"))
            .into_iter()
            .map(|name| format!("/{name}"))
            .collect(),
        agents: names(&folder.join("agents"), None, Some(".md")),
        hooks: keys(&hooks["hooks"]),
        mcp_servers: keys(&servers),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_a_plugin_folder_adds() {
        let root = std::env::temp_dir().join(format!("misty-plugin-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("skills/brainstorming")).unwrap();
        std::fs::write(root.join("skills/brainstorming/SKILL.md"), "---\n").unwrap();
        std::fs::create_dir_all(root.join("skills/notes-only")).unwrap();
        std::fs::create_dir_all(root.join("commands")).unwrap();
        std::fs::write(root.join("commands/review.md"), "").unwrap();
        std::fs::create_dir_all(root.join("hooks")).unwrap();
        std::fs::write(
            root.join("hooks/hooks.json"),
            r#"{"hooks":{"SessionStart":[],"PreToolUse":[]}}"#,
        )
        .unwrap();
        std::fs::write(root.join(".mcp.json"), r#"{"mcpServers":{"context7":{}}}"#).unwrap();
        let found = contents(&root);
        assert!(found.known);
        assert_eq!(found.skills, vec!["brainstorming"]);
        assert_eq!(found.commands, vec!["/review"]);
        assert_eq!(found.hooks, vec!["PreToolUse", "SessionStart"]);
        assert_eq!(found.mcp_servers, vec!["context7"]);
        let _ = std::fs::remove_dir_all(&root);
    }
}
