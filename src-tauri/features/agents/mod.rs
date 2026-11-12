use file_access::{self, fs};
pub mod chats;
pub mod commands;
pub mod shared_folders;
pub mod task_scopes;
pub mod web_fetch;

use std::path::{Component, Path, PathBuf};

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::app::error::{ApiError, ApiResult};
pub(crate) use chats::storage::device_id;
use chats::storage::{device_snapshot_sync, scoped_file_path_sync};
use database::environment::AppEnvironmentService;
use database::store::Store;

/// A folder's canonical path as it is stored and compared: on Windows without
/// the `\\?\` prefix canonicalizing adds, so every path here has one form.
pub(crate) fn canonical(path: impl AsRef<Path>) -> std::io::Result<PathBuf> {
    fs::canonicalize(path).map(|path| shared_folders::plain_path(&path))
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
        Self {
            database_path: environment.store().path().to_path_buf(),
        }
    }

    pub async fn device_snapshot(&self) -> ApiResult<Value> {
        run_db(self.database_path.clone(), device_snapshot_sync).await
    }

    /// Shares a folder the person chose. Agents can read it and nothing more.
    pub async fn share_folder(&self, path: PathBuf, protected: &[PathBuf]) -> ApiResult<Value> {
        // The person just picked this in the system's dialog, but it's only granted once it has
        // passed the checks below, so this look comes first.
        let chosen = file_access::looks::chosen_folder(&path)
            .map_err(|error| ApiError::Message(format!("Could not open that folder: {error}")))?;
        let root = shared_folders::plain_path(&chosen.real);
        if !chosen.is_folder {
            return Err(ApiError::Message("Choose a folder, not a file.".into()));
        }
        shared_folders::check_root(&root, protected, dirs::home_dir().as_deref())
            .map_err(ApiError::Message)?;
        let granted = root.clone();
        let shared = run_db(self.database_path.clone(), move |connection| {
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
        .await?;
        file_access::allow_shared_folder(&granted, file_access::Access::Read);
        Ok(shared)
    }

    /// Gives the file gate the folders shared before, when Misty starts.
    pub fn restore_folder_grants(&self) {
        let folders = (|| -> rusqlite::Result<Vec<String>> {
            let connection = Store::at(&self.database_path).connect()?;
            let mut statement = connection.prepare("SELECT local_path FROM local_agent_scopes")?;
            let rows = statement.query_map([], |row| row.get(0))?;
            rows.collect()
        })();
        for folder in folders.unwrap_or_default() {
            file_access::allow_shared_folder(Path::new(&folder), file_access::Access::Read);
        }
    }

    /// The name a shared folder goes by, for the question about it.
    pub async fn folder_name(&self, scope_id: String) -> ApiResult<String> {
        run_db(self.database_path.clone(), move |connection| {
            connection.query_row(
                "SELECT display_name FROM local_agent_scopes WHERE id=?1",
                [&scope_id],
                |row| row.get(0),
            )
        })
        .await
    }

    /// Only for after the person said yes in the native dialog.
    pub async fn allow_folder_changes(&self, key: String, scope_id: String) -> ApiResult<()> {
        run_db(self.database_path.clone(), move |connection| {
            shared_folders::folder_changes::allow(connection, &key, &scope_id)
        })
        .await
    }

    pub async fn stop_folder_changes(
        &self,
        key: String,
        scope_id: Option<String>,
    ) -> ApiResult<()> {
        run_db(self.database_path.clone(), move |connection| {
            shared_folders::folder_changes::stop(connection, &key, scope_id.as_deref())
        })
        .await
    }

    pub async fn adopt_folder_changes(&self, from: String, chat: String) -> ApiResult<()> {
        run_db(self.database_path.clone(), move |connection| {
            shared_folders::folder_changes::adopt(connection, &from, &chat)
        })
        .await
    }

    /// Off when the database can't answer: a failure must never read as a yes.
    pub async fn folder_changes_allowed(&self, key: String, scope_id: String) -> bool {
        run_db(self.database_path.clone(), move |connection| {
            shared_folders::folder_changes::allowed(connection, &key, &scope_id)
        })
        .await
        .unwrap_or(false)
    }

    /// A shared folder's real path, for a job already checked against its grant.
    pub async fn folder_root(&self, scope_id: String) -> ApiResult<PathBuf> {
        run_db(self.database_path.clone(), move |connection| {
            let root: String = connection.query_row(
                "SELECT local_path FROM local_agent_scopes WHERE id=?1",
                [&scope_id],
                |row| row.get(0),
            )?;
            canonical(root).map_err(io_error)
        })
        .await
    }

    pub async fn revoke_folder_scope(&self, scope_id: String) -> ApiResult<()> {
        let folder = run_db(self.database_path.clone(), move |connection| {
            let folder: Option<String> = connection
                .query_row(
                    "SELECT local_path FROM local_agent_scopes WHERE id=?1",
                    [&scope_id],
                    |row| row.get(0),
                )
                .optional()?;
            shared_folders::folder_changes::forget_folder(connection, &scope_id)?;
            connection.execute("DELETE FROM local_agent_scopes WHERE id=?1", [scope_id])?;
            Ok(folder)
        })
        .await?;
        if let Some(folder) = folder {
            file_access::revoke_shared_folder(Path::new(&folder));
        }
        Ok(())
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
            if !directory.starts_with(&root) || !fs::is_dir(&directory) {
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

pub mod connected_apps;
#[cfg(desktop)]
pub mod cursor;
pub mod desktop_control;
#[cfg(desktop)]
pub mod keep_awake;
pub mod live_pages_memory;
pub mod models;
pub mod run_control;
pub mod screen_context;
pub mod shell;
pub mod tutor_links;
pub mod tutor_video;
#[cfg(test)]
// Tests build their fixtures directly, outside the file gate.
#[allow(clippy::disallowed_methods, clippy::disallowed_types)]
mod tests;
pub mod window_control;
