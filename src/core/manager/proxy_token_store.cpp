#include "core/manager/proxy_token_store.h"

#include <curl/curl.h>
#include <filesystem>
#include <iostream>

#include <sqlite3.h>

#include "core/manager/env_manager.h"

namespace fs = std::filesystem;

namespace misty::core {
namespace {

size_t discard_response(char* /*ptr*/, size_t size, size_t nmemb, void* /*userdata*/) {
    return size * nmemb;
}

}  // namespace

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

bool ProxyTokenStore::refresh_access_token() const {
    const std::string proxy_url = EnvManager::get().get("PROXY_SERVICE_URL", "");
    if (proxy_url.empty()) {
        return false;
    }

    CURL* curl = curl_easy_init();
    if (!curl) {
        return false;
    }

    const std::string url = proxy_url + "/api/session/refresh";
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, "");
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, 0L);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, discard_response);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 10L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);

    CURLcode result = curl_easy_perform(curl);
    long status = 0;
    if (result == CURLE_OK) {
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
    }
    curl_easy_cleanup(curl);

    return status >= 200 && status < 300;
}

std::optional<std::string> ProxyTokenStore::current_or_refresh_access_token() const {
    if (auto token = current_access_token(); token && !token->empty()) {
        return token;
    }
    if (!refresh_access_token()) {
        return std::nullopt;
    }
    return current_access_token();
}

} // namespace misty::core
