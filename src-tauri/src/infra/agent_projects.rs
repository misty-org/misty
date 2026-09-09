//! Code projects on this device (docs/plans/agent-code-projects.md): folders
//! the person shared with write access, where agents edit files and run
//! sandboxed commands. They live beside read-only shared folders in
//! `local_agent_scopes`, marked `access='write'`.
use std::{fs, path::PathBuf};

use chrono::Utc;
use misty_agent_code::{CodeService, Project};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult},
    infra::agents::{device_id, io_error, run_db, validation_error, AgentService},
};

impl AgentService {
    /// Shares a folder the person chose as a project. A folder already shared
    /// read-only becomes a project under the same id.
    pub async fn register_project_scope(&self, path: PathBuf, code: &CodeService) -> ApiResult<Value> {
        let root = fs::canonicalize(&path)
            .map_err(|error| ApiError::Message(format!("Could not open that folder: {error}")))?;
        if !root.is_dir() {
            return Err(ApiError::Message("Choose a folder, not a file.".into()));
        }
        code.check_root(&root)
            .map_err(|error| ApiError::Message(error.to_string()))?;
        run_db(self.database_path.clone(), move |connection| {
            let device = device_id(connection)?;
            let local_path = root.to_string_lossy().into_owned();
            let display_name = root
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| local_path.clone());
            let existing: Option<String> = connection
                .query_row(
                    "SELECT id FROM local_agent_scopes WHERE local_path=?1",
                    [&local_path],
                    |row| row.get(0),
                )
                .optional()?;
            let id = match existing {
                Some(id) => {
                    connection.execute(
                        "UPDATE local_agent_scopes SET access='write' WHERE id=?1",
                        [&id],
                    )?;
                    id
                }
                None => {
                    let id = format!("scope_{}", Uuid::new_v4().simple());
                    connection.execute(
                        "INSERT INTO local_agent_scopes(id,device_id,display_name,local_path,created_at,access) VALUES(?1,?2,?3,?4,?5,'write')",
                        rusqlite::params![id, device, display_name, local_path, Utc::now().to_rfc3339()],
                    )?;
                    id
                }
            };
            Ok(json!({ "id": id, "displayName": display_name, "kind": "project_folder", "allowInstalls": false }))
        })
        .await
    }

    /// Lets agents change a folder that was shared read-only: it becomes a
    /// project. Only the person can do this, from Misty's own window.
    pub async fn allow_project_changes(&self, scope_id: String, code: &CodeService) -> ApiResult<()> {
        let lookup = scope_id.clone();
        let path: String = run_db(self.database_path.clone(), move |connection| {
            connection.query_row(
                "SELECT local_path FROM local_agent_scopes WHERE id=?1",
                [&lookup],
                |row| row.get(0),
            )
        })
        .await?;
        let root = fs::canonicalize(&path)
            .map_err(|_| ApiError::Message("That folder is no longer on this computer.".into()))?;
        if root.to_string_lossy() != path {
            return Err(ApiError::Message("That folder moved. Add it again as a project.".into()));
        }
        code.check_root(&root)
            .map_err(|error| ApiError::Message(error.to_string()))?;
        run_db(self.database_path.clone(), move |connection| {
            connection.execute(
                "UPDATE local_agent_scopes SET access='write' WHERE id=?1",
                [&scope_id],
            )?;
            Ok(())
        })
        .await
    }

    /// Whether agents may push this project's branches, and its default branch.
    pub async fn set_project_push(&self, scope_id: String, allow: bool, allow_default: bool) -> ApiResult<()> {
        run_db(self.database_path.clone(), move |connection| {
            let changed = connection.execute(
                "UPDATE local_agent_scopes SET allow_push=?2, allow_push_default=?3 WHERE id=?1 AND access='write'",
                rusqlite::params![scope_id, allow as i64, (allow && allow_default) as i64],
            )?;
            if changed == 0 {
                return Err(validation_error("That project no longer exists."));
            }
            Ok(())
        })
        .await
    }

    /// (agents may push, agents may push the default branch)
    pub async fn push_settings(&self, scope_id: String) -> ApiResult<(bool, bool)> {
        run_db(self.database_path.clone(), move |connection| {
            connection.query_row(
                "SELECT allow_push,allow_push_default FROM local_agent_scopes WHERE id=?1 AND access='write'",
                [&scope_id],
                |row| Ok((row.get::<_, i64>(0)? != 0, row.get::<_, i64>(1)? != 0)),
            )
        })
        .await
    }

    /// Creates `<parent>/<name>` as a new project (a Git repository when
    /// `git_init`), for New project and From GitHub.
    pub async fn create_project_folder(
        &self,
        parent: PathBuf,
        name: &str,
        code: &CodeService,
    ) -> ApiResult<(Value, PathBuf)> {
        let name = name.trim();
        let valid = !name.is_empty()
            && name.len() <= 100
            && !name.starts_with('.')
            && !name.contains(['/', '\\', ':', '\0'])
            && name.chars().all(|c| !c.is_control());
        if !valid {
            return Err(ApiError::Message("Use a short folder name without slashes.".into()));
        }
        let parent = fs::canonicalize(&parent)
            .map_err(|error| ApiError::Message(format!("Could not open that folder: {error}")))?;
        let folder = parent.join(name);
        if folder.exists() {
            return Err(ApiError::Message(format!("{name} already exists there. Pick another name or place.")));
        }
        code.check_root(&folder)
            .map_err(|error| ApiError::Message(error.to_string()))?;
        fs::create_dir(&folder)
            .map_err(|error| ApiError::Message(format!("Could not create the folder: {error}")))?;
        let registered = self.register_project_scope(folder.clone(), code).await;
        if registered.is_err() {
            let _ = fs::remove_dir(&folder);
        }
        let folder = fs::canonicalize(&folder).unwrap_or(folder);
        Ok((registered?, folder))
    }

    /// Lets a project's commands install packages through the proxy, or not.
    pub async fn set_project_installs(&self, scope_id: String, allow: bool) -> ApiResult<()> {
        run_db(self.database_path.clone(), move |connection| {
            let changed = connection.execute(
                "UPDATE local_agent_scopes SET allow_installs=?2 WHERE id=?1 AND access='write'",
                rusqlite::params![scope_id, allow as i64],
            )?;
            if changed == 0 {
                return Err(validation_error("That project no longer exists."));
            }
            Ok(())
        })
        .await
    }

    /// The project behind a scope id, only when it is shared with write access
    /// and its folder still exists.
    pub async fn project(&self, scope_id: String) -> ApiResult<Project> {
        run_db(self.database_path.clone(), move |connection| {
            let (path, allow): (String, i64) = connection.query_row(
                "SELECT local_path,allow_installs FROM local_agent_scopes WHERE id=?1 AND access='write'",
                [&scope_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let root = fs::canonicalize(&path).map_err(io_error)?;
            if root.to_string_lossy() != path {
                // The folder moved or a symlink replaced it: share it again.
                return Err(validation_error("The project folder moved."));
            }
            Ok(Project {
                scope_id,
                root,
                allow_installs: allow != 0,
            })
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(flavor = "multi_thread")]
    async fn projects_are_write_scopes_with_their_own_install_switch() {
        let state = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        let service = AgentService {
            database_path: state.path().join("misty.db"),
        };
        let code = CodeService::new(data.path().to_path_buf(), dirs::home_dir());
        let shared = service
            .register_folder_scope(folder.path().to_path_buf())
            .await
            .unwrap();
        let project = service
            .register_project_scope(folder.path().to_path_buf(), &code)
            .await
            .unwrap();
        assert_eq!(shared["id"], project["id"], "a shared folder becomes a project");
        let id = project["id"].as_str().unwrap().to_owned();
        let snapshot = service.device_snapshot().await.unwrap();
        assert_eq!(snapshot["scopes"][0]["kind"], "project_folder");
        assert_eq!(snapshot["scopes"][0]["allowInstalls"], false);

        assert!(!service.project(id.clone()).await.unwrap().allow_installs);
        service.set_project_installs(id.clone(), true).await.unwrap();
        assert!(service.project(id.clone()).await.unwrap().allow_installs);

        let read_only = tempfile::tempdir().unwrap();
        let other = service
            .register_folder_scope(read_only.path().to_path_buf())
            .await
            .unwrap();
        let other_id = other["id"].as_str().unwrap().to_owned();
        assert!(service.project(other_id.clone()).await.is_err(), "read-only folders aren't projects");
        assert!(service.set_project_installs(other_id.clone(), true).await.is_err());

        service.allow_project_changes(other_id.clone(), &code).await.unwrap();
        assert!(service.project(other_id).await.is_ok(), "allowed changes make it a project");

        if let Some(home) = dirs::home_dir() {
            assert!(service.register_project_scope(home, &code).await.is_err());
        }
    }
}
