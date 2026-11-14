//! What an engine offers the composer's `/` and `$` menus: its slash commands and its skills,
//! read from the files the engine itself reads (`~/.claude/commands`, a project's
//! `.claude/skills`, `~/.codex/prompts`, Codex plugin skills and the like). Only names, one-line
//! descriptions and argument hints are returned; the engine reads the files itself when the
//! command or skill is used.
//!
//! The folders, the front matter parsing and the discovery rules (namespaced command names,
//! README skipped, category folders, Codex `.system` and plugin skills) follow desktop-cc-gui's
//! slash_commands.rs.
//!
//! Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! See NOTICE.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogItem {
    pub name: String,
    pub description: String,
    /// `builtin`, `user` (the person's home folder) or `project` (the linked folder).
    pub source: &'static str,
    /// What the composer inserts to use it, in the engine's own syntax.
    pub insert: String,
    /// The command's `argument-hint`, shown after its name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub argument_hint: Option<String>,
    /// Who runs it: the engine, as the chat's next message, or Misty, out of turn
    /// (`slash/mod.rs`).
    pub runs: super::slash::Runs,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub commands: Vec<CatalogItem>,
    pub skills: Vec<CatalogItem>,
}

/// The `description:` line of a Markdown file's front matter, else its first line of text.
fn description_of(text: &str) -> String {
    let (_, description, _) = parse_command_frontmatter(text);
    if let Some(description) = description {
        return clip(&description);
    }
    let mut lines = text.lines();
    let mut first_text = None;
    if text.starts_with("---") {
        lines.next();
        for line in lines.by_ref() {
            if line.trim() == "---" {
                break;
            }
        }
    }
    for line in lines {
        let line = line.trim().trim_start_matches('#').trim();
        if !line.is_empty() {
            first_text = Some(line);
            break;
        }
    }
    clip(first_text.unwrap_or(""))
}

fn clip(text: &str) -> String {
    let text: String = text.chars().take(140).collect();
    text
}

fn read_head(path: &Path) -> String {
    use std::io::Read;
    let mut text = String::new();
    if let Ok(file) = file_access::fs::File::open(path) {
        let _ = file.take(16 * 1024).read_to_string(&mut text);
    }
    text
}

// ---------------------------------------------------------------------------------------------
// Front matter

pub(crate) fn sanitize_meta_value(value: &str) -> Option<String> {
    let mut val = value.trim().to_string();
    if val.len() >= 2 {
        let bytes = val.as_bytes();
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            val = val[1..val.len().saturating_sub(1)].to_string();
        }
    }
    let trimmed = val.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub(crate) fn parse_meta_line(
    line: &str,
    description: &mut Option<String>,
    argument_hint: &mut Option<String>,
) {
    let Some((key, value)) = line.split_once(':') else {
        return;
    };
    let key = key.trim().to_ascii_lowercase();
    let value = sanitize_meta_value(value);
    match key.as_str() {
        "description" => {
            if let Some(value) = value {
                *description = Some(value);
            }
        }
        "argument-hint" | "argument_hint" | "argumenthint" => {
            if let Some(value) = value {
                *argument_hint = Some(value);
            }
        }
        _ => {}
    }
}

/// YAML-ish front matter between `---` fences: the name override, the description (block scalars
/// included) and the argument hint. Unterminated front matter means the file has none.
fn parse_command_frontmatter(content: &str) -> (Option<String>, Option<String>, Option<String>) {
    let mut segments = content.split_inclusive('\n').peekable();
    let Some(first_segment) = segments.next() else {
        return (None, None, None);
    };
    if first_segment.trim_end_matches(['\r', '\n']).trim() != "---" {
        return (None, None, None);
    }
    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    let mut argument_hint: Option<String> = None;
    while let Some(segment) = segments.next() {
        let line = segment.trim_end_matches(['\r', '\n']);
        let trimmed = line.trim();
        if trimmed == "---" {
            return (name, description, argument_hint);
        }
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        // `name` is parsed here (not by parse_meta_line) so the file can override the name taken
        // from its path.
        if let Some((key, value)) = trimmed.split_once(':') {
            let key = key.trim().to_ascii_lowercase();
            let raw_val = value.trim();
            if key == "name" {
                if let Some(value) = sanitize_meta_value(raw_val) {
                    name = Some(value);
                }
                continue;
            } else if key == "description"
                && matches!(raw_val, ">" | "|" | ">+" | ">-" | "|+" | "|-")
            {
                let mut collected: Vec<String> = Vec::new();
                while let Some(peeked) = segments.peek() {
                    let peek_line = peeked.trim_end_matches(['\r', '\n']);
                    let peek_trimmed = peek_line.trim();
                    if peek_trimmed == "---" {
                        break;
                    }
                    if peek_trimmed.is_empty() {
                        segments.next();
                        continue;
                    }
                    if peek_line.starts_with(' ') || peek_line.starts_with('\t') {
                        collected.push(peek_trimmed.to_string());
                        segments.next();
                    } else {
                        break;
                    }
                }
                if !collected.is_empty() {
                    let separator = if raw_val.starts_with('|') { "\n" } else { " " };
                    description = Some(collected.join(separator));
                }
                continue;
            }
        }
        parse_meta_line(trimmed, &mut description, &mut argument_hint);
    }
    (None, None, None)
}

// ---------------------------------------------------------------------------------------------
// Discovery

/// A command's name from its path: folders join with `:`, the file stem is the last part, and a
/// README is documentation, not a command.
fn derive_command_name(path: &Path, root: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let mut parts: Vec<String> = relative
        .components()
        .filter_map(|component| component.as_os_str().to_str().map(str::to_string))
        .collect();
    let file_name = parts.pop()?;
    let stem = Path::new(&file_name)
        .file_stem()
        .and_then(|value| value.to_str())?;
    if stem.eq_ignore_ascii_case("readme") {
        return None;
    }
    parts.push(stem.to_string());
    Some(parts.join(":"))
}

/// A TOML command's `description`, on one line, else nothing. The file is read as TOML (a
/// multi-line or escaped string included); a head cut short of the whole file falls back to its
/// `description = "…"` line.
fn toml_description(text: &str) -> String {
    if let Ok(table) = text.parse::<toml::Table>() {
        return table
            .get("description")
            .and_then(toml::Value::as_str)
            .map(|description| clip(&description.split_whitespace().collect::<Vec<_>>().join(" ")))
            .unwrap_or_default();
    }
    text.lines()
        .find_map(|line| {
            let rest = line.trim().strip_prefix("description")?.trim_start();
            let value = rest.strip_prefix('=')?.trim();
            let quote = value.chars().next().filter(|c| *c == '"' || *c == '\'')?;
            let inner = value[1..].split(quote).next()?;
            Some(clip(inner))
        })
        .unwrap_or_default()
}

/// One command or skill as found on disk, before the engine's syntax is applied.
#[derive(Clone, Debug)]
struct Found {
    name: String,
    description: String,
    argument_hint: Option<String>,
    source: &'static str,
}

/// Markdown command files under `dir`, at any depth, named relative to `root`.
fn discover_commands_in(dir: &Path, root: &Path, source: &'static str) -> Vec<Found> {
    let mut out = Vec::new();
    let Ok(entries) = file_access::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if file_access::fs::is_dir(&path) {
            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            out.extend(discover_commands_in(&path, root, source));
            continue;
        }
        let extension = path
            .extension()
            .and_then(|s| s.to_str())
            .map(str::to_ascii_lowercase);
        let content = match extension.as_deref() {
            Some("md") => read_head(&path),
            // Gemini CLI, Qwen Code and Qoder write commands as TOML: `description` and `prompt`.
            Some("toml") => {
                let text = read_head(&path);
                let found = derive_command_name(&path, root).filter(|name| !name.is_empty());
                if let Some(name) = found {
                    out.push(Found {
                        name,
                        description: toml_description(&text),
                        argument_hint: None,
                        source,
                    });
                }
                continue;
            }
            _ => continue,
        };
        let (name, _, argument_hint) = parse_command_frontmatter(&content);
        let Some(resolved) = name.or_else(|| derive_command_name(&path, root)) else {
            continue;
        };
        let normalized = resolved.trim().trim_start_matches('/').to_string();
        if normalized.is_empty() {
            continue;
        }
        out.push(Found {
            name: normalized,
            description: description_of(&content),
            argument_hint,
            source,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Skills directly under `dir`: each folder with a `SKILL.md` (or `skill.md`) is one. Category
/// folders without one are searched to depth 3, Codex's own `.system` included; other hidden
/// folders, `node_modules` and `target` are skipped. The name comes from front matter, else the
/// folder.
fn discover_skills_in(dir: &Path, source: &'static str) -> Vec<Found> {
    let mut out = Vec::new();
    discover_skills_in_internal(dir, source, 0, &mut out);
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn discover_skills_in_internal(
    dir: &Path,
    source: &'static str,
    depth: usize,
    out: &mut Vec<Found>,
) {
    if depth > 3 {
        return;
    }
    let Ok(entries) = file_access::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !file_access::fs::is_dir(&path) {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if (file_name.starts_with('.') && file_name != ".system")
            || file_name == "node_modules"
            || file_name == "target"
        {
            continue;
        }
        let manifest = ["SKILL.md", "skill.md"]
            .iter()
            .map(|name| path.join(name))
            .find(|candidate| file_access::fs::is_file(candidate));
        match manifest {
            Some(manifest) => {
                let content = read_head(&manifest);
                let (name, _, _) = parse_command_frontmatter(&content);
                let resolved = name.unwrap_or_else(|| file_name.to_string());
                let normalized = resolved.trim().trim_start_matches('/').to_string();
                if normalized.is_empty() {
                    continue;
                }
                out.push(Found {
                    name: normalized,
                    description: description_of(&content),
                    argument_hint: None,
                    source,
                });
            }
            None => discover_skills_in_internal(&path, source, depth + 1, out),
        }
    }
}

/// Codex plugin skills: each plugin ships a `skills/` folder inside its version folder under
/// `plugins/cache`, and the nesting in between isn't fixed, so the tree is walked (to depth 8)
/// for every `skills` folder. Shared with the skills hub so the two never disagree.
pub(crate) fn codex_plugin_skills_dirs(codex_home: &Path) -> Vec<(PathBuf, &'static str)> {
    let cache = codex_home.join("plugins").join("cache");
    let mut out: Vec<(PathBuf, &'static str)> = Vec::new();
    let mut stack = vec![(cache, 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        if depth > 8 {
            continue;
        }
        let Ok(entries) = file_access::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !file_access::fs::is_dir(&path) {
                continue;
            }
            if entry.file_name() == "skills" {
                out.push((path, "plugin"));
            } else {
                stack.push((path, depth + 1));
            }
        }
    }
    out.sort();
    out
}

/// Folders inside the linked folder, in priority order, for commands of engines that read the
/// shared layouts (`.agents`, `.agent` for pi and omp, plain `commands`).
const SHARED_WORKSPACE_COMMAND_SUBPATHS: &[&[&str]] = &[
    &[".agents", "commands"],
    &[".agent", "commands"],
    &[".commands"],
    &["commands"],
];

/// The same for skills: the Open Agent standard (`.agents/skills`), the project's own hidden and
/// visible `skills`, pi and omp (`.agent/skills`), Cursor (`.cursor/skills`) and GitHub Copilot
/// (`.github/skills`).
const SHARED_WORKSPACE_SKILL_SUBPATHS: &[&[&str]] = &[
    &[".agents", "skills"],
    &[".skills"],
    &["skills"],
    &[".agent", "skills"],
    &[".cursor", "skills"],
    &[".github", "skills"],
];

/// Folders to read, in priority order, each once however it is reached (links included).
struct Folders {
    list: Vec<(PathBuf, &'static str)>,
    seen: HashSet<PathBuf>,
}

impl Folders {
    fn new() -> Self {
        Self {
            list: Vec::new(),
            seen: HashSet::new(),
        }
    }

    fn add(&mut self, dir: PathBuf, source: &'static str) {
        if !file_access::fs::is_dir(&dir) {
            return;
        }
        let canonical = file_access::fs::canonicalize(&dir).unwrap_or_else(|_| dir.clone());
        if self.seen.insert(canonical) {
            self.list.push((dir, source));
        }
    }

    fn add_under(&mut self, base: &Path, subpaths: &[&[&str]], source: &'static str) {
        for parts in subpaths {
            self.add(join(base, parts), source);
        }
    }
}

fn join(base: &Path, parts: &[&str]) -> PathBuf {
    parts
        .iter()
        .fold(base.to_path_buf(), |path, part| path.join(part))
}

fn commands_from(folders: Folders) -> Vec<Found> {
    let mut found = Vec::new();
    for (dir, source) in &folders.list {
        found.extend(discover_commands_in(dir, dir, source));
    }
    found
}

fn skills_from(folders: Folders) -> Vec<Found> {
    let mut found = Vec::new();
    for (dir, source) in &folders.list {
        found.extend(discover_skills_in(dir, source));
    }
    found
}

fn items(found: Vec<Found>, prefix: &str) -> Vec<CatalogItem> {
    found
        .into_iter()
        .map(|found| CatalogItem {
            insert: format!("{prefix}{} ", found.name),
            name: found.name,
            description: found.description,
            source: found.source,
            argument_hint: found.argument_hint,
            runs: super::slash::Runs::Turn,
        })
        .collect()
}

fn builtin(names: &[(&str, &str)], prefix: &str) -> Vec<CatalogItem> {
    names
        .iter()
        .map(|(name, description)| CatalogItem {
            name: (*name).into(),
            description: (*description).into(),
            source: "builtin",
            insert: format!("{prefix}{name} "),
            argument_hint: None,
            runs: super::slash::Runs::Turn,
        })
        .collect()
}

/// Keeps the first item of each name, ignoring case: a project's own wins over the person's,
/// which wins over a built-in one.
fn unique(mut items: Vec<CatalogItem>) -> Vec<CatalogItem> {
    let rank = |source: &str| match source {
        "project" => 0,
        "user" => 1,
        _ => 2,
    };
    // A stable sort keeps the folders' own priority order within each rank.
    items.sort_by_key(|item| rank(item.source));
    let mut seen = HashSet::new();
    items.retain(|item| seen.insert(item.name.to_ascii_lowercase()));
    items.sort_by(|a, b| a.name.cmp(&b.name));
    items
}

/// The catalog for `engine`, with `home` the person's home folder and `project` the linked
/// folder the chat works in, if any.
pub fn catalog_for(engine: &str, home: &Path, project: Option<&Path>) -> Catalog {
    let mut catalog = Catalog::default();
    let env_home = |key: &str, default: &[&str]| -> PathBuf {
        match std::env::var_os(key).filter(|value| !value.is_empty()) {
            Some(value) => PathBuf::from(value),
            None => join(home, default),
        }
    };
    match engine {
        "claude" => {
            let claude_home = env_home("CLAUDE_CONFIG_DIR", &[".claude"]);
            catalog.commands = builtin(
                &[
                    (
                        "compact",
                        "Summarize the conversation so far to free context",
                    ),
                    ("context", "Show what is using the context window"),
                    ("cost", "Show this session's token use"),
                    ("init", "Write a CLAUDE.md that describes this project"),
                    ("code-review", "Review the current changes"),
                    (
                        "security-review",
                        "Check the current changes for security problems",
                    ),
                ],
                "/",
            );
            let mut commands = Folders::new();
            let mut skills = Folders::new();
            if let Some(project) = project {
                commands.add(join(project, &[".claude", "commands"]), "project");
                skills.add(join(project, &[".claude", "skills"]), "project");
            }
            commands.add(claude_home.join("commands"), "user");
            skills.add(claude_home.join("skills"), "user");
            catalog.commands.extend(items(commands_from(commands), "/"));
            catalog.skills.extend(items(skills_from(skills), "/"));
        }
        "codex" => {
            let codex_home = env_home("CODEX_HOME", &[".codex"]);
            // Codex's own commands (`/compact`, `/review`, `/init` and the rest of its terminal
            // app's) are listed from `slash/codex/`.
            let mut prompts = Folders::new();
            prompts.add(codex_home.join("prompts"), "user");
            catalog
                .commands
                .extend(items(commands_from(prompts), "/prompts:"));
            let mut commands = Folders::new();
            let mut skills = Folders::new();
            if let Some(project) = project {
                commands.add_under(
                    project,
                    &[&[".codex", "commands"], &[".agents", "commands"]],
                    "project",
                );
                skills.add_under(
                    project,
                    &[&[".agents", "skills"], &[".codex", "skills"]],
                    "project",
                );
            }
            commands.add(codex_home.join("commands"), "user");
            commands.add(join(home, &[".agents", "commands"]), "user");
            // Codex's built-in `.system` skills are found by the bounded search inside its skills
            // folder.
            skills.add(codex_home.join("skills"), "user");
            skills.add(join(home, &[".agents", "skills"]), "user");
            for (dir, _) in codex_plugin_skills_dirs(&codex_home) {
                skills.add(dir, "user");
            }
            catalog.commands.extend(items(commands_from(commands), "/"));
            catalog.skills.extend(items(skills_from(skills), "$"));
        }
        "opencode" => {
            catalog.commands = builtin(
                &[
                    (
                        "compact",
                        "Summarize the conversation so far to free context",
                    ),
                    ("init", "Write an AGENTS.md that describes this project"),
                ],
                "/",
            );
            let mut commands = Folders::new();
            if let Some(project) = project {
                commands.add(join(project, &[".opencode", "command"]), "project");
            }
            commands.add(join(home, &[".config", "opencode", "command"]), "user");
            catalog.commands.extend(items(commands_from(commands), "/"));
        }
        "gemini" => {
            catalog.commands = builtin(
                &[
                    // Over ACP Gemini runs only its own short list, sent when a session
                    // starts; `/compress` is not on it.
                    ("init", "Write a GEMINI.md that describes this project"),
                ],
                "/",
            );
            // Its custom `.toml` commands as Gemini CLI's loader has them (and as Misty expands
            // them before a prompt goes): its names, its default description, and a project's
            // only in a trusted folder that isn't the home folder.
            let user_dir = env_home("GEMINI_CLI_HOME", &[]).join(".gemini");
            let custom = super::gemini::custom_commands_from(Some(&user_dir), project)
                .into_iter()
                .map(|command| Found {
                    name: command.name,
                    description: clip(&command.description),
                    argument_hint: None,
                    source: if command.scope == "Project" {
                        "project"
                    } else {
                        "user"
                    },
                })
                .collect();
            catalog.commands.extend(items(custom, "/"));
        }
        "pi" => {
            // pi's own loader: prompts and skills under its agent folder and a project's `.pi`.
            let agent = env_home("PI_CODING_AGENT_DIR", &[".pi", "agent"]);
            let mut commands = Folders::new();
            let mut skills = Folders::new();
            if let Some(project) = project {
                commands.add(join(project, &[".pi", "prompts"]), "project");
                skills.add(join(project, &[".pi", "skills"]), "project");
                commands.add_under(project, SHARED_WORKSPACE_COMMAND_SUBPATHS, "project");
                skills.add_under(project, SHARED_WORKSPACE_SKILL_SUBPATHS, "project");
            }
            commands.add(agent.join("prompts"), "user");
            skills.add(agent.join("skills"), "user");
            skills.add(join(home, &[".agents", "skills"]), "user");
            catalog.commands.extend(items(commands_from(commands), "/"));
            catalog.skills.extend(items(skills_from(skills), "/"));
        }
        "qwen" | "qoder" | "qoder-cn" | "codebuddy" => {
            // Each reads its own folders (`.qwen`, `.qoder`, `.qoder-cn`, `.codebuddy`) the way
            // Claude Code reads `.claude`, plus the shared skills folder.
            let own = match engine {
                "qwen" => ".qwen",
                "qoder" => ".qoder",
                "qoder-cn" => ".qoder-cn",
                _ => ".codebuddy",
            };
            // Qwen Code keeps its user folder at `QWEN_HOME` when that is set.
            let user_dir = if engine == "qwen" {
                env_home("QWEN_HOME", &[own])
            } else {
                home.join(own)
            };
            let mut commands = Folders::new();
            let mut skills = Folders::new();
            if let Some(project) = project {
                commands.add(join(project, &[own, "commands"]), "project");
                skills.add(join(project, &[own, "skills"]), "project");
                skills.add(join(project, &[".agents", "skills"]), "project");
            }
            commands.add(user_dir.join("commands"), "user");
            skills.add(user_dir.join("skills"), "user");
            skills.add(join(home, &[".agents", "skills"]), "user");
            catalog.commands.extend(items(commands_from(commands), "/"));
            catalog.skills.extend(items(skills_from(skills), "/"));
        }
        // The other engines read the shared layouts: `.agents` (the Open Agent standard), `.agent`
        // (pi, omp) and a project's own `commands` and `skills`.
        _ => {
            let mut commands = Folders::new();
            let mut skills = Folders::new();
            if let Some(project) = project {
                commands.add_under(project, SHARED_WORKSPACE_COMMAND_SUBPATHS, "project");
                skills.add_under(project, SHARED_WORKSPACE_SKILL_SUBPATHS, "project");
            }
            skills.add(join(home, &[".agents", "skills"]), "user");
            catalog.commands.extend(items(commands_from(commands), "/"));
            catalog.skills.extend(items(skills_from(skills), "/"));
        }
    }
    with_report(&mut catalog, engine);
    with_ports(&mut catalog, engine);
    catalog.commands = unique(catalog.commands);
    catalog.skills = unique(catalog.skills);
    catalog
}

/// Adds the engine's commands Misty runs for it (`slash/mod.rs`), which its headless report
/// leaves out, so the menu offers all its terminal app does. One Misty runs out of turn replaces
/// the engine's own row of that name, which can't run headless; one run in the turn only fills a
/// gap.
fn with_ports(catalog: &mut Catalog, engine: &str) {
    for command in super::slash::commands(engine) {
        let out_of_turn = command.runs == super::slash::Runs::Misty;
        if out_of_turn {
            catalog
                .commands
                .retain(|item| item.source != "builtin" || item.name != command.name);
        } else if catalog
            .commands
            .iter()
            .any(|item| item.name.eq_ignore_ascii_case(command.name))
        {
            continue;
        }
        catalog.commands.push(CatalogItem {
            name: command.name.into(),
            description: command.description.into(),
            source: "builtin",
            insert: format!("/{} ", command.name),
            argument_hint: command.argument_hint.map(Into::into),
            runs: command.runs,
        });
    }
}

/// What Claude Code's own commands do, for the names its report gives without a description.
const KNOWN_DESCRIPTIONS: &[(&str, &str)] = &[
    (
        "compact",
        "Summarize the conversation so far to free context",
    ),
    ("context", "Show what is using the context window"),
    ("cost", "Show this session's token use"),
    ("usage", "Show this session's token use"),
    ("init", "Write a file that describes this project"),
    (
        "security-review",
        "Check the current changes for security problems",
    ),
    ("release-notes", "Show what changed in this version"),
    ("rename", "Rename the current conversation"),
    ("recap", "Generate a one-line session recap now"),
];

/// Puts what the engine reported about itself (`reported.rs`) in place of the built-in guess:
/// its own commands become the built-in ones, and skills it named that no folder holds (from a
/// plugin, say) are added. Files found on disk keep their richer descriptions.
fn with_report(catalog: &mut Catalog, engine: &str) {
    let report = super::reported::report_of(engine);
    let from_report = |named: super::reported::Named, prefix: &str| CatalogItem {
        insert: format!("{prefix}{} ", named.name),
        description: if named.description.is_empty() {
            KNOWN_DESCRIPTIONS
                .iter()
                .find(|(name, _)| *name == named.name)
                .map(|(_, description)| (*description).to_owned())
                .unwrap_or_default()
        } else {
            named.description
        },
        name: named.name,
        source: "builtin",
        argument_hint: named.argument_hint,
        runs: super::slash::Runs::Turn,
    };
    if let Some(commands) = report.commands {
        catalog.commands.retain(|item| item.source != "builtin");
        catalog
            .commands
            .extend(commands.into_iter().map(|named| from_report(named, "/")));
    }
    if let Some(skills) = report.skills {
        let prefix = if engine == "codex" { "$" } else { "/" };
        catalog
            .skills
            .extend(skills.into_iter().map(|named| from_report(named, prefix)));
    }
}

#[cfg(test)]
#[path = "catalog_tests.rs"]
mod tests;
