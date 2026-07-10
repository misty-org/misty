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

#[derive(Debug, Clone)]
pub struct TransferQueuePatch {
    pub operation_id: u64,
    pub batch_id: u64,
    pub parent_transfer_id: u64,
    pub root_transfer_id: u64,
    pub tree_depth: u32,
    pub queue_title: String,
    pub preserve_order: bool,
    pub paused: bool,
    pub attempt: u32,
    pub supports_replace: bool,
    pub supports_keep_both: bool,
    pub cancelable: bool,
    pub retryable: bool,
    pub status: Option<TransferStatus>,
    pub conflict_policy: Option<TransferConflictPolicy>,
    pub error_message: Option<String>,
}

impl TransferService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        let service = Self {
            db_path: environment.misty_db_path(),
            db_lock: Arc::new(Mutex::new(())),
        };
        if let Err(error) = service.recover_orphaned_queue_rows() {
            let _ = error;
            eprintln!("SQLite transfer store recovery failed.");
        }
        service
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

    pub async fn update_progress_with_speed(
        &self,
        id: u64,
        transferred_bytes: i64,
        total_bytes: i64,
        bytes_per_second: f64,
    ) -> ApiResult<()> {
        self.mutate(id, move |record| {
            record.update_progress_with_speed(transferred_bytes, total_bytes, bytes_per_second)
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

    pub async fn complete_logical_descendants(&self, root_id: u64) -> ApiResult<()> {
        let db_path = self.db_path.clone();
        let db_lock = self.db_lock.clone();
        tokio::task::spawn_blocking(move || {
            let _guard = lock_db(&db_lock)?;
            complete_logical_descendants(&db_path, root_id)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Transfer worker failed: {err}")))?
    }

    pub async fn fail_transfer(&self, id: u64, message: String) -> ApiResult<()> {
        self.mutate(id, move |record| record.fail(message)).await
    }

    pub async fn fail_logical_descendants(&self, root_id: u64, message: String) -> ApiResult<()> {
        let db_path = self.db_path.clone();
        let db_lock = self.db_lock.clone();
        tokio::task::spawn_blocking(move || {
            let _guard = lock_db(&db_lock)?;
            fail_logical_descendants(&db_path, root_id, message)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Transfer worker failed: {err}")))?
    }

    pub async fn cancel_transfer(&self, id: u64, detail: String) -> ApiResult<()> {
        self.mutate(id, move |record| record.cancel(detail)).await
    }

    pub async fn cancel_logical_descendants(&self, root_id: u64, detail: String) -> ApiResult<()> {
        let db_path = self.db_path.clone();
        let db_lock = self.db_lock.clone();
        tokio::task::spawn_blocking(move || {
            let _guard = lock_db(&db_lock)?;
            cancel_logical_descendants(&db_path, root_id, detail)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Transfer worker failed: {err}")))?
    }

    pub async fn skip_transfer(&self, id: u64) -> ApiResult<()> {
        self.mutate(id, |record| {
            record.status = TransferStatus::Skipped;
            record.completed_at_ms = now_epoch_ms();
            record.cancelable = false;
            record.retryable = false;
        })
        .await
    }

    pub async fn mark_waiting_for_resolution(&self, id: u64) -> ApiResult<()> {
        self.mutate(id, |record| {
            record.status = TransferStatus::WaitingForResolution;
            record.cancelable = true;
        })
        .await
    }

    pub async fn retry_transfer(&self, id: u64) -> ApiResult<()> {
        self.mutate(id, |record| {
            record.status = TransferStatus::Queued;
            record.error_message.clear();
            record.completed_at_ms = 0;
            record.cancelable = true;
            record.retryable = true;
        })
        .await
    }

    pub async fn sync_queue_state(&self, id: u64, patch: TransferQueuePatch) -> ApiResult<()> {
        self.mutate(id, move |record| {
            record.operation_id = patch.operation_id;
            record.batch_id = patch.batch_id;
            record.parent_transfer_id = patch.parent_transfer_id;
            record.root_transfer_id = patch.root_transfer_id;
            record.tree_depth = patch.tree_depth;
            record.queue_title = patch.queue_title;
            record.preserve_order = patch.preserve_order;
            record.paused = patch.paused;
            record.attempt = patch.attempt;
            record.supports_replace = patch.supports_replace;
            record.supports_keep_both = patch.supports_keep_both;
            record.cancelable = patch.cancelable;
            record.retryable = patch.retryable;
            if let Some(status) = patch.status {
                if matches!(status, TransferStatus::Queued | TransferStatus::InProgress) {
                    record.completed_at_ms = 0;
                }
                record.status = status;
            }
            if let Some(conflict_policy) = patch.conflict_policy {
                record.conflict_policy = conflict_policy;
            }
            if let Some(error_message) = patch.error_message {
                record.error_message = error_message;
            }
        })
        .await
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

    pub async fn transfer_by_id(&self, id: u64) -> ApiResult<TransferRecord> {
        let db_path = self.db_path.clone();
        let db_lock = self.db_lock.clone();
        tokio::task::spawn_blocking(move || {
            let _guard = lock_db(&db_lock)?;
            transfer_by_id(&db_path, id)
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

    fn recover_orphaned_queue_rows(&self) -> ApiResult<()> {
        let _guard = lock_db(&self.db_lock)?;
        recover_orphaned_queue_rows(&self.db_path)
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
    let limit = filter.limit.unwrap_or(50).clamp(1, 5_000);

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
        record.job_id = if record.parent_transfer_id > 0 {
            record.root_transfer_id.max(record.parent_transfer_id)
        } else {
            next_top_level_job_id(&tx)?
        };
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

fn next_top_level_job_id(conn: &Connection) -> ApiResult<u64> {
    let mut stmt = conn
        .prepare(
            "SELECT job_id FROM transfers
             WHERE parent_transfer_id = 0 AND job_id > 0
             ORDER BY job_id ASC",
        )
        .map_err(sql_error)?;
    let mut used = stmt
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(sql_error)?;
    let mut candidate = 1_u64;
    while let Some(job_id) = used.next().transpose().map_err(sql_error)? {
        let job_id = job_id.max(0) as u64;
        if job_id < candidate {
            continue;
        }
        if job_id == candidate {
            candidate = candidate.saturating_add(1);
            continue;
        }
        break;
    }
    Ok(candidate.max(1))
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

fn transfer_by_id(db_path: &Path, id: u64) -> ApiResult<TransferRecord> {
    let conn = open_db(db_path)?;
    let record = conn
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
    Ok(record)
}

fn upsert_record(conn: &Connection, record: &TransferRecord) -> ApiResult<()> {
    conn.execute(
        "INSERT INTO transfers (
            id, job_id, operation_id, batch_id, parent_transfer_id, root_transfer_id, tree_depth,
            transfer_type, item_type, status, conflict_policy,
            queue_title, file_name,
            local_source_path, local_dest_path, remote_source_name, remote_source_path,
            remote_dest_name, remote_dest_path, total_bytes, transferred_bytes, bytes_per_second, error_message,
            detail_message, queued_at_ms, started_at_ms, completed_at_ms, cancelable, retryable,
            undoable, undo_token_id, preserve_order, paused, attempt, supports_replace,
            supports_keep_both, created_session_id
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        ) ON CONFLICT(id) DO UPDATE SET
            job_id = excluded.job_id,
            operation_id = excluded.operation_id,
            batch_id = excluded.batch_id,
            parent_transfer_id = excluded.parent_transfer_id,
            root_transfer_id = excluded.root_transfer_id,
            tree_depth = excluded.tree_depth,
            transfer_type = excluded.transfer_type,
            item_type = excluded.item_type,
            status = excluded.status,
            conflict_policy = excluded.conflict_policy,
            queue_title = excluded.queue_title,
            file_name = excluded.file_name,
            local_source_path = excluded.local_source_path,
            local_dest_path = excluded.local_dest_path,
            remote_source_name = excluded.remote_source_name,
            remote_source_path = excluded.remote_source_path,
            remote_dest_name = excluded.remote_dest_name,
            remote_dest_path = excluded.remote_dest_path,
            total_bytes = excluded.total_bytes,
            transferred_bytes = excluded.transferred_bytes,
            bytes_per_second = excluded.bytes_per_second,
            error_message = excluded.error_message,
            detail_message = excluded.detail_message,
            queued_at_ms = excluded.queued_at_ms,
            started_at_ms = excluded.started_at_ms,
            completed_at_ms = excluded.completed_at_ms,
            cancelable = excluded.cancelable,
            retryable = excluded.retryable,
            undoable = excluded.undoable,
            undo_token_id = excluded.undo_token_id,
            preserve_order = excluded.preserve_order,
            paused = excluded.paused,
            attempt = excluded.attempt,
            supports_replace = excluded.supports_replace,
            supports_keep_both = excluded.supports_keep_both,
            created_session_id = excluded.created_session_id",
        params![
            record.id as i64,
            record.job_id as i64,
            record.operation_id as i64,
            record.batch_id as i64,
            record.parent_transfer_id as i64,
            record.root_transfer_id as i64,
            record.tree_depth as i64,
            transfer_type_text(record.transfer_type),
            item_type_text(record.item_type),
            status_text(record.status),
            conflict_policy_text(record.conflict_policy),
            record.queue_title,
            record.file_name,
            record.local_source_path,
            record.local_dest_path,
            record.remote_source_name,
            record.remote_source_path,
            record.remote_dest_name,
            record.remote_dest_path,
            record.total_bytes,
            record.transferred_bytes,
            record.bytes_per_second,
            record.error_message,
            record.detail_message,
            record.queued_at_ms,
            record.started_at_ms,
            record.completed_at_ms,
            record.cancelable as i64,
            record.retryable as i64,
            record.undoable as i64,
            record.undo_token_id as i64,
            record.preserve_order as i64,
            record.paused as i64,
            record.attempt as i64,
            record.supports_replace as i64,
            record.supports_keep_both as i64,
            format!("rust-{}", now_epoch_ms()),
        ],
    )
    .map_err(sql_error)?;
    Ok(())
}

fn prune_history(conn: &Connection, limit: usize) -> ApiResult<()> {
    let ids = conn
        .prepare(
            "SELECT id FROM transfers
             WHERE status IN ('completed', 'failed', 'canceled', 'skipped', 'interrupted')
             ORDER BY COALESCE(completed_at_ms, queued_at_ms) DESC, id DESC
             LIMIT -1 OFFSET ?",
        )
        .map_err(sql_error)?
        .query_map(params![limit as i64], |row| row.get::<_, i64>(0))
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    delete_ids_with_descendants(conn, ids)?;
    Ok(())
}

fn delete_selected(db_path: &Path, ids: Vec<u64>) -> ApiResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let conn = open_db(db_path)?;
    let tx = conn.unchecked_transaction().map_err(sql_error)?;
    delete_ids_with_descendants(&tx, ids.into_iter().map(|id| id as i64).collect())?;
    tx.commit().map_err(sql_error)?;
    Ok(())
}

fn delete_ids_with_descendants(conn: &Connection, ids: Vec<i64>) -> ApiResult<()> {
    let ids = ids
        .into_iter()
        .filter(|id| *id > 0)
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Ok(());
    }
    let placeholders = std::iter::repeat("?")
        .take(ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "WITH RECURSIVE doomed(id) AS (
            SELECT id FROM transfers WHERE id IN ({placeholders})
            UNION
            SELECT sibling.id
            FROM transfers selected
            JOIN transfers sibling
              ON sibling.root_transfer_id = selected.root_transfer_id
            WHERE selected.id IN ({placeholders})
              AND selected.root_transfer_id > 0
              AND NOT EXISTS (
                  SELECT 1 FROM transfers root WHERE root.id = selected.root_transfer_id
              )
            UNION
            SELECT child.id
            FROM transfers child
            JOIN doomed parent
              ON child.parent_transfer_id = parent.id
              OR child.root_transfer_id = parent.id
         )
         DELETE FROM transfers
         WHERE id IN (SELECT id FROM doomed)"
    );
    let params = ids.iter().copied().chain(ids.iter().copied());
    conn.execute(&sql, rusqlite::params_from_iter(params))
        .map_err(sql_error)?;
    Ok(())
}

fn delete_all(db_path: &Path) -> ApiResult<()> {
    let conn = open_db(db_path)?;
    conn.execute("DELETE FROM transfers", [])
        .map_err(sql_error)?;
    Ok(())
}

fn complete_logical_descendants(db_path: &Path, root_id: u64) -> ApiResult<()> {
    let conn = open_db(db_path)?;
    conn.execute(
        "UPDATE transfers
         SET status = 'completed',
             transferred_bytes = CASE
                WHEN total_bytes > 0 AND transferred_bytes < total_bytes THEN total_bytes
                ELSE transferred_bytes
             END,
             completed_at_ms = ?,
             cancelable = 0,
             retryable = 0,
             paused = 0,
             bytes_per_second = 0,
             detail_message = CASE
                WHEN detail_message = 'Waiting for parent upload' THEN ''
                ELSE detail_message
             END
         WHERE root_transfer_id = ?
           AND operation_id = 0
           AND status IN ('queued', 'pending', 'in_progress', 'waiting_for_resolution')",
        params![now_epoch_ms(), root_id as i64],
    )
    .map_err(sql_error)?;
    Ok(())
}

fn fail_logical_descendants(db_path: &Path, root_id: u64, message: String) -> ApiResult<()> {
    let conn = open_db(db_path)?;
    conn.execute(
        "UPDATE transfers
         SET status = 'failed',
             error_message = ?,
             completed_at_ms = ?,
             cancelable = 0,
             retryable = 1,
             paused = 0,
             bytes_per_second = 0
         WHERE root_transfer_id = ?
           AND operation_id = 0
           AND status IN ('queued', 'pending', 'in_progress', 'waiting_for_resolution')",
        params![message, now_epoch_ms(), root_id as i64],
    )
    .map_err(sql_error)?;
    Ok(())
}

fn cancel_logical_descendants(db_path: &Path, root_id: u64, detail: String) -> ApiResult<()> {
    let conn = open_db(db_path)?;
    conn.execute(
        "UPDATE transfers
         SET status = 'canceled',
             detail_message = ?,
             completed_at_ms = ?,
             cancelable = 0,
             paused = 0,
             bytes_per_second = 0
         WHERE root_transfer_id = ?
           AND operation_id = 0
           AND status IN ('queued', 'pending', 'in_progress', 'waiting_for_resolution')",
        params![detail, now_epoch_ms(), root_id as i64],
    )
    .map_err(sql_error)?;
    Ok(())
}

fn recover_orphaned_queue_rows(db_path: &Path) -> ApiResult<()> {
    let conn = open_db(db_path)?;
    conn.execute(
        "UPDATE transfers
         SET status = 'failed',
             error_message = CASE
                WHEN error_message = '' THEN 'Transfer was queued in a previous app session but no executable queue operation was restored. Retry to start it again.'
                ELSE error_message
             END,
             detail_message = CASE
                WHEN detail_message = '' THEN 'Retry to start this transfer again.'
                ELSE detail_message
             END,
             completed_at_ms = ?,
             cancelable = 0,
             retryable = 1,
             paused = 0,
             bytes_per_second = 0
         WHERE operation_id = 0
           AND status IN ('queued', 'pending', 'in_progress', 'waiting_for_resolution')",
        params![now_epoch_ms()],
    )
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
            operation_id INTEGER NOT NULL DEFAULT 0,
            batch_id INTEGER NOT NULL DEFAULT 0,
            parent_transfer_id INTEGER NOT NULL DEFAULT 0,
            root_transfer_id INTEGER NOT NULL DEFAULT 0,
            tree_depth INTEGER NOT NULL DEFAULT 0,
            transfer_type TEXT NOT NULL,
            item_type TEXT NOT NULL,
            status TEXT NOT NULL,
            conflict_policy TEXT NOT NULL,
            queue_title TEXT NOT NULL DEFAULT '',
            file_name TEXT NOT NULL,
            local_source_path TEXT NOT NULL DEFAULT '',
            local_dest_path TEXT NOT NULL DEFAULT '',
            remote_source_name TEXT NOT NULL DEFAULT '',
            remote_source_path TEXT NOT NULL DEFAULT '',
            remote_dest_name TEXT NOT NULL DEFAULT '',
            remote_dest_path TEXT NOT NULL DEFAULT '',
            total_bytes INTEGER NOT NULL DEFAULT 0,
            transferred_bytes INTEGER NOT NULL DEFAULT 0,
            bytes_per_second INTEGER NOT NULL DEFAULT 0,
            error_message TEXT NOT NULL DEFAULT '',
            detail_message TEXT NOT NULL DEFAULT '',
            queued_at_ms INTEGER NOT NULL DEFAULT 0,
            started_at_ms INTEGER NOT NULL DEFAULT 0,
            completed_at_ms INTEGER NOT NULL DEFAULT 0,
            cancelable INTEGER NOT NULL DEFAULT 0,
            retryable INTEGER NOT NULL DEFAULT 0,
            undoable INTEGER NOT NULL DEFAULT 0,
            undo_token_id INTEGER NOT NULL DEFAULT 0,
            preserve_order INTEGER NOT NULL DEFAULT 0,
            paused INTEGER NOT NULL DEFAULT 0,
            attempt INTEGER NOT NULL DEFAULT 0,
            supports_replace INTEGER NOT NULL DEFAULT 0,
            supports_keep_both INTEGER NOT NULL DEFAULT 0,
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
    if version > 6 {
        return Err(ApiError::Message(
            "misty.db schema version is newer than this build supports.".to_owned(),
        ));
    }
    if version <= 1 {
        conn.execute_batch("PRAGMA user_version = 2")
            .map_err(sql_error)?;
    }
    if version <= 2 {
        add_column_if_missing(
            conn,
            "transfers",
            "operation_id",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        add_column_if_missing(conn, "transfers", "batch_id", "INTEGER NOT NULL DEFAULT 0")?;
        add_column_if_missing(conn, "transfers", "queue_title", "TEXT NOT NULL DEFAULT ''")?;
        add_column_if_missing(
            conn,
            "transfers",
            "preserve_order",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        add_column_if_missing(conn, "transfers", "paused", "INTEGER NOT NULL DEFAULT 0")?;
        add_column_if_missing(conn, "transfers", "attempt", "INTEGER NOT NULL DEFAULT 0")?;
        add_column_if_missing(
            conn,
            "transfers",
            "supports_replace",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        add_column_if_missing(
            conn,
            "transfers",
            "supports_keep_both",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_transfers_operation_id ON transfers(operation_id);
             CREATE INDEX IF NOT EXISTS idx_transfers_batch_id ON transfers(batch_id, id);
             PRAGMA user_version = 3;",
        )
        .map_err(sql_error)?;
    }
    if version <= 3 {
        add_column_if_missing(
            conn,
            "transfers",
            "created_session_id",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        conn.execute_batch("PRAGMA user_version = 4")
            .map_err(sql_error)?;
    }
    if version <= 4 {
        add_column_if_missing(
            conn,
            "transfers",
            "bytes_per_second",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        conn.execute_batch("PRAGMA user_version = 5")
            .map_err(sql_error)?;
    }
    if version <= 5 {
        add_column_if_missing(
            conn,
            "transfers",
            "parent_transfer_id",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        add_column_if_missing(
            conn,
            "transfers",
            "root_transfer_id",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        add_column_if_missing(
            conn,
            "transfers",
            "tree_depth",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_transfers_parent_id ON transfers(parent_transfer_id, id);
             PRAGMA user_version = 6;",
        )
        .map_err(sql_error)?;
    }
    Ok(())
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> ApiResult<()> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(sql_error)?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(sql_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(sql_error)?;
    if !columns.iter().any(|candidate| candidate == column) {
        conn.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {definition}"
        ))
        .map_err(sql_error)?;
    }
    Ok(())
}

fn read_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<TransferRecord> {
    Ok(TransferRecord {
        id: row.get::<_, i64>(0)?.max(0) as u64,
        job_id: row.get::<_, i64>(1)?.max(0) as u64,
        operation_id: row.get::<_, i64>(2)?.max(0) as u64,
        batch_id: row.get::<_, i64>(3)?.max(0) as u64,
        parent_transfer_id: row.get::<_, i64>(4)?.max(0) as u64,
        root_transfer_id: row.get::<_, i64>(5)?.max(0) as u64,
        tree_depth: row.get::<_, i64>(6)?.max(0) as u32,
        transfer_type: transfer_type_from_text(row.get::<_, String>(7)?.as_str()),
        item_type: item_type_from_text(row.get::<_, String>(8)?.as_str()),
        status: status_from_text(row.get::<_, String>(9)?.as_str()),
        conflict_policy: conflict_policy_from_text(row.get::<_, String>(10)?.as_str()),
        queue_title: row.get(11)?,
        file_name: row.get(12)?,
        local_source_path: row.get(13)?,
        local_dest_path: row.get(14)?,
        remote_source_name: row.get(15)?,
        remote_source_path: row.get(16)?,
        remote_dest_name: row.get(17)?,
        remote_dest_path: row.get(18)?,
        total_bytes: row.get(19)?,
        transferred_bytes: row.get(20)?,
        bytes_per_second: row.get(21)?,
        error_message: row.get(22)?,
        detail_message: row.get(23)?,
        queued_at_ms: row.get(24)?,
        started_at_ms: row.get(25)?,
        completed_at_ms: row.get(26)?,
        cancelable: row.get::<_, i64>(27)? != 0,
        retryable: row.get::<_, i64>(28)? != 0,
        undoable: row.get::<_, i64>(29)? != 0,
        undo_token_id: row.get::<_, i64>(30)?.max(0) as u64,
        preserve_order: row.get::<_, i64>(31)? != 0,
        paused: row.get::<_, i64>(32)? != 0,
        attempt: row.get::<_, i64>(33)?.max(0) as u32,
        supports_replace: row.get::<_, i64>(34)? != 0,
        supports_keep_both: row.get::<_, i64>(35)? != 0,
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
    "id, job_id, operation_id, batch_id, parent_transfer_id, root_transfer_id, tree_depth, \
     transfer_type, item_type, status, conflict_policy, \
     queue_title, file_name, \
     local_source_path, local_dest_path, remote_source_name, remote_source_path, \
     remote_dest_name, remote_dest_path, total_bytes, transferred_bytes, bytes_per_second, error_message, \
     detail_message, queued_at_ms, started_at_ms, completed_at_ms, cancelable, retryable, \
     undoable, undo_token_id, preserve_order, paused, attempt, supports_replace, \
     supports_keep_both"
}

fn transfer_search_where(search_query: &str) -> &'static str {
    if search_query.is_empty() {
        return "WHERE NOT (
            operation_id = 0 AND
            transfer_type = 'download' AND
            item_type = 'remote' AND
            (
                local_dest_path LIKE '%/.cache/remote-files/%' OR
                local_dest_path LIKE '%/.cache/remote-open/%'
            )
        ) ";
    }
    "WHERE NOT (
        operation_id = 0 AND
        transfer_type = 'download' AND
        item_type = 'remote' AND
        (
            local_dest_path LIKE '%/.cache/remote-files/%' OR
            local_dest_path LIKE '%/.cache/remote-open/%'
        )
    ) AND (
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
        "archive" => TransferType::Archive,
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
        TransferType::Archive => "archive",
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
            .update_progress_with_speed(id, 45, 100, 8_500_000.0)
            .await
            .expect("update progress");
        let page = service
            .snapshot(TransferFilter::default())
            .await
            .expect("load transfer page");
        assert_eq!(page.rows[0].transferred_bytes, 45);
        assert_eq!(page.rows[0].bytes_per_second, 8_500_000);
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
    async fn orphaned_queued_rows_recover_as_retryable_failures() {
        let (service, root) = test_service("orphaned-queued");
        let mut orphan =
            TransferRecord::new(TransferType::Upload, TransferItemType::Local, "project");
        orphan.status = TransferStatus::Queued;
        orphan.local_source_path = "/tmp/project".to_string();
        orphan.remote_dest_name = "drive-test".to_string();
        orphan.remote_dest_path = "/Uploads/project".to_string();
        let orphan_id = service
            .create_transfer(orphan)
            .await
            .expect("create orphan transfer");

        let mut logical_child =
            TransferRecord::new(TransferType::Upload, TransferItemType::Local, "README.md");
        logical_child.status = TransferStatus::Completed;
        logical_child.parent_transfer_id = orphan_id;
        logical_child.root_transfer_id = orphan_id;
        logical_child.local_source_path = "/tmp/project/README.md".to_string();
        logical_child.remote_dest_name = "drive-test".to_string();
        logical_child.remote_dest_path = "/Uploads/project/README.md".to_string();
        service
            .create_transfer(logical_child)
            .await
            .expect("create logical child transfer");

        service
            .recover_orphaned_queue_rows()
            .expect("recover orphaned rows");

        let page = service
            .snapshot(TransferFilter::default())
            .await
            .expect("load transfer page");
        let orphan = page
            .rows
            .iter()
            .find(|row| row.id == orphan_id)
            .expect("orphan row");
        assert_eq!(orphan.status, TransferStatus::Failed);
        assert!(orphan.retryable);
        assert!(!orphan.error_message.is_empty());
        assert!(page
            .rows
            .iter()
            .any(|row| row.status == TransferStatus::Completed));

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn logical_descendants_complete_with_root_transfer() {
        let (service, root) = test_service("logical-descendants-complete");
        let mut parent = TransferRecord::new(TransferType::Upload, TransferItemType::Local, "app");
        parent.status = TransferStatus::InProgress;
        parent.operation_id = 42;
        parent.total_bytes = 10;
        parent.transferred_bytes = 5;
        let parent_id = service
            .create_transfer(parent)
            .await
            .expect("create parent transfer");

        let mut child = TransferRecord::new(TransferType::Upload, TransferItemType::Local, "bin");
        child.status = TransferStatus::Pending;
        child.root_transfer_id = parent_id;
        child.parent_transfer_id = parent_id;
        child.total_bytes = 10;
        child.transferred_bytes = 0;
        child.detail_message = "Waiting for parent upload".to_string();
        let child_id = service
            .create_transfer(child)
            .await
            .expect("create logical child transfer");

        service
            .complete_logical_descendants(parent_id)
            .await
            .expect("complete logical descendants");

        let child = service
            .transfer_by_id(child_id)
            .await
            .expect("load child transfer");
        assert_eq!(child.status, TransferStatus::Completed);
        assert_eq!(child.transferred_bytes, 10);
        assert!(child.detail_message.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn deleting_history_parent_removes_logical_descendants() {
        let (service, root) = test_service("delete-history-tree");
        let mut parent = TransferRecord::new(
            TransferType::Delete,
            TransferItemType::Remote,
            "ForkLift.app",
        );
        parent.status = TransferStatus::Completed;
        parent.completed_at_ms = 40;
        let parent_id = service
            .create_transfer(parent)
            .await
            .expect("create parent transfer");

        let mut child =
            TransferRecord::new(TransferType::Delete, TransferItemType::Remote, "Contents");
        child.status = TransferStatus::Completed;
        child.parent_transfer_id = parent_id;
        child.root_transfer_id = parent_id;
        child.completed_at_ms = 41;
        let child_id = service
            .create_transfer(child)
            .await
            .expect("create child transfer");

        let mut grandchild =
            TransferRecord::new(TransferType::Delete, TransferItemType::Remote, "Info.plist");
        grandchild.status = TransferStatus::Completed;
        grandchild.parent_transfer_id = child_id;
        grandchild.root_transfer_id = parent_id;
        grandchild.completed_at_ms = 42;
        service
            .create_transfer(grandchild)
            .await
            .expect("create grandchild transfer");

        let mut unrelated =
            TransferRecord::new(TransferType::Delete, TransferItemType::Remote, "Other.app");
        unrelated.status = TransferStatus::Completed;
        unrelated.completed_at_ms = 43;
        let unrelated_id = service
            .create_transfer(unrelated)
            .await
            .expect("create unrelated transfer");

        service
            .delete_selected(vec![parent_id])
            .await
            .expect("delete parent history row");

        let page = service
            .snapshot(TransferFilter::default())
            .await
            .expect("load transfer page");
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.rows[0].id, unrelated_id);

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn deleting_orphaned_history_child_removes_sibling_group() {
        let (service, root) = test_service("delete-orphan-history-tree");
        let missing_root_id = 999_u64;
        let mut child =
            TransferRecord::new(TransferType::Delete, TransferItemType::Remote, "Resources");
        child.status = TransferStatus::Completed;
        child.parent_transfer_id = missing_root_id;
        child.root_transfer_id = missing_root_id;
        child.completed_at_ms = 41;
        let child_id = service
            .create_transfer(child)
            .await
            .expect("create orphaned child transfer");

        let mut sibling =
            TransferRecord::new(TransferType::Delete, TransferItemType::Remote, "MacOS");
        sibling.status = TransferStatus::Completed;
        sibling.parent_transfer_id = missing_root_id;
        sibling.root_transfer_id = missing_root_id;
        sibling.completed_at_ms = 42;
        service
            .create_transfer(sibling)
            .await
            .expect("create orphaned sibling transfer");

        let mut unrelated =
            TransferRecord::new(TransferType::Delete, TransferItemType::Remote, "Other.app");
        unrelated.status = TransferStatus::Completed;
        unrelated.completed_at_ms = 43;
        let unrelated_id = service
            .create_transfer(unrelated)
            .await
            .expect("create unrelated transfer");

        service
            .delete_selected(vec![child_id])
            .await
            .expect("delete orphaned child history row");

        let page = service
            .snapshot(TransferFilter::default())
            .await
            .expect("load transfer page");
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.rows[0].id, unrelated_id);

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn pruning_history_parent_removes_logical_descendants() {
        let (service, root) = test_service("prune-history-tree");
        let mut parent = TransferRecord::new(
            TransferType::Delete,
            TransferItemType::Remote,
            "ForkLift.app",
        );
        parent.status = TransferStatus::Completed;
        parent.completed_at_ms = 10;
        let parent_id = service
            .create_transfer(parent)
            .await
            .expect("create parent transfer");

        let mut child =
            TransferRecord::new(TransferType::Delete, TransferItemType::Remote, "Contents");
        child.status = TransferStatus::Completed;
        child.parent_transfer_id = parent_id;
        child.root_transfer_id = parent_id;
        child.completed_at_ms = 100;
        service
            .create_transfer(child)
            .await
            .expect("create child transfer");

        let mut unrelated =
            TransferRecord::new(TransferType::Delete, TransferItemType::Remote, "Other.app");
        unrelated.status = TransferStatus::Completed;
        unrelated.completed_at_ms = 200;
        let unrelated_id = service
            .create_transfer(unrelated)
            .await
            .expect("create unrelated transfer");

        let conn = open_db(&service.db_path).expect("open transfer db");
        prune_history(&conn, 2).expect("prune old transfer history");

        let page = service
            .snapshot(TransferFilter::default())
            .await
            .expect("load transfer page");
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.rows[0].id, unrelated_id);

        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn legacy_store_migrates_queue_columns_before_upsert() {
        let (service, root) = test_service("legacy-queue-columns");
        fs::create_dir_all(&root).expect("create legacy db root");
        {
            let conn = Connection::open(&service.db_path).expect("open legacy db");
            conn.execute_batch(
                "CREATE TABLE transfers (
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
                    undo_token_id INTEGER NOT NULL DEFAULT 0
                );
                INSERT INTO transfers (
                    id, job_id, transfer_type, item_type, status, conflict_policy, file_name
                ) VALUES (
                    1, 1, 'upload', 'local', 'completed', 'ask', 'old-file.txt'
                );
                PRAGMA user_version = 2;",
            )
            .expect("seed legacy transfers schema");
        }

        let mut record = TransferRecord::new(
            TransferType::Upload,
            TransferItemType::Local,
            "queued-file.txt",
        );
        record.operation_id = 42;
        record.batch_id = 7;
        record.queue_title = "Upload queued-file.txt".to_string();
        record.paused = true;
        record.attempt = 2;
        record.cancelable = true;
        record.retryable = true;
        let id = service
            .create_transfer(record)
            .await
            .expect("insert current transfer after migration");

        let page = service
            .snapshot(TransferFilter::default())
            .await
            .expect("load migrated transfer page");
        let current = page
            .rows
            .iter()
            .find(|row| row.id == id)
            .expect("current transfer row");
        assert_eq!(current.operation_id, 42);
        assert_eq!(current.batch_id, 7);
        assert_eq!(current.queue_title, "Upload queued-file.txt");
        assert!(current.paused);
        assert_eq!(current.attempt, 2);

        let legacy = page
            .rows
            .iter()
            .find(|row| row.id == 1)
            .expect("legacy transfer row");
        assert_eq!(legacy.operation_id, 0);
        assert_eq!(legacy.batch_id, 0);

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
    async fn snapshot_hides_internal_remote_file_cache_downloads() {
        let (service, root) = test_service("internal-cache-hidden");
        let mut cache_record = TransferRecord::new(
            TransferType::Download,
            TransferItemType::Remote,
            "thumb.png",
        );
        cache_record.remote_source_name = "drive".to_string();
        cache_record.remote_source_path = "/thumb.png".to_string();
        cache_record.local_dest_path =
            "/Users/example/.misty/.cache/remote-files/v1/staging/thumb.png".to_string();
        let cache_id = service
            .start_transfer(cache_record)
            .await
            .expect("start internal cache transfer");
        service
            .fail_transfer(cache_id, "preview failed".to_string())
            .await
            .expect("fail internal cache transfer");

        let mut user_record = TransferRecord::new(
            TransferType::Download,
            TransferItemType::Remote,
            "photo.png",
        );
        user_record.remote_source_name = "drive".to_string();
        user_record.remote_source_path = "/photo.png".to_string();
        user_record.local_dest_path = "/Users/example/Downloads/photo.png".to_string();
        let user_id = service
            .start_transfer(user_record)
            .await
            .expect("start user transfer");

        let page = service
            .snapshot(TransferFilter::default())
            .await
            .expect("load transfer page");
        assert_eq!(page.total_count, 1);
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.rows[0].id, user_id);

        let search_page = service
            .snapshot(TransferFilter {
                search: Some("thumb".to_string()),
                ..TransferFilter::default()
            })
            .await
            .expect("search transfer page");
        assert_eq!(search_page.total_count, 0);
        assert!(search_page.rows.is_empty());

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
