use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

use crate::core::file_transfer::now_epoch_ms;
pub use crate::core::file_transfer::{
    FileTransferConflictPolicy as TransferConflictPolicy, FileTransferItemType as TransferItemType,
    FileTransferRecord as TransferRecord, FileTransferStatus as TransferStatus,
    FileTransferType as TransferType,
};
use crate::error::{ApiError, ApiResult};
use crate::services::environment::AppEnvironmentService;

#[derive(Debug, Clone)]
pub struct TransferService {
    db_path: PathBuf,
    db_lock: Arc<Mutex<()>>,
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
            db_lock: Arc::new(Mutex::new(())),
        }
    }

    pub async fn snapshot(&self, filter: TransferFilter) -> ApiResult<TransferPage> {
        let db_path = self.db_path.clone();
        let db_lock = self.db_lock.clone();
        tokio::task::spawn_blocking(move || {
            let _guard = lock_db(&db_lock)?;
            load_page(&db_path, filter)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Transfer worker failed: {err}")))?
    }

    pub async fn delete_selected(&self, ids: Vec<u64>) -> ApiResult<()> {
        let db_path = self.db_path.clone();
        let db_lock = self.db_lock.clone();
        tokio::task::spawn_blocking(move || {
            let _guard = lock_db(&db_lock)?;
            delete_selected(&db_path, ids)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Transfer worker failed: {err}")))?
    }

    pub async fn delete_all(&self) -> ApiResult<()> {
        let db_path = self.db_path.clone();
        let db_lock = self.db_lock.clone();
        tokio::task::spawn_blocking(move || {
            let _guard = lock_db(&db_lock)?;
            delete_all(&db_path)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Transfer worker failed: {err}")))?
    }

    pub async fn create_transfer(&self, record: TransferRecord) -> ApiResult<u64> {
        let db_path = self.db_path.clone();
        let db_lock = self.db_lock.clone();
        tokio::task::spawn_blocking(move || {
            let _guard = lock_db(&db_lock)?;
            create_transfer(&db_path, record, false)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Transfer worker failed: {err}")))?
    }

    pub async fn start_transfer(&self, record: TransferRecord) -> ApiResult<u64> {
        let db_path = self.db_path.clone();
        let db_lock = self.db_lock.clone();
        tokio::task::spawn_blocking(move || {
            let _guard = lock_db(&db_lock)?;
            create_transfer(&db_path, record, true)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Transfer worker failed: {err}")))?
    }

    pub async fn mark_started(&self, id: u64) -> ApiResult<()> {
        self.mutate(id, |record| record.mark_started()).await
    }

    pub async fn update_progress(
        &self,
        id: u64,
        transferred_bytes: i64,
        total_bytes: i64,
    ) -> ApiResult<()> {
        self.mutate(id, move |record| {
            record.update_progress(transferred_bytes, total_bytes)
        })
        .await
    }

    pub async fn update_detail(&self, id: u64, detail: String) -> ApiResult<()> {
        self.mutate(id, move |record| record.detail_message = detail)
            .await
    }

    pub async fn complete_transfer(&self, id: u64) -> ApiResult<()> {
        self.mutate(id, |record| {
            record.complete();
            maybe_mark_undoable(record);
        })
        .await
    }

    pub async fn fail_transfer(&self, id: u64, message: String) -> ApiResult<()> {
        self.mutate(id, move |record| record.fail(message)).await
    }

    pub async fn cancel_transfer(&self, id: u64, detail: String) -> ApiResult<()> {
        self.mutate(id, move |record| record.cancel(detail)).await
    }

    pub async fn transfer_by_undo_token(&self, undo_token_id: u64) -> ApiResult<TransferRecord> {
        let db_path = self.db_path.clone();
        let db_lock = self.db_lock.clone();
        tokio::task::spawn_blocking(move || {
            let _guard = lock_db(&db_lock)?;
            transfer_by_undo_token(&db_path, undo_token_id)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Transfer worker failed: {err}")))?
    }

    pub async fn clear_undo(&self, id: u64) -> ApiResult<()> {
        self.mutate(id, |record| {
            record.undoable = false;
            record.undo_token_id = 0;
        })
        .await
    }

    async fn mutate<F>(&self, id: u64, mutation: F) -> ApiResult<()>
    where
        F: FnOnce(&mut TransferRecord) + Send + 'static,
    {
        let db_path = self.db_path.clone();
        let db_lock = self.db_lock.clone();
        tokio::task::spawn_blocking(move || {
            let _guard = lock_db(&db_lock)?;
            mutate_transfer(&db_path, id, mutation)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Transfer worker failed: {err}")))?
    }
}

fn lock_db(lock: &Mutex<()>) -> ApiResult<std::sync::MutexGuard<'_, ()>> {
    lock.lock()
        .map_err(|_| ApiError::Message("SQLite transfer store lock was poisoned.".to_string()))
}

fn maybe_mark_undoable(record: &mut TransferRecord) {
    let supported = match record.transfer_type {
        TransferType::Rename => {
            (!record.local_source_path.is_empty() && !record.local_dest_path.is_empty())
                || (record.item_type == TransferItemType::Remote
                    && !record.remote_source_name.is_empty()
                    && !record.remote_source_path.is_empty()
                    && !record.remote_dest_name.is_empty()
                    && !record.remote_dest_path.is_empty())
        }
        TransferType::Move => {
            (record.item_type == TransferItemType::Local
                && !record.local_source_path.is_empty()
                && !record.local_dest_path.is_empty())
                || (record.item_type == TransferItemType::Remote
                    && !record.remote_source_name.is_empty()
                    && !record.remote_source_path.is_empty()
                    && !record.remote_dest_name.is_empty()
                    && !record.remote_dest_path.is_empty())
        }
        _ => false,
    };
    record.undoable = supported;
    record.undo_token_id = if supported { record.id } else { 0 };
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

fn create_transfer(
    db_path: &Path,
    mut record: TransferRecord,
    start_immediately: bool,
) -> ApiResult<u64> {
    let mut conn = open_db(db_path)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql_error)?;
    record.id = tx
        .query_row(
            "SELECT COALESCE(MAX(id), 0) + 1 FROM transfers",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sql_error)?
        .max(1) as u64;
    if record.job_id == 0 {
        record.job_id = record.id;
    }
    if record.queued_at_ms <= 0 {
        record.queued_at_ms = now_epoch_ms();
    }
    if start_immediately && record.status != TransferStatus::Queued {
        record.mark_started();
    }
    upsert_record(&tx, &record)?;
    prune_history(&tx, 500)?;
    tx.commit().map_err(sql_error)?;
    Ok(record.id)
}

fn mutate_transfer<F>(db_path: &Path, id: u64, mutation: F) -> ApiResult<()>
where
    F: FnOnce(&mut TransferRecord),
{
    let conn = open_db(db_path)?;
    let tx = conn.unchecked_transaction().map_err(sql_error)?;
    let mut record = tx
        .query_row(
            &format!(
                "SELECT {} FROM transfers WHERE id = ?",
                transfer_select_columns()
            ),
            params![id as i64],
            read_record,
        )
        .optional()
        .map_err(sql_error)?
        .ok_or_else(|| ApiError::Message(format!("Transfer {id} was not found.")))?;
    mutation(&mut record);
    upsert_record(&tx, &record)?;
    prune_history(&tx, 500)?;
    tx.commit().map_err(sql_error)?;
    Ok(())
}

fn transfer_by_undo_token(db_path: &Path, undo_token_id: u64) -> ApiResult<TransferRecord> {
    let conn = open_db(db_path)?;
    let record = conn
        .query_row(
            &format!(
                "SELECT {} FROM transfers WHERE undo_token_id = ? AND undoable = 1",
                transfer_select_columns()
            ),
            params![undo_token_id as i64],
            read_record,
        )
        .optional()
        .map_err(sql_error)?
        .ok_or_else(|| ApiError::Message(format!("Undo token {undo_token_id} was not found.")))?;
    Ok(record)
}

fn upsert_record(conn: &Connection, record: &TransferRecord) -> ApiResult<()> {
    conn.execute(
        "INSERT INTO transfers (
            id, job_id, transfer_type, item_type, status, conflict_policy, file_name,
            local_source_path, local_dest_path, remote_source_name, remote_source_path,
            remote_dest_name, remote_dest_path, total_bytes, transferred_bytes, error_message,
            detail_message, queued_at_ms, started_at_ms, completed_at_ms, cancelable, retryable,
            undoable, undo_token_id, created_session_id
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        ) ON CONFLICT(id) DO UPDATE SET
            job_id = excluded.job_id,
            transfer_type = excluded.transfer_type,
            item_type = excluded.item_type,
            status = excluded.status,
            conflict_policy = excluded.conflict_policy,
            file_name = excluded.file_name,
            local_source_path = excluded.local_source_path,
            local_dest_path = excluded.local_dest_path,
            remote_source_name = excluded.remote_source_name,
            remote_source_path = excluded.remote_source_path,
            remote_dest_name = excluded.remote_dest_name,
            remote_dest_path = excluded.remote_dest_path,
            total_bytes = excluded.total_bytes,
            transferred_bytes = excluded.transferred_bytes,
            error_message = excluded.error_message,
            detail_message = excluded.detail_message,
            queued_at_ms = excluded.queued_at_ms,
            started_at_ms = excluded.started_at_ms,
            completed_at_ms = excluded.completed_at_ms,
            cancelable = excluded.cancelable,
            retryable = excluded.retryable,
            undoable = excluded.undoable,
            undo_token_id = excluded.undo_token_id,
            created_session_id = excluded.created_session_id",
        params![
            record.id as i64,
            record.job_id as i64,
            transfer_type_text(record.transfer_type),
            item_type_text(record.item_type),
            status_text(record.status),
            conflict_policy_text(record.conflict_policy),
            record.file_name,
            record.local_source_path,
            record.local_dest_path,
            record.remote_source_name,
            record.remote_source_path,
            record.remote_dest_name,
            record.remote_dest_path,
            record.total_bytes,
            record.transferred_bytes,
            record.error_message,
            record.detail_message,
            record.queued_at_ms,
            record.started_at_ms,
            record.completed_at_ms,
            record.cancelable as i64,
            record.retryable as i64,
            record.undoable as i64,
            record.undo_token_id as i64,
            format!("rust-{}", now_epoch_ms()),
        ],
    )
    .map_err(sql_error)?;
    Ok(())
}

fn prune_history(conn: &Connection, limit: usize) -> ApiResult<()> {
    conn.execute(
        "DELETE FROM transfers
         WHERE id IN (
            SELECT id FROM transfers
            WHERE status IN ('completed', 'failed', 'canceled', 'skipped', 'interrupted')
            ORDER BY COALESCE(completed_at_ms, queued_at_ms) DESC, id DESC
            LIMIT -1 OFFSET ?
         )",
        params![limit as i64],
    )
    .map_err(sql_error)?;
    Ok(())
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
    conn.busy_timeout(Duration::from_millis(10_000))
        .map_err(sql_error)?;
    configure_connection(&conn)?;
    initialize_schema(&conn)?;
    run_migrations(&conn)?;
    Ok(conn)
}

fn configure_connection(conn: &Connection) -> ApiResult<()> {
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(sql_error)?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(sql_error)?;
    Ok(())
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
        conflict_policy: conflict_policy_from_text(row.get::<_, String>(5)?.as_str()),
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

fn transfer_type_text(value: TransferType) -> &'static str {
    match value {
        TransferType::Upload => "upload",
        TransferType::Download => "download",
        TransferType::Create => "create",
        TransferType::Copy => "copy",
        TransferType::Move => "move",
        TransferType::Rename => "rename",
        TransferType::Delete => "delete",
    }
}

fn item_type_from_text(value: &str) -> TransferItemType {
    if value == "remote" {
        TransferItemType::Remote
    } else {
        TransferItemType::Local
    }
}

fn item_type_text(value: TransferItemType) -> &'static str {
    match value {
        TransferItemType::Local => "local",
        TransferItemType::Remote => "remote",
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

fn status_text(value: TransferStatus) -> &'static str {
    match value {
        TransferStatus::Queued => "queued",
        TransferStatus::Pending => "pending",
        TransferStatus::InProgress => "in_progress",
        TransferStatus::WaitingForResolution => "waiting_for_resolution",
        TransferStatus::Completed => "completed",
        TransferStatus::Failed => "failed",
        TransferStatus::Canceled => "canceled",
        TransferStatus::Skipped => "skipped",
        TransferStatus::Interrupted => "interrupted",
    }
}

fn conflict_policy_from_text(value: &str) -> TransferConflictPolicy {
    match value {
        "replace" => TransferConflictPolicy::Replace,
        "skip" => TransferConflictPolicy::Skip,
        "keep_both" => TransferConflictPolicy::KeepBoth,
        _ => TransferConflictPolicy::Ask,
    }
}

fn conflict_policy_text(value: TransferConflictPolicy) -> &'static str {
    match value {
        TransferConflictPolicy::Ask => "ask",
        TransferConflictPolicy::Replace => "replace",
        TransferConflictPolicy::Skip => "skip",
        TransferConflictPolicy::KeepBoth => "keep_both",
    }
}

fn sql_error(error: rusqlite::Error) -> ApiError {
    ApiError::Message(format!("SQLite transfer store failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_service(label: &str) -> (TransferService, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "misty-transfer-{label}-{}-{}",
            std::process::id(),
            now_epoch_ms()
        ));
        let db_path = root.join("misty.db");
        (
            TransferService {
                db_path,
                db_lock: Arc::new(Mutex::new(())),
            },
            root,
        )
    }

    #[tokio::test]
    async fn fresh_store_persists_transfer_lifecycle() {
        let (service, root) = test_service("lifecycle");
        let mut record =
            TransferRecord::new(TransferType::Upload, TransferItemType::Local, "archive.zip");
        record.local_source_path = "/tmp/archive.zip".to_string();
        record.remote_dest_name = "backup".to_string();
        record.remote_dest_path = "/archive.zip".to_string();
        record.total_bytes = 100;

        let id = service
            .start_transfer(record)
            .await
            .expect("start transfer");
        service
            .update_progress(id, 45, 100)
            .await
            .expect("update progress");
        service
            .complete_transfer(id)
            .await
            .expect("complete transfer");

        let page = service
            .snapshot(TransferFilter::default())
            .await
            .expect("load transfer page");
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.rows[0].id, id);
        assert_eq!(page.rows[0].status, TransferStatus::Completed);
        assert_eq!(page.rows[0].transferred_bytes, 100);
        assert_eq!(page.rows[0].conflict_policy, TransferConflictPolicy::Ask);

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn failed_transfer_keeps_context_and_becomes_retryable() {
        let (service, root) = test_service("failure");
        let mut record = TransferRecord::new(
            TransferType::Download,
            TransferItemType::Remote,
            "report.pdf",
        );
        record.remote_source_name = "drive".to_string();
        record.remote_source_path = "/report.pdf".to_string();
        record.local_dest_path = "/tmp/report.pdf".to_string();
        let id = service
            .start_transfer(record)
            .await
            .expect("start transfer");
        service
            .fail_transfer(id, "connection reset".to_string())
            .await
            .expect("fail transfer");

        let page = service
            .snapshot(TransferFilter::default())
            .await
            .expect("load transfer page");
        assert_eq!(page.rows[0].status, TransferStatus::Failed);
        assert_eq!(page.rows[0].remote_source_name, "drive");
        assert_eq!(page.rows[0].error_message, "connection reset");
        assert!(page.rows[0].retryable);

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn concurrent_transfer_creates_allocate_unique_ids() {
        let (service, root) = test_service("concurrent-create");
        let mut tasks = tokio::task::JoinSet::new();
        for index in 0..16 {
            let service = service.clone();
            tasks.spawn(async move {
                let mut record = TransferRecord::new(
                    TransferType::Download,
                    TransferItemType::Remote,
                    &format!("item-{index}.bin"),
                );
                record.remote_source_name = "drive".to_string();
                record.remote_source_path = format!("/item-{index}.bin");
                record.local_dest_path = format!("/tmp/item-{index}.bin");
                let id = service.start_transfer(record).await?;
                service.update_progress(id, 10, 10).await?;
                service.complete_transfer(id).await?;
                ApiResult::Ok(id)
            });
        }

        let mut ids = Vec::new();
        while let Some(result) = tasks.join_next().await {
            ids.push(result.expect("join transfer task").expect("transfer task"));
        }
        ids.sort_unstable();
        ids.dedup();

        let page = service
            .snapshot(TransferFilter {
                limit: Some(32),
                ..TransferFilter::default()
            })
            .await
            .expect("load transfer page");
        assert_eq!(ids.len(), 16);
        assert_eq!(page.total_count, 16);
        assert!(page
            .rows
            .iter()
            .all(|row| row.status == TransferStatus::Completed));

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn completed_local_rename_gets_undo_token() {
        let (service, root) = test_service("undo-rename");
        let mut record =
            TransferRecord::new(TransferType::Rename, TransferItemType::Local, "notes.md");
        record.local_source_path = "/tmp/notes.md".to_string();
        record.local_dest_path = "/tmp/renamed.md".to_string();

        let id = service
            .start_transfer(record)
            .await
            .expect("start rename transfer");
        service
            .complete_transfer(id)
            .await
            .expect("complete rename transfer");

        let row = service
            .transfer_by_undo_token(id)
            .await
            .expect("lookup undo token");
        assert_eq!(row.id, id);
        assert!(row.undoable);
        assert_eq!(row.undo_token_id, id);

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn completed_local_move_gets_undo_token() {
        let (service, root) = test_service("undo-move");
        let mut record =
            TransferRecord::new(TransferType::Move, TransferItemType::Local, "photo.png");
        record.local_source_path = "/tmp/source/photo.png".to_string();
        record.local_dest_path = "/tmp/dest/photo.png".to_string();

        let id = service
            .start_transfer(record)
            .await
            .expect("start move transfer");
        service
            .complete_transfer(id)
            .await
            .expect("complete move transfer");

        let page = service
            .snapshot(TransferFilter::default())
            .await
            .expect("load transfer page");
        assert_eq!(page.rows[0].id, id);
        assert!(page.rows[0].undoable);
        assert_eq!(page.rows[0].undo_token_id, id);

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn completed_remote_move_gets_undo_token() {
        let (service, root) = test_service("undo-remote-move");
        let mut record =
            TransferRecord::new(TransferType::Move, TransferItemType::Remote, "photo.png");
        record.remote_source_name = "drive".to_string();
        record.remote_source_path = "/source/photo.png".to_string();
        record.remote_dest_name = "drive".to_string();
        record.remote_dest_path = "/dest/photo.png".to_string();

        let id = service
            .start_transfer(record)
            .await
            .expect("start remote move transfer");
        service
            .complete_transfer(id)
            .await
            .expect("complete remote move transfer");

        let page = service
            .snapshot(TransferFilter::default())
            .await
            .expect("load transfer page");
        assert_eq!(page.rows[0].id, id);
        assert!(page.rows[0].undoable);
        assert_eq!(page.rows[0].undo_token_id, id);
        assert_eq!(
            service
                .transfer_by_undo_token(id)
                .await
                .expect("lookup undo token")
                .id,
            id
        );

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn completed_remote_rename_gets_undo_token() {
        let (service, root) = test_service("undo-remote-rename");
        let mut record =
            TransferRecord::new(TransferType::Rename, TransferItemType::Remote, "final.txt");
        record.remote_source_name = "drive".to_string();
        record.remote_source_path = "/draft.txt".to_string();
        record.remote_dest_name = "drive".to_string();
        record.remote_dest_path = "/final.txt".to_string();

        let id = service
            .start_transfer(record)
            .await
            .expect("start remote rename transfer");
        service
            .complete_transfer(id)
            .await
            .expect("complete remote rename transfer");

        let page = service
            .snapshot(TransferFilter::default())
            .await
            .expect("load transfer page");
        assert_eq!(page.rows[0].id, id);
        assert!(page.rows[0].undoable);
        assert_eq!(page.rows[0].undo_token_id, id);

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn clearing_undo_token_removes_lookup() {
        let (service, root) = test_service("undo-clear");
        let mut record =
            TransferRecord::new(TransferType::Rename, TransferItemType::Local, "draft.txt");
        record.local_source_path = "/tmp/draft.txt".to_string();
        record.local_dest_path = "/tmp/final.txt".to_string();

        let id = service
            .start_transfer(record)
            .await
            .expect("start rename transfer");
        service
            .complete_transfer(id)
            .await
            .expect("complete rename transfer");
        service.clear_undo(id).await.expect("clear undo");

        let page = service
            .snapshot(TransferFilter::default())
            .await
            .expect("load transfer page");
        assert!(!page.rows[0].undoable);
        assert_eq!(page.rows[0].undo_token_id, 0);
        assert!(service.transfer_by_undo_token(id).await.is_err());

        let _ = fs::remove_dir_all(root);
    }
}
