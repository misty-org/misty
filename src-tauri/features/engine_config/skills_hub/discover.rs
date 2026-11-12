// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//! Discover, search and popular lists, with their caches and network calls.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

use super::core::*;
use super::fsutil::*;
use super::http::*;
use super::registry::*;
use super::repos::*;
use super::scan::*;
use super::target_sync::SKILL_CONTENT_MAX_BYTES;
// ===== discover / updates / search / popular (caches and network) =====

/// upstream's `/(^|\/)SKILL\.md$/i` test (case-insensitive).
pub(super) fn is_skill_md_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    if bytes.len() == "skill.md".len() {
        return bytes.eq_ignore_ascii_case(b"skill.md");
    }
    bytes.len() >= "/skill.md".len()
        && bytes[bytes.len() - "/skill.md".len()..].eq_ignore_ascii_case(b"/skill.md")
}

/// upstream's `docPath.replace(/(^|\/)(?:SKILL|skill)\.md$/i, "")`.
pub(super) fn strip_skill_md_suffix(doc_path: &str) -> &str {
    let bytes = doc_path.as_bytes();
    if bytes.len() == "skill.md".len() && bytes.eq_ignore_ascii_case(b"skill.md") {
        return "";
    }
    if bytes.len() >= "/skill.md".len()
        && bytes[bytes.len() - "/skill.md".len()..].eq_ignore_ascii_case(b"/skill.md")
    {
        return &doc_path[..doc_path.len() - "/skill.md".len()];
    }
    doc_path
}

/// upstream discoverRepoSkills: the tree's SKILL.md blobs, at most 200, with front matter fetched 4 at a
/// time; a failure other than a rate limit keeps the entry as `{name: installName, description: ""}`.
pub(super) async fn discover_repo_skills(
    client: &reqwest::Client,
    repo_input: &Value,
) -> SkillResult<Vec<Value>> {
    let repo = normalize_repo(repo_input);
    let owner = js_string(repo.get("owner"));
    let name = js_string(repo.get("name"));
    let enabled = repo.get("enabled").and_then(Value::as_bool).unwrap_or(true);
    if owner.is_empty() || name.is_empty() || !enabled {
        return Ok(Vec::new());
    }
    let (branch, tree) =
        get_repo_tree(client, &owner, &name, &js_string(repo.get("branch"))).await?;
    let skill_files: Vec<String> = tree
        .iter()
        .filter(|entry| entry.get("type").and_then(Value::as_str) == Some("blob"))
        .filter_map(|entry| {
            entry
                .get("path")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .filter(|path| is_skill_md_path(path))
        .take(DISCOVER_MAX_SKILLS_PER_REPO)
        .collect();

    let owner = Arc::new(owner);
    let name = Arc::new(name);
    let branch = Arc::new(branch);
    let worker_client = client.clone();
    let results = map_with_concurrency(
        skill_files,
        DISCOVER_CONCURRENCY,
        move |doc_path: String| {
            let client = worker_client.clone();
            let owner = Arc::clone(&owner);
            let name = Arc::clone(&name);
            let branch = Arc::clone(&branch);
            async move {
                let doc_path = doc_path.replace('\\', "/");
                // A SKILL.md at the root → repo.name.
                let stripped = strip_skill_md_suffix(&doc_path);
                let directory = if stripped.is_empty() {
                    name.as_str().to_string()
                } else {
                    stripped.to_string()
                };
                let Some(install_name) = install_name_from_directory(&directory) else {
                    return Ok(None);
                };
                let mut meta_name = install_name.clone();
                let mut meta_description = String::new();
                match fetch_text(&client, &github_raw_url(&owner, &name, &branch, &doc_path)).await
                {
                    Ok(markdown) => {
                        let metadata = read_skill_metadata(&markdown, &install_name);
                        meta_name = metadata.name;
                        meta_description = metadata.description;
                    }
                    Err(error) => {
                        if error.is_rate_limited() {
                            return Err(error);
                        }
                        // A failure other than a rate limit: keep the entry (metadata fallback).
                    }
                }
                Ok(Some(json!({
                    "key": format!("{}/{}:{directory}", owner, name),
                    "name": meta_name,
                    "description": meta_description,
                    "directory": directory,
                    "readmeUrl": github_doc_url(&owner, &name, &branch, &doc_path),
                    "repoOwner": owner.as_str(),
                    "repoName": name.as_str(),
                    "repoBranch": branch.as_str(),
                })))
            }
        },
    )
    .await;

    let mut skills = Vec::new();
    for result in results {
        match result {
            Ok(Some(skill)) => skills.push(skill),
            Ok(None) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(skills)
}

/// upstream dedupeSkills: dedupes by lowercased key (the later one wins, in the first one's place), sorted by name.
pub(super) fn dedupe_skills(skills: Vec<Value>) -> Vec<Value> {
    let mut by_key: HashMap<String, usize> = HashMap::new();
    let mut values: Vec<Value> = Vec::new();
    for skill in skills {
        let key = format!(
            "{}/{}:{}",
            js_string(skill.get("repoOwner")),
            js_string(skill.get("repoName")),
            js_string(skill.get("directory"))
        )
        .to_lowercase();
        match by_key.get(&key) {
            Some(&index) => values[index] = skill,
            None => {
                by_key.insert(key, values.len());
                values.push(skill);
            }
        }
    }
    values.sort_by_key(|a| js_string(a.get("name")));
    values
}

/// upstream discover fingerprint: enabled repos' `owner/name@branch`, sorted and joined with `|`.
pub(super) fn discover_fingerprint(repos: &[Value]) -> String {
    let mut parts: Vec<String> = repos
        .iter()
        .map(|repo| {
            format!(
                "{}/{}@{}",
                js_string(repo.get("owner")),
                js_string(repo.get("name")),
                js_string(repo.get("branch"))
            )
        })
        .collect();
    parts.sort();
    parts.join("|")
}

/// upstream readDiscoverCache: a hit only when the fingerprint matches and generatedAt is at most 1h old.
pub(super) fn read_discover_cache(fingerprint: &str) -> Option<(Vec<Value>, i64)> {
    let data = read_json(&discover_cache_path())?;
    let skills = data.get("skills").and_then(Value::as_array)?.clone();
    if data.get("fingerprint").and_then(Value::as_str) != Some(fingerprint) {
        return None;
    }
    let generated_at = data.get("generatedAt").and_then(Value::as_f64)?;
    if now_ms() as f64 - generated_at > DISCOVER_CACHE_TTL_MS as f64 {
        return None;
    }
    Some((skills, generated_at as i64))
}

pub(super) fn write_discover_cache(fingerprint: &str, skills: &[Value]) -> SkillResult<()> {
    write_json(
        &discover_cache_path(),
        &json!({"fingerprint": fingerprint, "generatedAt": now_ms(), "skills": skills}),
    )
}

/// upstream discoverSkills: allSettled semantics (one repo failing doesn't sink the rest, but an empty
/// result with a rate limit surfaces the rate limit).
pub(super) async fn discover_skills(force: bool) -> SkillResult<Value> {
    let registry = read_registry();
    let enabled: Vec<Value> = registry
        .repos
        .iter()
        .map(normalize_repo)
        .filter(|repo| repo.get("enabled").and_then(Value::as_bool).unwrap_or(true))
        .collect();
    if enabled.is_empty() {
        return Ok(json!({"skills": [], "cached": false, "generatedAt": now_ms()}));
    }
    let fingerprint = discover_fingerprint(&enabled);
    if !force {
        if let Some((skills, generated_at)) = read_discover_cache(&fingerprint) {
            return Ok(json!({"skills": skills, "cached": true, "generatedAt": generated_at}));
        }
    }
    let worker_client = http_client()?;
    let results = map_with_concurrency(enabled, DISCOVER_CONCURRENCY, move |repo: Value| {
        let client = worker_client.clone();
        async move { discover_repo_skills(&client, &repo).await }
    })
    .await;
    let mut merged: Vec<Value> = Vec::new();
    let mut rate_limited: Option<SkillError> = None;
    for result in results {
        match result {
            Ok(skills) => merged.extend(skills),
            Err(error) => {
                if error.is_rate_limited() && rate_limited.is_none() {
                    rate_limited = Some(error);
                }
            }
        }
    }
    let merged = dedupe_skills(merged);
    if merged.is_empty() {
        if let Some(error) = rate_limited {
            return Err(error);
        }
    }
    write_discover_cache(&fingerprint, &merged)?;
    Ok(json!({"skills": merged, "cached": false, "generatedAt": now_ms()}))
}

// ===== skills.sh details: find SKILL.md in the repo and read it back =====

/// A skills.sh skill id normalized: lowercase, `:` to `-` (the site's `react:components` is
/// `react-components` in the repo).
pub(super) fn normalize_skill_id(value: &str) -> String {
    value.trim().to_lowercase().replace(':', "-")
}

/// How well a folder name matches a skill id: 3 = the same; 2 = one is the other without the repo
/// prefix (`vercel-react-best-practices` ↔ `react-best-practices`); 0 = no match.
fn skill_dir_score(folder: &str, wanted: &str) -> u8 {
    let folder = normalize_skill_id(folder);
    if folder.is_empty() {
        return 0;
    }
    if folder == wanted {
        return 3;
    }
    if wanted.ends_with(&format!("-{folder}")) || folder.ends_with(&format!("-{wanted}")) {
        return 2;
    }
    0
}

/// Finds the folder holding `SKILL.md` for a skills.sh skill id in the repo tree, by folder name
/// (the folder path without `/SKILL.md`; a SKILL.md at the root gives an empty string, which skills.sh
/// only points at when the id equals the repo name).
///
/// Only three matches count: the same name, without the repo prefix, or `:` changed to `-`; of
/// several the shallowest wins, and none gives None: better to report not_found and send the person
/// to GitHub than show another skill's text in its place.
pub(super) fn resolve_skill_dir_in_tree(tree: &[Value], skill_id: &str) -> Option<String> {
    let wanted = normalize_skill_id(skill_id);
    if wanted.is_empty() {
        return None;
    }
    let mut best: Option<(u8, usize, String)> = None;
    for entry in tree {
        if entry.get("type").and_then(Value::as_str) != Some("blob") {
            continue;
        }
        let Some(path) = entry.get("path").and_then(Value::as_str) else {
            continue;
        };
        if !is_skill_md_path(path) {
            continue;
        }
        let dir = strip_skill_md_suffix(path).trim_end_matches('/');
        let folder = dir.rsplit('/').next().unwrap_or("");
        let score = skill_dir_score(folder, &wanted);
        if score == 0 {
            continue;
        }
        let depth = dir.matches('/').count();
        let better = match &best {
            None => true,
            Some((best_score, best_depth, best_dir)) => {
                score > *best_score
                    || (score == *best_score
                        && (depth < *best_depth
                            || (depth == *best_depth && dir < best_dir.as_str())))
            }
        };
        if better {
            best = Some((score, depth, dir.to_string()));
        }
    }
    best.map(|(_, _, dir)| dir)
}

/// Every blob in one folder (an install downloads a folder's files by the same rule).
pub(super) fn skill_dir_files<'a>(tree: &'a [Value], dir: &str) -> Vec<&'a Value> {
    let prefix = format!("{dir}/");
    tree.iter()
        .filter(|entry| {
            entry.get("type").and_then(Value::as_str) == Some("blob")
                && entry
                    .get("path")
                    .and_then(Value::as_str)
                    .map(|path| path == dir || path.starts_with(&prefix))
                    .unwrap_or(false)
        })
        .collect()
}

/// Whether the folder has a `SKILL.md` (uppercase first, then `skill.md`).
pub(super) fn dir_has_skill_md(tree: &[Value], dir: &str) -> bool {
    skill_dir_files(tree, dir).iter().any(|entry| {
        entry
            .get("path")
            .and_then(Value::as_str)
            .map(is_skill_md_path)
            .unwrap_or(false)
    })
}

/// When the given folder has no SKILL.md, resolves the skills.sh id in the tree once more
/// （`vercel-react-best-practices` → `skills/react-best-practices`）。
pub(super) fn resolve_existing_skill_dir(tree: &[Value], requested: &str) -> Option<String> {
    if dir_has_skill_md(tree, requested) {
        return Some(requested.to_string());
    }
    let skill_id = requested.rsplit('/').next().unwrap_or(requested);
    let resolved = resolve_skill_dir_in_tree(tree, skill_id)?;
    if resolved.is_empty() || !dir_has_skill_md(tree, &resolved) {
        return None;
    }
    Some(resolved)
}

/// skills.sh search and popular give only name / repo / installs; what a skill does has to come
/// from the repo's `SKILL.md` (the details panel asks on demand, never for a whole list).
pub(super) async fn remote_skill_content(
    owner: &str,
    name: &str,
    branch: &str,
    skill_id: &str,
) -> SkillResult<Value> {
    let owner = owner.trim();
    let name = name.trim();
    let wanted = normalize_skill_id(skill_id);
    if owner.is_empty() || name.is_empty() || wanted.is_empty() {
        return Err(SkillError::coded(
            "invalid_input",
            "Missing skill or repository information",
        ));
    }
    let client = http_client()?;
    let (branch, tree) = get_repo_tree(&client, owner, name, branch).await?;
    let doc_path = match resolve_skill_dir_in_tree(&tree, &wanted) {
        Some(dir) => format!("{dir}/SKILL.md"),
        // The whole repo has one SKILL.md at the root: a skills.sh id is often the repo name.
        None => {
            let all: Vec<&str> = tree
                .iter()
                .filter(|entry| entry.get("type").and_then(Value::as_str) == Some("blob"))
                .filter_map(|entry| entry.get("path").and_then(Value::as_str))
                .filter(|path| is_skill_md_path(path))
                .collect();
            if all.len() == 1 && strip_skill_md_suffix(all[0]).is_empty() {
                all[0].to_string()
            } else {
                return Err(SkillError::coded(
                    "not_found",
                    format!("No SKILL.md for \"{wanted}\" in {owner}/{name}"),
                ));
            }
        }
    };
    let markdown = fetch_text(&client, &github_raw_url(owner, name, &branch, &doc_path)).await?;
    let metadata = read_skill_metadata(&markdown, &wanted);
    let bytes = markdown.as_bytes();
    let truncated = bytes.len() > SKILL_CONTENT_MAX_BYTES;
    let slice = if truncated {
        &bytes[..SKILL_CONTENT_MAX_BYTES]
    } else {
        bytes
    };
    Ok(json!({
        "name": metadata.name,
        "description": metadata.description,
        "directory": strip_skill_md_suffix(&doc_path).trim_end_matches('/'),
        "path": doc_path,
        "url": github_doc_url(owner, name, &branch, &doc_path),
        "repoUrl": format!("https://github.com/{owner}/{name}"),
        "markdown": String::from_utf8_lossy(slice).into_owned(),
        "truncated": truncated,
        "branch": branch,
    }))
}
