use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};
use crate::services::environment::AppEnvironmentService;

#[derive(Debug, Clone)]
pub struct TransferService {
    db_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferRecord {
    pub id: u64,
    pub job_id: u64,
    pub transfer_type: TransferType,
    pub item_type: TransferItemType,
    pub status: TransferStatus,
    pub conflict_policy: String,
    pub file_name: String,
    pub local_source_path: String,
    pub local_dest_path: String,
    pub remote_source_name: String,
    pub remote_source_path: String,
    pub remote_dest_name: String,
    pub remote_dest_path: String,
    pub total_bytes: i64,
    pub transferred_bytes: i64,
    pub error_message: String,
    pub detail_message: String,
    pub queued_at_ms: i64,
    pub started_at_ms: i64,
    pub completed_at_ms: i64,
    pub cancelable: bool,
    pub retryable: bool,
    pub undoable: bool,
    pub undo_token_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferType {
    Upload,
    Download,
    Create,
    Copy,
    Move,
    Rename,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferItemType {
    Local,
    Remote,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferStatus {
    Queued,
    Pending,
    InProgress,
    WaitingForResolution,
    Completed,
    Failed,
    Canceled,
    Skipped,
    Interrupted,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferFilter {
    pub search: Option<String>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferPage {
    pub rows: Vec<TransferRecord>,
    pub total_count: usize,
    pub db_path: String,
}

impl TransferService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        Self {
            db_path: environment.misty_db_path(),
        }
    }

    pub async fn snapshot(&self, filter: TransferFilter) -> ApiResult<TransferPage> {
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || load_page(&db_path, filter))
            .await
            .map_err(|err| ApiError::Message(format!("Transfer worker failed: {err}")))?
    }

    pub async fn delete_selected(&self, ids: Vec<u64>) -> ApiResult<()> {
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || delete_selected(&db_path, ids))
            .await
            .map_err(|err| ApiError::Message(format!("Transfer worker failed: {err}")))?
    }

    pub async fn delete_all(&self) -> ApiResult<()> {
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || delete_all(&db_path))
            .await
            .map_err(|err| ApiError::Message(format!("Transfer worker failed: {err}")))?
    }
}

fn load_page(db_path: &Path, filter: TransferFilter) -> ApiResult<TransferPage> {
    let conn = open_db(db_path)?;
    let search = filter.search.unwrap_or_default().trim().to_owned();
    let where_sql = transfer_search_where(&search);
    let total_count = count_rows(&conn, where_sql, &search)?;
    let offset = filter.offset.unwrap_or_default().min(total_count);
    let limit = filter.limit.unwrap_or(50).clamp(1, 500);

    let mut sql = String::from("SELECT ");
    sql.push_str(transfer_select_columns());
    sql.push_str(" FROM transfers ");
    sql.push_str(where_sql);
    sql.push_str(transfer_page_order_sql());
    sql.push_str(" LIMIT ? OFFSET ?");

    let rows = if search.is_empty() {
        let mut stmt = conn.prepare(&sql).map_err(sql_error)?;
        let mapped = stmt
            .query_map(params![limit as i64, offset as i64], read_record)
            .map_err(sql_error)?;
        collect_rows(mapped)?
    } else {
        let pattern = format!("%{search}%");
        let mut values = vec![pattern.as_str(); 12];
        let limit_text = limit.to_string();
        let offset_text = offset.to_string();
        values.push(limit_text.as_str());
        values.push(offset_text.as_str());
        let mut stmt = conn.prepare(&sql).map_err(sql_error)?;
        let mapped = stmt
            .query_map(rusqlite::params_from_iter(values), read_record)
            .map_err(sql_error)?;
        collect_rows(mapped)?
    };

    Ok(TransferPage {
        rows,
        total_count,
        db_path: db_path.display().to_string(),
    })
}

fn count_rows(conn: &Connection, where_sql: &str, search: &str) -> ApiResult<usize> {
    let sql = format!("SELECT COUNT(*) FROM transfers {where_sql}");
    if search.is_empty() {
        let count = conn
            .query_row(&sql, [], |row| row.get::<_, i64>(0))
            .map_err(sql_error)?;
        return Ok(count.max(0) as usize);
    }

    let pattern = format!("%{search}%");
    let values = vec![pattern.as_str(); 12];
    let count = conn
        .query_row(&sql, rusqlite::params_from_iter(values), |row| {
            row.get::<_, i64>(0)
        })
        .map_err(sql_error)?;
    Ok(count.max(0) as usize)
}

fn delete_selected(db_path: &Path, ids: Vec<u64>) -> ApiResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let conn = open_db(db_path)?;
    let tx = conn.unchecked_transaction().map_err(sql_error)?;
    {
        let mut stmt = tx
            .prepare("DELETE FROM transfers WHERE id = ?")
            .map_err(sql_error)?;
        for id in ids {
            stmt.execute(params![id as i64]).map_err(sql_error)?;
        }
    }
    tx.commit().map_err(sql_error)?;
    Ok(())
}

fn delete_all(db_path: &Path) -> ApiResult<()> {
    let conn = open_db(db_path)?;
    conn.execute("DELETE FROM transfers", [])
        .map_err(sql_error)?;
    Ok(())
}

fn open_db(path: &Path) -> ApiResult<Connection> {
    if path.as_os_str().is_empty() {
        return Err(ApiError::Unavailable(
            "Unable to resolve ~/.misty/db/misty.db.".to_owned(),
        ));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| ApiError::Message(format!("Failed to create ~/.misty/db: {err}")))?;
    }
    let conn = Connection::open(path).map_err(sql_error)?;
    conn.busy_timeout(Duration::from_millis(3000))
        .map_err(sql_error)?;
    initialize_schema(&conn)?;
    run_migrations(&conn)?;
    Ok(conn)
}

fn initialize_schema(conn: &Connection) -> ApiResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS transfers (
            id INTEGER PRIMARY KEY,
            job_id INTEGER NOT NULL,
            transfer_type TEXT NOT NULL,
            item_type TEXT NOT NULL,
            status TEXT NOT NULL,
            conflict_policy TEXT NOT NULL,
            file_name TEXT NOT NULL,
            local_source_path TEXT NOT NULL DEFAULT '',
            local_dest_path TEXT NOT NULL DEFAULT '',
            remote_source_name TEXT NOT NULL DEFAULT '',
            remote_source_path TEXT NOT NULL DEFAULT '',
            remote_dest_name TEXT NOT NULL DEFAULT '',
            remote_dest_path TEXT NOT NULL DEFAULT '',
            total_bytes INTEGER NOT NULL DEFAULT 0,
            transferred_bytes INTEGER NOT NULL DEFAULT 0,
            error_message TEXT NOT NULL DEFAULT '',
            detail_message TEXT NOT NULL DEFAULT '',
            queued_at_ms INTEGER NOT NULL DEFAULT 0,
            started_at_ms INTEGER NOT NULL DEFAULT 0,
            completed_at_ms INTEGER NOT NULL DEFAULT 0,
            cancelable INTEGER NOT NULL DEFAULT 0,
            retryable INTEGER NOT NULL DEFAULT 0,
            undoable INTEGER NOT NULL DEFAULT 0,
            undo_token_id INTEGER NOT NULL DEFAULT 0,
            created_session_id TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_transfers_status_completed
            ON transfers(status, completed_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_transfers_job_id
            ON transfers(job_id, id);
        CREATE INDEX IF NOT EXISTS idx_transfers_queued_id
            ON transfers(queued_at_ms DESC, id DESC);",
    )
    .map_err(sql_error)
}

fn run_migrations(conn: &Connection) -> ApiResult<()> {
    let version = conn
        .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
        .optional()
        .map_err(sql_error)?
        .unwrap_or_default();
    if version > 2 {
        return Err(ApiError::Message(
            "misty.db schema version is newer than this build supports.".to_owned(),
        ));
    }
    if version <= 1 {
        conn.execute_batch("PRAGMA user_version = 2")
            .map_err(sql_error)?;
    }
    Ok(())
}

fn read_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<TransferRecord> {
    Ok(TransferRecord {
        id: row.get::<_, i64>(0)?.max(0) as u64,
        job_id: row.get::<_, i64>(1)?.max(0) as u64,
        transfer_type: transfer_type_from_text(row.get::<_, String>(2)?.as_str()),
        item_type: item_type_from_text(row.get::<_, String>(3)?.as_str()),
        status: status_from_text(row.get::<_, String>(4)?.as_str()),
        conflict_policy: row.get(5)?,
        file_name: row.get(6)?,
        local_source_path: row.get(7)?,
        local_dest_path: row.get(8)?,
        remote_source_name: row.get(9)?,
        remote_source_path: row.get(10)?,
        remote_dest_name: row.get(11)?,
        remote_dest_path: row.get(12)?,
        total_bytes: row.get(13)?,
        transferred_bytes: row.get(14)?,
        error_message: row.get(15)?,
        detail_message: row.get(16)?,
        queued_at_ms: row.get(17)?,
        started_at_ms: row.get(18)?,
        completed_at_ms: row.get(19)?,
        cancelable: row.get::<_, i64>(20)? != 0,
        retryable: row.get::<_, i64>(21)? != 0,
        undoable: row.get::<_, i64>(22)? != 0,
        undo_token_id: row.get::<_, i64>(23)?.max(0) as u64,
    })
}

fn collect_rows<F>(mapped: rusqlite::MappedRows<'_, F>) -> ApiResult<Vec<TransferRecord>>
where
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<TransferRecord>,
{
    mapped
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(sql_error)
}

fn transfer_select_columns() -> &'static str {
    "id, job_id, transfer_type, item_type, status, conflict_policy, file_name, \
     local_source_path, local_dest_path, remote_source_name, remote_source_path, \
     remote_dest_name, remote_dest_path, total_bytes, transferred_bytes, error_message, \
     detail_message, queued_at_ms, started_at_ms, completed_at_ms, cancelable, retryable, \
     undoable, undo_token_id"
}

fn transfer_search_where(search_query: &str) -> &'static str {
    if search_query.is_empty() {
        return "";
    }
    "WHERE (
        CAST(id AS TEXT) LIKE ? OR
        CAST(job_id AS TEXT) LIKE ? OR
        ('J-' || CAST(job_id AS TEXT)) LIKE ? OR
        file_name LIKE ? OR
        local_source_path LIKE ? OR
        local_dest_path LIKE ? OR
        remote_source_name LIKE ? OR
        remote_source_path LIKE ? OR
        remote_dest_name LIKE ? OR
        remote_dest_path LIKE ? OR
        error_message LIKE ? OR
        detail_message LIKE ?
    ) "
}

fn transfer_page_order_sql() -> &'static str {
    " ORDER BY
        CASE WHEN status IN ('queued', 'pending', 'in_progress', 'waiting_for_resolution') THEN 0
             WHEN status = 'failed' THEN 1
             WHEN status = 'interrupted' THEN 2
             ELSE 3 END ASC,
        CASE WHEN status IN ('queued', 'pending', 'in_progress', 'waiting_for_resolution')
             THEN started_at_ms ELSE completed_at_ms END DESC,
        id DESC"
}

fn transfer_type_from_text(value: &str) -> TransferType {
    match value {
        "upload" => TransferType::Upload,
        "download" => TransferType::Download,
        "create" => TransferType::Create,
        "move" => TransferType::Move,
        "rename" => TransferType::Rename,
        "delete" => TransferType::Delete,
        _ => TransferType::Copy,
    }
}

fn item_type_from_text(value: &str) -> TransferItemType {
    if value == "remote" {
        TransferItemType::Remote
    } else {
        TransferItemType::Local
    }
}

fn status_from_text(value: &str) -> TransferStatus {
    match value {
        "queued" => TransferStatus::Queued,
        "in_progress" => TransferStatus::InProgress,
        "waiting_for_resolution" => TransferStatus::WaitingForResolution,
        "completed" => TransferStatus::Completed,
        "failed" => TransferStatus::Failed,
        "canceled" => TransferStatus::Canceled,
        "skipped" => TransferStatus::Skipped,
        "interrupted" => TransferStatus::Interrupted,
        _ => TransferStatus::Pending,
    }
}

fn sql_error(error: rusqlite::Error) -> ApiError {
    ApiError::Message(format!("SQLite transfer store failed: {error}"))
}
