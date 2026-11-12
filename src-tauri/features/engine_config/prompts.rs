// The prompt library behind the composer's `!` menu and Settings › Tools › Prompts. Each prompt is
// a Markdown file whose optional `---` front matter carries `description` and `argument-hint`; the
// file stem is the prompt's name, and its absolute path is the key the window sends back to edit,
// move or delete it. Folder prompts live in the linked folder at `.misty/prompts/*.md`, global ones
// in `~/.misty/engine-config/prompts/*.md`. Nothing here leaves the computer.
//
// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use file_access::fs;

use super::support;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CustomPromptEntry {
    /// File stem (`plan.md` → `plan`).
    pub name: String,
    /// Absolute file path; the window sends it back as `promptPath`.
    pub path: String,
    pub description: Option<String>,
    pub argument_hint: Option<String>,
    /// The Markdown body without the front matter.
    pub content: String,
    /// "workspace" or "global".
    pub scope: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptsDirs {
    /// Empty when no folder was given.
    pub workspace: String,
    pub global: String,
}

/// Partial edits for `engine_prompts_update`: absent keys keep the stored value, and `Some("")`
/// on the description or argument hint clears it.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PromptUpdates {
    pub name: Option<String>,
    pub description: Option<String>,
    pub argument_hint: Option<String>,
    pub content: Option<String>,
}

fn workspace_prompts_dir(root: &Path) -> PathBuf {
    root.join(".misty").join("prompts")
}

fn global_prompts_dir() -> PathBuf {
    support::app_home().join("prompts")
}

/// Both scopes' folders for a linked folder, the folder's first. The folder itself must pass the
/// file gate as a linked folder, so a window can't point `path` anywhere else. Without a folder,
/// only the global scope is there.
fn prompt_roots(path: &str) -> Result<Vec<(PathBuf, &'static str)>, String> {
    let mut roots = Vec::with_capacity(2);
    if !path.trim().is_empty() {
        let root = support::ensure_allowed(path)?;
        roots.push((workspace_prompts_dir(&root), "workspace"));
    }
    roots.push((global_prompts_dir(), "global"));
    Ok(roots)
}

/// Every change through a prompt path must land on a file inside one of the scope folders, with
/// both sides resolved so `..` and linked parents can't get out.
fn ensure_within_roots(path: &Path, roots: &[(PathBuf, &'static str)]) -> Result<(), String> {
    let canonical = fs::canonicalize(path).map_err(|_| "Invalid prompt path.".to_string())?;
    for (root, _) in roots {
        if let Ok(canonical_root) = fs::canonicalize(root) {
            if canonical.starts_with(&canonical_root) {
                return Ok(());
            }
        }
    }
    Err("Prompt path is not within allowed directories.".to_string())
}

fn scope_of(path: &Path, roots: &[(PathBuf, &'static str)]) -> Option<&'static str> {
    for (root, scope) in roots {
        if path.starts_with(root) {
            return Some(scope);
        }
    }
    None
}

#[cfg(unix)]
fn is_cross_device_error(err: &std::io::Error) -> bool {
    err.raw_os_error() == Some(libc::EXDEV)
}

#[cfg(not(unix))]
fn is_cross_device_error(_err: &std::io::Error) -> bool {
    false
}

fn move_file(src: &Path, dest: &Path) -> Result<(), String> {
    match fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(err) if is_cross_device_error(&err) => {
            fs::copy(src, dest).map_err(|err| err.to_string())?;
            fs::remove_file(src).map_err(|err| err.to_string())
        }
        Err(err) => Err(err.to_string()),
    }
}

/// A front matter value with one pair of matching quotes taken off; `None` when empty.
fn sanitize_meta_value(value: &str) -> Option<String> {
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

/// One `key: value` line of front matter, read with the same rules as the `/` menu
/// (`argument-hint` and its spellings).
fn parse_meta_line(
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

/// `---`-fenced front matter and the body. Front matter that never closes means the file has
/// none and all of it is body.
fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>, String) {
    let mut segments = content.split_inclusive('\n');
    let Some(first_segment) = segments.next() else {
        return (None, None, String::new());
    };
    if first_segment.trim_end_matches(['\r', '\n']).trim() != "---" {
        return (None, None, content.to_string());
    }
    let mut description: Option<String> = None;
    let mut argument_hint: Option<String> = None;
    let mut consumed = first_segment.len();
    for segment in segments {
        let line = segment.trim_end_matches(['\r', '\n']);
        let trimmed = line.trim();
        consumed += segment.len();
        if trimmed == "---" {
            let body = if consumed >= content.len() {
                String::new()
            } else {
                content[consumed..].to_string()
            };
            return (description, argument_hint, body);
        }
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        parse_meta_line(trimmed, &mut description, &mut argument_hint);
    }
    (None, None, content.to_string())
}

fn build_prompt_contents(
    description: Option<&str>,
    argument_hint: Option<&str>,
    content: &str,
) -> String {
    let description = description.map(str::trim).filter(|value| !value.is_empty());
    let argument_hint = argument_hint
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if description.is_none() && argument_hint.is_none() {
        return content.to_string();
    }
    let mut output = String::from("---\n");
    if let Some(description) = description {
        output.push_str(&format!(
            "description: \"{}\"\n",
            description.replace('"', "\\\"")
        ));
    }
    if let Some(argument_hint) = argument_hint {
        output.push_str(&format!(
            "argument-hint: \"{}\"\n",
            argument_hint.replace('"', "\\\"")
        ));
    }
    output.push_str("---\n");
    output.push_str(content);
    output
}

/// A prompt's name becomes its file stem, so spaces and path separators are refused.
fn sanitize_prompt_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Prompt name is required.".to_string());
    }
    if trimmed.chars().any(|ch| ch.is_whitespace()) {
        return Err("Prompt name cannot include whitespace.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Prompt name cannot include path separators.".to_string());
    }
    Ok(trimmed.to_string())
}

fn read_prompt_entry(path: &Path, scope: &str) -> Option<CustomPromptEntry> {
    let name = path.file_stem()?.to_str()?.to_string();
    let raw = fs::read_to_string(path).ok()?;
    let (description, argument_hint, body) = parse_frontmatter(&raw);
    Some(CustomPromptEntry {
        name,
        path: path.to_string_lossy().to_string(),
        description,
        argument_hint,
        content: body,
        scope: scope.to_string(),
    })
}

fn discover_prompts_in(dir: &Path, scope: &str) -> Vec<CustomPromptEntry> {
    let mut out: Vec<CustomPromptEntry> = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_file = fs::metadata(&path).map(|m| m.is_file()).unwrap_or(false);
        let is_md = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !is_file || !is_md {
            continue;
        }
        if let Some(entry) = read_prompt_entry(&path, scope) {
            out.push(entry);
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn prompts_list_blocking(path: &str) -> Result<Vec<CustomPromptEntry>, String> {
    let roots = prompt_roots(path)?;
    let mut out = Vec::new();
    for (dir, scope) in &roots {
        // The folder's prompts come first; each list is sorted by name. Listing makes no folders,
        // so a project that never had a prompt gets no `.misty` folder.
        out.extend(discover_prompts_in(dir, scope));
    }
    Ok(out)
}

fn prompts_dirs_blocking(path: &str) -> Result<PromptsDirs, String> {
    let roots = prompt_roots(path)?;
    for (dir, _) in &roots {
        fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    }
    let find = |scope: &str| {
        roots
            .iter()
            .find(|(_, s)| *s == scope)
            .map(|(dir, _)| dir.to_string_lossy().to_string())
            .unwrap_or_default()
    };
    Ok(PromptsDirs {
        workspace: find("workspace"),
        global: find("global"),
    })
}

fn prompts_create_blocking(
    path: &str,
    scope: &str,
    name: &str,
    description: Option<String>,
    argument_hint: Option<String>,
    content: String,
) -> Result<CustomPromptEntry, String> {
    let name = sanitize_prompt_name(name)?;
    let roots = prompt_roots(path)?;
    let Some((dir, scope)) = roots.iter().find(|(_, s)| *s == scope) else {
        return Err("Invalid scope.".to_string());
    };
    fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    let target = dir.join(format!("{name}.md"));
    if fs::exists(&target) {
        return Err("Prompt already exists.".to_string());
    }
    let body = build_prompt_contents(description.as_deref(), argument_hint.as_deref(), &content);
    fs::write(&target, body).map_err(|err| err.to_string())?;
    Ok(CustomPromptEntry {
        name,
        path: target.to_string_lossy().to_string(),
        description: description
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
        argument_hint: argument_hint
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
        content,
        scope: scope.to_string(),
    })
}

fn prompts_update_blocking(
    path: &str,
    prompt_path: &str,
    updates: PromptUpdates,
) -> Result<CustomPromptEntry, String> {
    let roots = prompt_roots(path)?;
    let target = PathBuf::from(prompt_path);
    if !fs::exists(&target) {
        return Err("Prompt not found.".to_string());
    }
    ensure_within_roots(&target, &roots)?;
    let raw = fs::read_to_string(&target).map_err(|err| err.to_string())?;
    let (old_description, old_argument_hint, old_body) = parse_frontmatter(&raw);
    let old_name = target
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or("Invalid prompt path.".to_string())?
        .to_string();

    // Absent keys keep the stored value; Some("") on the meta fields clears them through the
    // trim-to-empty rule below.
    let name = match updates.name {
        Some(name) => sanitize_prompt_name(&name)?,
        None => old_name,
    };
    let merge_meta = |update: Option<String>, old: Option<String>| -> Option<String> {
        match update {
            Some(value) => {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            }
            None => old,
        }
    };
    let description = merge_meta(updates.description, old_description);
    let argument_hint = merge_meta(updates.argument_hint, old_argument_hint);
    let content = updates.content.unwrap_or(old_body);

    let dir = target
        .parent()
        .ok_or("Unable to resolve prompt directory.".to_string())?;
    let next_path = dir.join(format!("{name}.md"));
    if next_path != target && fs::exists(&next_path) {
        return Err("Prompt with that name already exists.".to_string());
    }
    let body = build_prompt_contents(description.as_deref(), argument_hint.as_deref(), &content);
    fs::write(&next_path, body).map_err(|err| err.to_string())?;
    if next_path != target {
        fs::remove_file(&target).map_err(|err| err.to_string())?;
    }
    let scope = scope_of(&next_path, &roots)
        .ok_or("Prompt path is not within allowed directories.".to_string())?;
    Ok(CustomPromptEntry {
        name,
        path: next_path.to_string_lossy().to_string(),
        description,
        argument_hint,
        content,
        scope: scope.to_string(),
    })
}

fn prompts_delete_blocking(path: &str, prompt_path: &str) -> Result<bool, String> {
    let roots = prompt_roots(path)?;
    let target = PathBuf::from(prompt_path);
    if !fs::exists(&target) {
        return Ok(false);
    }
    ensure_within_roots(&target, &roots)?;
    fs::remove_file(&target).map_err(|err| err.to_string())?;
    Ok(true)
}

fn prompts_move_blocking(
    path: &str,
    prompt_path: &str,
    scope: &str,
) -> Result<CustomPromptEntry, String> {
    let roots = prompt_roots(path)?;
    let target = PathBuf::from(prompt_path);
    if !fs::exists(&target) {
        return Err("Prompt not found.".to_string());
    }
    ensure_within_roots(&target, &roots)?;
    let file_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("Invalid prompt path.".to_string())?;
    let Some((dest_dir, dest_scope)) = roots.iter().find(|(_, s)| *s == scope) else {
        return Err("Invalid scope.".to_string());
    };
    let next_path = dest_dir.join(file_name);
    if next_path == target {
        return Err("Prompt is already in that scope.".to_string());
    }
    if fs::exists(&next_path) {
        return Err("Prompt with that name already exists.".to_string());
    }
    fs::create_dir_all(dest_dir).map_err(|err| err.to_string())?;
    move_file(&target, &next_path)?;
    read_prompt_entry(&next_path, dest_scope).ok_or("Moved prompt could not be read.".to_string())
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

/// The folder's prompts, then the global ones. `path` is the linked folder, or empty.
#[tauri::command]
pub async fn engine_prompts_list(path: String) -> Result<Vec<CustomPromptEntry>, String> {
    blocking(move || prompts_list_blocking(&path)).await
}

/// Both scopes' folders, made if missing, to open in the file manager.
#[tauri::command]
pub async fn engine_prompts_dirs(path: String) -> Result<PromptsDirs, String> {
    blocking(move || prompts_dirs_blocking(&path)).await
}

/// Opens one scope's prompts folder (`workspace` or `global`) in the file manager, made if missing.
/// The folder is worked out here, so a window can't open anything else.
#[tauri::command]
pub async fn engine_prompts_reveal(
    app: tauri::AppHandle,
    path: String,
    scope: String,
) -> Result<(), String> {
    let dirs = blocking(move || prompts_dirs_blocking(&path)).await?;
    let folder = match scope.as_str() {
        "workspace" if !dirs.workspace.is_empty() => dirs.workspace,
        "global" => dirs.global,
        _ => return Err("Link a folder to this Space first.".to_string()),
    };
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(folder, None::<&str>)
        .map_err(|_| "The folder couldn't be opened.".to_string())
}

#[tauri::command]
pub async fn engine_prompts_create(
    path: String,
    scope: String,
    name: String,
    description: Option<String>,
    argument_hint: Option<String>,
    content: String,
) -> Result<CustomPromptEntry, String> {
    blocking(move || {
        prompts_create_blocking(&path, &scope, &name, description, argument_hint, content)
    })
    .await
}

#[tauri::command]
pub async fn engine_prompts_update(
    path: String,
    prompt_path: String,
    updates: PromptUpdates,
) -> Result<CustomPromptEntry, String> {
    blocking(move || prompts_update_blocking(&path, &prompt_path, updates)).await
}

#[tauri::command]
pub async fn engine_prompts_delete(path: String, prompt_path: String) -> Result<bool, String> {
    blocking(move || prompts_delete_blocking(&path, &prompt_path)).await
}

#[tauri::command]
pub async fn engine_prompts_move(
    path: String,
    prompt_path: String,
    scope: String,
) -> Result<CustomPromptEntry, String> {
    blocking(move || prompts_move_blocking(&path, &prompt_path, &scope)).await
}

#[cfg(test)]
mod tests {
    #![allow(clippy::disallowed_methods, clippy::disallowed_types)]
    use super::*;

    // The two scopes are exercised through the helpers with scratch folders; the commands'
    // folder check is the file gate's, covered in file_access.

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("misty-prompts-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn scratch_roots(name: &str) -> (PathBuf, Vec<(PathBuf, &'static str)>) {
        let root = scratch_dir(name);
        let roots = vec![
            (workspace_prompts_dir(&root), "workspace"),
            (root.join("global"), "global"),
        ];
        for (dir, _) in &roots {
            std::fs::create_dir_all(dir).unwrap();
        }
        (root, roots)
    }

    #[test]
    fn frontmatter_parsing() {
        let (description, hint, body) = parse_frontmatter(
            "---\ndescription: \"Planning flow\"\nargument-hint: [target]\n---\nBody\n",
        );
        assert_eq!(description.as_deref(), Some("Planning flow"));
        assert_eq!(hint.as_deref(), Some("[target]"));
        assert_eq!(body, "Body\n");

        // No fence: the whole file is body.
        let (description, hint, body) = parse_frontmatter("plain body\n");
        assert_eq!(description, None);
        assert_eq!(hint, None);
        assert_eq!(body, "plain body\n");

        // A fence that never closes is body too, and its meta is dropped.
        let (description, _, body) = parse_frontmatter("---\ndescription: x\nnever closed\n");
        assert_eq!(description, None);
        assert_eq!(body, "---\ndescription: x\nnever closed\n");
    }

    #[test]
    fn meta_lines_strip_quotes_and_accept_hint_spellings() {
        let mut description = None;
        let mut hint = None;
        parse_meta_line("description: 'Quoted'", &mut description, &mut hint);
        parse_meta_line("argument_hint: <file>", &mut description, &mut hint);
        assert_eq!(description.as_deref(), Some("Quoted"));
        assert_eq!(hint.as_deref(), Some("<file>"));
        parse_meta_line("description: \"\"", &mut description, &mut hint);
        assert_eq!(
            description.as_deref(),
            Some("Quoted"),
            "an empty value keeps the old one"
        );
    }

    #[test]
    fn prompt_name_validation() {
        assert!(sanitize_prompt_name("  ").is_err());
        assert!(sanitize_prompt_name("has space").is_err());
        assert!(sanitize_prompt_name("a/b").is_err());
        assert!(sanitize_prompt_name("a\\b").is_err());
        assert_eq!(sanitize_prompt_name(" plan ").unwrap(), "plan");
    }

    #[test]
    fn create_list_update_delete_move_round_trip() {
        let (_root, roots) = scratch_roots("roundtrip");
        let workspace_dir = roots[0].0.clone();
        let global_dir = roots[1].0.clone();

        // Create, through the same helpers the command uses.
        let name = sanitize_prompt_name("plan").unwrap();
        let target = workspace_dir.join(format!("{name}.md"));
        let body = build_prompt_contents(Some("Plan"), Some("[t]"), "Body\n");
        std::fs::write(&target, body).unwrap();

        let entries = discover_prompts_in(&workspace_dir, "workspace");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "plan");
        assert_eq!(entries[0].description.as_deref(), Some("Plan"));
        assert_eq!(entries[0].argument_hint.as_deref(), Some("[t]"));
        assert_eq!(entries[0].content, "Body\n");

        // Update: rewritten with merged meta and renamed.
        let renamed = workspace_dir.join("plan-v2.md");
        let body = build_prompt_contents(None, None, "New body\n");
        std::fs::write(&renamed, body).unwrap();
        std::fs::remove_file(&target).unwrap();
        let entry = read_prompt_entry(&renamed, "workspace").unwrap();
        assert_eq!(entry.name, "plan-v2");
        assert_eq!(entry.description, None);
        assert_eq!(entry.content, "New body\n");

        // Move to global.
        let dest = global_dir.join("plan-v2.md");
        move_file(&renamed, &dest).unwrap();
        assert!(!renamed.exists());
        let entry = read_prompt_entry(&dest, "global").unwrap();
        assert_eq!(entry.scope, "global");
        assert_eq!(entry.content, "New body\n");

        // Delete.
        std::fs::remove_file(&dest).unwrap();
        assert!(discover_prompts_in(&global_dir, "global").is_empty());
    }

    #[test]
    fn rejects_paths_outside_prompt_roots() {
        let (root, roots) = scratch_roots("escape");
        let outside = root.join("outside.md");
        std::fs::write(&outside, "not a prompt").unwrap();
        assert!(ensure_within_roots(&outside, &roots).is_err());

        // `..` out of the prompts folder is refused once resolved.
        let escape = roots[0].0.join("..").join("outside.md");
        assert!(ensure_within_roots(&escape, &roots).is_err());

        // A real prompt inside the folder's prompts passes.
        let inside = roots[0].0.join("ok.md");
        std::fs::write(&inside, "body").unwrap();
        assert!(ensure_within_roots(&inside, &roots).is_ok());
    }

    #[test]
    fn commands_work_on_the_global_scope_without_a_folder() {
        let home = scratch_dir("global-only");
        let _home = support::TestHome::set(&home);
        assert!(prompts_list_blocking("").unwrap().is_empty());
        let created = prompts_create_blocking(
            "",
            "global",
            "review",
            Some("Review the diff".into()),
            None,
            "Look at $ARGUMENTS\n".into(),
        )
        .unwrap();
        assert_eq!(created.scope, "global");
        assert!(prompts_create_blocking("", "workspace", "x", None, None, "y".into()).is_err());
        let listed = prompts_list_blocking("").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].description.as_deref(), Some("Review the diff"));
        let updated = prompts_update_blocking(
            "",
            &created.path,
            PromptUpdates {
                name: Some("review-2".into()),
                description: Some(String::new()),
                ..PromptUpdates::default()
            },
        )
        .unwrap();
        assert_eq!(updated.name, "review-2");
        assert_eq!(updated.description, None);
        assert_eq!(updated.content, "Look at $ARGUMENTS\n");
        assert!(!Path::new(&created.path).exists());
        let dirs = prompts_dirs_blocking("").unwrap();
        assert!(dirs.workspace.is_empty());
        assert!(dirs.global.ends_with("prompts"));
        assert!(prompts_delete_blocking("", &updated.path).unwrap());
        assert!(!prompts_delete_blocking("", &updated.path).unwrap());
        let _ = std::fs::remove_dir_all(&home);
    }
}
