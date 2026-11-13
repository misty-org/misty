// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//! Syncing the hub's copy of a skill into each engine's skills folder, and listing what is installed.

use file_access::fs;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use super::core::*;
use super::fsutil::*;
use super::registry::*;
use super::scan::*;
// ===== classify / scan / sync / remove / the installed list =====

/// The three disk states of one (skill, target) (the multi-folder core of upstream classifyTargetSkill):
/// present under any baseDir (a resolvable link or a real folder) → "synced" (short-circuits);
/// else a dangling link → "orphan"; else "off".
pub(super) fn classify_in_dirs(directory: &str, base_dirs: &[PathBuf]) -> &'static str {
    let mut state = "off";
    for base_dir in base_dirs {
        let Some(candidate) = target_skill_path(base_dir, directory) else {
            continue;
        };
        if fs::exists(&candidate) {
            return "synced";
        }
        if is_symlink(&candidate) {
            state = "orphan";
        }
    }
    state
}

pub(super) fn classify_target_skill(directory: &str, target_id: &str) -> &'static str {
    let Some(target) = target_by_id(target_id) else {
        return "off";
    };
    classify_in_dirs(directory, &target_dirs(target))
}

/// upstream scanTargetSkill: true when the candidate exists under any baseDir (links included).
pub(super) fn scan_target_skill(directory: &str, target_id: &str) -> bool {
    let Some(target) = target_by_id(target_id) else {
        return false;
    };
    target_dirs(target).iter().any(|base_dir| {
        target_skill_path(base_dir, directory)
            .map(|candidate| fs::exists(&candidate) || is_symlink(&candidate))
            .unwrap_or(false)
    })
}

/// The local source folder recorded at import: the person's own files, which sync and remove must
/// avoid, or managing it would silently overwrite or delete their local copy.
fn preserved_source_for(directory: &str) -> Option<PathBuf> {
    let registry = read_registry();
    registry
        .skills
        .iter()
        .filter(|entry| trashed_at_of(entry).is_none())
        .find(|entry| eq_ignore_case(&js_string(entry.get("directory")), directory))
        .and_then(|entry| entry.get("sourcePath"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// upstream syncSkillToTarget: a link from the SSOT into the target, falling back to a full recursive copy on any failure.
pub(super) fn sync_skill_to_target(directory: &str, target_id: &str) -> SkillResult<()> {
    let target = target_by_id(target_id)
        .ok_or_else(|| SkillError::other(format!("Unsupported target: {target_id}")))?;
    let source = managed_skill_path(directory)?;
    if !fs::exists(&source) {
        return Err(SkillError::other(format!(
            "Managed skill not found: {directory}"
        )));
    }
    let preserved = preserved_source_for(directory);
    for base_dir in target_dirs(target) {
        let dest = target_skill_path(&base_dir, directory)
            .ok_or_else(|| SkillError::other(format!("Invalid skill directory: {directory}")))?;
        // The person's own source copy stays as it is; it already counts as this target's copy.
        if preserved.as_deref() == Some(dest.as_path()) {
            continue;
        }
        assert_not_nested(&source, &dest)?;
        if let Some(parent) = dest.parent() {
            ensure_dir(parent)?;
        }
        remove_path(&dest);
        if symlink_dir(&source, &dest).is_err() {
            copy_dir(&source, &dest)?;
        }
    }
    Ok(())
}

/// upstream removeSkillFromTarget: removePath, then clear empty ancestors up to baseDir.
pub(super) fn remove_skill_from_target(directory: &str, target_id: &str) {
    let Some(target) = target_by_id(target_id) else {
        return;
    };
    let preserved = preserved_source_for(directory);
    for base_dir in target_dirs(target) {
        let Some(target_path) = target_skill_path(&base_dir, directory) else {
            continue;
        };
        if preserved.as_deref() == Some(target_path.as_path()) {
            continue;
        }
        remove_path(&target_path);
        if let Some(parent) = target_path.parent() {
            remove_empty_ancestors(parent, &base_dir);
        }
    }
}

// ===== Multi-target results (reported per target, a partial failure never hidden behind one ok) =====

/// Syncs each target and collects the results, so the UI can tell "all synced" from "some failed"
/// rather than getting a blanket success.
pub(super) fn sync_targets_with_results(
    directory: &str,
    target_ids: &[String],
) -> (bool, Vec<Value>) {
    let mut all_ok = true;
    let mut results = Vec::new();
    for target_id in target_ids {
        match sync_skill_to_target(directory, target_id) {
            Ok(()) => results.push(json!({"target": target_id, "ok": true, "error": Value::Null})),
            Err(error) => {
                all_ok = false;
                results.push(json!({"target": target_id, "ok": false, "error": error.to_string()}));
            }
        }
    }
    (all_ok, results)
}

/// Removes from each target and reads the result back: ok = no folder or dangling link of the skill
/// left there. Deleting is best-effort (as upstream), but the result isn't silent: the UI can say
/// which engine's copy wasn't fully removed. `kept` marks a target holding the person's own source
/// copy (never in scope for deletion, so keeping it is the right result), which the UI mustn't call removed.
pub(super) fn remove_targets_with_results(directory: &str, target_ids: &[String]) -> Vec<Value> {
    let preserved = preserved_source_for(directory);
    let mut results = Vec::new();
    for target_id in target_ids {
        // The person's own source copy isn't in scope for deletion: keeping it is the right result.
        let keep_preserved = preserved.as_deref().is_some_and(|path| {
            target_by_id(target_id).is_some_and(|target| {
                target_dirs(target)
                    .iter()
                    .any(|base_dir| target_skill_path(base_dir, directory).as_deref() == Some(path))
            })
        });
        remove_skill_from_target(directory, target_id);
        let gone = !scan_target_skill(directory, target_id);
        results.push(json!({
            "target": target_id,
            "ok": gone || keep_preserved,
            "kept": keep_preserved,
            "error": if gone || keep_preserved { Value::Null } else { json!("copy still present") },
        }));
    }
    results
}

/// Checks the target list from the renderer: an unknown id is refused (not silently dropped).
pub(super) fn validate_targets(target_ids: &[String]) -> SkillResult<()> {
    for id in target_ids {
        if target_by_id(id).is_none() {
            return Err(SkillError::coded(
                "invalid_input",
                format!("Unsupported target: {id}"),
            ));
        }
    }
    Ok(())
}

/// Finds a registry skill by `id == id || key == id` (shared by several upstream mutations).
pub(super) fn find_skill_position(skills: &[Value], id: &str) -> Option<usize> {
    skills.iter().position(|entry| {
        entry.get("id").and_then(Value::as_str) == Some(id)
            || entry.get("key").and_then(Value::as_str) == Some(id)
    })
}

/// upstream listInstalledSkills: purge the trash, then merge managed and unmanaged, sorted by name.
pub(super) fn list_installed_skills() -> Vec<Value> {
    purge_expired_trash();
    let registry = read_registry();
    let mut managed: Vec<Value> = Vec::new();
    for skill in &registry.skills {
        if trashed_at_of(skill).is_some() {
            continue;
        }
        let directory = js_string(skill.get("directory"));
        let intended: HashSet<String> = skill
            .get("targets")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let mut target_states = Map::new();
        let mut targets: Vec<Value> = Vec::new();
        for target in TARGETS.iter() {
            let mut state = classify_target_skill(&directory, target.id);
            // The registry wants it but it's gone from disk → orphan.
            if state == "off" && intended.contains(target.id) {
                state = "orphan";
            }
            target_states.insert(target.id.to_string(), json!(state));
            if state == "synced" {
                targets.push(json!(target.id));
            }
        }
        let mut entry = skill.as_object().cloned().unwrap_or_default();
        entry.insert("managed".to_string(), json!(true));
        entry.insert("targets".to_string(), Value::Array(targets));
        entry.insert("targetStates".to_string(), Value::Object(target_states));
        managed.push(Value::Object(entry));
    }

    let managed_dirs: HashSet<String> = managed
        .iter()
        .map(|skill| js_string(skill.get("directory")).to_lowercase())
        .collect();

    // Unmanaged: the local skills of every target plus the read-only sources (Codex `.system`, Codex
    // plugin cache), merged across sources by lowercased directory. Skills from read-only sources are
    // marked with sourceKind/readonly so the UI turns off their delete.
    let mut unmanaged: Vec<Value> = Vec::new();
    let mut unmanaged_index: HashMap<String, usize> = HashMap::new();

    /// Source priority when merging the same skill: read-only protection outranks a plain local entry.
    fn kind_rank(kind: &str) -> u8 {
        match kind {
            "builtin" => 4,
            "system" => 3,
            "plugin" => 2,
            _ => 1,
        }
    }

    let mut roots: Vec<(PathBuf, Option<&'static Target>, Option<&'static str>)> = Vec::new();
    for target in TARGETS.iter() {
        for base_dir in target_dirs(target) {
            roots.push((base_dir, Some(target), None));
        }
    }
    for source in readonly_sources() {
        roots.push((source.dir, None, Some(source.kind.as_str())));
    }

    for (base_dir, target, readonly_kind) in roots {
        for directory in scan_skill_directories(&base_dir) {
            if directory.is_empty() || managed_dirs.contains(&directory.to_lowercase()) {
                continue;
            }
            let Some(marker) = find_skill_marker(&base_dir.join(&directory)) else {
                continue;
            };
            let markdown = read_text(&marker).unwrap_or_default();
            let fallback =
                install_name_from_directory(&directory).unwrap_or_else(|| directory.clone());
            let metadata = read_skill_metadata(&markdown, &fallback);
            // Built-in skill names (Misty ships none today) and the read-only source
            // folders themselves are all read-only.
            let kind = if is_bundled_skill_name(&directory) {
                "builtin".to_string()
            } else if let Some(kind) = readonly_kind {
                kind.to_string()
            } else {
                "local".to_string()
            };
            let key = directory.to_lowercase();
            let index = match unmanaged_index.get(&key) {
                Some(&i) => i,
                None => {
                    let target_states: Map<String, Value> = TARGETS
                        .iter()
                        .map(|t| (t.id.to_string(), json!("off")))
                        .collect();
                    unmanaged.push(json!({
                        "id": format!("local:{directory}"),
                        "key": format!("local:{directory}"),
                        "name": metadata.name,
                        "description": metadata.description,
                        "directory": directory,
                        "readmeUrl": Value::Null,
                        "repoOwner": Value::Null,
                        "repoName": Value::Null,
                        "repoBranch": Value::Null,
                        "installedAt": Value::Null,
                        "managed": false,
                        "sourceKind": kind,
                        "readonly": kind != "local",
                        "targets": [],
                        "targetStates": Value::Object(target_states),
                        "targetPaths": {},
                    }));
                    unmanaged_index.insert(key, unmanaged.len() - 1);
                    unmanaged.len() - 1
                }
            };
            let entry = &mut unmanaged[index];
            let current_kind = js_string(entry.get("sourceKind"));
            if kind_rank(&kind) > kind_rank(&current_kind) {
                entry["sourceKind"] = json!(kind);
                entry["readonly"] = json!(kind != "local");
            }
            // A read-only source isn't any engine's managed copy: it takes no part in targetStates' synced flags.
            let Some(target) = target else {
                if let Some(paths) = entry.get_mut("targetPaths").and_then(Value::as_object_mut) {
                    let label = format!("{}:{}", kind, base_dir.to_string_lossy());
                    paths
                        .entry(label)
                        .or_insert_with(|| json!(base_dir.join(&directory).to_string_lossy()));
                }
                continue;
            };
            if let Some(targets) = entry.get_mut("targets").and_then(Value::as_array_mut) {
                if !targets.iter().any(|t| t.as_str() == Some(target.id)) {
                    targets.push(json!(target.id));
                }
            }
            if let Some(states) = entry.get_mut("targetStates").and_then(Value::as_object_mut) {
                states.insert(target.id.to_string(), json!("synced"));
            }
            if let Some(paths) = entry.get_mut("targetPaths").and_then(Value::as_object_mut) {
                // Only the first target path that matches is recorded.
                paths
                    .entry(target.id.to_string())
                    .or_insert_with(|| json!(base_dir.join(&directory).to_string_lossy()));
            }
        }
    }

    managed.extend(unmanaged);
    // Code point order (a planned difference from upstream's localeCompare); Rust's sort_by is stable.
    managed.sort_by_key(|a| js_string(a.get("name")));
    managed
}

/// Reads an installed or local skill's SKILL.md (for the details panel). The folder argument goes
/// through the same relative-path sanitizing and link checks as every other entry point; only the
/// text and a truncation flag come back, and no absolute path from the renderer is accepted.
pub(super) const SKILL_CONTENT_MAX_BYTES: usize = 512 * 1024;

pub(super) fn read_skill_content(directory: &str) -> SkillResult<Value> {
    let Some(safe) = sanitize_local_skill_path(directory) else {
        return Err(SkillError::coded(
            "invalid_input",
            "Invalid skill directory",
        ));
    };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(managed) = managed_skill_path(&safe) {
        candidates.push(managed);
    }
    for target in TARGETS.iter() {
        for base_dir in target_dirs(target) {
            if let Some(path) = target_skill_path(&base_dir, &safe) {
                candidates.push(path);
            }
        }
    }
    for source in readonly_sources() {
        if let Some(path) = target_skill_path(&source.dir, &safe) {
            candidates.push(path);
        }
    }
    for candidate in candidates {
        let Some(marker) = find_skill_marker(&candidate) else {
            continue;
        };
        let bytes = fs::read(&marker).map_err(SkillError::from)?;
        let truncated = bytes.len() > SKILL_CONTENT_MAX_BYTES;
        let slice = if truncated {
            &bytes[..SKILL_CONTENT_MAX_BYTES]
        } else {
            &bytes[..]
        };
        return Ok(json!({
            "directory": safe,
            "path": marker.to_string_lossy(),
            "markdown": String::from_utf8_lossy(slice).into_owned(),
            "truncated": truncated,
        }));
    }
    Err(SkillError::coded(
        "not_found",
        "SKILL.md not found for this skill",
    ))
}

/// Repoints engines' skill links that lead into another of Misty's folders at this one's copy of
/// the skill. A new release version's folder starts as a copy of the last one, and the layout from
/// before profiles moved into the first profile, so a link made then still leads to the old place.
/// Dev and named builds only take over links from the layout before profiles: links into a release
/// version's folder belong to whichever release ran last.
pub(super) fn repoint_links_from_other_folders() {
    use file_access::paths::{self, Profile};
    let (Some(root), Some(own)) = (paths::misty_root_dir(), paths::misty_home_dir()) else {
        return;
    };
    let release = matches!(paths::profile(), Profile::Release { .. });
    let managed = ssot_dir();
    for target in TARGETS.iter() {
        for base_dir in target_dirs(target) {
            let Ok(entries) = fs::read_dir(&base_dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let link = entry.path();
                let Ok(points_at) = fs::read_link(&link) else {
                    continue;
                };
                let Some(skill) = skill_in_other_folder(&points_at, &root, &own, release) else {
                    continue;
                };
                let ours = managed.join(&skill);
                if ours == points_at || !fs::is_dir(&ours) {
                    continue;
                }
                remove_path(&link);
                if symlink_dir(&ours, &link).is_err() {
                    let _ = copy_dir(&ours, &link);
                }
            }
        }
    }
}

/// The skill `points_at` names when it lies in another of Misty's folders' skills hub: the layout
/// from before profiles (`~/.misty/engine-config/...`), or, for a release build, another release
/// version's (`~/.misty/<channel>/<version>/engine-config/...`).
fn skill_in_other_folder(
    points_at: &Path,
    root: &Path,
    own: &Path,
    release: bool,
) -> Option<String> {
    if points_at.starts_with(own) {
        return None;
    }
    let rest = points_at.strip_prefix(root).ok()?;
    let parts: Vec<String> = rest
        .components()
        .map(|part| part.as_os_str().to_string_lossy().into_owned())
        .collect();
    let hub = ["engine-config", "skills-hub", "managed"];
    let after = if parts.len() == 4 && parts[..3] == hub {
        &parts[3..]
    } else if release
        && parts.len() == 6
        && parts[2..5] == hub
        && parts[0] != file_access::paths::DEV_FOLDER
        && parts[0] != file_access::paths::CUSTOM_FOLDER
    {
        &parts[5..]
    } else {
        return None;
    };
    after.first().cloned()
}
