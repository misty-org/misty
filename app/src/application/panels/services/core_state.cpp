#include "services_state.h"

#include "core/manager/env_manager.h"
#include "core/manager/session_manager.h"
#include "core/net/http_client.h"
#include "core/system/util.h"

#include <filesystem>
#include <fstream>
#include <iostream>
#include <nlohmann/json.hpp>
#include <set>

namespace misty::panel {

    ServicesState::ServicesState() = default;

    ServicesState::~ServicesState() = default;

    void ServicesState::init(core::WorkerPool& pool) {
        if (worker_pool_) return; // already initialized
        worker_pool_ = &pool;
        refresh_connections();
    }

    void ServicesState::refresh_connections() {
        if (!worker_pool_) return;

        {
            std::lock_guard<std::mutex> lock(mu);
            ms_connections.clear();
            gd_connections.clear();
            dbx_connections.clear();
            icl_connections.clear();
            error_msg = "";
            is_refreshing = true;
            pending_tasks_ = 2; // sequential (MS+GD+DBX) + iCloud
        }

        // Run MS, GD, DBX sequentially in ONE task to avoid concurrent 401/refresh races.
        // If the JWT is expired, only the first request triggers token refresh; the
        // others then use the newly issued token automatically.
        worker_pool_->add(
            [this]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                // Prefer SessionManager user_id (set at login), fall back to env
                std::string user_id = core::SessionManager::get().get_user_id();
                if (user_id.empty()) {
                    user_id = core::EnvManager::get().get("USER_ID", "");
                }

                if (!base.empty() && !user_id.empty()) {
                    std::map<std::string, std::string> hdrs;
                    hdrs["Accept"] = "application/json";

                    // --- Microsoft / OneDrive ---
                    auto ms_resp = core::HTTPClient::get().get(base + "/api/ms/users?user_id=" + user_id, hdrs);
                    {
                        std::lock_guard<std::mutex> lock(mu);
                        if (ms_resp.status_code >= 200 && ms_resp.status_code < 300) {
                            try {
                                auto json = nlohmann::json::parse(ms_resp.body);
                                if (json.is_array()) {
                                    for (const auto& obj : json) {
                                        std::string id = obj.value("ms_user_id", std::string(""));
                                        if (!id.empty()) {
                                            MSConnection conn;
                                            conn.is_authenticated = obj.value("connected", false);
                                            conn.profile.id = id;
                                            conn.profile.display_name = obj.value("display_name", std::string(""));
                                            conn.profile.email = obj.value("email", std::string(""));
                                            conn.profile.loaded = !conn.profile.display_name.empty() || !conn.profile.email.empty();
                                            ms_connections.insert(conn);
                                        }
                                    }
                                }
                            } catch (...) {}
                        }
                    }

                    // --- Google Drive ---
                    auto gd_resp = core::HTTPClient::get().get(base + "/api/gd/users?user_id=" + user_id, hdrs);
                    {
                        std::lock_guard<std::mutex> lock(mu);
                        if (gd_resp.status_code >= 200 && gd_resp.status_code < 300) {
                            try {
                                auto json = nlohmann::json::parse(gd_resp.body);
                                if (json.is_array()) {
                                    for (const auto& obj : json) {
                                        std::string id = obj.value("gd_user_id", std::string(""));
                                        if (!id.empty()) {
                                            GDConnection conn;
                                            conn.is_authenticated = obj.value("connected", false);
                                            conn.profile.id = id;
                                            conn.profile.display_name = obj.value("display_name", std::string(""));
                                            conn.profile.email = obj.value("email", std::string(""));
                                            conn.profile.loaded = !conn.profile.display_name.empty() || !conn.profile.email.empty();
                                            gd_connections.insert(conn);
                                        }
                                    }
                                }
                            } catch (...) {}
                        }
                    }

                    // --- Dropbox ---
                    auto dbx_resp = core::HTTPClient::get().get(base + "/api/dbx/users?user_id=" + user_id, hdrs);
                    {
                        std::lock_guard<std::mutex> lock(mu);
                        if (dbx_resp.status_code >= 200 && dbx_resp.status_code < 300) {
                            try {
                                auto json = nlohmann::json::parse(dbx_resp.body);
                                if (json.is_array()) {
                                    for (const auto& obj : json) {
                                        std::string id = obj.value("dbx_user_id", std::string(""));
                                        if (!id.empty()) {
                                            DBXConnection conn;
                                            conn.is_authenticated = obj.value("connected", false);
                                            conn.profile.id = id;
                                            conn.profile.display_name = obj.value("display_name", std::string(""));
                                            conn.profile.email = obj.value("email", std::string(""));
                                            conn.profile.loaded = !conn.profile.display_name.empty() || !conn.profile.email.empty();
                                            dbx_connections.insert(conn);
                                        }
                                    }
                                }
                            } catch (...) {}
                        }
                    }
                }

                {
                    std::lock_guard<std::mutex> lock(mu);
                    if (--pending_tasks_ == 0) {
                        is_refreshing = false;
                        initial_load_done = true;
                    }
                }
            },
            []() {},
            [this](const std::string& err) {
                std::cerr << "refresh_connections error: " << err << std::endl;
                std::lock_guard<std::mutex> lock(mu);
                if (--pending_tasks_ == 0) {
                    is_refreshing = false;
                    initial_load_done = true;
                }
            }
        );

        // iCloud — separate server, runs in parallel with the sequential task
        worker_pool_->add(
            [this]() {
                std::string base = core::EnvManager::get().get("ICLOUD_PROXY_URL", "");
                if (!base.empty()) {
                    std::map<std::string, std::string> headers;
                    headers["Accept"] = "application/json";
                    auto response = core::HTTPClient::get().get(base + "/auth/sessions", headers);
                    {
                        std::lock_guard<std::mutex> lock(mu);
                        if (response.status_code >= 200 && response.status_code < 300) {
                            try {
                                auto json = nlohmann::json::parse(response.body);
                                for (const auto& email_val : json.value("active_accounts", nlohmann::json::array())) {
                                    std::string email = email_val.get<std::string>();
                                    if (!email.empty()) {
                                        ICLConnection conn;
                                        conn.is_authenticated = true;
                                        conn.profile.email = email;
                                        conn.profile.loaded = true;
                                        icl_connections.insert(conn);
                                    }
                                }
                            } catch (...) {}
                        }
                    }
                }
                {
                    std::lock_guard<std::mutex> lock(mu);
                    if (--pending_tasks_ == 0) {
                        is_refreshing = false;
                        initial_load_done = true;
                    }
                }
            },
            []() {},
            [this](const std::string& err) {
                std::cerr << "refresh_connections icloud error: " << err << std::endl;
                std::lock_guard<std::mutex> lock(mu);
                if (--pending_tasks_ == 0) {
                    is_refreshing = false;
                    initial_load_done = true;
                }
            }
        );
    }


}
