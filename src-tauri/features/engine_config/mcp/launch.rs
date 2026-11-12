// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

//! How a server starts: each MCP entry either starts with the session (the default) or on
//! demand.
//!
//! The choice is Misty's own device setting (`mcp_launch_modes` in misty.db), never written into
//! a CLI's config, and only affects the engine processes Misty starts. When a message is sent,
//! [`on_demand_servers`] finds, by the engine's own scope precedence, the entry that really
//! applies for each name, keeps the enabled stdio ones marked on demand, and the engine adapters
//! use their per-run override to start those through the `--mcp-lazy` proxy.

use super::probe::ProbeTarget;
use super::{McpConfigEntry, McpConfigSection, McpError};

pub(crate) const ON_DEMAND: &str = "onDemand";
pub(crate) const EAGER: &str = "eager";

/// Where the launch modes are kept on this device (`misty.db`): entry key to mode.
const MODES_KEY: &str = "mcp_launch_modes";
static MODES_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

fn launch_modes() -> std::collections::HashMap<String, String> {
    crate::engine_config::support::load_value(MODES_KEY)
        .ok()
        .flatten()
        .unwrap_or_default()
}

/// A stdio server for an engine's own MCP config: what the Oh My Pi adapter writes into the
/// workspace's `.omp/mcp.json`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpServerSpec {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// Engines with a per-run override (claude/codebuddy `--mcp-config`, codex `-c`, omp's workspace
/// `.omp/mcp.json`).
pub(crate) fn engine_supports(engine: &str) -> bool {
    matches!(engine, "claude" | "codebuddy" | "codex" | "omp")
}

/// Why an entry can't start on demand, as a code the window turns into words.
pub(crate) fn unsupported_reason(entry: &McpConfigEntry) -> Option<&'static str> {
    if !engine_supports(&entry.engine) {
        return Some("engine");
    }
    if !is_stdio(entry.transport.as_deref(), entry.command.is_some()) {
        return Some("transport");
    }
    // omp's override is written to the workspace `.omp/mcp.json`; an entry that lives in that very
    // file can't be "overridden by name, then restored when the turn ends".
    if entry.source == "omp_project" {
        return Some("workspace_file");
    }
    // As above, omp's only per-run channel is a file in the project: an entry with env would have
    // its env (often tokens) copied in for a whole turn, and `git add -A` would commit it. The env
    // also has to be resolved by OMP itself (names, commands, envPolicy), so the proxy can't set it.
    if entry.engine == "omp" && !entry.env_keys.is_empty() {
        return Some("workspace_env");
    }
    // Codex reads `.codex/config.toml` only in trusted projects; a `-c` override on the command
    // line skips that check and would conjure a server that was never going to run.
    if entry.source == "codex_project" {
        return Some("project_trust");
    }
    // `-c mcp_servers.<name>.…` is a dotted path: a `.` or quote in the name breaks it apart.
    if entry.engine == "codex" && !plain_name(&entry.name) {
        return Some("name");
    }
    None
}

fn plain_name(name: &str) -> bool {
    name.chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
}

fn is_stdio(transport: Option<&str>, has_command: bool) -> bool {
    match transport {
        Some(kind) => matches!(kind, "stdio" | "local"),
        None => has_command,
    }
}

/// The setting's key: the entry id for user scope; project scope adds the resolved workspace in
/// front, so same-named project entries in different workspaces don't affect each other.
pub(crate) fn mode_key(entry_id: &str, scope: &str, workspace: Option<&str>) -> Option<String> {
    if scope != "project" {
        return Some(entry_id.to_string());
    }
    let workspace = workspace?;
    let canonical = file_access::fs::canonicalize(workspace)
        .map(|path| {
            let text = path.to_string_lossy().into_owned();
            // Windows `canonicalize` gives verbatim paths (`\\?\C:\…`); keys use the plain form.
            text.strip_prefix(r"\\?\")
                .map(str::to_string)
                .unwrap_or(text)
        })
        .unwrap_or_else(|_| workspace.to_string());
    Some(format!("{canonical}|{entry_id}"))
}

/// Fills each listed entry in with its launch mode and why it can't change, if it can't.
pub(crate) fn annotate(section: &mut McpConfigSection, workspace: Option<&str>) {
    let modes = launch_modes();
    let shadowed = shadowed_ids(&section.entries);
    for entry in &mut section.entries {
        entry.launch_mode_unsupported = blocked_reason(entry, &shadowed).map(str::to_string);
        let on_demand = mode_key(&entry.id, &entry.scope, workspace)
            .and_then(|key| modes.get(&key))
            .is_some_and(|mode| mode == ON_DEMAND);
        entry.launch_mode = if on_demand { ON_DEMAND } else { EAGER }.to_string();
    }
}

/// Why an entry can't go on demand: its own limits, or a same-named entry hiding it.
fn blocked_reason(
    entry: &McpConfigEntry,
    shadowed: &std::collections::HashSet<String>,
) -> Option<&'static str> {
    unsupported_reason(entry).or_else(|| shadowed.contains(&entry.id).then_some("shadowed"))
}

/// Writes one launch mode. `eager` removes the key (the default is to start with the session).
/// `entries` is the full list from the same read, to tell whether a same-named entry hides it
/// (the same rule as the list).
pub(crate) fn write_mode(
    entry: &McpConfigEntry,
    entries: &[McpConfigEntry],
    mode: &str,
    workspace: Option<&str>,
) -> Result<(), McpError> {
    if mode != ON_DEMAND && mode != EAGER {
        return Err(McpError::invalid(format!("unknown launch mode: {mode}")));
    }
    if mode == ON_DEMAND {
        if let Some(code) = blocked_reason(entry, &shadowed_ids(entries)) {
            return Err(McpError::new(
                "unsupported",
                format!("launch mode unsupported: {code}"),
            ));
        }
    }
    let key = mode_key(&entry.id, &entry.scope, workspace)
        .ok_or_else(|| McpError::invalid("project MCP entries need a workspace"))?;
    let _guard = MODES_LOCK.lock();
    let mut modes = launch_modes();
    if mode == ON_DEMAND {
        modes.insert(key, ON_DEMAND.to_string());
    } else {
        modes.remove(&key);
    }
    crate::engine_config::support::save_value(MODES_KEY, &modes).map_err(McpError::internal)
}

/// Entries hidden by a same-named entry of the same engine with higher precedence: the engine
/// starts only the one that applies, so putting this one on demand would do nothing (the same
/// rule [`on_demand_servers`] picks winners by).
fn shadowed_ids(entries: &[McpConfigEntry]) -> std::collections::HashSet<String> {
    let mut best: std::collections::HashMap<(&str, &str), u8> = Default::default();
    for entry in entries {
        let rank = rank(&entry.engine, &entry.source);
        best.entry((entry.engine.as_str(), entry.name.as_str()))
            .and_modify(|current| *current = (*current).min(rank))
            .or_insert(rank);
    }
    entries
        .iter()
        .filter(|entry| {
            best.get(&(entry.engine.as_str(), entry.name.as_str()))
                .is_some_and(|winner| *winner < rank(&entry.engine, &entry.source))
        })
        .map(|entry| entry.id.clone())
        .collect()
}

/// Scope precedence (the lower number wins). Of same-named entries the engine starts only one.
fn rank(engine: &str, source: &str) -> u8 {
    let scope = source.rsplit('_').next().unwrap_or_default();
    match (engine, scope) {
        // Claude Code: local > project > user (code.claude.com/docs/en/mcp, "Scope hierarchy and
        // precedence"); CodeBuddy uses the same file layout.
        ("claude" | "codebuddy", "local") => 0,
        ("claude" | "codebuddy", "project") => 1,
        (_, "project") => 1,
        _ => 2,
    }
}

/// A server to start through the proxy instead: its name and raw (unexpanded) definition. The
/// engine adapters take it, so the type is `pub` and its fields stay inside the crate.
#[derive(Debug, Clone)]
pub struct OnDemandServer {
    pub(crate) name: String,
    pub(crate) target: ProbeTarget,
}

/// Called on send: this engine's enabled stdio entries in the workspace that are marked on
/// demand and really apply. Returns nothing without reading any CLI config when none is marked.
pub fn on_demand_servers(engine: &str, workspace: &std::path::Path) -> Vec<OnDemandServer> {
    if !engine_supports(engine) {
        return Vec::new();
    }
    let modes = launch_modes();
    if modes.is_empty() {
        return Vec::new();
    }
    let workspace = workspace.to_string_lossy().into_owned();
    let mut section = super::config::read_config_entries(Some(&workspace));
    super::sources::append_entries(&mut section, Some(&workspace));
    let mut winners: std::collections::BTreeMap<String, &McpConfigEntry> = Default::default();
    for entry in section
        .entries
        .iter()
        .filter(|entry| entry.engine == engine)
    {
        let slot = winners.entry(entry.name.clone()).or_insert(entry);
        if rank(engine, &entry.source) < rank(engine, &slot.source) {
            *slot = entry;
        }
    }
    winners
        .into_values()
        .filter(|entry| entry.enabled && unsupported_reason(entry).is_none())
        .filter(|entry| {
            mode_key(&entry.id, &entry.scope, Some(&workspace))
                .and_then(|key| modes.get(&key))
                .is_some_and(|mode| mode == ON_DEMAND)
        })
        .filter_map(|entry| {
            let target = super::probe_target(&entry.id, Some(&workspace)).ok()?;
            target.command.is_some().then(|| OnDemandServer {
                name: entry.name.clone(),
                target,
            })
        })
        .collect()
}

impl OnDemandServer {
    fn wrapped(&self) -> Result<(String, Vec<String>), String> {
        let command = self
            .target
            .command
            .as_deref()
            .ok_or("stdio entry without command")?;
        super::lazy::wrap(command, &self.target.args)
    }

    /// A claude / codebuddy `--mcp-config` entry: replaces the same-named one whole, with env and
    /// cwd as written (values unexpanded; the CLI expands them by its own rules).
    pub fn claude_json(&self) -> Result<serde_json::Value, String> {
        let (command, args) = self.wrapped()?;
        let mut server = serde_json::json!({ "type": "stdio", "command": command, "args": args });
        if !self.target.env.is_empty() {
            let env: serde_json::Map<String, serde_json::Value> = self
                .target
                .env
                .iter()
                .map(|(key, value)| (key.clone(), serde_json::Value::String(value.clone())))
                .collect();
            server["env"] = serde_json::Value::Object(env);
        }
        if let Some(cwd) = &self.target.cwd {
            server["cwd"] = serde_json::Value::String(cwd.clone());
        }
        Ok(server)
    }

    /// codex `-c` overrides: merged by key, only command and args change, the rest is inherited.
    /// Names with a `.`, quotes or the like that break the dotted path are skipped (they keep
    /// starting with the session).
    pub fn codex_overrides(&self, quote: impl Fn(&str) -> String) -> Option<Vec<String>> {
        if !plain_name(&self.name) {
            return None;
        }
        let (command, args) = self.wrapped().ok()?;
        let args = args
            .iter()
            .map(|arg| quote(arg))
            .collect::<Vec<_>>()
            .join(",");
        Some(vec![
            format!("mcp_servers.{}.command={}", self.name, quote(&command)),
            format!("mcp_servers.{}.args=[{args}]", self.name),
        ])
    }

    /// For omp's workspace `.omp/mcp.json`: workspace entries win over user entries. Entries with
    /// env aren't written (the `workspace_env` of [`unsupported_reason`]); checked again here in
    /// case the config gained env between listing and sending.
    pub fn omp_spec(&self) -> Result<McpServerSpec, String> {
        if !self.target.env.is_empty() {
            return Err(format!(
                "{}: entries with env are not written to the workspace",
                self.name
            ));
        }
        let (command, args) = self.wrapped()?;
        Ok(McpServerSpec {
            name: self.name.clone(),
            command,
            args,
            env: Vec::new(),
        })
    }
}

/// claude / codebuddy: the on-demand entries go in a private 0600 file for `--mcp-config`. They
/// carry the person's env (possibly keys), so they can't go on the command line. The folder is
/// in Misty's own data, and a file left by a crash is removed when the engines sweep it.
pub fn stage_claude_config(
    servers: &[OnDemandServer],
    staging_dir: &str,
) -> Result<std::path::PathBuf, String> {
    let mut map = serde_json::Map::new();
    for server in servers {
        map.insert(server.name.clone(), server.claude_json()?);
    }
    let content = serde_json::to_vec(&serde_json::json!({ "mcpServers": map }))
        .map_err(|e| format!("serialize on-demand MCP config: {e}"))?;
    let directory = crate::engine_config::support::app_home().join(staging_dir);
    file_access::fs::create_dir_all(&directory)
        .map_err(|e| format!("create {staging_dir}: {e}"))?;
    let path = directory.join(format!("mcp-on-demand-{}.json", uuid::Uuid::new_v4()));
    let mut options = file_access::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(&path)
        .map_err(|e| format!("create {}: {e}", path.display()))?;
    if let Err(error) = std::io::Write::write_all(&mut file, &content) {
        drop(file);
        let _ = file_access::fs::remove_file(&path);
        return Err(format!("write on-demand MCP config: {error}"));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_keys_are_workspace_scoped_and_user_keys_are_not() {
        assert_eq!(
            mode_key("claude_user:a", "user", Some("/ws")).unwrap(),
            "claude_user:a"
        );
        let key = mode_key("claude_project:a", "project", Some("/no/such/ws")).unwrap();
        assert_eq!(key, "/no/such/ws|claude_project:a");
        assert!(mode_key("claude_project:a", "project", None).is_none());
    }

    fn entry(engine: &str, source: &str, name: &str) -> McpConfigEntry {
        McpConfigEntry {
            id: format!("{source}:{name}"),
            engine: engine.to_string(),
            name: name.to_string(),
            source: source.to_string(),
            scope: if source.ends_with("_user") {
                "user"
            } else {
                "project"
            }
            .to_string(),
            workspace_file: crate::engine_config::mcp::source_in_workspace(source),
            path: String::new(),
            format: "json".to_string(),
            enabled: true,
            transport: Some("stdio".to_string()),
            command: Some("npx".to_string()),
            args_count: 0,
            url: None,
            env_keys: Vec::new(),
            header_keys: Vec::new(),
            writable: true,
            readonly_reason: None,
            readonly_reason_code: None,
            version: String::new(),
            launch_mode: EAGER.to_string(),
            launch_mode_unsupported: None,
        }
    }

    #[test]
    fn omp_env_codex_project_and_dotted_codex_names_cannot_go_on_demand() {
        // OMP's override is written to the project's .omp/mcp.json: an entry with env would copy its tokens in.
        let mut omp = entry("omp", "omp_user", "gh");
        assert_eq!(unsupported_reason(&omp), None);
        omp.env_keys = vec!["GITHUB_TOKEN".to_string()];
        assert_eq!(unsupported_reason(&omp), Some("workspace_env"));
        // Codex doesn't read .codex/config.toml in an untrusted project; a `-c` override would skip that check.
        assert_eq!(
            unsupported_reason(&entry("codex", "codex_project", "a")),
            Some("project_trust")
        );
        assert_eq!(
            unsupported_reason(&entry("codex", "codex_user", "a-b_1")),
            None
        );
        assert_eq!(
            unsupported_reason(&entry("codex", "codex_user", "a.b")),
            Some("name")
        );
        // Other engines' names aren't limited by Codex's dotted path.
        assert_eq!(
            unsupported_reason(&entry("claude", "claude_user", "a.b")),
            None
        );
    }

    #[test]
    fn entries_hidden_by_a_same_name_higher_precedence_entry_are_shadowed() {
        let entries = vec![
            entry("claude", "claude_user", "fx"),
            entry("claude", "claude_local", "fx"),
            entry("claude", "claude_project", "fx"),
            entry("claude", "claude_user", "solo"),
            entry("omp", "omp_user", "fx"),
            entry("omp", "omp_project", "fx"),
            entry("codex", "codex_user", "fx"),
        ];
        let mut shadowed: Vec<_> = shadowed_ids(&entries).into_iter().collect();
        shadowed.sort();
        assert_eq!(
            shadowed,
            vec!["claude_project:fx", "claude_user:fx", "omp_user:fx"],
            "local wins for Claude, project wins for OMP; other engines are independent"
        );
        // The write follows the list's rule: a hidden entry can't go on demand (going back to eager always can).
        let error = write_mode(&entries[0], &entries, ON_DEMAND, None).unwrap_err();
        assert_eq!(error.code, "unsupported");
    }

    #[test]
    fn claude_local_beats_project_beats_user() {
        assert!(rank("claude", "claude_local") < rank("claude", "claude_project"));
        assert!(rank("claude", "claude_project") < rank("claude", "claude_user"));
        assert!(rank("codex", "codex_project") < rank("codex", "codex_user"));
    }
}
