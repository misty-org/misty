#include "services_state.h"

#include "core/manager/env_manager.h"
#include "core/net/http_client.h"
#include "core/system/util.h"

#include <filesystem>
#include <iostream>
#include <nlohmann/json.hpp>

namespace misty::panel {
    bool ServicesState::has_ms_connections() {
        std::lock_guard<std::mutex> lock(mu);
        return !ms_connections.empty();
    }

    void ServicesState::check_connections() {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) return;
                std::string user_id = core::EnvManager::get().get("USER_ID", "");
                if (user_id.empty()) return;

                std::string url = base + "/api/ms/users?user_id=" + user_id;

                std::map<std::string, std::string> headers;
                headers["Accept"] = "application/json";

                std::cout << "Fetching connections from " << url << std::endl;

                core::HttpResponse response = core::HTTPClient::get().get(url, headers);

                {
                    std::lock_guard<std::mutex> lock(mu);
                    if (response.status_code >= 200 && response.status_code < 300) {
                        try {
                            auto json = nlohmann::json::parse(response.body);
                            if (!json.is_array()) {
                                throw std::runtime_error("Invalid response format: expected array");
                            }
                            error_msg = "";
                            for (const auto& obj : json) {
                                std::string ms_user_id = obj.value("ms_user_id", std::string(""));
                                std::string display_name = obj.value("display_name", std::string(""));
                                std::string email = obj.value("email", std::string(""));

                                if (!ms_user_id.empty()) {
                                    MSConnection conn;
                                    conn.is_authenticated = obj.value("connected", false);
                                    conn.profile.id = ms_user_id;
                                    conn.profile.display_name = display_name;
                                    conn.profile.email = email;
                                    conn.profile.loaded = !display_name.empty() || !email.empty();
                                    ms_connections.insert(conn);
                                }
                            }
                        } catch (const std::exception& ex) {
                            error_msg = std::string("Failed to parse connection response: ") + ex.what();
                        }
                    } else {
                        error_msg = "Failed to fetch connections (" + std::to_string(response.status_code) + ")";
                    }
                }
            },
            []() {},
            [](const std::string& err) {
                std::cerr << "check_connections error: " << err << std::endl;
            }
        );
    }

    std::set<MSConnection>::iterator ServicesState::find_by_ms_user_id(const std::string& ms_user_id) {
        MSConnection search_conn;
        search_conn.profile.id = ms_user_id;
        return ms_connections.find(search_conn);
    }

    bool ServicesState::get_onedrive_card_state(const std::string& ms_user_id, OneDriveCardState& out) {
        std::lock_guard<std::mutex> lock(mu);
        auto it = find_by_ms_user_id(ms_user_id);
        if (it == ms_connections.end()) {
            return false;
        }
        out.profile_loaded = it->profile.loaded;
        out.profile = it->profile;
        out.is_connected = it->is_authenticated;
        return true;
    }

    void ServicesState::mark_disconnected(const std::string& ms_user_id) {
        std::lock_guard<std::mutex> lock(mu);
        auto it = find_by_ms_user_id(ms_user_id);
        if (it == ms_connections.end()) {
            return;
        }
        MSConnection conn = *it;
        ms_connections.erase(it);
        conn.is_authenticated = false;
        ms_connections.insert(conn);
        error_msg = "Connection lost. Please reconnect.";
        success_msg = "";
    }

    void ServicesState::disconnect_onedrive(const std::string& ms_user_id) {
        {
            std::lock_guard<std::mutex> lock(mu);
            auto it = find_by_ms_user_id(ms_user_id);
            if (it != ms_connections.end()) {
                ms_connections.erase(it);
            }
            error_msg = "";
            success_msg = "";
        }

        std::string app_user_id = core::EnvManager::get().get("USER_ID", "");
        std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
        if (!ms_user_id.empty() && !app_user_id.empty() && !base.empty()) {
            if (worker_pool_) {
                worker_pool_->add(
                    [ms_user_id, app_user_id, base]() {
                        std::string url = base + "/api/ms/users?user_id=" + app_user_id + "&ms_user_id=" + ms_user_id;
                        std::map<std::string, std::string> headers;
                        headers["Accept"] = "application/json";
                        core::HTTPClient::get().del(url, headers);
                    },
                    []() {},
                    [](const std::string& err) {
                        std::cerr << "disconnect_onedrive error: " << err << std::endl;
                    }
                );
            }
        }
    }

    void ServicesState::initiate_ms_login() {
        std::string proxy_url = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
        if (proxy_url.empty()) throw std::runtime_error("PROXY_SERVICE_URL is not set");

        std::string user_id = core::EnvManager::get().get("USER_ID", "");
        if (user_id.empty()) throw std::runtime_error("USER_ID is not set");

        std::string url = proxy_url + "/api/ms/auth?user_id=" + user_id;
        core::open_file_in_browser(url);
        ms_auth_error.clear();
    }

    bool ServicesState::is_account_folder_connected(const std::string& folder_name) {
        std::lock_guard<std::mutex> lock(mu);
        for (const auto& conn : ms_connections) {
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

    void ServicesState::fetch_drive(const std::string& ms_user_id, DriveCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, ms_user_id, callback]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) {
                    callback(ms_user_id, "", false, "PROXY_SERVICE_URL not set");
                    return;
                }
                std::string user_id = core::EnvManager::get().get("USER_ID", "");
                if (user_id.empty()) {
                    callback(ms_user_id, "", false, "USER_ID not set");
                    return;
                }

                std::string url = base + "/api/ms/drive?user_id=" + user_id + "&ms_user_id=" + ms_user_id;

                std::map<std::string, std::string> headers;
                headers["Accept"] = "application/json";

                core::HttpResponse response = core::HTTPClient::get().get(url, headers);

                if (response.status_code >= 200 && response.status_code < 300) {
                    try {
                        auto json = nlohmann::json::parse(response.body);
                        std::string drive_id = json.value("id", std::string(""));
                        callback(ms_user_id, drive_id, true, "");
                    } catch (const std::exception& e) {
                        callback(ms_user_id, "", false, std::string("Parse error: ") + e.what());
                    }
                } else if (response.status_code == 401) {
                    mark_disconnected(ms_user_id);
                    callback(ms_user_id, "", false, "Session expired. Please reconnect.");
                } else {
                    callback(ms_user_id, "", false, "HTTP " + std::to_string(response.status_code));
                }
            },
            []() {},
            [ms_user_id, callback](const std::string& err) {
                callback(ms_user_id, "", false, err);
            }
        );
    }

    void ServicesState::fetch_onedrive_files(const std::string& ms_user_id,
                                              const std::string& drive_id,
                                              const std::string& folder_id,
                                              FilesCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, ms_user_id, drive_id, folder_id, callback]() {
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

                std::string url = base + "/api/ms/files?user_id=" + user_id
                    + "&ms_user_id=" + ms_user_id
                    + "&drive_id=" + drive_id
                    + "&folder_id=" + folder_id;

                std::map<std::string, std::string> headers;
                headers["Accept"] = "application/json";

                core::HttpResponse response = core::HTTPClient::get().get(url, headers);

                if (response.status_code >= 200 && response.status_code < 300) {
                    callback(true, response.body, "");
                } else if (response.status_code == 401) {
                    mark_disconnected(ms_user_id);
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

    void ServicesState::download_file(const std::string& ms_user_id,
                                       const std::string& drive_id,
                                       const std::string& file_id,
                                       const std::string& local_path,
                                       DownloadProgressCallback progress_cb,
                                       DownloadCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, ms_user_id, drive_id, file_id, local_path, callback, progress_cb]() {
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

                std::string url = base + "/api/ms/file/download?user_id=" + user_id
                    + "&ms_user_id=" + ms_user_id
                    + "&drive_id=" + drive_id
                    + "&file_id=" + file_id;

                core::DownloadResult result = core::HTTPClient::get().download_to_file(url, local_path, {}, progress_cb);

                if (result.success) {
                    callback(true, local_path, "");
                } else if (result.final_status_code == 401) {
                    mark_disconnected(ms_user_id);
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

    // ==================== Google Drive Methods ====================


}
