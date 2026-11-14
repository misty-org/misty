//! What engines keep in plain files and show in their terminal apps' dialogs: context (memory)
//! files, agent definitions, hooks and permission rules. Gemini CLI, Qwen Code, Qoder and
//! CodeBuddy share the shapes (Claude Code's, mostly), so their `/memory`, `/agents`, `/hooks`
//! and `/permissions` read them here and answer with what is on disk.

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::{row, Output, Row, Section};

/// The most rows one list shows; a longer one says how many it left out.
const MOST_ROWS: usize = 200;
/// How long a description may run in a row.
const MOST_DESCRIPTION: usize = 160;

pub fn home() -> Option<PathBuf> {
    dirs::home_dir()
}

/// `path` with the home folder written as `~`.
pub fn display_path(path: &Path) -> String {
    if let Some(home) = home() {
        if let Ok(rest) = path.strip_prefix(&home) {
            return if rest.as_os_str().is_empty() {
                "~".to_string()
            } else {
                format!("~/{}", rest.display())
            };
        }
    }
    path.display().to_string()
}

/// A settings file read as JSON. Gemini CLI and Qwen Code accept comments in theirs, so `//`
/// and `/* */` comments are dropped first. None when the file is missing or isn't JSON.
pub fn read_json(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&strip_json_comments(&text)).ok()
}

/// JSON text without its comments; strings (and the escapes in them) are left alone.
pub fn strip_json_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut in_string = false;
    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            match c {
                '\\' => {
                    if let Some(next) = chars.next() {
                        out.push(next);
                    }
                }
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match (c, chars.peek()) {
            ('"', _) => {
                in_string = true;
                out.push(c);
            }
            ('/', Some('/')) => {
                for next in chars.by_ref() {
                    if next == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            ('/', Some('*')) => {
                chars.next();
                let mut last = '\0';
                for next in chars.by_ref() {
                    if last == '*' && next == '/' {
                        break;
                    }
                    last = next;
                }
            }
            _ => out.push(c),
        }
    }
    out
}

/// The folder and the folders above it up to its repository root (the first that holds a
/// `.git`), root first: where these engines look for project context files. A folder outside
/// any repository is searched alone.
pub fn project_chain(folder: &Path) -> Vec<PathBuf> {
    let home = home();
    let mut chain = Vec::new();
    let mut current = Some(folder);
    while let Some(dir) = current {
        chain.push(dir.to_path_buf());
        if dir.join(".git").exists() {
            chain.reverse();
            return chain;
        }
        if home.as_deref() == Some(dir) {
            break;
        }
        current = dir.parent();
    }
    vec![folder.to_path_buf()]
}

/// The context files an engine loads: `global` (its own folder's) and, in each folder of the
/// project chain, every one of `project_names` (a name may carry a subfolder, such as
/// `.codebuddy/CODEBUDDY.md`). One row per file that exists, with its size.
pub fn context_section(
    heading: &str,
    global: &[PathBuf],
    project_names: &[&str],
    folder: Option<&Path>,
) -> Section {
    let mut files: Vec<PathBuf> = global
        .iter()
        .filter(|path| path.is_file())
        .cloned()
        .collect();
    if let Some(folder) = folder {
        for dir in project_chain(folder) {
            for name in project_names {
                let path = dir.join(name);
                if path.is_file() && !files.contains(&path) {
                    files.push(path);
                }
            }
        }
    }
    let rows = files
        .iter()
        .map(|path| row(display_path(path), file_size(path)))
        .collect::<Vec<_>>();
    let text = rows.is_empty().then(|| {
        let names = project_names
            .iter()
            .map(|name| format!("`{name}`"))
            .collect::<Vec<_>>()
            .join(", ");
        format!("No context files yet. The engine reads {names} here and in the folders above it.")
    });
    Section {
        heading: Some(heading.to_string()),
        rows,
        text,
    }
}

fn file_size(path: &Path) -> String {
    match std::fs::read_to_string(path) {
        Ok(text) => {
            let lines = text.lines().count();
            format!("{lines} line{}", if lines == 1 { "" } else { "s" })
        }
        Err(_) => "unreadable".to_string(),
    }
}

/// The agents defined as Markdown files with front matter (`name`, `description`) in `dir` and
/// its subfolders one level down. None when there are none.
pub fn agents_section(heading: &str, dir: &Path) -> Option<Section> {
    let mut files = markdown_files(dir);
    for entry in read_dir_sorted(dir) {
        if entry.is_dir() {
            files.extend(markdown_files(&entry));
        }
    }
    let mut rows: Vec<Row> = files
        .iter()
        .map(|path| {
            let (name, description) = agent_front_matter(path);
            let name = name.unwrap_or_else(|| {
                path.file_stem()
                    .map(|stem| stem.to_string_lossy().into_owned())
                    .unwrap_or_default()
            });
            row(name, description.map(|d| shorten(&d)).unwrap_or_default())
        })
        .collect();
    if rows.is_empty() {
        return None;
    }
    rows.sort_by(|a, b| a.label.cmp(&b.label));
    Some(Section {
        heading: Some(format!("{heading} · {}", display_path(dir))),
        rows,
        text: None,
    })
}

fn markdown_files(dir: &Path) -> Vec<PathBuf> {
    read_dir_sorted(dir)
        .into_iter()
        .filter(|path| path.is_file() && path.extension().is_some_and(|ext| ext == "md"))
        .collect()
}

fn read_dir_sorted(dir: &Path) -> Vec<PathBuf> {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|entries| entries.flatten().map(|entry| entry.path()).collect())
        .unwrap_or_default();
    entries.sort();
    entries
}

/// `name` and `description` from a Markdown file's YAML front matter.
fn agent_front_matter(path: &Path) -> (Option<String>, Option<String>) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return (None, None);
    };
    let Some(rest) = text.strip_prefix("---") else {
        return (None, None);
    };
    let Some(end) = rest.find("\n---") else {
        return (None, None);
    };
    let Ok(yaml) = serde_yaml::from_str::<serde_yaml::Value>(&rest[..end]) else {
        return (None, None);
    };
    let field = |key: &str| {
        yaml.get(key)
            .and_then(serde_yaml::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    (field("name"), field("description"))
}

fn shorten(text: &str) -> String {
    let line = text.lines().next().unwrap_or_default().trim();
    if line.chars().count() <= MOST_DESCRIPTION {
        return line.to_string();
    }
    let cut: String = line.chars().take(MOST_DESCRIPTION - 1).collect();
    format!("{cut}…")
}

/// The hooks one settings file configures, in the shape these engines share:
/// `hooks: { <Event>: [{ matcher?, hooks: [{ type, command | prompt | url, name? }] }] }`.
/// One row per hook, under the event (and matcher) it runs on. None when it has none.
pub fn hooks_section(label: &str, path: &Path) -> Option<Section> {
    let settings = read_json(path)?;
    let events = settings.get("hooks")?.as_object()?;
    let mut rows = Vec::new();
    for (event, groups) in events {
        for group in groups.as_array().into_iter().flatten() {
            let matcher = group
                .get("matcher")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|matcher| !matcher.is_empty() && *matcher != "*");
            let on = match matcher {
                Some(matcher) => format!("{event} · {matcher}"),
                None => event.clone(),
            };
            for hook in group
                .get("hooks")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                rows.push(row(on.clone(), hook_action(hook)));
            }
        }
    }
    (!rows.is_empty()).then(|| Section {
        heading: Some(format!("{label} · {}", display_path(path))),
        rows: capped(rows),
        text: None,
    })
}

/// What one hook runs: its command, prompt or URL, after its name when it has one.
fn hook_action(hook: &Value) -> String {
    let text = |key: &str| hook.get(key).and_then(Value::as_str).map(str::trim);
    let action = text("command")
        .or_else(|| text("prompt"))
        .or_else(|| text("url"))
        .unwrap_or_default();
    let action = shorten(action);
    match text("name").filter(|name| !name.is_empty() && *name != action) {
        Some(name) => format!("{name}: {action}"),
        None => action,
    }
}

/// The permission rules one settings file sets: `permissions: { allow, ask, deny }` (and its
/// default mode and extra folders when it names them). None when it sets none.
pub fn permissions_section(label: &str, path: &Path) -> Option<Section> {
    let settings = read_json(path)?;
    let permissions = settings.get("permissions")?.as_object()?;
    let mut rows = Vec::new();
    for (key, title) in [("deny", "Deny"), ("ask", "Ask"), ("allow", "Allow")] {
        for rule in permissions
            .get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            rows.push(row(title, rule));
        }
    }
    if let Some(mode) = permissions.get("defaultMode").and_then(Value::as_str) {
        rows.push(row("Default mode", mode));
    }
    for dir in permissions
        .get("additionalDirectories")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        rows.push(row("Extra folder", dir));
    }
    (!rows.is_empty()).then(|| Section {
        heading: Some(format!("{label} · {}", display_path(path))),
        rows: capped(rows),
        text: None,
    })
}

fn capped(mut rows: Vec<Row>) -> Vec<Row> {
    if rows.len() > MOST_ROWS {
        let left = rows.len() - MOST_ROWS;
        rows.truncate(MOST_ROWS);
        rows.push(row("…", format!("{left} more")));
    }
    rows
}

/// An `Info` with `sections`, or with one line saying `empty` when there are none.
pub fn info_or(title: &str, sections: Vec<Section>, empty: impl Into<String>) -> Output {
    if sections.is_empty() {
        return Output::info(
            title,
            vec![Section {
                text: Some(empty.into()),
                ..Default::default()
            }],
        );
    }
    Output::info(title, sections)
}

/// The settings files an engine layers, user first: `<user_dir>/settings.json`, then the
/// project's `<folder>/<project_dir>/settings.json` and `settings.local.json`.
pub fn settings_files(
    user_dir: &Path,
    project_dir: &str,
    folder: Option<&Path>,
    with_local: bool,
) -> Vec<(&'static str, PathBuf)> {
    let mut files = vec![("User", user_dir.join("settings.json"))];
    if let Some(folder) = folder {
        let dir = folder.join(project_dir);
        files.push(("Project", dir.join("settings.json")));
        if with_local {
            files.push(("Local", dir.join("settings.local.json")));
        }
    }
    files
}

/// `/hooks` over `files`.
pub fn hooks_info(engine: &str, files: &[(&str, PathBuf)]) -> Output {
    let sections = files
        .iter()
        .filter_map(|(label, path)| hooks_section(label, path))
        .collect();
    info_or(
        &format!("{engine} hooks"),
        sections,
        "No hooks configured in the user or project settings.",
    )
}

/// `/permissions` over `files`.
pub fn permissions_info(engine: &str, files: &[(&str, PathBuf)]) -> Output {
    let sections = files
        .iter()
        .filter_map(|(label, path)| permissions_section(label, path))
        .collect();
    info_or(
        &format!("{engine} permission rules"),
        sections,
        "No allow, ask or deny rules in the user or project settings.",
    )
}

/// `/agents` over the engine's user and project agent folders.
pub fn agents_info(engine: &str, dirs: &[(&str, PathBuf)]) -> Output {
    let sections = dirs
        .iter()
        .filter_map(|(label, dir)| agents_section(label, dir))
        .collect();
    let looked = dirs
        .iter()
        .map(|(_, dir)| format!("`{}`", display_path(dir)))
        .collect::<Vec<_>>()
        .join(" and ");
    info_or(
        &format!("{engine} agents"),
        sections,
        format!("No custom agents in {looked}."),
    )
}
