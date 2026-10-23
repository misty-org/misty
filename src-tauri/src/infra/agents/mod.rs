pub mod chats;
pub mod files;
pub mod projects;
mod storage;
pub mod web_fetch;
pub mod workspace;

use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use super::store::Store;
use crate::{
    error::{ApiError, ApiResult},
    infra::environment::AppEnvironmentService,
};
pub(crate) use storage::device_id;
#[cfg(test)]
use storage::strip_verbatim_prefixes;
use storage::{
    device_snapshot_sync, import_legacy, scoped_file_path_sync,
};

/// A folder's canonical path as it is stored and compared: on Windows without
/// the `\\?\` prefix canonicalizing adds, so every path here has one form.
pub(crate) fn canonical(path: impl AsRef<Path>) -> std::io::Result<PathBuf> {
    fs::canonicalize(path).map(|path| crate::agents::project_root::plain_path(&path))
}

#[derive(Clone)]
pub struct AgentService {
    pub(crate) database_path: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListScopedFilesRequest {
    pub scope_id: String,
    #[serde(default)]
    pub relative_path: String,
}

/// Agents see at most this many entries from one folder listing.
const SCOPED_LISTING_LIMIT: usize = 500;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareScopedAgentDocumentRequest {
    pub scope_id: String,
    pub relative_path: String,
}

impl AgentService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        let store = environment.store();
        // Folders shared before the database moved come along once.
        if let Err(error) = import_legacy(&store, &environment.misty_db_path()) {
            eprintln!("Could not import earlier shared folders: {error}");
        }
        Self {
            database_path: store.path().to_path_buf(),
        }
    }

    pub async fn device_snapshot(&self) -> ApiResult<Value> {
        run_db(self.database_path.clone(), device_snapshot_sync).await
    }

    /// Records a folder as an agent scope, as sharing one did before projects.
    #[cfg(test)]
    pub(crate) async fn register_folder_scope(&self, path: PathBuf) -> ApiResult<Value> {
        let root = canonical(&path)
            .map_err(|error| ApiError::Message(format!("Could not open that folder: {error}")))?;
        if !root.is_dir() {
            return Err(ApiError::Message("Choose a folder, not a file.".into()));
        }
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
                Some(id) => id,
                None => {
                    let id = format!("scope_{}", Uuid::new_v4().simple());
                    connection.execute(
                        "INSERT INTO local_agent_scopes(id,device_id,display_name,local_path,created_at) VALUES(?1,?2,?3,?4,?5)",
                        rusqlite::params![id, device, display_name, local_path, Utc::now().to_rfc3339()],
                    )?;
                    id
                }
            };
            Ok(json!({ "id": id, "displayName": display_name, "kind": "local_folder" }))
        })
        .await
    }

    pub async fn revoke_folder_scope(&self, scope_id: String) -> ApiResult<()> {
        run_db(self.database_path.clone(), move |connection| {
            connection.execute("DELETE FROM local_agent_scopes WHERE id=?1", [scope_id])?;
            Ok(())
        })
        .await
    }

    /// Lists one directory inside a granted folder. Hidden entries are skipped.
    pub async fn list_scoped_files(&self, request: ListScopedFilesRequest) -> ApiResult<Value> {
        run_db(self.database_path.clone(), move |connection| {
            let root: String = connection.query_row(
                "SELECT local_path FROM local_agent_scopes WHERE id=?1",
                [&request.scope_id],
                |row| row.get(0),
            )?;
            let root = canonical(root).map_err(io_error)?;
            let relative = request.relative_path.trim().trim_matches('/');
            let relative_path = Path::new(relative);
            if relative_path.is_absolute()
                || relative_path.components().any(|part| {
                    matches!(
                        part,
                        Component::ParentDir | Component::RootDir | Component::Prefix(_)
                    )
                })
            {
                return Err(validation_error("Folder path is outside its device scope."));
            }
            let directory = canonical(root.join(relative_path)).map_err(io_error)?;
            if !directory.starts_with(&root) || !directory.is_dir() {
                return Err(validation_error("Folder path is outside its device scope."));
            }
            let mut entries = Vec::new();
            let mut truncated = false;
            for entry in fs::read_dir(&directory).map_err(io_error)? {
                let entry = entry.map_err(io_error)?;
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') {
                    continue;
                }
                if entries.len() >= SCOPED_LISTING_LIMIT {
                    truncated = true;
                    break;
                }
                let metadata = entry.metadata().map_err(io_error)?;
                let path = if relative.is_empty() {
                    name.clone()
                } else {
                    format!("{relative}/{name}")
                };
                let modified = metadata
                    .modified()
                    .ok()
                    .map(|time| chrono::DateTime::<Utc>::from(time).to_rfc3339());
                entries.push(json!({
                    "name": name,
                    "relativePath": path,
                    "directory": metadata.is_dir(),
                    "size": if metadata.is_dir() { Value::Null } else { json!(metadata.len()) },
                    "modifiedAt": modified,
                }));
            }
            entries.sort_by(|a, b| {
                (
                    !a["directory"].as_bool().unwrap_or(false),
                    a["name"].as_str().unwrap_or(""),
                )
                    .cmp(&(
                        !b["directory"].as_bool().unwrap_or(false),
                        b["name"].as_str().unwrap_or(""),
                    ))
            });
            Ok(json!({ "path": relative, "entries": entries, "truncated": truncated }))
        })
        .await
    }

    pub async fn scoped_document_path(
        &self,
        request: PrepareScopedAgentDocumentRequest,
    ) -> ApiResult<PathBuf> {
        let target = run_db(self.database_path.clone(), move |connection| {
            scoped_file_path_sync(connection, &request.scope_id, &request.relative_path)
        })
        .await?;
        Ok(target)
    }
}

pub(crate) async fn run_db<T, F>(path: PathBuf, operation: F) -> ApiResult<T>
where
    T: Send + 'static,
    F: FnOnce(&mut Connection) -> Result<T, rusqlite::Error> + Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let mut connection = Store::at(path).connect().map_err(|error| {
            ApiError::Message(format!("Could not open device scope database: {error}"))
        })?;
        operation(&mut connection)
            .map_err(|error| ApiError::Message(format!("Device scope operation failed: {error}")))
    })
    .await
    .map_err(|error| ApiError::Message(format!("Device scope worker failed: {error}")))?
}

pub(crate) fn io_error(error: std::io::Error) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(error))
}

pub(crate) fn validation_error(message: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(message.to_owned())
}

#[cfg(test)]
mod tests;
