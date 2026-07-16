use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};

use chrono::{Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::{
    error::{ApiError, ApiResult},
    services::document_intelligence::{
        prepare_document, PrepareAgentDocumentRequest, PreparedAgentDocument,
    },
    services::environment::AppEnvironmentService,
};

const LOCAL_STORE_VERSION: i64 = 1;

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
pub struct SaveAgentDefinitionRequest {
    pub definition: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAgentDefinitionRequest {
    pub agent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimAgentJobsRequest {
    pub limit: usize,
    pub lease_seconds: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentJobLeaseRequest {
    pub job_id: String,
    pub lease_seconds: i64,
    pub progress: Option<f64>,
    pub status_message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteAgentJobRequest {
    pub job_id: String,
    pub idempotency_key: String,
    #[serde(default)]
    pub artifact_ids: Vec<String>,
    pub status_message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailAgentJobRequest {
    pub job_id: String,
    pub idempotency_key: String,
    pub error: String,
    pub retryable: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelAgentJobRequest {
    pub job_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveAgentApprovalRequest {
    pub approval_id: String,
    pub decision: String,
    pub action_digest: String,
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
    pub ocr_page_start: Option<usize>,
    pub ocr_page_limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindScopeDocumentRequest {
    pub scope_id: String,
    pub query: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileAgentScopesRequest {
    pub max_files_per_scope: usize,
    pub max_events: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentSummaryArtifactRequest {
    pub agent_id: String,
    pub job_id: String,
    pub scope_id: String,
    pub source_file_name: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcknowledgeAgentFileEventsRequest {
    pub event_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteApprovedAgentActionRequest {
    pub agent_id: String,
    pub job_id: String,
    pub action_digest: String,
    pub kind: String,
    pub summary: String,
    pub scope_id: String,
    pub relative_paths: Vec<String>,
    pub destination_relative_path: Option<String>,
    pub content: Option<String>,
    pub content_sha256: Option<String>,
    pub unix_mode: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageApprovedAgentActionRequest {
    #[serde(flatten)]
    pub action: ExecuteApprovedAgentActionRequest,
    pub result: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalApprovedAgentAction<'a> {
    kind: &'a str,
    summary: &'a str,
    scope_id: &'a str,
    relative_paths: &'a [String],
    #[serde(skip_serializing_if = "Option::is_none")]
    destination_relative_path: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_sha256: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unix_mode: Option<u32>,
}

impl AgentService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        Self {
            database_path: environment.misty_db_path(),
        }
    }

    pub async fn snapshot(&self) -> ApiResult<Value> {
        let path = self.database_path.clone();
        let mut snapshot = run_db(path, snapshot_sync).await?;
        set_value(&mut snapshot, "localWebhookUrl", Value::Null);
        Ok(snapshot)
    }

    pub async fn register_folder_scope(
        &self,
        request: RegisterFolderScopeRequest,
    ) -> ApiResult<Value> {
        let path = self.database_path.clone();
        run_db(path, move |connection| {
            register_scope_sync(connection, &request.path)
        })
        .await
    }

    pub async fn save_definition(&self, request: SaveAgentDefinitionRequest) -> ApiResult<Value> {
        let path = self.database_path.clone();
        run_db(path, move |connection| {
            save_definition_sync(connection, request.definition)
        })
        .await
    }

    pub async fn delete_definition(&self, request: DeleteAgentDefinitionRequest) -> ApiResult<()> {
        let path = self.database_path.clone();
        run_db(path, move |connection| {
            connection.execute(
                "DELETE FROM local_agent_definitions WHERE id=?1",
                [&request.agent_id],
            )?;
            Ok(())
        })
        .await
    }

    pub async fn claim_jobs(&self, request: ClaimAgentJobsRequest) -> ApiResult<Vec<Value>> {
        let path = self.database_path.clone();
        run_db(path, move |connection| claim_jobs_sync(connection, request)).await
    }

    pub async fn heartbeat_job(&self, request: AgentJobLeaseRequest) -> ApiResult<Value> {
        let path = self.database_path.clone();
        run_db(path, move |connection| {
            update_job_lease_sync(connection, request)
        })
        .await
    }

    pub async fn complete_job(&self, request: CompleteAgentJobRequest) -> ApiResult<Value> {
        let path = self.database_path.clone();
        run_db(path, move |connection| {
            complete_job_sync(connection, request)
        })
        .await
    }

    pub async fn fail_job(&self, request: FailAgentJobRequest) -> ApiResult<Value> {
        let path = self.database_path.clone();
        run_db(path, move |connection| fail_job_sync(connection, request)).await
    }

    pub async fn cancel_job(&self, request: CancelAgentJobRequest) -> ApiResult<Value> {
        let path = self.database_path.clone();
        run_db(path, move |connection| {
            transition_job(connection, &request.job_id, "canceled", None, None)
        })
        .await
    }

    pub async fn resolve_approval(&self, request: ResolveAgentApprovalRequest) -> ApiResult<Value> {
        let path = self.database_path.clone();
        run_db(path, move |connection| {
            resolve_approval_sync(connection, request)
        })
        .await
    }

    pub async fn open_citation(&self, request: OpenAgentCitationRequest) -> ApiResult<()> {
        let path = self.database_path.clone();
        let citation = request.citation;
        let pdf_page = if citation.get("kind").and_then(Value::as_str) == Some("pdf_page") {
            citation.get("page").and_then(Value::as_u64)
        } else {
            None
        };
        let target = run_db(path, move |connection| {
            citation_path_sync(connection, &citation)
        })
        .await?;
        open_path(&target, pdf_page)
    }

    pub async fn prepare_scoped_document(
        &self,
        request: PrepareScopedAgentDocumentRequest,
    ) -> ApiResult<PreparedAgentDocument> {
        let path = self.database_path.clone();
        let target = run_db(path, move |connection| {
            scoped_file_path_sync(connection, &request.scope_id, &request.relative_path)
        })
        .await?;
        prepare_document(PrepareAgentDocumentRequest {
            path: target.to_string_lossy().into_owned(),
            ocr_page_start: request.ocr_page_start,
            ocr_page_limit: request.ocr_page_limit,
        })
        .await
    }

    pub async fn find_scope_document(
        &self,
        request: FindScopeDocumentRequest,
    ) -> ApiResult<Option<String>> {
        let path = self.database_path.clone();
        run_db(path, move |connection| {
            find_scope_document_sync(connection, &request.scope_id, &request.query)
        })
        .await
    }

    pub async fn reconcile_scopes(&self, request: ReconcileAgentScopesRequest) -> ApiResult<Value> {
        let path = self.database_path.clone();
        run_db(path, move |connection| {
            reconcile_scopes_sync(connection, request)
        })
        .await
    }

    pub async fn create_summary_artifact(
        &self,
        request: CreateAgentSummaryArtifactRequest,
    ) -> ApiResult<Value> {
        let path = self.database_path.clone();
        run_db(path, move |connection| {
            create_summary_artifact_sync(connection, request)
        })
        .await
    }

    pub async fn acknowledge_file_events(
        &self,
        request: AcknowledgeAgentFileEventsRequest,
    ) -> ApiResult<()> {
        let path = self.database_path.clone();
        run_db(path, move |connection| {
            for id in request.event_ids.into_iter().take(250) {
                connection.execute(
                    "DELETE FROM local_agent_file_outbox WHERE event_id=?1",
                    [id],
                )?;
            }
            Ok(())
        })
        .await
    }

    pub async fn execute_approved_action(
        &self,
        request: ExecuteApprovedAgentActionRequest,
    ) -> ApiResult<Value> {
        let path = self.database_path.clone();
        run_db(path, move |connection| {
            execute_approved_action_sync(connection, request)
        })
        .await
    }

    pub async fn stage_approved_action(
        &self,
        request: StageApprovedAgentActionRequest,
    ) -> ApiResult<Value> {
        let path = self.database_path.clone();
        run_db(path, move |connection| {
            stage_approved_action_sync(connection, request)
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
                ApiError::Message(format!("Could not create agent data directory: {error}"))
            })?;
        }
        let mut connection = Connection::open(path).map_err(|error| {
            ApiError::Message(format!("Could not open agent database: {error}"))
        })?;
        ensure_schema(&connection).map_err(|error| {
            ApiError::Message(format!("Could not initialize agent database: {error}"))
        })?;
        operation(&mut connection)
            .map_err(|error| ApiError::Message(format!("Agent database operation failed: {error}")))
    })
    .await
    .map_err(|error| ApiError::Message(format!("Agent database worker failed: {error}")))?
}

#[allow(dead_code)]
fn enqueue_local_webhook_sync(
    connection: &mut Connection,
    webhook_id: &str,
    prompt: &str,
) -> rusqlite::Result<Value> {
    let definitions = load_json_rows(
        connection,
        "SELECT document FROM local_agent_definitions ORDER BY updated_at DESC",
    )?;
    let definition = definitions
        .into_iter()
        .find(|definition| {
            definition.get("status").and_then(Value::as_str) == Some("enabled")
                && definition
                    .get("triggers")
                    .and_then(Value::as_array)
                    .is_some_and(|triggers| {
                        triggers.iter().any(|trigger| {
                            trigger.get("enabled").and_then(Value::as_bool) == Some(true)
                                && trigger.get("kind").and_then(Value::as_str)
                                    == Some("local_webhook")
                                && trigger.get("webhookId").and_then(Value::as_str)
                                    == Some(webhook_id)
                        })
                    })
        })
        .ok_or_else(|| validation_error("Agent webhook was not found or is disabled."))?;
    let agent_id = required_string(definition.get("id"), "Agent id is required.")?;
    let scope_id = definition
        .pointer("/scope/id")
        .and_then(Value::as_str)
        .ok_or_else(|| validation_error("Agent scope is required."))?;
    let event_id = format!("webhookevent_{}", Uuid::new_v4());
    let event = json!({
        "eventId": event_id,
        "agentId": agent_id,
        "scopeId": scope_id,
        "triggerKind": "local_webhook",
        "prompt": prompt,
        "checkpoint": Utc::now().to_rfc3339(),
    });
    connection.execute(
        "INSERT INTO local_agent_file_outbox(event_id,document,created_at) VALUES(?1,?2,?3)",
        params![
            event_id,
            serde_json::to_string(&event).map_err(json_error)?,
            Utc::now().to_rfc3339()
        ],
    )?;
    Ok(event)
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
        CREATE TABLE IF NOT EXISTS local_agent_definitions (
            id TEXT PRIMARY KEY,
            scope_id TEXT NOT NULL REFERENCES local_agent_scopes(id) ON DELETE RESTRICT,
            document TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_agent_jobs (
            id TEXT PRIMARY KEY,
            document TEXT NOT NULL,
            state TEXT NOT NULL,
            lease_expires_at TEXT,
            completion_key TEXT,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_agent_approvals (
            id TEXT PRIMARY KEY,
            document TEXT NOT NULL,
            action_digest TEXT NOT NULL,
            status TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_agent_artifacts (
            id TEXT PRIMARY KEY,
            document TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_agent_scope_checkpoints (
            scope_id TEXT PRIMARY KEY REFERENCES local_agent_scopes(id) ON DELETE CASCADE,
            initialized_at TEXT NOT NULL,
            last_reconciled_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_agent_file_checkpoints (
            scope_id TEXT NOT NULL REFERENCES local_agent_scopes(id) ON DELETE CASCADE,
            file_name TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            PRIMARY KEY(scope_id,file_name)
        );
        CREATE TABLE IF NOT EXISTS local_agent_file_outbox (
            event_id TEXT PRIMARY KEY,
            document TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_agent_mutations (
            job_id TEXT PRIMARY KEY,
            action_digest TEXT NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('pending','completed')),
            document TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
    )
}

fn snapshot_sync(connection: &mut Connection) -> rusqlite::Result<Value> {
    expire_local_state(connection)?;
    let device_id = device_id(connection)?;
    let scopes = load_json_rows(connection, "SELECT json_object('id',id,'deviceId',device_id,'displayName',display_name,'kind','local_folder','relativePath',NULL,'available',json('true')) FROM local_agent_scopes ORDER BY created_at")?;
    let definitions = load_json_rows(
        connection,
        "SELECT document FROM local_agent_definitions ORDER BY updated_at DESC",
    )?;
    let jobs = load_json_rows(
        connection,
        "SELECT document FROM local_agent_jobs ORDER BY updated_at DESC LIMIT 100",
    )?;
    let approvals = load_json_rows(
        connection,
        "SELECT document FROM local_agent_approvals ORDER BY updated_at DESC LIMIT 100",
    )?;
    let artifacts = load_json_rows(
        connection,
        "SELECT document FROM local_agent_artifacts ORDER BY created_at DESC LIMIT 100",
    )?;
    Ok(json!({
        "version": LOCAL_STORE_VERSION,
        "device": {"id": device_id, "displayName": "This Misty", "status": "online", "capabilities": ["folder_agents", "document_intelligence", "job_leases", "citations"], "lastSeenAt": Utc::now().to_rfc3339()},
        "scopes": scopes,
        "definitions": definitions,
        "jobs": jobs,
        "approvals": approvals,
        "artifacts": artifacts,
        "loadedAt": Utc::now().to_rfc3339(),
    }))
}

fn register_scope_sync(connection: &mut Connection, raw_path: &str) -> rusqlite::Result<Value> {
    let canonical = fs::canonicalize(raw_path)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    if !canonical.is_dir() {
        return Err(validation_error("Agent scope must be a local folder."));
    }
    let canonical_text = canonical.to_string_lossy().to_string();
    if let Some(existing) = connection
        .query_row(
            "SELECT json_object('id',id,'deviceId',device_id,'displayName',display_name,'kind','local_folder','relativePath',NULL,'available',json('true')) FROM local_agent_scopes WHERE local_path=?1",
            [&canonical_text],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    {
        return json_from_string(existing);
    }
    let id = format!("scope_{}", Uuid::new_v4().simple());
    let device = device_id(connection)?;
    let display_name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Folder");
    connection.execute(
        "INSERT INTO local_agent_scopes(id,device_id,display_name,local_path,created_at) VALUES(?1,?2,?3,?4,?5)",
        params![id, device, display_name, canonical_text, Utc::now().to_rfc3339()],
    )?;
    Ok(
        json!({"id":id,"deviceId":device,"displayName":display_name,"kind":"local_folder","relativePath":null,"available":true}),
    )
}

fn save_definition_sync(
    connection: &mut Connection,
    mut definition: Value,
) -> rusqlite::Result<Value> {
    let object = definition
        .as_object_mut()
        .ok_or_else(|| validation_error("Agent definition must be an object."))?;
    let id = required_string(object.get("id"), "Agent id is required.")?;
    let scope = object
        .get("scope")
        .and_then(Value::as_object)
        .ok_or_else(|| validation_error("Agent scope is required."))?;
    let scope_id = required_string(scope.get("id"), "Agent scope id is required.")?;
    let device = device_id(connection)?;
    let scope_device: Option<String> = connection
        .query_row(
            "SELECT device_id FROM local_agent_scopes WHERE id=?1",
            [&scope_id],
            |row| row.get(0),
        )
        .optional()?;
    if scope_device.as_deref() != Some(device.as_str()) {
        return Err(validation_error(
            "Agent scope is unavailable on this device.",
        ));
    }
    required_string(object.get("name"), "Agent name is required.")?;
    required_string(
        object.get("instructions"),
        "Agent instructions are required.",
    )?;
    if object
        .get("trustPolicy")
        .and_then(Value::as_object)
        .and_then(|policy| policy.get("memberWriteAccess"))
        .and_then(Value::as_bool)
        != Some(false)
    {
        return Err(validation_error(
            "Agent members cannot receive write access in this beta.",
        ));
    }
    object.insert("deviceId".to_owned(), Value::String(device));
    object.insert(
        "updatedAt".to_owned(),
        Value::String(Utc::now().to_rfc3339()),
    );
    let encoded = serde_json::to_string(&definition).map_err(json_error)?;
    connection.execute(
        "INSERT INTO local_agent_definitions(id,scope_id,document,updated_at) VALUES(?1,?2,?3,?4)
         ON CONFLICT(id) DO UPDATE SET scope_id=excluded.scope_id,document=excluded.document,updated_at=excluded.updated_at",
        params![id, scope_id, encoded, Utc::now().to_rfc3339()],
    )?;
    Ok(definition)
}

fn claim_jobs_sync(
    connection: &mut Connection,
    request: ClaimAgentJobsRequest,
) -> rusqlite::Result<Vec<Value>> {
    expire_local_state(connection)?;
    let limit = request.limit.clamp(1, 20) as i64;
    let lease_seconds = request.lease_seconds.clamp(15, 300);
    let now = Utc::now();
    let ids = {
        let mut statement = connection.prepare(
            "SELECT id FROM local_agent_jobs WHERE state='queued' OR (state='leased' AND lease_expires_at < ?1) ORDER BY updated_at LIMIT ?2",
        )?;
        let values = statement
            .query_map(params![now.to_rfc3339(), limit], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<Result<Vec<_>, _>>()?;
        values
    };
    let mut claimed = Vec::new();
    for id in ids {
        let lease = now + Duration::seconds(lease_seconds);
        let job = transition_job(
            connection,
            &id,
            "leased",
            Some(lease.to_rfc3339()),
            Some("Claimed by this device".to_owned()),
        )?;
        claimed.push(job);
    }
    Ok(claimed)
}

fn update_job_lease_sync(
    connection: &mut Connection,
    request: AgentJobLeaseRequest,
) -> rusqlite::Result<Value> {
    let mut job = load_job(connection, &request.job_id)?;
    let state = job.get("status").and_then(Value::as_str).unwrap_or("");
    if !matches!(state, "leased" | "running") {
        return Err(validation_error("Only active jobs can renew a lease."));
    }
    set_value(&mut job, "status", json!("running"));
    set_value(
        &mut job,
        "leaseExpiresAt",
        json!((Utc::now() + Duration::seconds(request.lease_seconds.clamp(15, 300))).to_rfc3339()),
    );
    if let Some(progress) = request.progress {
        set_value(&mut job, "progress", json!(progress.clamp(0.0, 1.0)));
    }
    if let Some(message) = request.status_message {
        set_value(&mut job, "statusMessage", json!(message));
    }
    save_job(connection, job)
}

fn complete_job_sync(
    connection: &mut Connection,
    request: CompleteAgentJobRequest,
) -> rusqlite::Result<Value> {
    validate_idempotency_key(&request.idempotency_key)?;
    let mut job = load_job(connection, &request.job_id)?;
    let existing: Option<String> = connection
        .query_row(
            "SELECT completion_key FROM local_agent_jobs WHERE id=?1",
            [&request.job_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    if let Some(existing) = existing {
        if existing == request.idempotency_key {
            return Ok(job);
        }
        return Err(validation_error(
            "Job was already completed with a different idempotency key.",
        ));
    }
    set_value(&mut job, "status", json!("completed"));
    set_value(&mut job, "progress", json!(1.0));
    set_value(&mut job, "completedAt", json!(Utc::now().to_rfc3339()));
    set_value(&mut job, "leaseExpiresAt", Value::Null);
    set_value(&mut job, "artifactIds", json!(request.artifact_ids));
    if let Some(message) = request.status_message {
        set_value(&mut job, "statusMessage", json!(message));
    }
    save_job_with_completion(connection, job, &request.idempotency_key)
}

fn fail_job_sync(
    connection: &mut Connection,
    request: FailAgentJobRequest,
) -> rusqlite::Result<Value> {
    validate_idempotency_key(&request.idempotency_key)?;
    let mut job = load_job(connection, &request.job_id)?;
    let state = if request.retryable {
        "queued"
    } else {
        "failed"
    };
    set_value(&mut job, "status", json!(state));
    set_value(&mut job, "error", json!(request.error));
    set_value(&mut job, "leaseExpiresAt", Value::Null);
    if !request.retryable {
        set_value(&mut job, "completedAt", json!(Utc::now().to_rfc3339()));
    }
    save_job_with_completion(connection, job, &request.idempotency_key)
}

fn transition_job(
    connection: &mut Connection,
    id: &str,
    state: &str,
    lease: Option<String>,
    message: Option<String>,
) -> rusqlite::Result<Value> {
    let mut job = load_job(connection, id)?;
    set_value(&mut job, "status", json!(state));
    set_value(
        &mut job,
        "leaseExpiresAt",
        lease.map(Value::String).unwrap_or(Value::Null),
    );
    if let Some(message) = message {
        set_value(&mut job, "statusMessage", json!(message));
    }
    if matches!(state, "canceled" | "failed" | "expired") {
        set_value(&mut job, "completedAt", json!(Utc::now().to_rfc3339()));
    }
    save_job(connection, job)
}

fn resolve_approval_sync(
    connection: &mut Connection,
    request: ResolveAgentApprovalRequest,
) -> rusqlite::Result<Value> {
    let encoded: String = connection.query_row(
        "SELECT document FROM local_agent_approvals WHERE id=?1",
        [&request.approval_id],
        |row| row.get(0),
    )?;
    let mut approval = json_from_string(encoded)?;
    if approval.get("status").and_then(Value::as_str) != Some("pending") {
        return Err(validation_error("Approval is no longer pending."));
    }
    let digest = approval
        .pointer("/action/digest")
        .and_then(Value::as_str)
        .unwrap_or("");
    if digest.is_empty() || digest != request.action_digest {
        return Err(validation_error("Approval action digest does not match."));
    }
    let expires_at = approval
        .get("expiresAt")
        .and_then(Value::as_str)
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok());
    if expires_at.is_some_and(|expires| expires.with_timezone(&Utc) <= Utc::now()) {
        return Err(validation_error("Approval has expired."));
    }
    let status = match request.decision.as_str() {
        "approved" => "approved",
        "denied" => "denied",
        _ => return Err(validation_error("Approval decision is invalid.")),
    };
    set_value(&mut approval, "status", json!(status));
    set_value(&mut approval, "resolvedAt", json!(Utc::now().to_rfc3339()));
    connection.execute(
        "UPDATE local_agent_approvals SET document=?2,status=?3,updated_at=?4 WHERE id=?1",
        params![
            request.approval_id,
            serde_json::to_string(&approval).map_err(json_error)?,
            status,
            Utc::now().to_rfc3339()
        ],
    )?;
    Ok(approval)
}

fn citation_path_sync(connection: &mut Connection, citation: &Value) -> rusqlite::Result<PathBuf> {
    let scope_id = citation
        .get("scopeId")
        .and_then(Value::as_str)
        .ok_or_else(|| validation_error("Citation scope is required."))?;
    let root: String = connection.query_row(
        "SELECT local_path FROM local_agent_scopes WHERE id=?1",
        [scope_id],
        |row| row.get(0),
    )?;
    let relative = citation
        .get("relativePath")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .or_else(|| citation.get("fileName").and_then(Value::as_str))
        .ok_or_else(|| validation_error("Citation file is required."))?;
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path.components().any(|part| {
            matches!(
                part,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(validation_error(
            "Citation path is outside its agent scope.",
        ));
    }
    let root = fs::canonicalize(root)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let target = fs::canonicalize(root.join(relative_path))
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    if !target.starts_with(&root) {
        return Err(validation_error(
            "Citation path is outside its agent scope.",
        ));
    }
    Ok(target)
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
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(validation_error(
            "Document path is outside its agent scope.",
        ));
    }
    let root = fs::canonicalize(root)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let target = fs::canonicalize(root.join(relative_path))
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    if !target.starts_with(&root) || !target.is_file() {
        return Err(validation_error(
            "Document path is outside its agent scope.",
        ));
    }
    Ok(target)
}

fn find_scope_document_sync(
    connection: &Connection,
    scope_id: &str,
    query: &str,
) -> rusqlite::Result<Option<String>> {
    let _: String = connection.query_row(
        "SELECT id FROM local_agent_scopes WHERE id=?1",
        [scope_id],
        |row| row.get(0),
    )?;
    let tokens = query
        .split(|character: char| !character.is_alphanumeric())
        .map(str::to_ascii_lowercase)
        .filter(|token| token.len() >= 3)
        .collect::<Vec<_>>();
    let mut statement = connection.prepare(
        "SELECT file_name FROM local_agent_file_checkpoints WHERE scope_id=?1 ORDER BY last_seen_at DESC LIMIT 1000",
    )?;
    let candidates = statement
        .query_map([scope_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let supported = [
        "pdf", "docx", "pptx", "xlsx", "ods", "csv", "md", "txt", "png", "jpg", "jpeg", "webp",
        "gif", "bmp", "tif", "tiff",
    ];
    let mut best: Option<(usize, String)> = None;
    for candidate in candidates.into_iter().filter(|candidate| {
        Path::new(candidate)
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| supported.contains(&extension.to_ascii_lowercase().as_str()))
    }) {
        let normalized = candidate.to_ascii_lowercase();
        let score = tokens
            .iter()
            .filter(|token| normalized.contains(*token))
            .count();
        if best
            .as_ref()
            .map_or(true, |(best_score, _)| score > *best_score)
        {
            best = Some((score, candidate));
        }
    }
    Ok(best.map(|(_, candidate)| candidate))
}

fn reconcile_scopes_sync(
    connection: &mut Connection,
    request: ReconcileAgentScopesRequest,
) -> rusqlite::Result<Value> {
    connection.execute(
        "DELETE FROM local_agent_file_outbox WHERE created_at < ?1",
        [(Utc::now() - Duration::days(7)).to_rfc3339()],
    )?;
    let max_files = request.max_files_per_scope.clamp(1, 10_000);
    let max_events = request.max_events.clamp(1, 250);
    let mut query = connection.prepare("SELECT d.document,s.id,s.local_path FROM local_agent_definitions d JOIN local_agent_scopes s ON s.id=d.scope_id ORDER BY d.updated_at")?;
    let rows = query
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(query);
    let mut definitions: std::collections::BTreeMap<String, Vec<Value>> =
        std::collections::BTreeMap::new();
    let mut roots = std::collections::BTreeMap::new();
    for (encoded, scope_id, root) in rows {
        let definition = json_from_string(encoded)?;
        let enabled = definition.get("status").and_then(Value::as_str) == Some("enabled");
        if enabled {
            roots.insert(scope_id.clone(), root);
            definitions.entry(scope_id).or_default().push(definition);
        }
    }
    let now = Utc::now().to_rfc3339();
    let mut events = Vec::new();
    let mut truncated_scopes = Vec::new();
    for (scope_id, scope_definitions) in definitions {
        let Some(root_text) = roots.get(&scope_id) else {
            continue;
        };
        let Ok(root) = fs::canonicalize(root_text) else {
            continue;
        };
        let initialized = connection
            .query_row(
                "SELECT 1 FROM local_agent_scope_checkpoints WHERE scope_id=?1",
                [&scope_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        let mut seen = Vec::new();
        let mut scope_truncated = false;
        for entry in WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() {
                continue;
            }
            if seen.len() >= max_files {
                truncated_scopes.push(scope_id.clone());
                scope_truncated = true;
                break;
            }
            let Ok(relative) = entry.path().strip_prefix(&root) else {
                continue;
            };
            let file_name = relative.to_string_lossy().replace('\\', "/");
            if file_name
                .split('/')
                .any(|component| component.starts_with('.'))
            {
                continue;
            }
            if file_name.contains(".misty-summary") {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            seen.push((file_name, file_fingerprint(&metadata)));
        }
        if !initialized {
            for (file_name, fingerprint) in &seen {
                connection.execute("INSERT OR REPLACE INTO local_agent_file_checkpoints(scope_id,file_name,fingerprint,last_seen_at) VALUES(?1,?2,?3,?4)", params![scope_id, file_name, fingerprint, now])?;
            }
            connection.execute("INSERT INTO local_agent_scope_checkpoints(scope_id,initialized_at,last_reconciled_at) VALUES(?1,?2,?2)", params![scope_id, now])?;
            continue;
        }
        let current_names = seen
            .iter()
            .map(|(name, _)| name.as_str())
            .collect::<std::collections::HashSet<_>>();
        let mut prior_query = connection
            .prepare("SELECT file_name FROM local_agent_file_checkpoints WHERE scope_id=?1")?;
        let prior_names = prior_query
            .query_map([&scope_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(prior_query);
        for prior in prior_names {
            if !scope_truncated && !current_names.contains(prior.as_str()) {
                connection.execute(
                    "DELETE FROM local_agent_file_checkpoints WHERE scope_id=?1 AND file_name=?2",
                    params![scope_id, prior],
                )?;
            }
        }
        for (file_name, fingerprint) in seen {
            let prior: Option<String> = connection.query_row("SELECT fingerprint FROM local_agent_file_checkpoints WHERE scope_id=?1 AND file_name=?2", params![scope_id, file_name], |row| row.get(0)).optional()?;
            let kind = match prior.as_deref() {
                None => Some("file_created"),
                Some(value) if value != fingerprint => Some("file_changed"),
                _ => None,
            };
            let Some(kind) = kind else {
                continue;
            };
            let matching = scope_definitions
                .iter()
                .filter(|definition| {
                    definition
                        .get("triggers")
                        .and_then(Value::as_array)
                        .is_some_and(|triggers| {
                            triggers.iter().any(|trigger| {
                                trigger.get("enabled").and_then(Value::as_bool) == Some(true)
                                    && trigger.get("kind").and_then(Value::as_str) == Some(kind)
                            })
                        })
                })
                .collect::<Vec<_>>();
            let mut emitted = 0usize;
            for definition in &matching {
                if events.len() >= max_events {
                    break;
                }
                emitted += 1;
                let agent_id = definition.get("id").and_then(Value::as_str).unwrap_or("");
                let digest = Sha256::digest(
                    format!("{agent_id}\n{scope_id}\n{kind}\n{file_name}\n{fingerprint}")
                        .as_bytes(),
                );
                let event_id = format!("fileevent_{}", hex::encode(digest));
                let event = json!({"eventId":event_id,"agentId":agent_id,"scopeId":scope_id,"triggerKind":kind,"fileName":file_name,"checkpoint":fingerprint});
                connection.execute("INSERT OR IGNORE INTO local_agent_file_outbox(event_id,document,created_at) VALUES(?1,?2,?3)", params![event_id, serde_json::to_string(&event).map_err(json_error)?, now])?;
                events.push(event);
            }
            if emitted == matching.len() {
                connection.execute("INSERT INTO local_agent_file_checkpoints(scope_id,file_name,fingerprint,last_seen_at) VALUES(?1,?2,?3,?4) ON CONFLICT(scope_id,file_name) DO UPDATE SET fingerprint=excluded.fingerprint,last_seen_at=excluded.last_seen_at", params![scope_id, file_name, fingerprint, now])?;
            }
        }
        connection.execute(
            "UPDATE local_agent_scope_checkpoints SET last_reconciled_at=?2 WHERE scope_id=?1",
            params![scope_id, now],
        )?;
    }
    let mut outbox_query = connection
        .prepare("SELECT document FROM local_agent_file_outbox ORDER BY created_at LIMIT ?1")?;
    let pending = outbox_query
        .query_map([max_events as i64], |row| row.get::<_, String>(0))?
        .map(|row| json_from_string(row?))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({"events":pending,"truncatedScopes":truncated_scopes,"reconciledAt":now}))
}

fn file_fingerprint(metadata: &fs::Metadata) -> String {
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        return format!(
            "{}:{modified}:{}:{}:{}",
            metadata.len(),
            metadata.ino(),
            metadata.ctime(),
            metadata.ctime_nsec()
        );
    }
    #[cfg(not(unix))]
    format!("{}:{modified}", metadata.len())
}

fn execute_approved_action_sync(
    connection: &mut Connection,
    mut request: ExecuteApprovedAgentActionRequest,
) -> rusqlite::Result<Value> {
    let staged: Option<Value> = connection
        .query_row(
            "SELECT document FROM local_agent_mutations WHERE action_digest=?1 AND job_id=?2",
            params![request.action_digest, request.job_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(json_from_string)
        .transpose()?;
    if request.kind == "overwrite" && request.content.is_none() {
        let staged_request: ExecuteApprovedAgentActionRequest = serde_json::from_value(
            staged
                .as_ref()
                .and_then(|value| value.get("request"))
                .cloned()
                .ok_or_else(|| {
                    validation_error(
                        "Approved overwrite content is no longer available on this device.",
                    )
                })?,
        )
        .map_err(json_error)?;
        if !same_action_identity(&request, &staged_request) {
            return Err(validation_error(
                "Approved action no longer matches the staged action.",
            ));
        }
        request.content = staged_request.content;
        request.content_sha256 = staged_request.content_sha256;
    }
    if request.job_id.trim().is_empty()
        || request.summary.trim().is_empty()
        || request.summary.len() > 1_000
        || request.relative_paths.len() != 1
        || !is_sha256(&request.action_digest)
    {
        return Err(validation_error("Approved action is invalid."));
    }
    let content_sha256 = request
        .content_sha256
        .as_deref()
        .filter(|value| !value.is_empty());
    if request.kind == "overwrite" {
        let content = request
            .content
            .as_deref()
            .ok_or_else(|| validation_error("Approved overwrite content is missing."))?;
        let expected = content_sha256
            .filter(|value| is_sha256(value))
            .ok_or_else(|| validation_error("Approved overwrite content digest is missing."))?;
        if hex::encode(Sha256::digest(content.as_bytes())) != expected {
            return Err(validation_error(
                "Approved overwrite content does not match its digest.",
            ));
        }
    } else if request.content.is_some() || content_sha256.is_some() {
        return Err(validation_error(
            "Only overwrite actions may contain file content.",
        ));
    }
    validate_action_parameters(&request)?;
    let canonical = CanonicalApprovedAgentAction {
        kind: &request.kind,
        summary: request.summary.trim(),
        scope_id: &request.scope_id,
        relative_paths: &request.relative_paths,
        destination_relative_path: request.destination_relative_path.as_deref(),
        content_sha256,
        unix_mode: request.unix_mode,
    };
    let encoded_action = serde_json::to_vec(&canonical).map_err(json_error)?;
    if hex::encode(Sha256::digest(&encoded_action)) != request.action_digest {
        return Err(validation_error("Approved action digest does not match."));
    }
    if let Some(encoded) = connection.query_row(
        "SELECT document FROM local_agent_mutations WHERE action_digest=?1 AND job_id=?2 AND state='completed'",
        params![request.action_digest, request.job_id],
        |row| row.get::<_, String>(0),
    ).optional()? {
        return json_from_string(encoded);
    }
    let definition_encoded: String = connection.query_row(
        "SELECT document FROM local_agent_definitions WHERE id=?1 AND scope_id=?2",
        params![request.agent_id, request.scope_id],
        |row| row.get(0),
    )?;
    let definition = json_from_string(definition_encoded)?;
    if definition.get("status").and_then(Value::as_str) != Some("enabled")
        || !saved_workflow_contains_action(&definition, &request)
    {
        return Err(validation_error(
            "The approved action is not present in the enabled saved workflow.",
        ));
    }
    let root: String = connection.query_row(
        "SELECT local_path FROM local_agent_scopes WHERE id=?1",
        [&request.scope_id],
        |row| row.get(0),
    )?;
    let root = fs::canonicalize(root)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let pending = json!({
        "jobId": request.job_id,
        "agentId": request.agent_id,
        "scopeId": request.scope_id,
        "actionDigest": request.action_digest,
        "kind": request.kind,
        "status": "pending",
    });
    connection.execute(
        "INSERT INTO local_agent_mutations(action_digest,job_id,state,document,updated_at) VALUES(?1,?2,'pending',?3,?4)
         ON CONFLICT(job_id) DO NOTHING",
        params![request.action_digest, request.job_id, serde_json::to_string(&pending).map_err(json_error)?, Utc::now().to_rfc3339()],
    )?;
    let bound_job: Option<String> = connection
        .query_row(
            "SELECT job_id FROM local_agent_mutations WHERE action_digest=?1 AND job_id=?2",
            params![request.action_digest, request.job_id],
            |row| row.get(0),
        )
        .optional()?;
    if bound_job.as_deref() != Some(request.job_id.as_str()) {
        return Err(validation_error(
            "Approved action was already bound to another job.",
        ));
    }
    apply_scoped_mutation(&root, &request)?;
    let completed = json!({
        "jobId": request.job_id,
        "agentId": request.agent_id,
        "scopeId": request.scope_id,
        "actionDigest": request.action_digest,
        "kind": request.kind,
        "status": "completed",
        "relativePaths": request.relative_paths,
        "destinationRelativePath": request.destination_relative_path,
        "result": staged.as_ref().and_then(|value| value.get("result")).cloned().unwrap_or(Value::Null),
        "completedAt": Utc::now().to_rfc3339(),
    });
    connection.execute(
        "UPDATE local_agent_mutations SET state='completed',document=?3,updated_at=?4 WHERE action_digest=?1 AND job_id=?2",
        params![request.action_digest, request.job_id, serde_json::to_string(&completed).map_err(json_error)?, Utc::now().to_rfc3339()],
    )?;
    Ok(completed)
}

fn stage_approved_action_sync(
    connection: &mut Connection,
    request: StageApprovedAgentActionRequest,
) -> rusqlite::Result<Value> {
    validate_staged_action(connection, &request.action)?;
    if !request.result.is_object() || request.result.to_string().len() > 2_000_000 {
        return Err(validation_error("Staged agent result is invalid."));
    }
    let document = json!({
        "request": request.action,
        "result": request.result,
        "status": "pending",
    });
    connection.execute(
        "INSERT INTO local_agent_mutations(action_digest,job_id,state,document,updated_at) VALUES(?1,?2,'pending',?3,?4)
         ON CONFLICT(job_id) DO UPDATE SET action_digest=CASE WHEN local_agent_mutations.state='pending' THEN excluded.action_digest ELSE local_agent_mutations.action_digest END,document=CASE WHEN local_agent_mutations.state='pending' THEN excluded.document ELSE local_agent_mutations.document END,updated_at=excluded.updated_at",
        params![request.action.action_digest, request.action.job_id, serde_json::to_string(&document).map_err(json_error)?, Utc::now().to_rfc3339()],
    )?;
    Ok(json!({"actionDigest":request.action.action_digest,"status":"pending"}))
}

fn validate_staged_action(
    connection: &Connection,
    request: &ExecuteApprovedAgentActionRequest,
) -> rusqlite::Result<()> {
    if request.job_id.trim().is_empty()
        || request.summary.trim().is_empty()
        || request.relative_paths.len() != 1
        || !is_sha256(&request.action_digest)
    {
        return Err(validation_error("Staged action is invalid."));
    }
    let content_sha256 = request.content_sha256.as_deref();
    if request.kind == "overwrite" {
        let content = request
            .content
            .as_deref()
            .ok_or_else(|| validation_error("Staged overwrite content is missing."))?;
        let expected = content_sha256
            .filter(|value| is_sha256(value))
            .ok_or_else(|| validation_error("Staged overwrite digest is missing."))?;
        if hex::encode(Sha256::digest(content.as_bytes())) != expected {
            return Err(validation_error(
                "Staged overwrite content does not match its digest.",
            ));
        }
    }
    validate_action_parameters(request)?;
    let canonical = CanonicalApprovedAgentAction {
        kind: &request.kind,
        summary: request.summary.trim(),
        scope_id: &request.scope_id,
        relative_paths: &request.relative_paths,
        destination_relative_path: request.destination_relative_path.as_deref(),
        content_sha256,
        unix_mode: request.unix_mode,
    };
    if hex::encode(Sha256::digest(
        serde_json::to_vec(&canonical).map_err(json_error)?,
    )) != request.action_digest
    {
        return Err(validation_error("Staged action digest does not match."));
    }
    let definition: String = connection.query_row(
        "SELECT document FROM local_agent_definitions WHERE id=?1 AND scope_id=?2",
        params![request.agent_id, request.scope_id],
        |row| row.get(0),
    )?;
    let definition = json_from_string(definition)?;
    if definition.get("status").and_then(Value::as_str) != Some("enabled")
        || !saved_workflow_contains_action(&definition, request)
    {
        return Err(validation_error(
            "Staged action is not in the enabled saved workflow.",
        ));
    }
    Ok(())
}

fn same_action_identity(
    a: &ExecuteApprovedAgentActionRequest,
    b: &ExecuteApprovedAgentActionRequest,
) -> bool {
    a.agent_id == b.agent_id
        && a.job_id == b.job_id
        && a.action_digest == b.action_digest
        && a.kind == b.kind
        && a.summary == b.summary
        && a.scope_id == b.scope_id
        && a.relative_paths == b.relative_paths
        && a.destination_relative_path == b.destination_relative_path
        && a.unix_mode == b.unix_mode
}

fn validate_action_parameters(request: &ExecuteApprovedAgentActionRequest) -> rusqlite::Result<()> {
    if request.kind == "change_permissions" {
        if request.unix_mode.is_none_or(|mode| mode > 0o777) {
            return Err(validation_error(
                "Approved Unix permission mode is invalid.",
            ));
        }
    } else if request.unix_mode.is_some() {
        return Err(validation_error(
            "Only permission actions may contain a Unix mode.",
        ));
    }
    Ok(())
}

fn saved_workflow_contains_action(
    definition: &Value,
    request: &ExecuteApprovedAgentActionRequest,
) -> bool {
    definition
        .pointer("/workflow/nodes")
        .and_then(Value::as_array)
        .is_some_and(|nodes| {
            nodes.iter().any(|node| {
                if node.get("kind").and_then(Value::as_str) != Some("approval") {
                    return false;
                }
                let policy_allows =
                    node.get("policy")
                        .and_then(Value::as_array)
                        .is_some_and(|policies| {
                            policies.iter().any(|policy| {
                                policy.get("action").and_then(Value::as_str)
                                    == Some(request.kind.as_str())
                                    && policy.get("mode").and_then(Value::as_str)
                                        == Some("approval")
                            })
                        });
                let configured = node
                    .pointer("/config/action")
                    .or_else(|| node.get("config"));
                let paths_match = configured
                    .and_then(|value| value.get("relativePaths"))
                    .and_then(Value::as_array)
                    .is_some_and(|paths| {
                        paths
                            .iter()
                            .filter_map(Value::as_str)
                            .eq(request.relative_paths.iter().map(String::as_str))
                    });
                policy_allows
                    && configured
                        .and_then(|value| value.get("kind").or_else(|| value.get("actionKind")))
                        .and_then(Value::as_str)
                        == Some(request.kind.as_str())
                    && configured
                        .and_then(|value| value.get("summary"))
                        .and_then(Value::as_str)
                        == Some(request.summary.trim())
                    && paths_match
                    && configured
                        .and_then(|value| value.get("destinationRelativePath"))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        == request.destination_relative_path.as_deref().unwrap_or("")
                    && configured
                        .and_then(|value| value.get("unixMode"))
                        .and_then(Value::as_u64)
                        .map(|value| value as u32)
                        == request.unix_mode
            })
        })
}

fn apply_scoped_mutation(
    root: &Path,
    request: &ExecuteApprovedAgentActionRequest,
) -> rusqlite::Result<()> {
    let source_relative = Path::new(&request.relative_paths[0]);
    validate_relative_path(source_relative)?;
    match request.kind.as_str() {
        "overwrite" => {
            let target = safe_existing_regular_file(root, source_relative)?;
            let parent = target
                .parent()
                .ok_or_else(|| validation_error("Approved overwrite destination is invalid."))?;
            let temporary = parent.join(format!(".misty-action-{}.tmp", request.action_digest));
            if temporary.exists() {
                fs::remove_file(&temporary).map_err(io_sql_error)?;
            }
            let mut file = open_new_artifact(&temporary).map_err(io_sql_error)?;
            file.write_all(request.content.as_deref().unwrap_or_default().as_bytes())
                .map_err(io_sql_error)?;
            file.sync_all().map_err(io_sql_error)?;
            fs::rename(&temporary, &target).map_err(|error| {
                let _ = fs::remove_file(&temporary);
                io_sql_error(error)
            })?;
        }
        "rename" | "move" => {
            let destination_relative = request
                .destination_relative_path
                .as_deref()
                .ok_or_else(|| validation_error("Approved move destination is missing."))?;
            let destination_relative = Path::new(destination_relative);
            validate_relative_path(destination_relative)?;
            if let Some(parent) = destination_relative
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
            {
                reject_symlink_components(root, parent)?;
            }
            let destination = safe_new_artifact_target(root, destination_relative)?;
            if destination.exists() {
                // A pending record plus source disappearance means the previous
                // attempt completed between the filesystem mutation and ledger update.
                if !root.join(source_relative).exists()
                    && safe_existing_regular_file(root, destination_relative).is_ok()
                {
                    return Ok(());
                }
                return Err(validation_error(
                    "Approved move destination already exists.",
                ));
            }
            let source = safe_existing_regular_file(root, source_relative)?;
            fs::rename(source, destination).map_err(io_sql_error)?;
        }
        "delete" => {
            let unresolved = root.join(source_relative);
            match fs::symlink_metadata(&unresolved) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(error) => return Err(io_sql_error(error)),
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err(validation_error(
                        "Approved action cannot target a symbolic link.",
                    ))
                }
                Ok(_) => {}
            }
            let source = safe_existing_regular_file(root, source_relative)?;
            fs::remove_file(source).map_err(io_sql_error)?;
        }
        "change_permissions" => {
            let target = safe_existing_regular_file(root, source_relative)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(
                    target,
                    fs::Permissions::from_mode(request.unix_mode.unwrap_or(0)),
                )
                .map_err(io_sql_error)?;
            }
            #[cfg(not(unix))]
            {
                let _ = target;
                return Err(validation_error(
                    "Unix permission changes are unavailable on this platform.",
                ));
            }
        }
        _ => return Err(validation_error("Approved mutation kind is unsupported.")),
    }
    Ok(())
}

fn safe_existing_regular_file(root: &Path, relative: &Path) -> rusqlite::Result<PathBuf> {
    validate_relative_path(relative)?;
    reject_symlink_components(root, relative)?;
    let unresolved = root.join(relative);
    let link_metadata = fs::symlink_metadata(&unresolved).map_err(io_sql_error)?;
    if link_metadata.file_type().is_symlink() {
        return Err(validation_error(
            "Approved action cannot target a symbolic link.",
        ));
    }
    let target = fs::canonicalize(&unresolved).map_err(io_sql_error)?;
    if !target.starts_with(root) || !target.is_file() {
        return Err(validation_error(
            "Approved action target is outside its agent scope.",
        ));
    }
    Ok(target)
}

fn reject_symlink_components(root: &Path, relative: &Path) -> rusqlite::Result<()> {
    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component.as_os_str());
        let metadata = fs::symlink_metadata(&current).map_err(io_sql_error)?;
        if metadata.file_type().is_symlink() {
            return Err(validation_error(
                "Approved action cannot traverse a symbolic link.",
            ));
        }
    }
    Ok(())
}

fn validate_relative_path(relative: &Path) -> rusqlite::Result<()> {
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative.components().any(|part| {
            matches!(
                part,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(validation_error(
            "Approved action path is outside its agent scope.",
        ));
    }
    Ok(())
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn io_sql_error(error: std::io::Error) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(error))
}

fn create_summary_artifact_sync(
    connection: &mut Connection,
    request: CreateAgentSummaryArtifactRequest,
) -> rusqlite::Result<Value> {
    if request.content.trim().is_empty() || request.content.len() > 1_000_000 {
        return Err(validation_error("Summary artifact content is invalid."));
    }
    if let Some(existing) = load_json_rows(
        connection,
        "SELECT document FROM local_agent_artifacts ORDER BY created_at",
    )?
    .into_iter()
    .find(|artifact| artifact.get("jobId").and_then(Value::as_str) == Some(request.job_id.as_str()))
    {
        return Ok(existing);
    }
    let encoded: String = connection.query_row(
        "SELECT document FROM local_agent_definitions WHERE id=?1 AND scope_id=?2",
        params![request.agent_id, request.scope_id],
        |row| row.get(0),
    )?;
    if json_from_string(encoded)?
        .get("status")
        .and_then(Value::as_str)
        != Some("enabled")
    {
        return Err(validation_error("Agent is not enabled."));
    }
    let root: String = connection.query_row(
        "SELECT local_path FROM local_agent_scopes WHERE id=?1",
        [&request.scope_id],
        |row| row.get(0),
    )?;
    let root = fs::canonicalize(root)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let source = Path::new(&request.source_file_name);
    if source.is_absolute()
        || source.components().any(|part| {
            matches!(
                part,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(validation_error(
            "Artifact source is outside its agent scope.",
        ));
    }
    let parent = source.parent().unwrap_or_else(|| Path::new(""));
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Document");
    let existing_documents = load_json_rows(
        connection,
        "SELECT document FROM local_agent_artifacts ORDER BY created_at DESC",
    )?;
    if let Some(existing) = existing_documents.into_iter().find(|artifact| {
        artifact.get("jobId").and_then(Value::as_str) == Some(request.job_id.as_str())
    }) {
        let relative = existing
            .get("relativePath")
            .and_then(Value::as_str)
            .ok_or_else(|| validation_error("Saved artifact path is invalid."))?;
        let target = safe_new_artifact_target(&root, Path::new(relative))?;
        if !target.exists() {
            let mut file = open_new_artifact(&target)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
            file.write_all(request.content.as_bytes())
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        }
        return Ok(existing);
    }
    for suffix in 0..1000 {
        let name = if suffix == 0 {
            format!("{stem}.misty-summary.md")
        } else {
            format!("{stem}.misty-summary-{suffix}.md")
        };
        let relative = parent.join(name);
        let target = safe_new_artifact_target(&root, &relative)?;
        if target.exists() {
            continue;
        }
        let relative_text = relative.to_string_lossy().replace('\\', "/");
        let id = format!("artifact_{}", Uuid::new_v4().simple());
        let created_at = Utc::now().to_rfc3339();
        let document = json!({"id":id,"jobId":request.job_id,"agentId":request.agent_id,"scopeId":request.scope_id,"fileName":Path::new(&relative_text).file_name().and_then(|value| value.to_str()).unwrap_or("Summary.md"),"relativePath":relative_text,"mimeType":"text/markdown","sizeBytes":request.content.len(),"createdAt":created_at,"citations":[]});
        connection.execute(
            "INSERT INTO local_agent_artifacts(id,document,created_at) VALUES(?1,?2,?3)",
            params![
                id,
                serde_json::to_string(&document).map_err(json_error)?,
                created_at
            ],
        )?;
        match open_new_artifact(&target) {
            Ok(mut file) => {
                if let Err(error) = file.write_all(request.content.as_bytes()) {
                    let _ =
                        connection.execute("DELETE FROM local_agent_artifacts WHERE id=?1", [&id]);
                    let _ = fs::remove_file(&target);
                    return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(error)));
                }
                return Ok(document);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                connection.execute("DELETE FROM local_agent_artifacts WHERE id=?1", [&id])?;
                continue;
            }
            Err(error) => {
                let _ = connection.execute("DELETE FROM local_agent_artifacts WHERE id=?1", [&id]);
                return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(error)));
            }
        }
    }
    Err(validation_error(
        "No collision-free artifact name is available.",
    ))
}

fn safe_new_artifact_target(root: &Path, relative: &Path) -> rusqlite::Result<PathBuf> {
    if relative.is_absolute()
        || relative.components().any(|part| {
            matches!(
                part,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(validation_error(
            "Artifact destination is outside its agent scope.",
        ));
    }
    let file_name = relative
        .file_name()
        .ok_or_else(|| validation_error("Artifact destination is invalid."))?;
    let parent = relative.parent().unwrap_or_else(|| Path::new(""));
    let canonical_parent = fs::canonicalize(root.join(parent))
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    if !canonical_parent.starts_with(root) {
        return Err(validation_error(
            "Artifact destination is outside its agent scope.",
        ));
    }
    Ok(canonical_parent.join(file_name))
}

fn open_new_artifact(path: &Path) -> std::io::Result<fs::File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    options.open(path)
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

fn load_json_rows(connection: &Connection, query: &str) -> rusqlite::Result<Vec<Value>> {
    let mut statement = connection.prepare(query)?;
    let values = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .map(|row| json_from_string(row?))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(values)
}

fn load_job(connection: &Connection, id: &str) -> rusqlite::Result<Value> {
    let encoded: String = connection.query_row(
        "SELECT document FROM local_agent_jobs WHERE id=?1",
        [id],
        |row| row.get(0),
    )?;
    json_from_string(encoded)
}

fn save_job(connection: &Connection, mut job: Value) -> rusqlite::Result<Value> {
    set_value(&mut job, "updatedAt", json!(Utc::now().to_rfc3339()));
    let id = job
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| validation_error("Job id is required."))?
        .to_owned();
    let state = job
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("queued")
        .to_owned();
    let lease = job
        .get("leaseExpiresAt")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    connection.execute("UPDATE local_agent_jobs SET document=?2,state=?3,lease_expires_at=?4,updated_at=?5 WHERE id=?1", params![id, serde_json::to_string(&job).map_err(json_error)?, state, lease, Utc::now().to_rfc3339()])?;
    Ok(job)
}

fn save_job_with_completion(
    connection: &Connection,
    job: Value,
    key: &str,
) -> rusqlite::Result<Value> {
    let saved = save_job(connection, job)?;
    connection.execute(
        "UPDATE local_agent_jobs SET completion_key=?2 WHERE id=?1",
        params![saved.get("id").and_then(Value::as_str).unwrap_or(""), key],
    )?;
    Ok(saved)
}

fn expire_local_state(connection: &Connection) -> rusqlite::Result<()> {
    let now = Utc::now().to_rfc3339();
    connection.execute(
        "DELETE FROM local_agent_mutations WHERE (state='pending' AND updated_at < ?1) OR (state='completed' AND updated_at < ?2)",
        params![(Utc::now() - Duration::hours(25)).to_rfc3339(), (Utc::now() - Duration::days(30)).to_rfc3339()],
    )?;
    let mut statement = connection.prepare("SELECT id,document FROM local_agent_jobs WHERE state IN ('queued','leased','running','awaiting_approval')")?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    for (id, encoded) in rows {
        let mut value = json_from_string(encoded)?;
        if value
            .get("expiresAt")
            .and_then(Value::as_str)
            .is_some_and(|expires| expires <= now.as_str())
        {
            set_value(&mut value, "status", json!("expired"));
            set_value(&mut value, "completedAt", json!(now));
            connection.execute(
                "UPDATE local_agent_jobs SET state='expired',document=?2,updated_at=?3 WHERE id=?1",
                params![
                    id,
                    serde_json::to_string(&value).map_err(json_error)?,
                    Utc::now().to_rfc3339()
                ],
            )?;
        }
    }
    Ok(())
}

fn set_value(value: &mut Value, key: &str, next: Value) {
    if let Some(object) = value.as_object_mut() {
        object.insert(key.to_owned(), next);
    }
}

fn required_string(value: Option<&Value>, message: &str) -> rusqlite::Result<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| validation_error(message))
}

fn validate_idempotency_key(value: &str) -> rusqlite::Result<()> {
    if value.trim().len() < 8 || value.len() > 128 {
        return Err(validation_error("A valid idempotency key is required."));
    }
    Ok(())
}

fn json_from_string(encoded: String) -> rusqlite::Result<Value> {
    serde_json::from_str(&encoded).map_err(json_error)
}
fn json_error(error: serde_json::Error) -> rusqlite::Error {
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
    #[cfg(target_os = "macos")]
    let status = Command::new("open")
        .arg(
            page_url
                .as_deref()
                .unwrap_or_else(|| path.to_str().unwrap_or_default()),
        )
        .status();
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer")
        .arg(
            page_url
                .as_deref()
                .unwrap_or_else(|| path.to_str().unwrap_or_default()),
        )
        .status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open")
        .arg(
            page_url
                .as_deref()
                .unwrap_or_else(|| path.to_str().unwrap_or_default()),
        )
        .status();
    status
        .map_err(|error| ApiError::Message(format!("Could not open citation: {error}")))
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err(ApiError::Message(
                    "The citation could not be opened.".to_owned(),
                ))
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn scopes_do_not_expose_absolute_paths_and_definitions_remain_local() {
        let root = std::env::temp_dir().join(format!("misty-agent-service-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("folder")).unwrap();
        let environment = AppEnvironmentService::new_with_data_root(Some(root.clone()));
        let service = AgentService::new(environment);
        let scope = service
            .register_folder_scope(RegisterFolderScopeRequest {
                path: root.join("folder").to_string_lossy().to_string(),
            })
            .await
            .unwrap();
        assert!(scope.get("relativePath").unwrap().is_null());
        assert!(!scope
            .to_string()
            .contains(&root.to_string_lossy().to_string()));
        let snapshot = service.snapshot().await.unwrap();
        assert_eq!(snapshot["scopes"].as_array().unwrap().len(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn scoped_document_preparation_never_returns_or_escapes_the_local_root() {
        let root = std::env::temp_dir().join(format!("misty-agent-document-{}", Uuid::new_v4()));
        let folder = root.join("folder");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("report.txt"), "grounded report text").unwrap();
        fs::write(root.join("outside.txt"), "private").unwrap();
        let service = AgentService::new(AppEnvironmentService::new_with_data_root(Some(
            root.clone(),
        )));
        let scope = service
            .register_folder_scope(RegisterFolderScopeRequest {
                path: folder.to_string_lossy().into_owned(),
            })
            .await
            .unwrap();
        let scope_id = scope["id"].as_str().unwrap().to_owned();
        let document = service
            .prepare_scoped_document(PrepareScopedAgentDocumentRequest {
                scope_id: scope_id.clone(),
                relative_path: "report.txt".to_owned(),
                ocr_page_start: None,
                ocr_page_limit: None,
            })
            .await
            .unwrap();
        let encoded = serde_json::to_string(&document).unwrap();
        assert!(encoded.contains("grounded report text"));
        assert!(!encoded.contains(&root.to_string_lossy().to_string()));
        assert!(service
            .prepare_scoped_document(PrepareScopedAgentDocumentRequest {
                scope_id,
                relative_path: "../outside.txt".to_owned(),
                ocr_page_start: None,
                ocr_page_limit: None,
            })
            .await
            .is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn reconciliation_uses_a_durable_outbox_and_artifacts_never_overwrite() {
        let root = std::env::temp_dir().join(format!("misty-agent-reconcile-{}", Uuid::new_v4()));
        let folder = root.join("folder");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("existing.txt"), "baseline").unwrap();
        let service = AgentService::new(AppEnvironmentService::new_with_data_root(Some(
            root.clone(),
        )));
        let scope = service
            .register_folder_scope(RegisterFolderScopeRequest {
                path: folder.to_string_lossy().into_owned(),
            })
            .await
            .unwrap();
        let scope_id = scope["id"].as_str().unwrap().to_owned();
        let device_id = scope["deviceId"].as_str().unwrap().to_owned();
        let agent_id = format!("agent_{}", Uuid::new_v4());
        service.save_definition(SaveAgentDefinitionRequest { definition: json!({
            "id":agent_id,"ownerAccountId":"owner","deviceId":device_id,"scope":scope,"name":"Reports","instructions":"Summarize reports",
            "status":"enabled","cloudDocumentConsent":true,"members":[],"triggers":[{"id":"trigger","kind":"file_created","enabled":true}],
            "trustPolicy":{"automaticActions":["read","summarize","create_file"],"approvalRequiredActions":[],"memberWriteAccess":false,"approvalTtlHours":24},
            "workflowRevision":1,"version":1,"createdAt":Utc::now().to_rfc3339(),"updatedAt":Utc::now().to_rfc3339()
        }) }).await.unwrap();
        let limits = || ReconcileAgentScopesRequest {
            max_files_per_scope: 100,
            max_events: 10,
        };
        assert!(service.reconcile_scopes(limits()).await.unwrap()["events"]
            .as_array()
            .unwrap()
            .is_empty());
        fs::write(folder.join("report.txt"), "new report").unwrap();
        let first = service.reconcile_scopes(limits()).await.unwrap();
        let event_id = first["events"][0]["eventId"].as_str().unwrap().to_owned();
        assert_eq!(first["events"][0]["fileName"], "report.txt");
        assert_eq!(
            service
                .find_scope_document(FindScopeDocumentRequest {
                    scope_id: scope_id.clone(),
                    query: "summarize the report".to_owned(),
                })
                .await
                .unwrap()
                .as_deref(),
            Some("report.txt")
        );
        assert_eq!(
            service.reconcile_scopes(limits()).await.unwrap()["events"][0]["eventId"],
            event_id
        );
        service
            .acknowledge_file_events(AcknowledgeAgentFileEventsRequest {
                event_ids: vec![event_id],
            })
            .await
            .unwrap();
        assert!(service.reconcile_scopes(limits()).await.unwrap()["events"]
            .as_array()
            .unwrap()
            .is_empty());
        let artifact = |job: &str| CreateAgentSummaryArtifactRequest {
            agent_id: agent_id.clone(),
            job_id: job.to_owned(),
            scope_id: scope_id.clone(),
            source_file_name: "report.txt".to_owned(),
            content: "summary".to_owned(),
        };
        let first_artifact = service
            .create_summary_artifact(artifact("job_one"))
            .await
            .unwrap();
        let retried_artifact = service
            .create_summary_artifact(artifact("job_one"))
            .await
            .unwrap();
        let second_artifact = service
            .create_summary_artifact(artifact("job_two"))
            .await
            .unwrap();
        assert_eq!(first_artifact["id"], retried_artifact["id"]);
        assert_ne!(
            first_artifact["relativePath"],
            second_artifact["relativePath"]
        );
        assert_eq!(
            fs::read_to_string(folder.join("report.misty-summary.md")).unwrap(),
            "summary"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let outside = root.join("outside");
            fs::create_dir_all(&outside).unwrap();
            symlink(&outside, folder.join("escaped")).unwrap();
            let escaped = CreateAgentSummaryArtifactRequest {
                agent_id: agent_id.clone(),
                job_id: "job_symlink".to_owned(),
                scope_id: scope_id.clone(),
                source_file_name: "escaped/report.txt".to_owned(),
                content: "must stay scoped".to_owned(),
            };
            assert!(service.create_summary_artifact(escaped).await.is_err());
            assert!(!outside.join("report.misty-summary.md").exists());
        }
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn approved_mutations_are_scoped_digest_bound_and_idempotent() {
        let root = std::env::temp_dir().join(format!("misty-agent-mutation-{}", Uuid::new_v4()));
        let folder = root.join("folder");
        fs::create_dir_all(folder.join("archive")).unwrap();
        fs::write(folder.join("report.txt"), "old").unwrap();
        let service = AgentService::new(AppEnvironmentService::new_with_data_root(Some(
            root.clone(),
        )));
        let scope = service
            .register_folder_scope(RegisterFolderScopeRequest {
                path: folder.to_string_lossy().into_owned(),
            })
            .await
            .unwrap();
        let scope_id = scope["id"].as_str().unwrap().to_owned();
        let agent_id = format!("agent_{}", Uuid::new_v4());
        let summary = "Move the processed report";
        service.save_definition(SaveAgentDefinitionRequest { definition: json!({
            "id":agent_id,"ownerAccountId":"owner","deviceId":scope["deviceId"],"scope":scope,"name":"Reports","instructions":"Process reports",
            "status":"enabled","cloudDocumentConsent":true,"members":[],"triggers":[{"id":"trigger","kind":"manual","enabled":true}],
            "trustPolicy":{"automaticActions":["read"],"approvalRequiredActions":["move"],"memberWriteAccess":false,"approvalTtlHours":24},
            "workflow":{"version":1,"revision":1,"nodes":[
                {"id":"approval","kind":"approval","config":{"action":{"kind":"move","summary":summary,"relativePaths":["report.txt"],"destinationRelativePath":"archive/report.txt"}},"policy":[{"action":"move","mode":"approval"}]},
                {"id":"permissions","kind":"approval","config":{"action":{"kind":"change_permissions","summary":"Make the report owner-only","relativePaths":["archive/report.txt"],"unixMode":384}},"policy":[{"action":"change_permissions","mode":"approval"}]}
            ],"edges":[]},
            "workflowRevision":1,"version":1,"createdAt":Utc::now().to_rfc3339(),"updatedAt":Utc::now().to_rfc3339()
        }) }).await.unwrap();
        let canonical = CanonicalApprovedAgentAction {
            kind: "move",
            summary,
            scope_id: &scope_id,
            relative_paths: &["report.txt".to_owned()],
            destination_relative_path: Some("archive/report.txt"),
            content_sha256: None,
            unix_mode: None,
        };
        let digest = hex::encode(Sha256::digest(serde_json::to_vec(&canonical).unwrap()));
        let action = || ExecuteApprovedAgentActionRequest {
            agent_id: agent_id.clone(),
            job_id: "job_one".to_owned(),
            action_digest: digest.clone(),
            kind: "move".to_owned(),
            summary: summary.to_owned(),
            scope_id: scope_id.clone(),
            relative_paths: vec!["report.txt".to_owned()],
            destination_relative_path: Some("archive/report.txt".to_owned()),
            content: None,
            content_sha256: None,
            unix_mode: None,
        };
        assert_eq!(
            service.execute_approved_action(action()).await.unwrap()["status"],
            "completed"
        );
        assert_eq!(
            service.execute_approved_action(action()).await.unwrap()["status"],
            "completed"
        );
        assert!(!folder.join("report.txt").exists());
        assert_eq!(
            fs::read_to_string(folder.join("archive/report.txt")).unwrap(),
            "old"
        );
        let mut altered = action();
        altered.destination_relative_path = Some("../outside.txt".to_owned());
        assert!(service.execute_approved_action(altered).await.is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let permission_paths = vec!["archive/report.txt".to_owned()];
            let permission_canonical = CanonicalApprovedAgentAction {
                kind: "change_permissions",
                summary: "Make the report owner-only",
                scope_id: &scope_id,
                relative_paths: &permission_paths,
                destination_relative_path: None,
                content_sha256: None,
                unix_mode: Some(0o600),
            };
            let permission_digest = hex::encode(Sha256::digest(
                serde_json::to_vec(&permission_canonical).unwrap(),
            ));
            service
                .execute_approved_action(ExecuteApprovedAgentActionRequest {
                    agent_id,
                    job_id: "job_permissions".to_owned(),
                    action_digest: permission_digest,
                    kind: "change_permissions".to_owned(),
                    summary: "Make the report owner-only".to_owned(),
                    scope_id,
                    relative_paths: permission_paths,
                    destination_relative_path: None,
                    content: None,
                    content_sha256: None,
                    unix_mode: Some(0o600),
                })
                .await
                .unwrap();
            assert_eq!(
                fs::metadata(folder.join("archive/report.txt"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn local_webhooks_only_queue_enabled_opaque_agent_events() {
        let root = std::env::temp_dir().join(format!("misty-agent-hook-{}", Uuid::new_v4()));
        let folder = root.join("folder");
        fs::create_dir_all(&folder).unwrap();
        let service = AgentService::new(AppEnvironmentService::new_with_data_root(Some(
            root.clone(),
        )));
        let scope = service
            .register_folder_scope(RegisterFolderScopeRequest {
                path: folder.to_string_lossy().into_owned(),
            })
            .await
            .unwrap();
        let webhook_id = format!("hook_{}", Uuid::new_v4().simple());
        service.save_definition(SaveAgentDefinitionRequest { definition: json!({
            "id":format!("agent_{}",Uuid::new_v4()),"ownerAccountId":"owner","deviceId":scope["deviceId"],"scope":scope,"name":"Hook","instructions":"Run on hook",
            "status":"enabled","cloudDocumentConsent":false,"members":[],"triggers":[{"id":"trigger","kind":"local_webhook","webhookId":webhook_id,"enabled":true}],
            "trustPolicy":{"automaticActions":["read"],"approvalRequiredActions":[],"memberWriteAccess":false,"approvalTtlHours":24},
            "workflow":{"version":1,"revision":1,"nodes":[],"edges":[]},"workflowRevision":1,"version":1,"createdAt":Utc::now().to_rfc3339(),"updatedAt":Utc::now().to_rfc3339()
        }) }).await.unwrap();
        let database = service.database_path.clone();
        let queued = run_db(database, move |connection| {
            enqueue_local_webhook_sync(connection, &webhook_id, "Summarize current reports")
        })
        .await
        .unwrap();
        assert_eq!(queued["triggerKind"], "local_webhook");
        assert_eq!(queued["prompt"], "Summarize current reports");
        assert!(!queued
            .to_string()
            .contains(&root.to_string_lossy().to_string()));
        let _ = fs::remove_dir_all(root);
    }
}
