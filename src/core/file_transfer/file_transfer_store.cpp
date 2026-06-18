#include "core/file_transfer/file_transfer_store.h"

#include <algorithm>
#include <chrono>
#include <string>

#include <sqlite3.h>

#include "core/db.h"

namespace misty::core {
namespace {

int64_t now_epoch_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

const char* transfer_type_text(FileTransferType type) {
    switch (type) {
        case FileTransferType::Upload: return "upload";
        case FileTransferType::Download: return "download";
        case FileTransferType::Create: return "create";
        case FileTransferType::Copy: return "copy";
        case FileTransferType::Move: return "move";
        case FileTransferType::Rename: return "rename";
        case FileTransferType::Delete: return "delete";
    }
    return "copy";
}

FileTransferType transfer_type_from_text(const std::string& value) {
    if (value == "upload") return FileTransferType::Upload;
    if (value == "download") return FileTransferType::Download;
    if (value == "create") return FileTransferType::Create;
    if (value == "move") return FileTransferType::Move;
    if (value == "rename") return FileTransferType::Rename;
    if (value == "delete") return FileTransferType::Delete;
    return FileTransferType::Copy;
}

const char* item_type_text(FileTransferItemType type) {
    return type == FileTransferItemType::Remote ? "remote" : "local";
}

FileTransferItemType item_type_from_text(const std::string& value) {
    return value == "remote" ? FileTransferItemType::Remote : FileTransferItemType::Local;
}

const char* status_text(FileTransferStatus status) {
    switch (status) {
        case FileTransferStatus::Queued: return "queued";
        case FileTransferStatus::Pending: return "pending";
        case FileTransferStatus::InProgress: return "in_progress";
        case FileTransferStatus::WaitingForResolution: return "waiting_for_resolution";
        case FileTransferStatus::Completed: return "completed";
        case FileTransferStatus::Failed: return "failed";
        case FileTransferStatus::Canceled: return "canceled";
        case FileTransferStatus::Skipped: return "skipped";
        case FileTransferStatus::Interrupted: return "interrupted";
    }
    return "pending";
}

FileTransferStatus status_from_text(const std::string& value) {
    if (value == "queued") return FileTransferStatus::Queued;
    if (value == "in_progress") return FileTransferStatus::InProgress;
    if (value == "waiting_for_resolution") return FileTransferStatus::WaitingForResolution;
    if (value == "completed") return FileTransferStatus::Completed;
    if (value == "failed") return FileTransferStatus::Failed;
    if (value == "canceled") return FileTransferStatus::Canceled;
    if (value == "skipped") return FileTransferStatus::Skipped;
    if (value == "interrupted") return FileTransferStatus::Interrupted;
    return FileTransferStatus::Pending;
}

const char* conflict_policy_text(FileTransferConflictPolicy policy) {
    switch (policy) {
        case FileTransferConflictPolicy::Ask: return "ask";
        case FileTransferConflictPolicy::Replace: return "replace";
        case FileTransferConflictPolicy::Skip: return "skip";
        case FileTransferConflictPolicy::KeepBoth: return "keep_both";
    }
    return "ask";
}

FileTransferConflictPolicy conflict_policy_from_text(const std::string& value) {
    if (value == "replace") return FileTransferConflictPolicy::Replace;
    if (value == "skip") return FileTransferConflictPolicy::Skip;
    if (value == "keep_both") return FileTransferConflictPolicy::KeepBoth;
    return FileTransferConflictPolicy::Ask;
}

bool bind_record(DB::Statement& stmt, const FileTransferRecord& record) {
    return stmt.bind_int64(1, static_cast<int64_t>(record.id)) &&
           stmt.bind_int64(2, static_cast<int64_t>(record.job_id)) &&
           stmt.bind_text(3, transfer_type_text(record.transfer_type)) &&
           stmt.bind_text(4, item_type_text(record.item_type)) &&
           stmt.bind_text(5, status_text(record.status)) &&
           stmt.bind_text(6, conflict_policy_text(record.conflict_policy)) &&
           stmt.bind_text(7, record.file_name) &&
           stmt.bind_text(8, record.local_source_path) &&
           stmt.bind_text(9, record.local_dest_path) &&
           stmt.bind_text(10, record.remote_source_name) &&
           stmt.bind_text(11, record.remote_source_path) &&
           stmt.bind_text(12, record.remote_dest_name) &&
           stmt.bind_text(13, record.remote_dest_path) &&
           stmt.bind_int64(14, record.total_bytes) &&
           stmt.bind_int64(15, record.transferred_bytes) &&
           stmt.bind_text(16, record.error_message) &&
           stmt.bind_text(17, record.detail_message) &&
           stmt.bind_int64(18, record.queued_at_ms) &&
           stmt.bind_int64(19, record.started_at_ms) &&
           stmt.bind_int64(20, record.completed_at_ms) &&
           stmt.bind_bool(21, record.cancelable) &&
           stmt.bind_bool(22, record.retryable) &&
           stmt.bind_bool(23, record.undoable) &&
           stmt.bind_int64(24, static_cast<int64_t>(record.undo_token_id));
}

FileTransferRecord read_record(DB::Statement& stmt) {
    FileTransferRecord record;
    record.id = static_cast<uint64_t>(stmt.column_int64(0));
    record.job_id = static_cast<uint64_t>(stmt.column_int64(1));
    record.transfer_type = transfer_type_from_text(stmt.column_text(2));
    record.item_type = item_type_from_text(stmt.column_text(3));
    record.status = status_from_text(stmt.column_text(4));
    record.conflict_policy = conflict_policy_from_text(stmt.column_text(5));
    record.file_name = stmt.column_text(6);
    record.local_source_path = stmt.column_text(7);
    record.local_dest_path = stmt.column_text(8);
    record.remote_source_name = stmt.column_text(9);
    record.remote_source_path = stmt.column_text(10);
    record.remote_dest_name = stmt.column_text(11);
    record.remote_dest_path = stmt.column_text(12);
    record.total_bytes = stmt.column_int64(13);
    record.transferred_bytes = stmt.column_int64(14);
    record.error_message = stmt.column_text(15);
    record.detail_message = stmt.column_text(16);
    record.queued_at_ms = stmt.column_int64(17);
    record.started_at_ms = stmt.column_int64(18);
    record.completed_at_ms = stmt.column_int64(19);
    record.cancelable = stmt.column_bool(20);
    record.retryable = stmt.column_bool(21);
    record.undoable = stmt.column_bool(22);
    record.undo_token_id = static_cast<uint64_t>(stmt.column_int64(23));
    return record;
}

bool is_terminal_status(FileTransferStatus status) {
    return status == FileTransferStatus::Completed ||
           status == FileTransferStatus::Failed ||
           status == FileTransferStatus::Canceled ||
           status == FileTransferStatus::Skipped ||
           status == FileTransferStatus::Interrupted;
}

std::string transfer_select_columns() {
    return "id, job_id, transfer_type, item_type, status, conflict_policy, file_name, "
           "local_source_path, local_dest_path, remote_source_name, remote_source_path, "
           "remote_dest_name, remote_dest_path, total_bytes, transferred_bytes, error_message, "
           "detail_message, queued_at_ms, started_at_ms, completed_at_ms, cancelable, retryable, "
           "undoable, undo_token_id ";
}

std::string transfer_search_where(const std::string& search_query) {
    if (search_query.empty()) {
        return "";
    }
    return "WHERE ("
           "CAST(id AS TEXT) LIKE ? OR "
           "CAST(job_id AS TEXT) LIKE ? OR "
           "('J-' || CAST(job_id AS TEXT)) LIKE ? OR "
           "file_name LIKE ? OR "
           "local_source_path LIKE ? OR "
           "local_dest_path LIKE ? OR "
           "remote_source_name LIKE ? OR "
           "remote_source_path LIKE ? OR "
           "remote_dest_name LIKE ? OR "
           "remote_dest_path LIKE ? OR "
           "error_message LIKE ? OR "
           "detail_message LIKE ?"
           ") ";
}

int bind_search_terms(DB::Statement& stmt, int first_index, const std::string& search_query) {
    if (search_query.empty()) {
        return first_index;
    }
    const std::string pattern = "%" + search_query + "%";
    for (int i = 0; i < 12; ++i) {
        if (!stmt.bind_text(first_index + i, pattern)) {
            return 0;
        }
    }
    return first_index + 12;
}

const char* transfer_page_order_sql() {
    return "ORDER BY "
           "CASE WHEN status IN ('queued', 'pending', 'in_progress', 'waiting_for_resolution') THEN 0 "
           "     WHEN status = 'failed' THEN 1 "
           "     WHEN status = 'interrupted' THEN 2 "
           "     ELSE 3 END ASC, "
           "CASE WHEN status IN ('queued', 'pending', 'in_progress', 'waiting_for_resolution') "
           "     THEN started_at_ms ELSE completed_at_ms END DESC, "
           "id DESC ";
}

}  // namespace

FileTransferStore& FileTransferStore::get() {
    static FileTransferStore instance;
    return instance;
}

FileTransferStore::FileTransferStore() = default;

FileTransferStore::~FileTransferStore() {
    stop_worker();
}

bool FileTransferStore::initialize(std::string* error) {
    if (session_id_.empty()) {
        session_id_ = std::to_string(now_epoch_ms());
    }
    return DB::get().open(error);
}

std::vector<FileTransferRecord> FileTransferStore::load_recent(std::size_t limit, std::string* error) {
    std::vector<FileTransferRecord> rows;
    if (!initialize(error)) {
        return rows;
    }
    flush();

    {
        auto guard = DB::get().acquire();
        DB::Statement stmt = guard.prepare(
            "SELECT id, job_id, transfer_type, item_type, status, conflict_policy, file_name, "
            "local_source_path, local_dest_path, remote_source_name, remote_source_path, "
            "remote_dest_name, remote_dest_path, total_bytes, transferred_bytes, error_message, "
            "detail_message, queued_at_ms, started_at_ms, completed_at_ms, cancelable, retryable, "
            "undoable, undo_token_id "
            "FROM transfers "
            "ORDER BY queued_at_ms DESC, id DESC "
            "LIMIT ?",
            error);
        if (!stmt.valid() || !stmt.bind_int64(1, static_cast<int64_t>(limit))) {
            if (error != nullptr && error->empty()) {
                *error = "Failed to prepare transfer history query.";
            }
            return rows;
        }

        while (true) {
            const int result = stmt.step();
            if (result == SQLITE_DONE) {
                break;
            }
            if (result != SQLITE_ROW) {
                if (error != nullptr) {
                    *error = "Failed while reading transfer history.";
                }
                rows.clear();
                return rows;
            }
            rows.push_back(read_record(stmt));
        }
    }

    std::reverse(rows.begin(), rows.end());

    const int64_t interrupted_at_ms = now_epoch_ms();
    for (auto& row : rows) {
        if (is_terminal_status(row.status)) {
            continue;
        }
        row.status = FileTransferStatus::Interrupted;
        row.cancelable = false;
        row.undoable = false;
        row.detail_message = "Misty closed before this transfer finished.";
        row.completed_at_ms = std::max(row.completed_at_ms, interrupted_at_ms);
        if (!upsert_sync(row, error)) {
            if (error != nullptr && error->empty()) {
                *error = "Failed to reconcile interrupted transfer history.";
            }
            rows.clear();
            return rows;
        }
    }

    std::sort(rows.begin(), rows.end(), [](const FileTransferRecord& lhs, const FileTransferRecord& rhs) {
        if (lhs.queued_at_ms != rhs.queued_at_ms) {
            return lhs.queued_at_ms < rhs.queued_at_ms;
        }
        return lhs.id < rhs.id;
    });
    return rows;
}

FileTransferPage FileTransferStore::load_page(std::size_t limit,
                                              std::size_t offset,
                                              const std::string& search_query,
                                              std::string* error) {
    FileTransferPage page;
    if (!initialize(error)) {
        return page;
    }
    flush();

    const std::string where = transfer_search_where(search_query);

    {
        auto guard = DB::get().acquire();
        DB::Statement count_stmt = guard.prepare("SELECT COUNT(*) FROM transfers " + where, error);
        const int next_index = bind_search_terms(count_stmt, 1, search_query);
        if (!count_stmt.valid() || next_index == 0) {
            if (error != nullptr && error->empty()) {
                *error = "Failed to prepare transfer count query.";
            }
            return page;
        }
        if (count_stmt.step() != SQLITE_ROW) {
            if (error != nullptr) {
                *error = "Failed while counting transfer history.";
            }
            return page;
        }
        page.total_count = static_cast<std::size_t>(std::max<int64_t>(0, count_stmt.column_int64(0)));
    }

    {
        auto guard = DB::get().acquire();
        DB::Statement stmt = guard.prepare(
            "SELECT " + transfer_select_columns() +
                "FROM transfers " +
                where +
                transfer_page_order_sql() +
                "LIMIT ? OFFSET ?",
            error);
        int next_index = bind_search_terms(stmt, 1, search_query);
        if (next_index == 0 ||
            !stmt.valid() ||
            !stmt.bind_int64(next_index, static_cast<int64_t>(limit)) ||
            !stmt.bind_int64(next_index + 1, static_cast<int64_t>(offset))) {
            if (error != nullptr && error->empty()) {
                *error = "Failed to prepare transfer page query.";
            }
            page.rows.clear();
            page.total_count = 0;
            return page;
        }

        while (true) {
            const int result = stmt.step();
            if (result == SQLITE_DONE) {
                break;
            }
            if (result != SQLITE_ROW) {
                if (error != nullptr) {
                    *error = "Failed while reading transfer page.";
                }
                page.rows.clear();
                page.total_count = 0;
                return page;
            }
            page.rows.push_back(read_record(stmt));
        }
    }

    return page;
}

bool FileTransferStore::upsert(const FileTransferRecord& record, std::string* error) {
    flush();
    return upsert_sync(record, error);
}

bool FileTransferStore::upsert_sync(const FileTransferRecord& record, std::string* error) {
    if (!initialize(error)) {
        return false;
    }

    {
        auto guard = DB::get().acquire();
        DB::Statement stmt = guard.prepare(
            "INSERT INTO transfers ("
            "id, job_id, transfer_type, item_type, status, conflict_policy, file_name, "
            "local_source_path, local_dest_path, remote_source_name, remote_source_path, "
            "remote_dest_name, remote_dest_path, total_bytes, transferred_bytes, error_message, "
            "detail_message, queued_at_ms, started_at_ms, completed_at_ms, cancelable, retryable, "
            "undoable, undo_token_id, created_session_id"
            ") VALUES ("
            "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?"
            ") "
            "ON CONFLICT(id) DO UPDATE SET "
            "job_id = excluded.job_id, "
            "transfer_type = excluded.transfer_type, "
            "item_type = excluded.item_type, "
            "status = excluded.status, "
            "conflict_policy = excluded.conflict_policy, "
            "file_name = excluded.file_name, "
            "local_source_path = excluded.local_source_path, "
            "local_dest_path = excluded.local_dest_path, "
            "remote_source_name = excluded.remote_source_name, "
            "remote_source_path = excluded.remote_source_path, "
            "remote_dest_name = excluded.remote_dest_name, "
            "remote_dest_path = excluded.remote_dest_path, "
            "total_bytes = excluded.total_bytes, "
            "transferred_bytes = excluded.transferred_bytes, "
            "error_message = excluded.error_message, "
            "detail_message = excluded.detail_message, "
            "queued_at_ms = excluded.queued_at_ms, "
            "started_at_ms = excluded.started_at_ms, "
            "completed_at_ms = excluded.completed_at_ms, "
            "cancelable = excluded.cancelable, "
            "retryable = excluded.retryable, "
            "undoable = excluded.undoable, "
            "undo_token_id = excluded.undo_token_id, "
            "created_session_id = excluded.created_session_id",
            error);
        if (!stmt.valid() || !bind_record(stmt, record) || !stmt.bind_text(25, session_id_)) {
            if (error != nullptr && error->empty()) {
                *error = "Failed to prepare transfer upsert.";
            }
            return false;
        }
        if (stmt.step() != SQLITE_DONE) {
            if (error != nullptr) {
                *error = "Failed to persist transfer row.";
            }
            return false;
        }
    }
    return prune_history_sync(500, error);
}

bool FileTransferStore::delete_by_id(uint64_t id, std::string* error) {
    flush();
    return delete_by_id_sync(id, error);
}

bool FileTransferStore::delete_by_id_sync(uint64_t id, std::string* error) {
    if (!initialize(error)) {
        return false;
    }
    auto guard = DB::get().acquire();
    DB::Statement stmt = guard.prepare("DELETE FROM transfers WHERE id = ?", error);
    if (!stmt.valid() || !stmt.bind_int64(1, static_cast<int64_t>(id))) {
        if (error != nullptr && error->empty()) {
            *error = "Failed to prepare transfer delete.";
        }
        return false;
    }
    if (stmt.step() != SQLITE_DONE) {
        if (error != nullptr) {
            *error = "Failed to delete transfer row.";
        }
        return false;
    }
    return true;
}

bool FileTransferStore::delete_all(std::string* error) {
    flush();
    return delete_all_sync(error);
}

bool FileTransferStore::delete_all_sync(std::string* error) {
    if (!initialize(error)) {
        return false;
    }
    auto guard = DB::get().acquire();
    return guard.exec("DELETE FROM transfers", error);
}

bool FileTransferStore::delete_completed(std::string* error) {
    flush();
    return delete_completed_sync(error);
}

bool FileTransferStore::delete_completed_sync(std::string* error) {
    if (!initialize(error)) {
        return false;
    }
    auto guard = DB::get().acquire();
    return guard.exec("DELETE FROM transfers WHERE status = 'completed'", error);
}

bool FileTransferStore::delete_failed_like(std::string* error) {
    flush();
    return delete_failed_like_sync(error);
}

bool FileTransferStore::delete_failed_like_sync(std::string* error) {
    if (!initialize(error)) {
        return false;
    }
    auto guard = DB::get().acquire();
    return guard.exec(
        "DELETE FROM transfers WHERE status IN ('failed', 'canceled', 'skipped', 'interrupted')",
        error);
}

bool FileTransferStore::prune_history(std::size_t limit, std::string* error) {
    flush();
    return prune_history_sync(limit, error);
}

bool FileTransferStore::prune_history_sync(std::size_t limit, std::string* error) {
    if (!initialize(error)) {
        return false;
    }

    auto guard = DB::get().acquire();
    DB::Statement stmt = guard.prepare(
        "DELETE FROM transfers "
        "WHERE id IN ("
        "  SELECT id FROM transfers "
        "  WHERE status IN ('completed', 'failed', 'canceled', 'skipped', 'interrupted') "
        "  ORDER BY COALESCE(completed_at_ms, queued_at_ms) DESC, id DESC "
        "  LIMIT -1 OFFSET ?"
        ")",
        error);
    if (!stmt.valid() || !stmt.bind_int64(1, static_cast<int64_t>(limit))) {
        if (error != nullptr && error->empty()) {
            *error = "Failed to prepare transfer prune query.";
        }
        return false;
    }
    if (stmt.step() != SQLITE_DONE) {
        if (error != nullptr) {
            *error = "Failed to prune transfer history.";
        }
        return false;
    }
    return true;
}

uint64_t FileTransferStore::next_transfer_id(std::string* error) {
    flush();
    return next_transfer_id_sync(error);
}

uint64_t FileTransferStore::next_transfer_id_sync(std::string* error) {
    if (!initialize(error)) {
        return 1;
    }

    auto guard = DB::get().acquire();
    DB::Statement stmt = guard.prepare("SELECT COALESCE(MAX(id), 0) + 1 FROM transfers", error);
    if (!stmt.valid()) {
        return 1;
    }
    if (stmt.step() != SQLITE_ROW) {
        if (error != nullptr) {
            *error = "Failed to compute next transfer id.";
        }
        return 1;
    }
    return static_cast<uint64_t>(stmt.column_int64(0));
}

void FileTransferStore::schedule_upsert(const FileTransferRecord& record) {
    if (!initialize(nullptr)) {
        return;
    }
    ensure_worker_started();
    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        pending_writes_.push_back(PendingWrite{.kind = PendingWriteKind::Upsert, .record = record});
    }
    queue_cv_.notify_one();
}

void FileTransferStore::schedule_delete_by_id(uint64_t id) {
    if (!initialize(nullptr)) {
        return;
    }
    ensure_worker_started();
    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        pending_writes_.push_back(PendingWrite{.kind = PendingWriteKind::DeleteById, .id = id});
    }
    queue_cv_.notify_one();
}

void FileTransferStore::schedule_delete_all() {
    if (!initialize(nullptr)) {
        return;
    }
    ensure_worker_started();
    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        pending_writes_.push_back(PendingWrite{.kind = PendingWriteKind::DeleteAll});
    }
    queue_cv_.notify_one();
}

void FileTransferStore::schedule_delete_completed() {
    if (!initialize(nullptr)) {
        return;
    }
    ensure_worker_started();
    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        pending_writes_.push_back(PendingWrite{.kind = PendingWriteKind::DeleteCompleted});
    }
    queue_cv_.notify_one();
}

void FileTransferStore::schedule_delete_failed_like() {
    if (!initialize(nullptr)) {
        return;
    }
    ensure_worker_started();
    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        pending_writes_.push_back(PendingWrite{.kind = PendingWriteKind::DeleteFailedLike});
    }
    queue_cv_.notify_one();
}

void FileTransferStore::flush() {
    std::unique_lock<std::mutex> lock(queue_mu_);
    queue_cv_.wait(lock, [this]() {
        return pending_writes_.empty() && !worker_busy_;
    });
}

void FileTransferStore::ensure_worker_started() {
    std::lock_guard<std::mutex> lock(queue_mu_);
    if (worker_started_) {
        return;
    }
    stop_worker_ = false;
    worker_started_ = true;
    worker_thread_ = std::thread([this]() { worker_loop(); });
}

void FileTransferStore::stop_worker() {
    std::thread worker;
    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        if (!worker_started_) {
            return;
        }
        stop_worker_ = true;
        worker = std::move(worker_thread_);
    }
    queue_cv_.notify_all();
    if (worker.joinable()) {
        worker.join();
    }
    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        worker_started_ = false;
        stop_worker_ = false;
        worker_busy_ = false;
        pending_writes_.clear();
    }
}

void FileTransferStore::worker_loop() {
    while (true) {
        PendingWrite work;
        {
            std::unique_lock<std::mutex> lock(queue_mu_);
            queue_cv_.wait(lock, [this]() {
                return stop_worker_ || !pending_writes_.empty();
            });
            if (stop_worker_ && pending_writes_.empty()) {
                worker_busy_ = false;
                queue_cv_.notify_all();
                return;
            }
            work = std::move(pending_writes_.front());
            pending_writes_.pop_front();
            worker_busy_ = true;
        }

        switch (work.kind) {
            case PendingWriteKind::Upsert:
                upsert_sync(work.record, nullptr);
                break;
            case PendingWriteKind::DeleteById:
                delete_by_id_sync(work.id, nullptr);
                break;
            case PendingWriteKind::DeleteAll:
                delete_all_sync(nullptr);
                break;
            case PendingWriteKind::DeleteCompleted:
                delete_completed_sync(nullptr);
                break;
            case PendingWriteKind::DeleteFailedLike:
                delete_failed_like_sync(nullptr);
                break;
        }

        {
            std::lock_guard<std::mutex> lock(queue_mu_);
            worker_busy_ = false;
        }
        queue_cv_.notify_all();
    }
}

void FileTransferStore::reset_for_testing() {
    stop_worker();
    flush();
    session_id_.clear();
}

}  // namespace misty::core
