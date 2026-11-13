// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//! The skills hub: skills from GitHub repositories, installed once into Misty's own folder and
//! synced into each engine's skills folder. Upstream traces back to TokenTracker's
//! `skills-manager.js` / `skill-usage.js` (MIT).
//!
//! Two commands, matching the reference implementation's HTTP endpoints, consumed by the renderer
//! as a discriminated union (`src/features/engine-config/skills/api.ts`):
//! - [`engine_skills_query`]: installed / discover / search / repos / popular / updates /
//!   activity / skill_content / remote_skill_content / skill_usage
//! - [`engine_skills_mutate`]: install / uninstall / restore / set_targets / import_local /
//!   delete_local / add_repo / remove_repo
//!
//! Mutations that sync several targets report each one in `targetResults`; `ok` only says whether
//! the main operation (the registry change) succeeded, so a partial failure never passes for a
//! full success. Errors serialize as `{ code, message }`, with code one of rate_limited /
//! invalid_input / not_found / conflict / readonly / permission / network / http / internal, so
//! the renderer can offer the matching way out.

use serde::Serialize;
use serde_json::{json, Value};

mod core;
mod discover;
mod fsutil;
mod http;
mod lifecycle;
mod registry;
mod repos;
mod scan;
mod target_sync;
mod updates_popular;
mod usage;

use core::*;
use discover::*;
use fsutil::*;
use http::*;
use lifecycle::*;
use registry::*;
use repos::*;
#[cfg(test)]
use scan::*;
use target_sync::*;
use updates_popular::*;
use usage::*;

/// Grants the file gate every engine skills folder the hub syncs into, following each CLI's own
/// home variable. Runs once as the app starts.
pub fn allow_skill_targets() {
    for target in TARGETS.iter() {
        for home in target_home_dirs(target) {
            file_access::allow_engine_config_folder(&home);
        }
    }
}

/// Repoints engines' skill links left leading into another of Misty's folders (an older version's,
/// or the layout from before profiles). Runs once at launch, after `allow_skill_targets`.
pub fn repoint_skill_links() {
    target_sync::repoint_links_from_other_folders();
}

/// A normalized error: Tauri hands the serialized `Err` to the renderer (not a string).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubError {
    code: &'static str,
    message: String,
}

impl From<SkillError> for HubError {
    fn from(error: SkillError) -> Self {
        match error {
            SkillError::RateLimited(message) => Self {
                code: "rate_limited",
                message,
            },
            SkillError::Coded(code, message) => Self { code, message },
            SkillError::Other(message) => Self {
                code: "internal",
                message,
            },
        }
    }
}

/// A query's `force` counts only as the string "1" (as upstream `get("force") === "1"`).
fn param_force(params: &Value) -> bool {
    params.get("force").and_then(Value::as_str) == Some("1")
}

/// A string array from the payload; a missing or non-array key is None (the caller picks the default).
fn string_array_param(payload: &Value, key: &str) -> Option<Vec<String>> {
    payload.get(key).and_then(Value::as_array).map(|arr| {
        arr.iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect()
    })
}

/// Reads from the skills hub.
#[tauri::command]
pub async fn engine_skills_query(mode: String, params: Value) -> Result<Value, HubError> {
    let mode = if mode.is_empty() {
        "installed"
    } else {
        mode.as_str()
    };
    match mode {
        "installed" => {
            let payload = tokio::task::spawn_blocking(|| {
                json!({
                    "targets": target_list(),
                    "skills": list_installed_skills(),
                    "generatedAt": now_ms(),
                })
            })
            .await
            .map_err(|e| HubError::from(SkillError::other(format!("skills task failed: {e}"))))?;
            Ok(payload)
        }
        "repos" => Ok(json!({"repos": list_repos()})),
        "discover" => discover_skills(param_force(&params))
            .await
            .map_err(HubError::from),
        "search" => {
            let q = js_string(params.get("q"));
            let limit = js_number_or(params.get("limit"), 20.0);
            let offset = js_number_or(params.get("offset"), 0.0);
            let client = http_client().map_err(HubError::from)?;
            search_skills_sh(&client, &q, limit, offset)
                .await
                .map_err(HubError::from)
        }
        "popular" => {
            let limit = js_number_or(params.get("limit"), 60.0);
            fetch_popular_skills_sh(param_force(&params), limit)
                .await
                .map_err(HubError::from)
        }
        "updates" => check_updates(param_force(&params))
            .await
            .map_err(HubError::from),
        "activity" => {
            let limit = js_number_or(params.get("limit"), 50.0) as i64;
            let payload =
                tokio::task::spawn_blocking(move || json!({"activity": read_activity(limit)}))
                    .await
                    .map_err(|e| {
                        HubError::from(SkillError::other(format!("skills task failed: {e}")))
                    })?;
            Ok(payload)
        }
        "skill_content" => {
            let directory = js_string(params.get("directory"));
            let payload = tokio::task::spawn_blocking(move || read_skill_content(&directory))
                .await
                .map_err(|e| HubError::from(SkillError::other(format!("skills task failed: {e}"))))?
                .map_err(HubError::from)?;
            Ok(payload)
        }
        // skills.sh gives only name / repo / installs: the details come from the repo's SKILL.md.
        "remote_skill_content" => {
            let owner = js_string(params.get("owner"));
            let name = js_string(params.get("name"));
            let branch = {
                let branch = js_string(params.get("branch"));
                if branch.is_empty() {
                    crate::known_names::DEFAULT_BRANCH.to_string()
                } else {
                    branch
                }
            };
            let directory = js_string(params.get("directory"));
            remote_skill_content(&owner, &name, &branch, &directory)
                .await
                .map_err(HubError::from)
        }
        "skill_usage" => {
            let force = param_force(&params);
            let payload = tokio::task::spawn_blocking(move || skill_usage_query(force))
                .await
                .map_err(|e| {
                    HubError::from(SkillError::other(format!("skills task failed: {e}")))
                })?;
            Ok(payload)
        }
        _ => Err(HubError::from(SkillError::coded(
            "invalid_input",
            "Unknown skills mode",
        ))),
    }
}

/// Changes the skills hub.
#[tauri::command]
pub async fn engine_skills_mutate(action: String, payload: Value) -> Result<Value, HubError> {
    match action.as_str() {
        "install" => {
            let skill = payload.get("skill").cloned().unwrap_or(Value::Null);
            let targets = string_array_param(&payload, "targets")
                .unwrap_or_else(|| vec!["claude".to_string(), "codex".to_string()]);
            // `force` acknowledges that a locally modified managed copy will
            // be overwritten (updates); without it the backend refuses.
            let force = payload
                .get("force")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            install_skill(&skill, &targets, force)
                .await
                .map_err(HubError::from)
        }
        "uninstall" => uninstall_skill(&js_string(payload.get("id"))).map_err(HubError::from),
        "restore" => restore_skill(&js_string(payload.get("id"))).map_err(HubError::from),
        "set_targets" => {
            let targets = string_array_param(&payload, "targets").unwrap_or_default();
            set_skill_targets(&js_string(payload.get("id")), &targets).map_err(HubError::from)
        }
        "import_local" => {
            let targets = string_array_param(&payload, "targets").unwrap_or_default();
            import_local_skill(&js_string(payload.get("directory")), &targets)
                .map_err(HubError::from)
        }
        "delete_local" => {
            let targets = string_array_param(&payload, "targets").unwrap_or_default();
            delete_local_skill(&js_string(payload.get("directory")), &targets)
                .map_err(HubError::from)
        }
        "add_repo" => add_repo(payload.get("repo").unwrap_or(&Value::Null)).map_err(HubError::from),
        "remove_repo" => remove_repo(
            &js_string(payload.get("owner")),
            &js_string(payload.get("name")),
        )
        .map_err(HubError::from),
        _ => Err(HubError::from(SkillError::coded(
            "invalid_input",
            "Unknown skills action",
        ))),
    }
}

#[cfg(test)]
mod tests;
