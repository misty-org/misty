#include "core/db.h"

#include <filesystem>

#include <sqlite3.h>

#include "core/manager/env_manager.h"

namespace fs = std::filesystem;

namespace misty::core {

DB::Statement::Statement(sqlite3_stmt* stmt)
    : stmt_(stmt) {}

DB::Statement::~Statement() {
    if (stmt_ != nullptr) {
        sqlite3_finalize(stmt_);
    }
}

DB::Statement::Statement(Statement&& other) noexcept
    : stmt_(other.stmt_) {
    other.stmt_ = nullptr;
}

DB::Statement& DB::Statement::operator=(Statement&& other) noexcept {
    if (this == &other) {
        return *this;
    }
    if (stmt_ != nullptr) {
        sqlite3_finalize(stmt_);
    }
    stmt_ = other.stmt_;
    other.stmt_ = nullptr;
    return *this;
}

bool DB::Statement::valid() const {
    return stmt_ != nullptr;
}

bool DB::Statement::bind_int64(int index, int64_t value) {
    return stmt_ != nullptr && sqlite3_bind_int64(stmt_, index, value) == SQLITE_OK;
}

bool DB::Statement::bind_text(int index, const std::string& value) {
    return stmt_ != nullptr &&
           sqlite3_bind_text(stmt_, index, value.c_str(), static_cast<int>(value.size()), SQLITE_TRANSIENT) ==
               SQLITE_OK;
}

bool DB::Statement::bind_bool(int index, bool value) {
    return bind_int64(index, value ? 1 : 0);
}

int DB::Statement::step() {
    if (stmt_ == nullptr) {
        return SQLITE_MISUSE;
    }
    return sqlite3_step(stmt_);
}

int64_t DB::Statement::column_int64(int index) const {
    if (stmt_ == nullptr) {
        return 0;
    }
    return sqlite3_column_int64(stmt_, index);
}

std::string DB::Statement::column_text(int index) const {
    if (stmt_ == nullptr) {
        return {};
    }
    const unsigned char* raw = sqlite3_column_text(stmt_, index);
    if (raw == nullptr) {
        return {};
    }
    return reinterpret_cast<const char*>(raw);
}

bool DB::Statement::column_bool(int index) const {
    return column_int64(index) != 0;
}

DB::Guard::Guard(DB& db)
    : db_(db),
      lock_(db.mu_) {}

bool DB::Guard::ready() const {
    return db_.db_ != nullptr;
}

bool DB::Guard::exec(const std::string& sql, std::string* error) {
    return db_.exec_unlocked(sql, error);
}

DB::Statement DB::Guard::prepare(const std::string& sql, std::string* error) {
    return db_.prepare_unlocked(sql, error);
}

bool DB::Guard::begin(std::string* error) {
    return exec("BEGIN IMMEDIATE", error);
}

bool DB::Guard::commit(std::string* error) {
    return exec("COMMIT", error);
}

bool DB::Guard::rollback(std::string* error) {
    return exec("ROLLBACK", error);
}

DB& DB::get() {
    static DB instance;
    return instance;
}

bool DB::open(std::string* error) {
    std::lock_guard<std::mutex> lock(mu_);
    return open_unlocked(error);
}

bool DB::initialize_schema(std::string* error) {
    std::lock_guard<std::mutex> lock(mu_);
    return initialize_schema_unlocked(error);
}

bool DB::run_migrations(std::string* error) {
    std::lock_guard<std::mutex> lock(mu_);
    return run_migrations_unlocked(error);
}

DB::Guard DB::acquire() {
    return Guard(*this);
}

void DB::close() {
    std::lock_guard<std::mutex> lock(mu_);
    if (db_ != nullptr) {
        sqlite3_close(db_);
        db_ = nullptr;
    }
}

void DB::set_path_override_for_testing(const std::string& path) {
    std::lock_guard<std::mutex> lock(mu_);
    path_override_ = path;
}

void DB::reset_for_testing() {
    std::lock_guard<std::mutex> lock(mu_);
    if (db_ != nullptr) {
        sqlite3_close(db_);
        db_ = nullptr;
    }
    path_override_.clear();
}

std::string DB::resolve_path() const {
    if (!path_override_.empty()) {
        return path_override_;
    }
    const std::string home_dir = EnvManager::get().get_user_home_dir();
    if (home_dir.empty()) {
        return {};
    }
    return (fs::path(home_dir) / ".misty" / "db" / "misty.db").string();
}

bool DB::open_unlocked(std::string* error) {
    if (db_ != nullptr) {
        return true;
    }

    const std::string path = resolve_path();
    if (path.empty()) {
        if (error != nullptr) {
            *error = "Unable to resolve ~/.misty/db/misty.db.";
        }
        return false;
    }

    std::error_code ec;
    fs::create_directories(fs::path(path).parent_path(), ec);
    if (ec) {
        if (error != nullptr) {
            *error = "Failed to create ~/.misty/db: " + ec.message();
        }
        return false;
    }

    if (sqlite3_open_v2(path.c_str(), &db_, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nullptr) != SQLITE_OK) {
        if (error != nullptr) {
            *error = db_ != nullptr ? sqlite3_errmsg(db_) : "Failed to open sqlite database.";
        }
        if (db_ != nullptr) {
            sqlite3_close(db_);
            db_ = nullptr;
        }
        return false;
    }

    sqlite3_busy_timeout(db_, 3000);
    return initialize_schema_unlocked(error) && run_migrations_unlocked(error);
}

bool DB::initialize_schema_unlocked(std::string* error) {
    return exec_unlocked(
        "CREATE TABLE IF NOT EXISTS transfers ("
        "id INTEGER PRIMARY KEY,"
        "job_id INTEGER NOT NULL,"
        "transfer_type TEXT NOT NULL,"
        "item_type TEXT NOT NULL,"
        "status TEXT NOT NULL,"
        "conflict_policy TEXT NOT NULL,"
        "file_name TEXT NOT NULL,"
        "local_source_path TEXT NOT NULL DEFAULT '',"
        "local_dest_path TEXT NOT NULL DEFAULT '',"
        "remote_source_name TEXT NOT NULL DEFAULT '',"
        "remote_source_path TEXT NOT NULL DEFAULT '',"
        "remote_dest_name TEXT NOT NULL DEFAULT '',"
        "remote_dest_path TEXT NOT NULL DEFAULT '',"
        "total_bytes INTEGER NOT NULL DEFAULT 0,"
        "transferred_bytes INTEGER NOT NULL DEFAULT 0,"
        "error_message TEXT NOT NULL DEFAULT '',"
        "detail_message TEXT NOT NULL DEFAULT '',"
        "queued_at_ms INTEGER NOT NULL DEFAULT 0,"
        "started_at_ms INTEGER NOT NULL DEFAULT 0,"
        "completed_at_ms INTEGER NOT NULL DEFAULT 0,"
        "cancelable INTEGER NOT NULL DEFAULT 0,"
        "retryable INTEGER NOT NULL DEFAULT 0,"
        "undoable INTEGER NOT NULL DEFAULT 0,"
        "undo_token_id INTEGER NOT NULL DEFAULT 0,"
        "created_session_id TEXT NOT NULL DEFAULT ''"
        ")",
        error) &&
           exec_unlocked(
               "CREATE INDEX IF NOT EXISTS idx_transfers_status_completed "
               "ON transfers(status, completed_at_ms DESC)",
               error) &&
           exec_unlocked(
               "CREATE INDEX IF NOT EXISTS idx_transfers_job_id "
               "ON transfers(job_id, id)",
               error) &&
           exec_unlocked(
               "CREATE INDEX IF NOT EXISTS idx_transfers_queued_id "
               "ON transfers(queued_at_ms DESC, id DESC)",
               error);
}

bool DB::run_migrations_unlocked(std::string* error) {
    if (db_ == nullptr) {
        if (error != nullptr) {
            *error = "Database is not open.";
        }
        return false;
    }

    Statement version_stmt = prepare_unlocked("PRAGMA user_version", error);
    if (!version_stmt.valid()) {
        return false;
    }
    int version = 0;
    if (version_stmt.step() == SQLITE_ROW) {
        version = static_cast<int>(version_stmt.column_int64(0));
    }

    if (version > 1) {
        if (error != nullptr) {
            *error = "misty.db schema version is newer than this build supports.";
        }
        return false;
    }

    if (version == 0) {
        return exec_unlocked("PRAGMA user_version = 1", error);
    }
    return true;
}

bool DB::exec_unlocked(const std::string& sql, std::string* error) {
    if (db_ == nullptr) {
        if (error != nullptr) {
            *error = "Database is not open.";
        }
        return false;
    }

    char* raw_error = nullptr;
    const int result = sqlite3_exec(db_, sql.c_str(), nullptr, nullptr, &raw_error);
    if (result != SQLITE_OK) {
        if (error != nullptr) {
            *error = raw_error != nullptr ? raw_error : sqlite3_errmsg(db_);
        }
        if (raw_error != nullptr) {
            sqlite3_free(raw_error);
        }
        return false;
    }
    return true;
}

DB::Statement DB::prepare_unlocked(const std::string& sql, std::string* error) {
    if (db_ == nullptr) {
        if (error != nullptr) {
            *error = "Database is not open.";
        }
        return {};
    }

    sqlite3_stmt* stmt = nullptr;
    const int result = sqlite3_prepare_v2(db_, sql.c_str(), -1, &stmt, nullptr);
    if (result != SQLITE_OK) {
        if (error != nullptr) {
            *error = sqlite3_errmsg(db_);
        }
        if (stmt != nullptr) {
            sqlite3_finalize(stmt);
        }
        return {};
    }
    return Statement(stmt);
}

}  // namespace misty::core
