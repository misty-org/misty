// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//! Install, uninstall, restore, import and delete.

use file_access::fs;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

use super::core::*;
use super::discover::*;
use super::fsutil::*;
use super::http::*;
use super::registry::*;
use super::scan::*;
use super::target_sync::*;
// ===== mutations：install / uninstall / restore / set_targets / import_local / delete_local =====

/// upstream installSkill: GitHub tree → download into tmp → rename into the SSOT → registry → sync targets.
pub(super) async fn install_skill(
    skill_input: &Value,
    target_ids: &[String],
    force: bool,
) -> SkillResult<Value> {
    let skill_name_input = js_string(skill_input.get("name"));
    let skill_description_input = js_string(skill_input.get("description"));
    let directory_input = js_string(skill_input.get("directory"));
    let repo_owner = js_string(skill_input.get("repoOwner"));
    let repo_name = js_string(skill_input.get("repoName"));
    let repo_branch = {
        let branch = js_string(skill_input.get("repoBranch"));
        if branch.is_empty() {
            crate::known_names::DEFAULT_BRANCH.to_string()
        } else {
            branch
        }
    };
    if repo_owner.is_empty() || repo_name.is_empty() {
        return Err(SkillError::coded(
            "invalid_input",
            "Missing GitHub repository information",
        ));
    }
    let source_dir = sanitize_relative_path(&directory_input);
    // A GitHub skill keeps its flat installName even when its sourceDirectory is nested.
    let install_name = source_dir.as_deref().and_then(install_name_from_directory);
    let (source_dir, install_name) = match (source_dir, install_name) {
        (Some(dir), Some(name)) => (dir, name),
        _ => {
            return Err(SkillError::coded(
                "invalid_input",
                "Invalid skill directory",
            ))
        }
    };

    let mut registry = read_registry();
    let new_repo = format!("{repo_owner}/{repo_name}").to_lowercase();
    let conflict = registry
        .skills
        .iter()
        .find(|entry| {
            let dir = js_string(entry.get("directory"));
            let repo = format!(
                "{}/{}",
                js_string(entry.get("repoOwner")),
                js_string(entry.get("repoName"))
            )
            .to_lowercase();
            eq_ignore_case(&dir, &install_name) && repo != new_repo
        })
        .map(|entry| {
            (
                js_string(entry.get("repoOwner")),
                js_string(entry.get("repoName")),
            )
        });
    if let Some((owner, name)) = conflict {
        return Err(SkillError::coded(
            "conflict",
            format!("Skill directory \"{install_name}\" is already managed by {owner}/{name}"),
        ));
    }

    let client = http_client()?;
    let (branch, tree) = get_repo_tree(&client, &repo_owner, &repo_name, &repo_branch).await?;
    // A skills.sh id isn't always the folder name in the repo (`vercel-react-best-practices` is
    // `skills/react-best-practices` in vercel-labs/agent-skills): when the given folder has no
    // SKILL.md, resolve it again by the same matching rules rather than failing the install on a
    // folder name (the details panel reads the remote SKILL.md from the same tree).
    let Some(source_dir) = resolve_existing_skill_dir(&tree, &source_dir) else {
        return Err(SkillError::coded(
            "invalid_input",
            "SKILL.md not found in selected directory",
        ));
    };
    let files = skill_dir_files(&tree, &source_dir);

    let dest = managed_skill_path(&install_name)?;
    // Local edits are protected: when the managed copy's hash on disk differs from the registry's,
    // overwriting is refused unless the caller passes force (the person confirmed the update).
    if fs::exists(&dest) && !force {
        let recorded = registry
            .skills
            .iter()
            .find(|entry| eq_ignore_case(&js_string(entry.get("directory")), &install_name))
            .and_then(|entry| entry.get("contentHash"))
            .and_then(Value::as_str)
            .filter(|hash| !hash.is_empty())
            .map(str::to_string);
        if let Some(recorded) = recorded {
            if hash_directory(&dest) != recorded {
                return Err(SkillError::coded(
                    "conflict",
                    "The managed copy has local changes; reinstalling would overwrite them",
                ));
            }
        }
    }
    let temp = tmp_dir().join(format!("{install_name}-{}", now_ms()));
    remove_path(&temp);
    ensure_dir(&temp)?;
    // Files are downloaded one at a time; any failure cleans up tmp and is returned.
    let download = async {
        for entry in &files {
            let path = entry.get("path").and_then(Value::as_str).unwrap_or("");
            let relative = if path == source_dir {
                Path::new(path)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default()
            } else {
                path[source_dir.len() + 1..].to_string()
            };
            let Some(safe_relative) = sanitize_relative_path(&relative) else {
                continue;
            };
            let out = temp.join(&safe_relative);
            if let Some(parent) = out.parent() {
                ensure_dir(parent)?;
            }
            let text = fetch_text(
                &client,
                &github_raw_url(&repo_owner, &repo_name, &branch, path),
            )
            .await?;
            fs::write(&out, text)?;
        }
        remove_path(&dest);
        if let Some(parent) = dest.parent() {
            ensure_dir(parent)?;
        }
        fs::rename(&temp, &dest)?;
        Ok::<(), SkillError>(())
    };
    if let Err(error) = download.await {
        remove_path(&temp);
        return Err(error);
    }

    // Read name and description again from the SKILL.md on disk (uppercase first, then skill.md).
    let marker = find_skill_marker(&dest);
    let skill_md = marker.and_then(|m| read_text(&m)).unwrap_or_default();
    let fallback_name = if skill_name_input.is_empty() {
        install_name.clone()
    } else {
        skill_name_input.clone()
    };
    let metadata = read_skill_metadata(&skill_md, &fallback_name);
    let description = if metadata.description.is_empty() {
        skill_description_input.clone()
    } else {
        metadata.description
    };
    validate_targets(target_ids)?;
    let selected_targets: Vec<String> = target_ids.to_vec();

    let id = format!("{repo_owner}/{repo_name}:{source_dir}");
    let mut installed = Map::new();
    installed.insert("id".to_string(), json!(id));
    installed.insert("key".to_string(), json!(id));
    installed.insert("name".to_string(), json!(metadata.name));
    installed.insert("description".to_string(), json!(description));
    installed.insert("directory".to_string(), json!(install_name));
    installed.insert("sourceDirectory".to_string(), json!(source_dir));
    // readmeUrl always uses uppercase SKILL.md (as upstream).
    installed.insert(
        "readmeUrl".to_string(),
        json!(github_doc_url(
            &repo_owner,
            &repo_name,
            &branch,
            &format!("{source_dir}/SKILL.md")
        )),
    );
    installed.insert("repoOwner".to_string(), json!(repo_owner));
    installed.insert("repoName".to_string(), json!(repo_name));
    installed.insert("repoBranch".to_string(), json!(branch));
    installed.insert("installedAt".to_string(), json!(now_ms()));
    installed.insert("contentHash".to_string(), json!(hash_directory(&dest)));
    if let Some(signature) = source_signature_from_tree(&tree, &source_dir) {
        installed.insert("sourceSignature".to_string(), json!(signature));
    }
    installed.insert("targets".to_string(), json!(&selected_targets));

    registry.skills.retain(|entry| {
        entry.get("id").and_then(Value::as_str) != Some(id.as_str())
            && !eq_ignore_case(&js_string(entry.get("directory")), &install_name)
    });
    registry.skills.push(Value::Object(installed.clone()));
    save_registry(&registry)?;

    let (_, target_results) = sync_targets_with_results(&install_name, &selected_targets);
    append_activity(json!({
        "action": "install",
        "name": installed.get("name").cloned().unwrap_or(Value::Null),
        "directory": install_name,
        "targets": &selected_targets,
        "source": format!("{repo_owner}/{repo_name}"),
    }));
    let mut skill = installed;
    skill.insert("managed".to_string(), json!(true));
    Ok(json!({"ok": true, "skill": Value::Object(skill), "targetResults": target_results}))
}

/// upstream uninstallSkill: once every target is removed the SSOT copy moves to .trash (restorable for
/// 5 minutes); when the rename fails or the SSOT copy is missing it is deleted for good.
pub(super) fn uninstall_skill(id: &str) -> SkillResult<Value> {
    let mut registry = read_registry();
    let Some(position) = find_skill_position(&registry.skills, id) else {
        return Err(SkillError::coded("not_found", "Managed skill not found"));
    };
    let skill = registry.skills[position].clone();
    let directory = js_string(skill.get("directory"));
    let entry_id = skill.get("id").and_then(Value::as_str).map(str::to_string);
    let ssot_path = managed_skill_path(&directory)?;
    let all_targets: Vec<String> = TARGETS.iter().map(|target| target.id.to_string()).collect();
    let target_results = remove_targets_with_results(&directory, &all_targets);
    let skill_name = skill.get("name").cloned().unwrap_or(Value::Null);
    if fs::exists(&ssot_path) {
        ensure_dir(&trash_dir())?;
        let stamp = now_ms();
        let trash_name = format!("{}-{stamp}", base64url_no_pad(&directory));
        let trash_path = trash_dir().join(&trash_name);
        if fs::rename(&ssot_path, &trash_path).is_ok() {
            if let Some(parent) = ssot_path.parent() {
                remove_empty_ancestors(parent, &ssot_dir());
            }
            let mut trashed = skill.as_object().cloned().unwrap_or_default();
            trashed.insert("trashedAt".to_string(), json!(stamp));
            trashed.insert("trashedDirectory".to_string(), json!(trash_name));
            trashed.insert(
                "previousTargets".to_string(),
                skill.get("targets").cloned().unwrap_or_else(|| json!([])),
            );
            trashed.insert("targets".to_string(), json!([]));
            registry
                .skills
                .retain(|entry| entry.get("id").and_then(Value::as_str) != entry_id.as_deref());
            registry.skills.push(Value::Object(trashed));
            save_registry(&registry)?;
            purge_expired_trash();
            append_activity(
                json!({"action": "uninstall", "name": skill_name, "directory": directory}),
            );
            return Ok(json!({
                "ok": true,
                "trashed": true,
                "restoreId": skill.get("id").cloned().unwrap_or(Value::Null),
                "ttlMs": TRASH_TTL_MS,
                "targetResults": target_results,
            }));
        }
        // The rename failed: delete it for good instead.
        remove_path(&ssot_path);
        if let Some(parent) = ssot_path.parent() {
            remove_empty_ancestors(parent, &ssot_dir());
        }
    }
    registry
        .skills
        .retain(|entry| entry.get("id").and_then(Value::as_str) != entry_id.as_deref());
    save_registry(&registry)?;
    append_activity(json!({"action": "uninstall", "name": skill_name, "directory": directory}));
    Ok(json!({"ok": true, "trashed": false, "targetResults": target_results}))
}

/// upstream restoreSkill: within the trash window, renames it back into the SSOT and links previousTargets again.
pub(super) fn restore_skill(id: &str) -> SkillResult<Value> {
    let mut registry = read_registry();
    let Some(index) = find_skill_position(&registry.skills, id) else {
        return Err(SkillError::other("Nothing to restore"));
    };
    let skill = registry.skills[index].clone();
    let Some(trashed_at) = trashed_at_of(&skill) else {
        return Err(SkillError::coded("not_found", "Nothing to restore"));
    };
    if now_ms() as f64 - trashed_at > TRASH_TTL_MS as f64 {
        return Err(SkillError::coded("conflict", "Restore window expired"));
    }
    let directory = js_string(skill.get("directory"));
    let trash_path = trash_dir().join(js_string(skill.get("trashedDirectory")));
    let ssot_path = managed_skill_path(&directory)?;
    if !fs::exists(&trash_path) {
        return Err(SkillError::coded("not_found", "Trashed copy is missing"));
    }
    if let Some(parent) = ssot_path.parent() {
        ensure_dir(parent)?;
    }
    remove_path(&ssot_path);
    fs::rename(&trash_path, &ssot_path)?;
    let targets: Vec<String> = skill
        .get("previousTargets")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let mut restored = skill.as_object().cloned().unwrap_or_default();
    restored.insert("targets".to_string(), json!(&targets));
    restored.remove("trashedAt");
    restored.remove("trashedDirectory");
    restored.remove("previousTargets");
    registry.skills[index] = Value::Object(restored.clone());
    save_registry(&registry)?;
    validate_targets(&targets)?;
    let (_, target_results) = sync_targets_with_results(&directory, &targets);
    append_activity(json!({
        "action": "restore",
        "name": restored.get("name").cloned().unwrap_or(Value::Null),
        "directory": directory,
        "targets": &targets,
    }));
    restored.insert("managed".to_string(), json!(true));
    Ok(json!({"ok": true, "skill": Value::Object(restored), "targetResults": target_results}))
}

/// upstream setSkillTargets: syncs newly turned-on targets and removes turned-off ones.
pub(super) fn set_skill_targets(id: &str, target_ids: &[String]) -> SkillResult<Value> {
    let mut registry = read_registry();
    let Some(index) = find_skill_position(&registry.skills, id) else {
        return Err(SkillError::other("Managed skill not found"));
    };
    let skill = registry.skills[index].clone();
    let directory = js_string(skill.get("directory"));
    validate_targets(target_ids)?;
    let selected: Vec<String> = target_ids.to_vec();
    let mut target_results: Vec<Value> = Vec::new();
    for target in TARGETS.iter() {
        if selected.iter().any(|tid| tid == target.id) {
            let result = sync_skill_to_target(&directory, target.id);
            target_results.push(match result {
                Ok(()) => json!({"target": target.id, "ok": true, "error": Value::Null}),
                Err(error) => json!({"target": target.id, "ok": false, "error": error.to_string()}),
            });
        } else {
            let removed = remove_targets_with_results(&directory, &[target.id.to_string()]);
            target_results.extend(removed);
        }
    }
    let mut updated = skill.as_object().cloned().unwrap_or_default();
    updated.insert("targets".to_string(), json!(&selected));
    registry.skills[index] = Value::Object(updated.clone());
    save_registry(&registry)?;
    append_activity(json!({
        "action": "set_targets",
        "name": updated.get("name").cloned().unwrap_or(Value::Null),
        "directory": directory,
        "targets": &selected,
    }));
    updated.insert("managed".to_string(), json!(true));
    Ok(json!({"ok": true, "skill": Value::Object(updated), "targetResults": target_results}))
}

/// upstream findLocalSkillSource: the source folder holding a marker under one target.
pub(super) fn find_local_skill_source(directory: &str) -> Option<(PathBuf, String)> {
    let source_dir = sanitize_local_skill_path(directory)?;
    for target in TARGETS.iter() {
        for base_dir in target_dirs(target) {
            let Some(skill_path) = target_skill_path(&base_dir, &source_dir) else {
                continue;
            };
            if find_skill_marker(&skill_path).is_some() {
                return Some((skill_path, target.id.to_string()));
            }
        }
    }
    None
}

/// upstream importLocalSkill: copies (doesn't link) a local skill into the SSOT and records it as `local:<dir>`.
/// Read-only sources (built-in / system / plugin) can't be imported: a copy in the SSOT would overwrite
/// the original of the same name in the engine's folder, getting around the read-only protection.
pub(super) fn import_local_skill(directory: &str, target_ids: &[String]) -> SkillResult<Value> {
    let Some(source_dir) = sanitize_local_skill_path(directory) else {
        return Err(SkillError::other("Invalid skill directory"));
    };
    if let Some(kind) = readonly_kind_for_dir(&source_dir) {
        return Err(SkillError::coded(
            "readonly",
            format!(
                "This skill is provided by the app or a plugin ({}); importing it as a managed copy is not supported",
                kind.as_str()
            ),
        ));
    }
    let mut registry = read_registry();
    let existing = registry
        .skills
        .iter()
        .find(|entry| eq_ignore_case(&js_string(entry.get("directory")), &source_dir))
        .cloned();
    if let Some(existing) = existing {
        let existing_id = js_string(existing.get("id"));
        let existing_key = js_string(existing.get("key"));
        let id_or_key = if existing_id.is_empty() {
            existing_key
        } else {
            existing_id
        };
        if !id_or_key.starts_with("local:") {
            return Err(SkillError::coded(
                "conflict",
                format!(
                    "Skill directory \"{source_dir}\" is already managed by another installed skill"
                ),
            ));
        }
        if target_ids.is_empty() {
            let mut skill = existing.as_object().cloned().unwrap_or_default();
            let targets = existing
                .get("targets")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            skill.insert("managed".to_string(), json!(true));
            skill.insert("targets".to_string(), Value::Array(targets));
            return Ok(json!({"ok": true, "skill": Value::Object(skill)}));
        }
        return set_skill_targets(&js_string(existing.get("id")), target_ids);
    }

    let Some((source_path, _target_id)) = find_local_skill_source(&source_dir) else {
        return Err(SkillError::coded("not_found", "Local skill not found"));
    };
    // Remember the source folder: it belongs to the person, and sync, remove and uninstall must never overwrite or delete it.
    let preserved_source = source_path.to_string_lossy().into_owned();
    let dest = managed_skill_path(&source_dir)?;
    copy_dir(&source_path, &dest)?;
    let marker = find_skill_marker(&dest);
    let markdown = marker.and_then(|m| read_text(&m)).unwrap_or_default();
    let fallback = install_name_from_directory(&source_dir).unwrap_or_default();
    let metadata = read_skill_metadata(&markdown, &fallback);
    let discovered: Vec<String> = TARGETS
        .iter()
        .filter(|t| scan_target_skill(&source_dir, t.id))
        .map(|t| t.id.to_string())
        .collect();
    validate_targets(target_ids)?;
    let selected: Vec<String> = if target_ids.is_empty() {
        discovered
    } else {
        target_ids.to_vec()
    };

    let local_id = format!("local:{source_dir}");
    let mut skill = Map::new();
    skill.insert("id".to_string(), json!(local_id));
    skill.insert("key".to_string(), json!(local_id));
    skill.insert("name".to_string(), json!(metadata.name));
    skill.insert("description".to_string(), json!(metadata.description));
    skill.insert("directory".to_string(), json!(source_dir));
    skill.insert("sourceDirectory".to_string(), json!(source_dir));
    skill.insert("readmeUrl".to_string(), Value::Null);
    skill.insert("repoOwner".to_string(), Value::Null);
    skill.insert("repoName".to_string(), Value::Null);
    skill.insert("repoBranch".to_string(), Value::Null);
    skill.insert("installedAt".to_string(), json!(now_ms()));
    skill.insert("contentHash".to_string(), json!(hash_directory(&dest)));
    skill.insert("sourcePath".to_string(), json!(preserved_source));
    skill.insert("targets".to_string(), json!(&selected));
    registry.skills.push(Value::Object(skill.clone()));
    save_registry(&registry)?;
    let mut target_results: Vec<Value> = Vec::new();
    for target in TARGETS.iter() {
        if selected.iter().any(|tid| tid == target.id) {
            let result = sync_skill_to_target(&source_dir, target.id);
            target_results.push(match result {
                Ok(()) => json!({"target": target.id, "ok": true, "error": Value::Null}),
                Err(error) => json!({"target": target.id, "ok": false, "error": error.to_string()}),
            });
        } else {
            let removed = remove_targets_with_results(&source_dir, &[target.id.to_string()]);
            target_results.extend(removed);
        }
    }
    append_activity(json!({
        "action": "import",
        "name": skill.get("name").cloned().unwrap_or(Value::Null),
        "directory": source_dir,
        "targets": &selected,
    }));
    skill.insert("managed".to_string(), json!(true));
    Ok(json!({"ok": true, "skill": Value::Object(skill), "targetResults": target_results}))
}

/// upstream deleteLocalSkill: deletes a local skill from the given targets (all by default).
/// Read-only sources and managed entries are refused here: the first are the app's or engine's own
/// files, the second have to go through uninstall to keep the registry and the disk in step.
pub(super) fn delete_local_skill(directory: &str, target_ids: &[String]) -> SkillResult<Value> {
    let Some(install_name) = sanitize_local_skill_path(directory) else {
        return Err(SkillError::other("Invalid skill directory"));
    };
    if let Some(kind) = readonly_kind_for_dir(&install_name) {
        return Err(SkillError::coded(
            "readonly",
            format!(
                "This skill is provided by the app, the engine, or a plugin ({}); it is read-only here",
                kind.as_str()
            ),
        ));
    }
    let registry = read_registry();
    let managed = registry.skills.iter().any(|entry| {
        trashed_at_of(entry).is_none()
            && eq_ignore_case(&js_string(entry.get("directory")), &install_name)
    });
    if managed {
        return Err(SkillError::coded(
            "conflict",
            "This skill is managed by the app; uninstall it instead of deleting the engine copies",
        ));
    }
    let selected: Vec<String> = if target_ids.is_empty() {
        TARGETS.iter().map(|target| target.id.to_string()).collect()
    } else {
        target_ids.to_vec()
    };
    validate_targets(&selected)?;
    let target_results = remove_targets_with_results(&install_name, &selected);
    append_activity(
        json!({"action": "delete_local", "directory": install_name, "targets": &selected}),
    );
    Ok(json!({"ok": true, "targetResults": target_results}))
}
