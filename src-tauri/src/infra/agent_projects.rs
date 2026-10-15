//! Projects on this device: folders the person shared for coding. Misty
//! agents hand the coding to the person's own coding tool, which runs inside
//! the folder. Projects live beside read-only shared folders in
//! `local_agent_scopes`, marked `access='write'`. Their old access switches
//! (installs, pushes) are carried over once as remembered approvals.
use std::{fs, path::PathBuf};

use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    agents::project_root::check_root,
    error::{ApiError, ApiResult},
    infra::agents::{canonical, device_id, io_error, run_db, validation_error, AgentService},
};

/// A project folder, resolved and still where it was shared.
#[derive(Debug, Clone)]
pub struct Project {
    pub scope_id: String,
    pub root: PathBuf,
}

/// A project whose old switches haven't been carried over to the server yet.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyProjectFlags {
    pub scope_id: String,
    pub allow_installs: bool,
    pub allow_push: bool,
}

impl AgentService {
    /// Shares a folder the person chose as a project. A folder already shared
    /// read-only becomes a project under the same id.
    pub async fn register_project_scope(
        &self,
        path: PathBuf,
        protected: &[PathBuf],
    ) -> ApiResult<Value> {
        let root = canonical(&path)
            .map_err(|error| ApiError::Message(format!("Could not open that folder: {error}")))?;
        if !root.is_dir() {
            return Err(ApiError::Message("Choose a folder, not a file.".into()));
        }
        check_root(&root, protected, dirs::home_dir().as_deref()).map_err(ApiError::Message)?;
        run_db(self.database_path.clone(), move |connection| {
            let device = device_id(connection)?;
            let local_path = root.to_string_lossy().into_owned();
            let display_name = root
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| local_path.clone());
            let existing: Option<String> = connection
                .query_row("SELECT id FROM local_agent_scopes WHERE local_path=?1", [&local_path], |row| row.get(0))
                .optional()?;
            let id = match existing {
                Some(id) => {
                    connection.execute("UPDATE local_agent_scopes SET access='write' WHERE id=?1", [&id])?;
                    id
                }
                None => {
                    let id = format!("scope_{}", Uuid::new_v4().simple());
                    // New projects have no old switches to carry over.
                    connection.execute(
                        "INSERT INTO local_agent_scopes(id,device_id,display_name,local_path,created_at,access,grants_migrated) VALUES(?1,?2,?3,?4,?5,'write',1)",
                        rusqlite::params![id, device, display_name, local_path, Utc::now().to_rfc3339()],
                    )?;
                    id
                }
            };
            Ok(json!({ "id": id, "displayName": display_name, "kind": "project_folder" }))
        })
        .await
    }

    /// Creates `<parent>/<name>` as a new project, for New project.
    pub async fn create_project_folder(
        &self,
        parent: PathBuf,
        name: &str,
        protected: &[PathBuf],
    ) -> ApiResult<(Value, PathBuf)> {
        let name = name.trim();
        let valid = !name.is_empty()
            && name.len() <= 100
            && !name.starts_with('.')
            && !name.contains(['/', '\\', ':', '\0'])
            && name.chars().all(|c| !c.is_control());
        if !valid {
            return Err(ApiError::Message(
                "Use a short folder name without slashes.".into(),
            ));
        }
        let parent = canonical(&parent)
            .map_err(|error| ApiError::Message(format!("Could not open that folder: {error}")))?;
        let folder = parent.join(name);
        if folder.exists() {
            return Err(ApiError::Message(format!(
                "{name} already exists there. Pick another name or place."
            )));
        }
        check_root(&folder, protected, dirs::home_dir().as_deref()).map_err(ApiError::Message)?;
        fs::create_dir(&folder)
            .map_err(|error| ApiError::Message(format!("Could not create the folder: {error}")))?;
        let registered = self.register_project_scope(folder.clone(), protected).await;
        if registered.is_err() {
            let _ = fs::remove_dir(&folder);
        }
        let folder = canonical(&folder).unwrap_or(folder);
        Ok((registered?, folder))
    }

    /// The project behind a scope id, only when it is shared for coding and
    /// its folder is still where it was.
    pub async fn project(&self, scope_id: String) -> ApiResult<Project> {
        run_db(self.database_path.clone(), move |connection| {
            let path: String = connection.query_row(
                "SELECT local_path FROM local_agent_scopes WHERE id=?1 AND access='write'",
                [&scope_id],
                |row| row.get(0),
            )?;
            let root = canonical(&path).map_err(io_error)?;
            if root.to_string_lossy() != path {
                // The folder moved or a symlink replaced it: share it again.
                return Err(validation_error("The project folder moved."));
            }
            Ok(Project { scope_id, root })
        })
        .await
    }

    /// Projects whose old switches still need carrying over to the server.
    pub async fn legacy_project_flags(&self) -> ApiResult<Vec<LegacyProjectFlags>> {
        run_db(self.database_path.clone(), move |connection| {
            let mut statement = connection.prepare(
                "SELECT id,allow_installs,allow_push FROM local_agent_scopes WHERE access='write' AND grants_migrated=0",
            )?;
            let rows = statement.query_map([], |row| {
                Ok(LegacyProjectFlags {
                    scope_id: row.get(0)?,
                    allow_installs: row.get::<_, i64>(1)? != 0,
                    allow_push: row.get::<_, i64>(2)? != 0,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()
        })
        .await
    }

    /// Records that a project's old switches were carried over.
    pub async fn mark_project_flags_migrated(&self, scope_id: String) -> ApiResult<()> {
        run_db(self.database_path.clone(), move |connection| {
            connection.execute(
                "UPDATE local_agent_scopes SET grants_migrated=1 WHERE id=?1",
                [&scope_id],
            )?;
            Ok(())
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(flavor = "multi_thread")]
    async fn shared_folders_become_projects_and_old_switches_migrate_once() {
        let state = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        let service = AgentService {
            database_path: state.path().join("misty.db"),
        };
        let shared = service
            .register_folder_scope(folder.path().to_path_buf())
            .await
            .unwrap();
        let id = shared["id"].as_str().unwrap().to_owned();
        assert!(
            service.project(id.clone()).await.is_err(),
            "read-only folders aren't projects"
        );
        // A folder shared before projects, with its old switches on.
        run_db(service.database_path.clone(), {
            let id = id.clone();
            move |connection| {
                connection.execute(
                    "UPDATE local_agent_scopes SET allow_installs=1, allow_push=1 WHERE id=?1",
                    [&id],
                )?;
                Ok(())
            }
        })
        .await
        .unwrap();
        let project = service
            .register_project_scope(folder.path().to_path_buf(), &[])
            .await
            .unwrap();
        assert_eq!(
            shared["id"], project["id"],
            "a shared folder becomes a project"
        );
        assert!(service.project(id.clone()).await.is_ok());
        let legacy = service.legacy_project_flags().await.unwrap();
        assert_eq!(legacy.len(), 1);
        assert!(legacy[0].allow_installs && legacy[0].allow_push);
        service.mark_project_flags_migrated(id).await.unwrap();
        assert!(service.legacy_project_flags().await.unwrap().is_empty());

        let fresh = tempfile::tempdir().unwrap();
        service
            .register_project_scope(fresh.path().to_path_buf(), &[])
            .await
            .unwrap();
        assert!(
            service.legacy_project_flags().await.unwrap().is_empty(),
            "new projects have nothing to carry over"
        );
        if let Some(home) = dirs::home_dir() {
            assert!(service.register_project_scope(home, &[]).await.is_err());
        }
    }
}
