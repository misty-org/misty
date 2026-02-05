#include "services_state.h"

#include "core/manager/env_manager.h"
#include "core/net/http_client.h"
#include "core/system/util.h"

#include <filesystem>
#include <iostream>
#include <nlohmann/json.hpp>

namespace misty::panel {
    bool ServicesState::has_dbx_connections() {
        std::lock_guard<std::mutex> lock(mu);
        return !dbx_connections.empty();
    }

    void ServicesState::check_dbx_connections() {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) return;
                std::string user_id = core::EnvManager::get().get("USER_ID", "");
                if (user_id.empty()) return;

                std::string url = base + "/api/dbx/users?user_id=" + user_id;

                std::map<std::string, std::string> headers;
                headers["Accept"] = "application/json";

                std::cout << "Fetching DBX connections from " << url << std::endl;

                core::HttpResponse response = core::HTTPClient::get().get(url, headers);

                {
                    std::lock_guard<std::mutex> lock(mu);
                    if (response.status_code >= 200 && response.status_code < 300) {
                        try {
                            auto json = nlohmann::json::parse(response.body);
                            if (!json.is_array()) {
                                throw std::runtime_error("Invalid response format: expected array");
                            }
                            for (const auto& obj : json) {
                                std::string dbx_user_id = obj.value("dbx_user_id", std::string(""));
                                std::string display_name = obj.value("display_name", std::string(""));
                                std::string email = obj.value("email", std::string(""));

                                if (!dbx_user_id.empty()) {
                                    DBXConnection conn;
                                    conn.is_authenticated = obj.value("connected", false);
                                    conn.profile.id = dbx_user_id;
                                    conn.profile.display_name = display_name;
                                    conn.profile.email = email;
                                    conn.profile.loaded = !display_name.empty() || !email.empty();
                                    dbx_connections.insert(conn);
                                }
                            }
                        } catch (const std::exception& ex) {
                            error_msg = std::string("Failed to parse DBX connection response: ") + ex.what();
                        }
                    } else {
                        error_msg = "Failed to fetch DBX connections (" + std::to_string(response.status_code) + ")";
                    }
                }
            },
            []() {},
            [](const std::string& err) {
                std::cerr << "check_dbx_connections error: " << err << std::endl;
            }
        );
    }

    std::set<DBXConnection>::iterator ServicesState::find_by_dbx_user_id(const std::string& dbx_user_id) {
        DBXConnection search_conn;
        search_conn.profile.id = dbx_user_id;
        return dbx_connections.find(search_conn);
    }

    bool ServicesState::get_dropbox_card_state(const std::string& dbx_user_id, DropboxCardState& out) {
        std::lock_guard<std::mutex> lock(mu);
        auto it = find_by_dbx_user_id(dbx_user_id);
        if (it == dbx_connections.end()) {
            return false;
        }
        out.profile_loaded = it->profile.loaded;
        out.profile = it->profile;
        out.is_connected = it->is_authenticated;
        return true;
    }

    void ServicesState::mark_dbx_disconnected(const std::string& dbx_user_id) {
        std::lock_guard<std::mutex> lock(mu);
        auto it = find_by_dbx_user_id(dbx_user_id);
        if (it == dbx_connections.end()) {
            return;
        }
        DBXConnection conn = *it;
        dbx_connections.erase(it);
        conn.is_authenticated = false;
        dbx_connections.insert(conn);
        error_msg = "Dropbox connection lost. Please reconnect.";
        success_msg = "";
    }

    void ServicesState::disconnect_dropbox(const std::string& dbx_user_id) {
        {
            std::lock_guard<std::mutex> lock(mu);
            auto it = find_by_dbx_user_id(dbx_user_id);
            if (it != dbx_connections.end()) {
                dbx_connections.erase(it);
            }
            error_msg = "";
            success_msg = "";
        }

        std::string app_user_id = core::EnvManager::get().get("USER_ID", "");
        std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
        if (!dbx_user_id.empty() && !app_user_id.empty() && !base.empty()) {
            if (worker_pool_) {
                worker_pool_->add(
                    [dbx_user_id, app_user_id, base]() {
                        std::string url = base + "/api/dbx/users?user_id=" + app_user_id + "&dbx_user_id=" + dbx_user_id;
                        std::map<std::string, std::string> headers;
                        headers["Accept"] = "application/json";
                        core::HTTPClient::get().del(url, headers);
                    },
                    []() {},
                    [](const std::string& err) {
                        std::cerr << "disconnect_dropbox error: " << err << std::endl;
                    }
                );
            }
        }
    }

    void ServicesState::initiate_dbx_login() {
        std::string proxy_url = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
        if (proxy_url.empty()) throw std::runtime_error("PROXY_SERVICE_URL is not set");

        std::string user_id = core::EnvManager::get().get("USER_ID", "");
        if (user_id.empty()) throw std::runtime_error("USER_ID is not set");

        std::string url = proxy_url + "/api/dbx/auth?user_id=" + user_id;
        core::open_file_in_browser(url);
        dbx_auth_error.clear();
    }

    bool ServicesState::is_dbx_account_folder_connected(const std::string& folder_name) {
        std::lock_guard<std::mutex> lock(mu);
        for (const auto& conn : dbx_connections) {
            std::string email = conn.profile.email;
            std::string derived_folder;
            if (!email.empty()) {
                size_t at_pos = email.find('@');
                derived_folder = (at_pos != std::string::npos) ? email.substr(0, at_pos) : email;
            }

            if (derived_folder == folder_name) {
                return conn.is_authenticated;
            }
        }
        return false;
    }

    bool ServicesState::is_icl_account_folder_connected(const std::string& folder_name) {
        std::lock_guard<std::mutex> lock(mu);
        for (const auto& conn : icl_connections) {
            std::string email = conn.profile.email;
            std::string derived_folder;
            if (!email.empty()) {
                size_t at_pos = email.find('@');
                derived_folder = (at_pos != std::string::npos) ? email.substr(0, at_pos) : email;
            }

            if (derived_folder == folder_name) {
                return conn.is_authenticated;
            }
        }
        return false;
    }

    void ServicesState::fetch_dropbox_files(const std::string& dbx_user_id,
                                             const std::string& folder_path,
                                             DBXFilesCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, dbx_user_id, folder_path, callback]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) {
                    callback(false, "", "PROXY_SERVICE_URL not set");
                    return;
                }
                std::string user_id = core::EnvManager::get().get("USER_ID", "");
                if (user_id.empty()) {
                    callback(false, "", "USER_ID not set");
                    return;
                }

                std::string url = base + "/api/dbx/files?user_id=" + user_id
                    + "&dbx_user_id=" + dbx_user_id
                    + "&folder_path=" + core::url_encode(folder_path);

                std::map<std::string, std::string> headers;
                headers["Accept"] = "application/json";

                core::HttpResponse response = core::HTTPClient::get().get(url, headers);

                if (response.status_code >= 200 && response.status_code < 300) {
                    callback(true, response.body, "");
                } else if (response.status_code == 401) {
                    mark_dbx_disconnected(dbx_user_id);
                    callback(false, "", "Session expired. Please reconnect.");
                } else {
                    callback(false, "", "HTTP " + std::to_string(response.status_code));
                }
            },
            []() {},
            [callback](const std::string& err) {
                callback(false, "", err);
            }
        );
    }

    void ServicesState::download_dbx_file(const std::string& dbx_user_id,
                                           const std::string& file_path,
                                           const std::string& local_path,
                                           DownloadProgressCallback progress_cb,
                                           DBXDownloadCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, dbx_user_id, file_path, local_path, callback, progress_cb]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) {
                    callback(false, "", "PROXY_SERVICE_URL not set");
                    return;
                }
                std::string user_id = core::EnvManager::get().get("USER_ID", "");
                if (user_id.empty()) {
                    callback(false, "", "USER_ID not set");
                    return;
                }

                // Ensure parent directory exists
                std::filesystem::path path(local_path);
                std::error_code ec;
                std::filesystem::create_directories(path.parent_path(), ec);

                std::string url = base + "/api/dbx/file/download?user_id=" + user_id
                    + "&dbx_user_id=" + dbx_user_id
                    + "&file_path=" + core::url_encode(file_path);

                core::DownloadResult result = core::HTTPClient::get().download_to_file(url, local_path, {}, progress_cb);

                if (result.success) {
                    callback(true, local_path, "");
                } else if (result.final_status_code == 401) {
                    mark_dbx_disconnected(dbx_user_id);
                    callback(false, "", "Session expired. Please reconnect.");
                } else {
                    callback(false, "", result.error_message);
                }
            },
            []() {},
            [callback](const std::string& err) {
                callback(false, "", err);
            }
        );
    }

    void ServicesState::create_dbx_folder(const std::string& dbx_user_id,
                                          const std::string& folder_path,
                                          const std::string& folder_name,
                                          CreateFolderCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, dbx_user_id, folder_path, folder_name, callback]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) { callback(false, "", "PROXY_SERVICE_URL not set"); return; }
                std::string user_id = core::EnvManager::get().get("USER_ID", "");
                if (user_id.empty()) { callback(false, "", "USER_ID not set"); return; }

                std::string url = base + "/api/dbx/folder/create?user_id=" + user_id
                    + "&dbx_user_id=" + dbx_user_id;

                // Dropbox folder path: parent_path + "/" + name
                std::string full_path = folder_path.empty() ? ("/" + folder_name) : (folder_path + "/" + folder_name);

                nlohmann::json body;
                body["path"] = full_path;
                body["autorename"] = true;

                std::map<std::string, std::string> headers;
                headers["Content-Type"] = "application/json";

                core::HttpResponse response = core::HTTPClient::get().post(url, body.dump(), headers);

                if (response.status_code >= 200 && response.status_code < 300) {
                    callback(true, response.body, "");
                } else {
                    callback(false, "", "HTTP " + std::to_string(response.status_code));
                }
            },
            []() {},
            [callback](const std::string& err) { callback(false, "", err); }
        );
    }

    // ==================== iCloud Methods ====================


}
