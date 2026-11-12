//! Turning each engine's own plugin listings into one shape. Pure: the CLI's JSON and a way to
//! read a plugin's manifest come in, items come out, so tests run on recorded output.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

/// One plugin an engine's marketplaces offer or already have installed.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MarketItem {
    /// `plugin@marketplace`, what the engine's own install command takes.
    pub id: String,
    pub name: String,
    pub description: String,
    pub engine: String,
    pub marketplace: String,
    pub category: Option<String>,
    pub installed: bool,
    pub enabled: bool,
    /// Installs the engine's marketplace reports, when it reports them.
    pub installs: Option<u64>,
    /// The plugin's repository or home page.
    pub link: Option<String>,
    /// When the plugin signs in to an app of its own: `on_install` or `on_use` (Codex).
    pub sign_in: Option<String>,
    /// The GitHub stars a gallery reports (Gemini's extension gallery).
    pub stars: Option<u64>,
}

/// One marketplace an engine reads plugins from.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MarketSource {
    pub name: String,
    /// Where it comes from: a GitHub repository, a git URL or a folder.
    pub location: String,
}

/// An app connection an engine has under the person's own sign-in.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Connector {
    pub engine: String,
    pub name: String,
    /// `account` (connected on the engine maker's own site, like claude.ai), `plugin` or `config`.
    pub origin: String,
    /// `connected`, `needs_sign_in`, `failed`, `pending` or `off`.
    pub state: String,
}

/// A manifest reader: the plugin folder in, the parsed manifest out.
pub type ReadManifest<'a> = &'a dyn Fn(&Path) -> Option<Value>;

pub(super) fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// `name@marketplace` split in two; an id without `@` has no marketplace.
pub(super) fn split_id(id: &str) -> (String, String) {
    match id.rsplit_once('@') {
        Some((name, marketplace)) => (name.to_string(), marketplace.to_string()),
        None => (id.to_string(), String::new()),
    }
}

/// A web address for a plugin's source: a git URL without `.git`, or a GitHub repository.
pub(super) fn source_link(source: &Value) -> Option<String> {
    let url = text(source, "url")
        .or_else(|| text(source, "repository").map(|repo| format!("https://github.com/{repo}")))?;
    let url = url.trim_end_matches(".git").to_string();
    url.starts_with("https://").then_some(url)
}

/// A readable name from a plugin's id: `google-drive` → `Google drive`.
pub(super) fn readable(name: &str) -> String {
    let spaced = name.replace(['-', '_'], " ");
    let mut chars = spaced.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

// ===== Claude Code =====

/// `claude plugin list --json --available`: `{ installed: [...], available: [...] }`. Installed
/// entries carry no description, so it comes from the plugin's own manifest in its install folder.
pub fn claude_items(listing: &Value, read_manifest: ReadManifest) -> Vec<MarketItem> {
    let mut items: Vec<MarketItem> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for entry in listing["available"].as_array().into_iter().flatten() {
        let Some(id) = text(entry, "pluginId") else {
            continue;
        };
        let (name, marketplace) = split_id(&id);
        let item = MarketItem {
            name: readable(&text(entry, "name").unwrap_or(name)),
            description: text(entry, "description").unwrap_or_default(),
            engine: "claude".into(),
            marketplace: text(entry, "marketplaceName").unwrap_or(marketplace),
            category: text(entry, "category"),
            installed: false,
            enabled: false,
            installs: entry["installCount"].as_u64(),
            link: source_link(&entry["source"]),
            sign_in: None,
            stars: None,
            id: id.clone(),
        };
        index.insert(id, items.len());
        items.push(item);
    }
    for entry in listing["installed"].as_array().into_iter().flatten() {
        let Some(id) = text(entry, "id") else {
            continue;
        };
        let enabled = entry["enabled"].as_bool().unwrap_or(false);
        if let Some(&at) = index.get(&id) {
            items[at].installed = true;
            items[at].enabled = enabled;
            continue;
        }
        let (name, marketplace) = split_id(&id);
        let manifest = text(entry, "installPath")
            .and_then(|path| read_manifest(&Path::new(&path).join(".claude-plugin")));
        let manifest = manifest.unwrap_or(Value::Null);
        index.insert(id.clone(), items.len());
        items.push(MarketItem {
            name: readable(&text(&manifest, "name").unwrap_or(name)),
            description: text(&manifest, "description").unwrap_or_default(),
            engine: "claude".into(),
            marketplace,
            category: None,
            installed: true,
            enabled,
            installs: None,
            link: text(&manifest, "homepage").or_else(|| text(&manifest, "repository")),
            sign_in: None,
            stars: None,
            id,
        });
    }
    items
}

/// `claude plugin marketplace list --json`: a list of `{ name, source, repo | url | path }`.
pub fn claude_sources(listing: &Value) -> Vec<MarketSource> {
    listing
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let name = text(entry, "name")?;
            let location = text(entry, "repo")
                .or_else(|| text(entry, "url"))
                .or_else(|| text(entry, "path"))
                .unwrap_or_default();
            Some(MarketSource { name, location })
        })
        .collect()
}

/// `claude mcp list` prints one line per server: `<name>: <address> - <state>`. Names never hold
/// `": "` (a plugin's servers are `plugin:<plugin>:<server>`), so the first one ends the name.
/// Addresses are left out: a URL can carry a token in its query.
pub fn claude_connectors(output: &str) -> Vec<Connector> {
    output
        .lines()
        .filter_map(|line| {
            let (name, rest) = line.split_once(": ")?;
            let (_, state) = rest.rsplit_once(" - ")?;
            let state = state.trim();
            let state = if state.contains("Connected") {
                "connected"
            } else if state.contains("authentication") {
                "needs_sign_in"
            } else if state.contains("Pending") {
                "pending"
            } else if state.contains("Failed") {
                "failed"
            } else {
                "off"
            };
            let (origin, name) = if let Some(app) = name.strip_prefix("claude.ai ") {
                ("account", app.to_string())
            } else if let Some(rest) = name.strip_prefix("plugin:") {
                let server = rest.rsplit(':').next().unwrap_or(rest);
                ("plugin", readable(server))
            } else {
                ("config", name.to_string())
            };
            Some(Connector {
                engine: "claude".into(),
                name,
                origin: origin.into(),
                state: state.into(),
            })
        })
        .collect()
}

// ===== Codex =====

/// `codex plugin list --json --available`: `{ installed: [...], available: [...] }`, with no
/// descriptions; those come from each plugin's `.codex-plugin/plugin.json`.
pub fn codex_items(listing: &Value, read_manifest: ReadManifest) -> Vec<MarketItem> {
    let mut items = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let entries = listing["installed"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(listing["available"].as_array().into_iter().flatten());
    for entry in entries {
        let Some(id) = text(entry, "pluginId") else {
            continue;
        };
        if !seen.insert(id.clone()) {
            continue;
        }
        let (name, marketplace) = split_id(&id);
        let manifest = text(&entry["source"], "path")
            .and_then(|path| read_manifest(&Path::new(&path).join(".codex-plugin")))
            .unwrap_or(Value::Null);
        let interface = &manifest["interface"];
        let sign_in = match entry["authPolicy"].as_str() {
            Some("ON_INSTALL") => Some("on_install".to_string()),
            Some("ON_USE") => Some("on_use".to_string()),
            _ => None,
        };
        items.push(MarketItem {
            name: text(interface, "displayName").unwrap_or_else(|| readable(&name)),
            description: text(interface, "shortDescription")
                .or_else(|| text(&manifest, "description"))
                .unwrap_or_default(),
            engine: "codex".into(),
            marketplace: text(entry, "marketplaceName").unwrap_or(marketplace),
            category: text(interface, "category"),
            installed: entry["installed"].as_bool().unwrap_or(false),
            enabled: entry["enabled"].as_bool().unwrap_or(false),
            installs: None,
            link: text(interface, "websiteURL")
                .or_else(|| text(&manifest, "homepage"))
                .or_else(|| source_link(&entry["source"])),
            sign_in,
            stars: None,
            id,
        });
    }
    items
}

/// `codex plugin marketplace list --json`: `{ marketplaces: [{ name, root, marketplaceSource }] }`.
pub fn codex_sources(listing: &Value) -> Vec<MarketSource> {
    listing["marketplaces"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let name = text(entry, "name")?;
            let location = text(&entry["marketplaceSource"], "source")
                .or_else(|| text(entry, "root"))
                .unwrap_or_default();
            Some(MarketSource { name, location })
        })
        .collect()
}

// ===== Checks on what reaches a command line =====

/// A plugin id an install or remove may pass on: `name@marketplace`, plain characters only, so it
/// can never read as an option.
pub fn valid_id(id: &str) -> bool {
    let plain = |part: &str| {
        !part.is_empty()
            && !part.starts_with(['-', '.'])
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    match id.split_once('@') {
        Some((name, marketplace)) => plain(name) && plain(marketplace),
        None => false,
    }
}

/// A marketplace name to remove: plain characters only.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with(['-', '.'])
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// A marketplace source to add: an `https://` URL, a GitHub `owner/repo`, or an absolute folder.
/// Nothing that could read as an option or carry spaces.
pub fn valid_source(source: &str) -> bool {
    let source = source.trim();
    if source.is_empty() || source.starts_with('-') || source.chars().any(char::is_whitespace) {
        return false;
    }
    if source.starts_with("https://") {
        return true;
    }
    if Path::new(source).is_absolute() {
        return true;
    }
    let mut parts = source.split('/');
    let (Some(owner), Some(repo), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    valid_name(owner) && valid_name(repo)
}

/// What `claude plugin install --json` asks to be shown before a plugin whose marketplace runs a
/// command of its own is installed: the command and its sha256, which a second run accepts.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShownCommand {
    pub command: String,
    pub sha256: String,
}

/// The last JSON line of a `--json` run.
pub fn last_json_line(output: &str) -> Option<Value> {
    output
        .lines()
        .rev()
        .map(str::trim)
        .filter(|line| line.starts_with('{'))
        .find_map(|line| serde_json::from_str(line).ok())
}

/// The command a Claude install wants shown first, wherever the result line nests it.
pub fn shown_command(result: &Value) -> Option<ShownCommand> {
    fn find(value: &Value) -> Option<&Value> {
        match value {
            Value::Object(map) => map
                .get("shownCommand")
                .or_else(|| map.values().find_map(find)),
            Value::Array(list) => list.iter().find_map(find),
            _ => None,
        }
    }
    let shown = find(result)?;
    let sha256 = text(shown, "sha256")?;
    let command = text(shown, "command")
        .or_else(|| text(shown, "display"))
        .unwrap_or_default();
    Some(ShownCommand { command, sha256 })
}
