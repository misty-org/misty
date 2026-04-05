use std::{
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult},
    services::document_intelligence::{
        prepare_document, PrepareAgentDocumentRequest, PreparedAgentDocument,
    },
    services::environment::AppEnvironmentService,
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

    pub async fn register_folder_scope(
        &self,
        request: RegisterFolderScopeRequest,
    ) -> ApiResult<Value> {
        run_db(self.database_path.clone(), move |connection| {
            register_scope_sync(connection, &request.path)
        })
        .await
    }

    pub async fn open_citation(&self, request: OpenAgentCitationRequest) -> ApiResult<()> {
        let citation = request.citation;
        let page = (citation.get("kind").and_then(Value::as_str) == Some("pdf_page"))
            .then(|| citation.get("page").and_then(Value::as_u64))
            .flatten();
        let target = run_db(self.database_path.clone(), move |connection| {
            citation_path_sync(connection, &citation)
        })
        .await?;
        open_path(&target, page)
    }

    pub async fn prepare_scoped_document(
        &self,
        request: PrepareScopedAgentDocumentRequest,
    ) -> ApiResult<PreparedAgentDocument> {
        let target = run_db(self.database_path.clone(), move |connection| {
            scoped_file_path_sync(connection, &request.scope_id, &request.relative_path)
        })
        .await?;
        prepare_document(PrepareAgentDocumentRequest {
            path: target.to_string_lossy().into_owned(),
        })
        .await
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

fn register_scope_sync(connection: &mut Connection, raw_path: &str) -> rusqlite::Result<Value> {
    let canonical = fs::canonicalize(raw_path).map_err(io_error)?;
    if !canonical.is_dir() {
        return Err(validation_error("Device scope must be a local folder."));
    }
    let canonical_text = canonical.to_string_lossy().to_string();
    if let Some((id, device, display_name)) = connection
        .query_row(
            "SELECT id,device_id,display_name FROM local_agent_scopes WHERE local_path=?1",
            [&canonical_text],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
        )
        .optional()?
    {
        return Ok(scope_json(id, device, display_name));
    }
    let id = format!("scope_{}", Uuid::new_v4().simple());
    let device = device_id(connection)?;
    let display_name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Folder")
        .to_owned();
    connection.execute(
        "INSERT INTO local_agent_scopes(id,device_id,display_name,local_path,created_at) VALUES(?1,?2,?3,?4,?5)",
        params![id, device, display_name, canonical_text, Utc::now().to_rfc3339()],
    )?;
    Ok(scope_json(id, device, display_name))
}

fn scope_json(id: String, device_id: String, display_name: String) -> Value {
    json!({
        "id": id,
        "deviceId": device_id,
        "displayName": display_name,
        "kind": "local_folder",
        "relativePath": Value::Null,
        "available": true,
    })
}

fn citation_path_sync(connection: &mut Connection, citation: &Value) -> rusqlite::Result<PathBuf> {
    let scope_id = citation
        .get("scopeId")
        .and_then(Value::as_str)
        .ok_or_else(|| validation_error("Citation scope is required."))?;
    let relative = citation
        .get("relativePath")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .or_else(|| citation.get("fileName").and_then(Value::as_str))
        .ok_or_else(|| validation_error("Citation file is required."))?;
    scoped_file_path_sync(connection, scope_id, relative)
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
            matches!(part, Component::ParentDir | Component::RootDir | Component::Prefix(_))
        })
    {
        return Err(validation_error("Document path is outside its device scope."));
    }
    let root = fs::canonicalize(root).map_err(io_error)?;
    let target = fs::canonicalize(root.join(relative_path)).map_err(io_error)?;
    if !target.starts_with(&root) || !target.is_file() {
        return Err(validation_error("Document path is outside its device scope."));
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
            status.success().then_some(()).ok_or_else(|| {
                ApiError::Message("The citation could not be opened.".to_owned())
            })
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn snapshot_exposes_only_device_scopes() {
        let root = std::env::temp_dir().join(format!("misty-device-scopes-{}", Uuid::new_v4()));
        let folder = root.join("folder");
        fs::create_dir_all(&folder).unwrap();
        let service = AgentService::new(AppEnvironmentService::new_with_data_root(Some(root.clone())));
        service.register_folder_scope(RegisterFolderScopeRequest { path: folder.to_string_lossy().into_owned() }).await.unwrap();
        let snapshot = service.device_snapshot().await.unwrap();
        assert_eq!(snapshot["version"], 2);
        assert_eq!(snapshot["scopes"].as_array().unwrap().len(), 1);
        assert!(snapshot.get("definitions").is_none());
        assert!(!snapshot.to_string().contains(folder.to_string_lossy().as_ref()));
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn scoped_reads_reject_parent_traversal() {
        let root = std::env::temp_dir().join(format!("misty-device-scope-read-{}", Uuid::new_v4()));
        let folder = root.join("folder");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("inside.txt"), "hello").unwrap();
        let service = AgentService::new(AppEnvironmentService::new_with_data_root(Some(root.clone())));
        let scope = service.register_folder_scope(RegisterFolderScopeRequest { path: folder.to_string_lossy().into_owned() }).await.unwrap();
        let scope_id = scope["id"].as_str().unwrap().to_owned();
        assert!(service.prepare_scoped_document(PrepareScopedAgentDocumentRequest { scope_id: scope_id.clone(), relative_path: "inside.txt".to_owned() }).await.is_ok());
        assert!(service.prepare_scoped_document(PrepareScopedAgentDocumentRequest { scope_id, relative_path: "../outside.txt".to_owned() }).await.is_err());
        let _ = fs::remove_dir_all(root);
    }
}
