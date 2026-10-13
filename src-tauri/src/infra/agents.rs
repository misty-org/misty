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

/// A folder's canonical path as it is stored and compared: on Windows without
/// the `\\?\` prefix canonicalizing adds, so every path here has one form.
pub(crate) fn canonical(path: impl AsRef<Path>) -> std::io::Result<PathBuf> {
    fs::canonicalize(path).map(|path| misty_agent_code::plain_path(&path))
}

#[derive(Clone)]
pub struct AgentService {
    pub(crate) database_path: PathBuf,
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
    )?;
    // Code projects (docs/plans/agent-code-projects.md): a scope with write
    // access is a project; installs open the package proxy for it.
    let columns: Vec<String> = connection
        .prepare("PRAGMA table_info(local_agent_scopes)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<_, _>>()?;
    if !columns.iter().any(|column| column == "access") {
        connection.execute_batch(
            "ALTER TABLE local_agent_scopes ADD COLUMN access TEXT NOT NULL DEFAULT 'read'",
        )?;
    }
    for (column, definition) in [
        ("allow_installs", "INTEGER NOT NULL DEFAULT 0"),
        // Git (docs/plans/agent-git-projects.md): agents may push branches,
        // and separately the default branch.
        ("allow_push", "INTEGER NOT NULL DEFAULT 0"),
        ("allow_push_default", "INTEGER NOT NULL DEFAULT 0"),
    ] {
        if !columns.iter().any(|existing| existing == column) {
            connection.execute_batch(&format!(
                "ALTER TABLE local_agent_scopes ADD COLUMN {column} {definition}"
            ))?;
        }
    }
    // Windows folders were stored with the `\\?\` prefix canonicalizing adds;
    // they are stored without it now (see `canonical`).
    connection.execute_batch(
        r"UPDATE OR IGNORE local_agent_scopes SET local_path = '\\' || substr(local_path, 9)
              WHERE local_path LIKE '\\?\UNC\%';
          UPDATE OR IGNORE local_agent_scopes SET local_path = substr(local_path, 5)
              WHERE local_path LIKE '\\?\%';",
    )?;
    Ok(())
}

fn device_snapshot_sync(connection: &mut Connection) -> rusqlite::Result<Value> {
    let device_id = device_id(connection)?;
    let scopes = {
        let mut statement = connection.prepare(
            "SELECT id,device_id,display_name,access,allow_installs,allow_push,allow_push_default,local_path FROM local_agent_scopes ORDER BY created_at",
        )?;
        let rows = statement
            .query_map([], |row| {
                let project = row.get::<_, String>(3)? == "write";
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "deviceId": row.get::<_, String>(1)?,
                    "displayName": row.get::<_, String>(2)?,
                    "kind": if project { "project_folder" } else { "local_folder" },
                    "allowInstalls": project && row.get::<_, i64>(4)? != 0,
                    "allowPush": project && row.get::<_, i64>(5)? != 0,
                    "allowPushDefault": project && row.get::<_, i64>(6)? != 0,
                    "git": project && Path::new(&row.get::<_, String>(7)?).join(".git").is_dir(),
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
    let root = canonical(root).map_err(io_error)?;
    let target = canonical(root.join(relative_path)).map_err(io_error)?;
    if !target.starts_with(&root) || !target.is_file() {
        return Err(validation_error(
            "Document path is outside its device scope.",
        ));
    }
    Ok(target)
}

pub(crate) fn device_id(connection: &Connection) -> rusqlite::Result<String> {
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

pub(crate) fn io_error(error: std::io::Error) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(error))
}

pub(crate) fn validation_error(message: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(message.to_owned())
}

/// Windows opens the file with its default app. Explorer's exit code says
/// nothing about success, and file associations drop `#page=` fragments.
#[cfg(windows)]
fn open_path(path: &Path, _pdf_page: Option<u64>) -> ApiResult<()> {
    tauri_plugin_opener::open_path(path, None::<&str>)
        .map_err(|_| ApiError::Message("The citation could not be opened.".to_owned()))
}

#[cfg(not(windows))]
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
#[path = "agents_tests.rs"]
mod tests;
