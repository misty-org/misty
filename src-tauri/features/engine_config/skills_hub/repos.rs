// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//! The GitHub repositories the hub discovers skills in.

use file_access::fs;
use serde_json::{json, Value};

use super::core::*;
use super::fsutil::*;
use super::registry::*;
// ===== Repositories =====

/// upstream normalizeRepo。
pub(super) fn normalize_repo(repo: &Value) -> Value {
    let owner = js_string(repo.get("owner")).trim().to_string();
    let name = js_string(repo.get("name")).trim().to_string();
    let branch = {
        let branch = js_string(repo.get("branch")).trim().to_string();
        if branch.is_empty() {
            crate::known_names::DEFAULT_BRANCH.to_string()
        } else {
            branch
        }
    };
    let enabled = repo.get("enabled").and_then(Value::as_bool).unwrap_or(true);
    json!({"owner": owner, "name": name, "branch": branch, "enabled": enabled})
}

/// upstream OWNER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/。
pub(super) fn owner_name_valid(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || bytes.len() > 100 || !bytes[0].is_ascii_alphanumeric() {
        return false;
    }
    bytes[1..]
        .iter()
        .all(|b| b.is_ascii_alphanumeric() || *b == b'.' || *b == b'_' || *b == b'-')
}

pub(super) fn list_repos() -> Vec<Value> {
    read_registry().repos.iter().map(normalize_repo).collect()
}

pub(super) fn invalidate_discover_cache() {
    let _ = fs::remove_file(discover_cache_path());
}

/// Drops entries matching `"owner/name"`, lowercased (shared by upstream addRepo/removeRepo).
pub(super) fn retain_repos_not(repos: &mut Vec<Value>, key: &str) {
    repos.retain(|entry| {
        format!(
            "{}/{}",
            js_string(entry.get("owner")),
            js_string(entry.get("name"))
        )
        .to_lowercase()
            != key
    });
}

/// upstream addRepo: validate → dedupe → push → invalidate the discover cache.
pub(super) fn add_repo(repo_input: &Value) -> SkillResult<Value> {
    let repo = normalize_repo(repo_input);
    let owner = js_string(repo.get("owner"));
    let name = js_string(repo.get("name"));
    let branch = js_string(repo.get("branch"));
    if owner.is_empty() || name.is_empty() {
        return Err(SkillError::other("Repository owner and name are required"));
    }
    if !owner_name_valid(&owner) || !owner_name_valid(&name) {
        return Err(SkillError::other(
            "Repository owner and name may only contain letters, digits, '.', '_', or '-'",
        ));
    }
    if !owner_name_valid(&branch) {
        return Err(SkillError::other(
            "Repository branch contains unsupported characters",
        ));
    }
    let mut registry = read_registry();
    retain_repos_not(
        &mut registry.repos,
        &format!("{owner}/{name}").to_lowercase(),
    );
    registry.repos.push(repo.clone());
    save_registry(&registry)?;
    invalidate_discover_cache();
    Ok(json!({"ok": true, "repo": repo}))
}

/// upstream removeRepo。
pub(super) fn remove_repo(owner: &str, name: &str) -> SkillResult<Value> {
    let mut registry = read_registry();
    retain_repos_not(
        &mut registry.repos,
        &format!("{owner}/{name}").to_lowercase(),
    );
    save_registry(&registry)?;
    invalidate_discover_cache();
    Ok(json!({"ok": true}))
}
