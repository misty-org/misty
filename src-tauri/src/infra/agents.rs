use std::{
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
};

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult},
    infra::environment::AppEnvironmentService,
};

#[derive(Clone)]
pub struct AgentService {
    database_path: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterFolderScopeRequest {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAgentCitationRequest {
    pub citation: Value,
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
            database_path: environment.misty_db_path(),
        }
    }

    pub async fn device_snapshot(&self) -> ApiResult<Value> {
        run_db(self.database_path.clone(), device_snapshot_sync).await
    }

    pub async fn revoke_folder_scope(&self, scope_id: String) -> ApiResult<()> {
        run_db(self.database_path.clone(), move |connection| {
            connection.execute("DELETE FROM local_agent_scopes WHERE id=?1", [scope_id])?;
            Ok(())
        })
        .await
    }

    /// Records a folder the person chose in the native picker. Agents can then
    /// list and read inside it, never outside it.
    pub async fn register_folder_scope(&self, path: PathBuf) -> ApiResult<Value> {
        let root = fs::canonicalize(&path)
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

    /// Lists one directory inside a granted folder. Hidden entries are skipped.
    pub async fn list_scoped_files(&self, request: ListScopedFilesRequest) -> ApiResult<Value> {
        run_db(self.database_path.clone(), move |connection| {
            let root: String = connection.query_row(
                "SELECT local_path FROM local_agent_scopes WHERE id=?1",
                [&request.scope_id],
                |row| row.get(0),
            )?;
            let root = fs::canonicalize(root).map_err(io_error)?;
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
            let directory = fs::canonicalize(root.join(relative_path)).map_err(io_error)?;
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

async fn run_db<T, F>(path: PathBuf, operation: F) -> ApiResult<T>
where
    T: Send + 'static,
    F: FnOnce(&mut Connection) -> Result<T, rusqlite::Error> + Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                ApiError::Message(format!("Could not create device scope directory: {error}"))
            })?;
        }
        let mut connection = Connection::open(path).map_err(|error| {
            ApiError::Message(format!("Could not open device scope database: {error}"))
        })?;
        ensure_schema(&connection).map_err(|error| {
            ApiError::Message(format!("Could not initialize device scopes: {error}"))
        })?;
        operation(&mut connection)
            .map_err(|error| ApiError::Message(format!("Device scope operation failed: {error}")))
    })
    .await
    .map_err(|error| ApiError::Message(format!("Device scope worker failed: {error}")))?
}

fn ensure_schema(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS local_agent_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_agent_scopes (
            id TEXT PRIMARY KEY,
            device_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            local_path TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        );

        -- Scoped one-time cleanup of the retired whole-Agent runtime. Keep
        -- settings and scopes because v2 Read content leases reference them.
        DROP TABLE IF EXISTS local_agent_mutations;
        DROP TABLE IF EXISTS local_agent_file_outbox;
        DROP TABLE IF EXISTS local_agent_file_checkpoints;
        DROP TABLE IF EXISTS local_agent_scope_checkpoints;
        DROP TABLE IF EXISTS local_agent_artifacts;
        DROP TABLE IF EXISTS local_agent_approvals;
        DROP TABLE IF EXISTS local_agent_jobs;
        DROP TABLE IF EXISTS local_agent_definitions;",
    )
}

fn device_snapshot_sync(connection: &mut Connection) -> rusqlite::Result<Value> {
    let device_id = device_id(connection)?;
    let scopes = {
        let mut statement = connection.prepare(
            "SELECT id,device_id,display_name FROM local_agent_scopes ORDER BY created_at",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "deviceId": row.get::<_, String>(1)?,
                    "displayName": row.get::<_, String>(2)?,
                    "kind": "local_folder",
                    "relativePath": Value::Null,
                    "available": true,
                }))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    Ok(json!({
        "version": 2,
        "device": {
            "id": device_id,
            "displayName": "This Misty",
            "status": "online",
            "capabilities": ["workflow_node_leases", "read_content", "document_intelligence", "citations"],
            "lastSeenAt": Utc::now().to_rfc3339(),
        },
        "scopes": scopes,
        "loadedAt": Utc::now().to_rfc3339(),
    }))
}

fn scoped_file_path_sync(
    connection: &mut Connection,
    scope_id: &str,
    relative: &str,
) -> rusqlite::Result<PathBuf> {
    let root: String = connection.query_row(
        "SELECT local_path FROM local_agent_scopes WHERE id=?1",
        [scope_id],
        |row| row.get(0),
    )?;
    let relative_path = Path::new(relative);
    if relative.trim().is_empty()
        || relative_path.is_absolute()
        || relative_path.components().any(|part| {
            matches!(
                part,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(validation_error(
            "Document path is outside its device scope.",
        ));
    }
    let root = fs::canonicalize(root).map_err(io_error)?;
    let target = fs::canonicalize(root.join(relative_path)).map_err(io_error)?;
    if !target.starts_with(&root) || !target.is_file() {
        return Err(validation_error(
            "Document path is outside its device scope.",
        ));
    }
    Ok(target)
}

fn device_id(connection: &Connection) -> rusqlite::Result<String> {
    if let Some(value) = connection
        .query_row(
            "SELECT value FROM local_agent_settings WHERE key='device_id'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    {
        return Ok(value);
    }
    let value = format!("device_{}", Uuid::new_v4().simple());
    connection.execute(
        "INSERT INTO local_agent_settings(key,value) VALUES('device_id',?1)",
        [&value],
    )?;
    Ok(value)
}

fn io_error(error: std::io::Error) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(error))
}

fn validation_error(message: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(message.to_owned())
}

fn open_path(path: &Path, pdf_page: Option<u64>) -> ApiResult<()> {
    let page_url = pdf_page.and_then(|page| {
        url::Url::from_file_path(path).ok().map(|mut value| {
            value.set_fragment(Some(&format!("page={page}")));
            value.to_string()
        })
    });
    let target = page_url
        .as_deref()
        .unwrap_or_else(|| path.to_str().unwrap_or_default());
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(target).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer").arg(target).status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(target).status();
    status
        .map_err(|error| ApiError::Message(format!("Could not open citation: {error}")))
        .and_then(|status| {
            status
                .success()
                .then_some(())
                .ok_or_else(|| ApiError::Message("The citation could not be opened.".to_owned()))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn folder_scopes_list_only_inside_the_chosen_folder() {
        let state = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        fs::create_dir(folder.path().join("Reports")).unwrap();
        fs::write(folder.path().join("Reports/q3.txt"), "Revenue grew").unwrap();
        fs::write(folder.path().join("notes.md"), "Plan").unwrap();
        fs::write(folder.path().join(".secret"), "hidden").unwrap();
        let service = AgentService {
            database_path: state.path().join("misty.db"),
        };
        let scope = service
            .register_folder_scope(folder.path().to_path_buf())
            .await
            .unwrap();
        let again = service
            .register_folder_scope(folder.path().to_path_buf())
            .await
            .unwrap();
        assert_eq!(scope["id"], again["id"], "a folder is granted once");
        let id = scope["id"].as_str().unwrap().to_owned();
        let root = service
            .list_scoped_files(ListScopedFilesRequest {
                scope_id: id.clone(),
                relative_path: String::new(),
            })
            .await
            .unwrap();
        let names: Vec<_> = root["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["relativePath"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(names, vec!["Reports", "notes.md"]);
        let nested = service
            .list_scoped_files(ListScopedFilesRequest {
                scope_id: id.clone(),
                relative_path: "Reports".into(),
            })
            .await
            .unwrap();
        assert_eq!(nested["entries"][0]["relativePath"], "Reports/q3.txt");
        for outside in ["..", "../..", "/etc"] {
            assert!(service
                .list_scoped_files(ListScopedFilesRequest {
                    scope_id: id.clone(),
                    relative_path: outside.into(),
                })
                .await
                .is_err());
        }
        let document = service
            .scoped_document_path(PrepareScopedAgentDocumentRequest {
                scope_id: id,
                relative_path: "Reports/q3.txt".into(),
            })
            .await
            .unwrap();
        assert!(document.ends_with("Reports/q3.txt"));
    }
}
