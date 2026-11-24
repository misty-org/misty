use std::path::{Path, PathBuf};

use super::{gemini_dir, is_home, workspace_trusted};

pub(crate) struct CustomCommand {
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub path: PathBuf,
    pub scope: &'static str,
}

pub(crate) fn custom_commands(workspace: Option<&Path>) -> Vec<CustomCommand> {
    custom_commands_from(gemini_dir().as_deref(), workspace)
}

pub(crate) fn custom_commands_from(
    user_dir: Option<&Path>,
    workspace: Option<&Path>,
) -> Vec<CustomCommand> {
    let mut by_name: std::collections::BTreeMap<String, CustomCommand> = Default::default();
    let mut dirs = Vec::new();
    if let Some(dir) = user_dir {
        dirs.push(("User", dir.join("commands")));
    }
    if let Some(workspace) = workspace.filter(|w| !is_home(w) && workspace_trusted(w)) {
        dirs.push(("Project", workspace.join(".gemini").join("commands")));
    }
    for (scope, dir) in dirs {
        let mut files = Vec::new();
        toml_files(&dir, 0, &mut files);
        files.sort();
        for path in files {
            if let Some(command) = read_command(&dir, &path, scope) {
                by_name.insert(command.name.clone(), command);
            }
        }
    }
    by_name.into_values().collect()
}

#[allow(
    clippy::disallowed_methods,
    reason = "reads Gemini's command files in the person's project folder as well as its home; the project need not be linked"
)]
fn toml_files(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    const MOST_DEPTH: usize = 8;
    const MOST_FILES: usize = 1000;
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= MOST_FILES {
            return;
        }
        let path = entry.path();
        if path.is_dir() {
            if depth < MOST_DEPTH {
                toml_files(&path, depth + 1, out);
            }
        } else if path.extension().is_some_and(|ext| ext == "toml") && path.is_file() {
            out.push(path);
        }
    }
}

#[allow(
    clippy::disallowed_methods,
    reason = "reads Gemini's command files in the person's project folder as well as its home; the project need not be linked"
)]
fn read_command(base: &Path, path: &Path, scope: &'static str) -> Option<CustomCommand> {
    let text = std::fs::read_to_string(path).ok()?;
    let table: toml::Table = text.parse().ok()?;
    let prompt = table.get("prompt")?.as_str()?.to_string();
    let relative = path.strip_prefix(base).ok()?.with_extension("");
    let name = relative
        .components()
        .map(|part| command_segment(&part.as_os_str().to_string_lossy()))
        .collect::<Vec<_>>()
        .join(":");
    let file_name = path.file_name()?.to_string_lossy().into_owned();
    let description = table
        .get("description")
        .and_then(toml::Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("Custom command from {file_name}"));
    Some(CustomCommand {
        name,
        description: display_text(&description, 100),
        prompt,
        path: path.to_path_buf(),
        scope,
    })
}

fn command_segment(segment: &str) -> String {
    let mut clean = String::with_capacity(segment.len());
    for c in segment.chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.') {
            clean.push(c);
        } else {
            clean.extend(std::iter::repeat_n('_', c.len_utf16()));
        }
    }
    if clean.len() > 50 {
        format!("{}...", &clean[..47])
    } else {
        clean
    }
}

fn display_text(text: &str, most: usize) -> String {
    let clean: String = text
        .chars()
        .map(|c| if c == '\n' || c == '\t' { ' ' } else { c })
        .filter(|c| !c.is_control())
        .collect();
    if clean.chars().count() <= most {
        return clean;
    }
    let cut: String = clean.chars().take(most.saturating_sub(3)).collect();
    format!("{cut}...")
}

const MISTY_TAIL: &str = "\n\n[CCGUI internal ";

pub(crate) fn expand_custom_command(prompt: &str, workspace: &Path) -> Option<String> {
    let (typed, tail) = match prompt.find(MISTY_TAIL) {
        Some(at) => prompt.split_at(at),
        None => (prompt, ""),
    };
    let raw = typed.trim();
    let rest = raw.strip_prefix('/')?;
    let mut words = rest.split_whitespace();
    let name = words.next()?;
    let args = words.collect::<Vec<_>>().join(" ");
    let command = custom_commands(Some(workspace))
        .into_iter()
        .find(|command| command.name == name)?;
    let expanded = expand_prompt(&command.prompt, &args, raw)?;
    Some(format!("{expanded}{tail}"))
}

fn expand_prompt(prompt: &str, args: &str, raw: &str) -> Option<String> {
    const ARGS: &str = "{{args}}";
    if !prompt.contains(ARGS) {
        return Some(if args.is_empty() {
            prompt.to_string()
        } else {
            format!("{prompt}\n\n{raw}")
        });
    }
    let mut out = String::with_capacity(prompt.len() + args.len());
    let mut rest = prompt;
    while let Some(start) = next_injection(rest) {
        out.push_str(&rest[..start].replace(ARGS, args));
        let end = injection_end(rest, start)?;
        out.push_str(&rest[start..end]);
        rest = &rest[end..];
    }
    out.push_str(&rest.replace(ARGS, args));
    Some(out)
}

fn next_injection(text: &str) -> Option<usize> {
    match (text.find("!{"), text.find("@{")) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    }
}

fn injection_end(text: &str, start: usize) -> Option<usize> {
    let mut depth = 0usize;
    for (offset, c) in text[start + 2..].char_indices() {
        match c {
            '{' => depth += 1,
            '}' if depth == 0 => return Some(start + 2 + offset + 1),
            '}' => depth -= 1,
            _ => {}
        }
    }
    None
}
