#include "services_state.h"
#include "core/env_manager.h"
#include "core/http_client.h"
#include "core/util.h"
#include <nlohmann/json.hpp>
#include <iostream>
#include <thread>
#include <set>
#include <fstream>
#include <filesystem>


namespace minidfs::panel {

    ServicesState::ServicesState() {
        check_connections();
        check_gd_connections();
    }

    ServicesState::~ServicesState() = default;

    bool ServicesState::has_ms_connections() {
        std::lock_guard<std::mutex> lock(mu);
        return !ms_connections.empty();
    }

    void ServicesState::check_connections() {
        std::thread([this]() {
            std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
            if (base.empty()) {
                return;
            }
            std::string user_id = core::EnvManager::get().get("USER_ID", "");
            if (user_id.empty()) {
                return;
            }
            std::string url = base + "/api/ms/users?user_id=" + user_id;

            std::map<std::string, std::string> headers;
            headers["Accept"] = "application/json";

            std::cout << "Fetching connections from " << url << std::endl;

            core::HttpResponse response = core::HttpClient::get().get(url, headers);

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
        }).detach();

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
            std::thread([ms_user_id, app_user_id, base]() {
                std::string url = base + "/api/ms/users?user_id=" + app_user_id + "&ms_user_id=" + ms_user_id;
                std::map<std::string, std::string> headers;
                headers["Accept"] = "application/json";
                core::HttpClient::get().del(url, headers);
            }).detach();
        }
    }

    void ServicesState::initiate_ms_login() {
        std::string proxy_url = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
        if (proxy_url.empty()) throw std::runtime_error("PROXY_SERVICE_URL is not set");

        std::string user_id = core::EnvManager::get().get("USER_ID", "");
        if (user_id.empty()) throw std::runtime_error("USER_ID is not set");

        std::string url = proxy_url + "/api/ms/auth?user_id=" + user_id;
        core::open_file_in_browser(url);
        show_ms_login_modal = true;
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
        std::thread([this, ms_user_id, callback]() {
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

            core::HttpResponse response = core::HttpClient::get().get(url, headers);

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
        }).detach();
    }

    void ServicesState::fetch_onedrive_files(const std::string& ms_user_id,
                                              const std::string& drive_id,
                                              const std::string& folder_id,
                                              FilesCallback callback) {
        std::thread([this, ms_user_id, drive_id, folder_id, callback]() {
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

            core::HttpResponse response = core::HttpClient::get().get(url, headers);

            if (response.status_code >= 200 && response.status_code < 300) {
                callback(true, response.body, "");
            } else if (response.status_code == 401) {
                mark_disconnected(ms_user_id);
                callback(false, "", "Session expired. Please reconnect.");
            } else {
                callback(false, "", "HTTP " + std::to_string(response.status_code));
            }
        }).detach();
    }

    void ServicesState::download_file(const std::string& ms_user_id,
                                       const std::string& drive_id,
                                       const std::string& file_id,
                                       const std::string& local_path,
                                       DownloadCallback callback) {
        std::thread([this, ms_user_id, drive_id, file_id, local_path, callback]() {
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

            core::HttpResponse response = core::HttpClient::get().get(url);

            if (response.status_code >= 200 && response.status_code < 300) {
                std::ofstream file(local_path, std::ios::binary);
                if (!file) {
                    callback(false, "", "Failed to create local file: " + local_path);
                    return;
                }
                file.write(response.body.data(), response.body.size());
                file.close();

                if (file.good()) {
                    callback(true, local_path, "");
                } else {
                    callback(false, "", "Failed to write file to disk");
                }
            } else if (response.status_code == 401) {
                mark_disconnected(ms_user_id);
                callback(false, "", "Session expired. Please reconnect.");
            } else {
                callback(false, "", "Download failed: HTTP " + std::to_string(response.status_code));
            }
        }).detach();
    }

    // ==================== Google Drive Methods ====================

    bool ServicesState::has_gd_connections() {
        std::lock_guard<std::mutex> lock(mu);
        return !gd_connections.empty();
    }

    void ServicesState::check_gd_connections() {
        std::thread([this]() {
            std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
            if (base.empty()) {
                return;
            }
            std::string user_id = core::EnvManager::get().get("USER_ID", "");
            if (user_id.empty()) {
                return;
            }
            std::string url = base + "/api/gd/users?user_id=" + user_id;

            std::map<std::string, std::string> headers;
            headers["Accept"] = "application/json";

            std::cout << "Fetching GD connections from " << url << std::endl;

            core::HttpResponse response = core::HttpClient::get().get(url, headers);

            {
                std::lock_guard<std::mutex> lock(mu);
                if (response.status_code >= 200 && response.status_code < 300) {
                    try {
                        auto json = nlohmann::json::parse(response.body);
                        if (!json.is_array()) {
                            throw std::runtime_error("Invalid response format: expected array");
                        }
                        for (const auto& obj : json) {
                            std::string gd_user_id = obj.value("gd_user_id", std::string(""));
                            std::string display_name = obj.value("display_name", std::string(""));
                            std::string email = obj.value("email", std::string(""));

                            if (!gd_user_id.empty()) {
                                GDConnection conn;
                                conn.is_authenticated = obj.value("connected", false);
                                conn.profile.id = gd_user_id;
                                conn.profile.display_name = display_name;
                                conn.profile.email = email;
                                conn.profile.loaded = !display_name.empty() || !email.empty();
                                gd_connections.insert(conn);
                            }
                        }
                    } catch (const std::exception& ex) {
                        error_msg = std::string("Failed to parse GD connection response: ") + ex.what();
                    }
                } else {
                    error_msg = "Failed to fetch GD connections (" + std::to_string(response.status_code) + ")";
                }
            }
        }).detach();
    }

    std::set<GDConnection>::iterator ServicesState::find_by_gd_user_id(const std::string& gd_user_id) {
        GDConnection search_conn;
        search_conn.profile.id = gd_user_id;
        return gd_connections.find(search_conn);
    }

    bool ServicesState::get_gdrive_card_state(const std::string& gd_user_id, GDriveCardState& out) {
        std::lock_guard<std::mutex> lock(mu);
        auto it = find_by_gd_user_id(gd_user_id);
        if (it == gd_connections.end()) {
            return false;
        }
        out.profile_loaded = it->profile.loaded;
        out.profile = it->profile;
        out.is_connected = it->is_authenticated;
        return true;
    }

    void ServicesState::mark_gd_disconnected(const std::string& gd_user_id) {
        std::lock_guard<std::mutex> lock(mu);
        auto it = find_by_gd_user_id(gd_user_id);
        if (it == gd_connections.end()) {
            return;
        }
        GDConnection conn = *it;
        gd_connections.erase(it);
        conn.is_authenticated = false;
        gd_connections.insert(conn);
        error_msg = "Google Drive connection lost. Please reconnect.";
        success_msg = "";
    }

    void ServicesState::disconnect_gdrive(const std::string& gd_user_id) {
        {
            std::lock_guard<std::mutex> lock(mu);
            auto it = find_by_gd_user_id(gd_user_id);
            if (it != gd_connections.end()) {
                gd_connections.erase(it);
            }
            error_msg = "";
            success_msg = "";
        }

        std::string app_user_id = core::EnvManager::get().get("USER_ID", "");
        std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
        if (!gd_user_id.empty() && !app_user_id.empty() && !base.empty()) {
            std::thread([gd_user_id, app_user_id, base]() {
                std::string url = base + "/api/gd/users?user_id=" + app_user_id + "&gd_user_id=" + gd_user_id;
                std::map<std::string, std::string> headers;
                headers["Accept"] = "application/json";
                core::HttpClient::get().del(url, headers);
            }).detach();
        }
    }

    void ServicesState::initiate_gd_login() {
        std::string proxy_url = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
        if (proxy_url.empty()) throw std::runtime_error("PROXY_SERVICE_URL is not set");

        std::string user_id = core::EnvManager::get().get("USER_ID", "");
        if (user_id.empty()) throw std::runtime_error("USER_ID is not set");

        std::string url = proxy_url + "/api/gd/auth?user_id=" + user_id;
        core::open_file_in_browser(url);
        show_gd_login_modal = true;
        gd_auth_error.clear();
    }

    bool ServicesState::is_gd_account_folder_connected(const std::string& folder_name) {
        std::lock_guard<std::mutex> lock(mu);
        for (const auto& conn : gd_connections) {
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

    void ServicesState::fetch_gdrive_files(const std::string& gd_user_id,
                                            const std::string& folder_id,
                                            GDFilesCallback callback) {
        std::thread([this, gd_user_id, folder_id, callback]() {
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

            std::string url = base + "/api/gd/files?user_id=" + user_id
                + "&gd_user_id=" + gd_user_id
                + "&folder_id=" + folder_id;

            std::map<std::string, std::string> headers;
            headers["Accept"] = "application/json";

            core::HttpResponse response = core::HttpClient::get().get(url, headers);

            if (response.status_code >= 200 && response.status_code < 300) {
                callback(true, response.body, "");
            } else if (response.status_code == 401) {
                mark_gd_disconnected(gd_user_id);
                callback(false, "", "Session expired. Please reconnect.");
            } else {
                callback(false, "", "HTTP " + std::to_string(response.status_code));
            }
        }).detach();
    }

    void ServicesState::download_gd_file(const std::string& gd_user_id,
                                          const std::string& file_id,
                                          const std::string& local_path,
                                          GDDownloadCallback callback) {
        std::thread([this, gd_user_id, file_id, local_path, callback]() {
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

            std::string url = base + "/api/gd/file/download?user_id=" + user_id
                + "&gd_user_id=" + gd_user_id
                + "&file_id=" + file_id;

            core::HttpResponse response = core::HttpClient::get().get(url);

            if (response.status_code >= 200 && response.status_code < 300) {
                std::ofstream file(local_path, std::ios::binary);
                if (!file) {
                    callback(false, "", "Failed to create local file: " + local_path);
                    return;
                }
                file.write(response.body.data(), response.body.size());
                file.close();

                if (file.good()) {
                    callback(true, local_path, "");
                } else {
                    callback(false, "", "Failed to write file to disk");
                }
            } else if (response.status_code == 401) {
                mark_gd_disconnected(gd_user_id);
                callback(false, "", "Session expired. Please reconnect.");
            } else {
                callback(false, "", "Download failed: HTTP " + std::to_string(response.status_code));
            }
        }).detach();
    }

}
