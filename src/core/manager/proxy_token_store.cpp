#include "core/manager/proxy_token_store.h"

#include <filesystem>
#include <iostream>

#include <sqlite3.h>

#include "core/manager/env_manager.h"

namespace fs = std::filesystem;

namespace misty::core {

ProxyTokenStore& ProxyTokenStore::get() {
    static ProxyTokenStore instance;
    return instance;
}

std::string ProxyTokenStore::database_path() const {
    const std::string home_dir = EnvManager::get().get_user_home_dir();
    if (home_dir.empty()) {
        return "";
    }
    return (fs::path(home_dir) / ".misty" / "db" / "data.db").string();
}

std::optional<std::string> ProxyTokenStore::current_access_token() const {
    const std::string path = database_path();
    if (path.empty() || !fs::exists(path)) {
        return std::nullopt;
    }

    sqlite3* db = nullptr;
    if (sqlite3_open_v2(path.c_str(), &db, SQLITE_OPEN_READONLY, nullptr) != SQLITE_OK) {
        if (db) {
            sqlite3_close(db);
        }
        return std::nullopt;
    }

    const char* sql = R"SQL(
        SELECT token
        FROM access_tokens
        WHERE revoked = 0
          AND datetime(expires_at) > datetime('now')
        ORDER BY datetime(created_at) DESC
        LIMIT 1
    )SQL";

    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, nullptr) != SQLITE_OK) {
        sqlite3_close(db);
        return std::nullopt;
    }

    std::optional<std::string> token;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        const unsigned char* raw = sqlite3_column_text(stmt, 0);
        if (raw && raw[0] != '\0') {
            token = reinterpret_cast<const char*>(raw);
        }
    }

    sqlite3_finalize(stmt);
    sqlite3_close(db);
    return token;
}

} // namespace misty::core
