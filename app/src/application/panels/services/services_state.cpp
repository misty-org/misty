#include "services_state.h"
#include "core/env_manager.h"
#include "core/http_client.h"
#include "core/util.h"
#include <nlohmann/json.hpp>
#include <iostream>
#include <set>
#include <fstream>
#include <filesystem>


namespace misty::panel {

    ServicesState::ServicesState() = default;

    ServicesState::~ServicesState() = default;

    void ServicesState::init(core::WorkerPool& pool) {
        if (worker_pool_) return; // already initialized
        worker_pool_ = &pool;
        check_connections();
        check_gd_connections();
        check_dbx_connections();
        check_icl_connections();
    }

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
                                       DownloadCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, ms_user_id, drive_id, file_id, local_path, callback]() {
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

                core::HttpResponse response = core::HTTPClient::get().get(url);

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
            },
            []() {},
            [callback](const std::string& err) {
                callback(false, "", err);
            }
        );
    }

    // ==================== Google Drive Methods ====================

    bool ServicesState::has_gd_connections() {
        std::lock_guard<std::mutex> lock(mu);
        return !gd_connections.empty();
    }

    void ServicesState::check_gd_connections() {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) return;
                std::string user_id = core::EnvManager::get().get("USER_ID", "");
                if (user_id.empty()) return;

                std::string url = base + "/api/gd/users?user_id=" + user_id;

                std::map<std::string, std::string> headers;
                headers["Accept"] = "application/json";

                std::cout << "Fetching GD connections from " << url << std::endl;

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
            },
            []() {},
            [](const std::string& err) {
                std::cerr << "check_gd_connections error: " << err << std::endl;
            }
        );
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
            if (worker_pool_) {
                worker_pool_->add(
                    [gd_user_id, app_user_id, base]() {
                        std::string url = base + "/api/gd/users?user_id=" + app_user_id + "&gd_user_id=" + gd_user_id;
                        std::map<std::string, std::string> headers;
                        headers["Accept"] = "application/json";
                        core::HTTPClient::get().del(url, headers);
                    },
                    []() {},
                    [](const std::string& err) {
                        std::cerr << "disconnect_gdrive error: " << err << std::endl;
                    }
                );
            }
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
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, gd_user_id, folder_id, callback]() {
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

                core::HttpResponse response = core::HTTPClient::get().get(url, headers);

                if (response.status_code >= 200 && response.status_code < 300) {
                    callback(true, response.body, "");
                } else if (response.status_code == 401) {
                    mark_gd_disconnected(gd_user_id);
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

    void ServicesState::download_gd_file(const std::string& gd_user_id,
                                          const std::string& file_id,
                                          const std::string& local_path,
                                          GDDownloadCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, gd_user_id, file_id, local_path, callback]() {
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

                core::HttpResponse response = core::HTTPClient::get().get(url);

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
            },
            []() {},
            [callback](const std::string& err) {
                callback(false, "", err);
            }
        );
    }

    // ==================== Dropbox Methods ====================

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
        show_dbx_login_modal = true;
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
                                           DBXDownloadCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, dbx_user_id, file_path, local_path, callback]() {
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

                core::HttpResponse response = core::HTTPClient::get().get(url);

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
                    mark_dbx_disconnected(dbx_user_id);
                    callback(false, "", "Session expired. Please reconnect.");
                } else {
                    callback(false, "", "Download failed: HTTP " + std::to_string(response.status_code));
                }
            },
            []() {},
            [callback](const std::string& err) {
                callback(false, "", err);
            }
        );
    }

    // ==================== Cloud Folder Creation ====================

    void ServicesState::create_onedrive_folder(const std::string& ms_user_id,
                                               const std::string& drive_id,
                                               const std::string& parent_id,
                                               const std::string& folder_name,
                                               CreateFolderCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, ms_user_id, drive_id, parent_id, folder_name, callback]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) { callback(false, "", "PROXY_SERVICE_URL not set"); return; }
                std::string user_id = core::EnvManager::get().get("USER_ID", "");
                if (user_id.empty()) { callback(false, "", "USER_ID not set"); return; }

                std::string url = base + "/api/ms/folder/create?user_id=" + user_id
                    + "&ms_user_id=" + ms_user_id;

                nlohmann::json body;
                body["drive_id"] = drive_id;
                body["parent_id"] = parent_id;
                body["name"] = folder_name;

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

    void ServicesState::create_gdrive_folder(const std::string& gd_user_id,
                                             const std::string& parent_id,
                                             const std::string& folder_name,
                                             CreateFolderCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, gd_user_id, parent_id, folder_name, callback]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) { callback(false, "", "PROXY_SERVICE_URL not set"); return; }
                std::string user_id = core::EnvManager::get().get("USER_ID", "");
                if (user_id.empty()) { callback(false, "", "USER_ID not set"); return; }

                std::string url = base + "/api/gd/folder/create?user_id=" + user_id
                    + "&gd_user_id=" + gd_user_id;

                nlohmann::json body;
                body["name"] = folder_name;
                body["parent_id"] = parent_id;

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

    bool ServicesState::has_icl_connections() {
        std::lock_guard<std::mutex> lock(mu);
        return !icl_connections.empty();
    }

    void ServicesState::check_icl_connections() {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this]() {
                std::string base = core::EnvManager::get().get("ICLOUD_PROXY_URL", "");
                if (base.empty()) return;

                std::map<std::string, std::string> headers;
                headers["Accept"] = "application/json";

                std::cout << "Fetching iCloud sessions from " << base << "/auth/sessions" << std::endl;

                core::HttpResponse response = core::HTTPClient::get().get(base + "/auth/sessions", headers);

                {
                    std::lock_guard<std::mutex> lock(mu);
                    if (response.status_code >= 200 && response.status_code < 300) {
                        try {
                            auto json = nlohmann::json::parse(response.body);
                            auto accounts = json.value("active_accounts", nlohmann::json::array());
                            for (const auto& email_val : accounts) {
                                std::string email = email_val.get<std::string>();
                                if (!email.empty()) {
                                    ICLConnection conn;
                                    conn.is_authenticated = true;
                                    conn.profile.email = email;
                                    conn.profile.loaded = true;
                                    icl_connections.insert(conn);
                                }
                            }
                        } catch (const std::exception& ex) {
                            error_msg = std::string("Failed to parse iCloud sessions: ") + ex.what();
                        }
                    }
                }
            },
            []() {},
            [](const std::string& err) {
                std::cerr << "check_icl_connections error: " << err << std::endl;
            }
        );
    }

    std::set<ICLConnection>::iterator ServicesState::find_by_icl_email(const std::string& email) {
        ICLConnection search_conn;
        search_conn.profile.email = email;
        return icl_connections.find(search_conn);
    }

    bool ServicesState::get_icloud_card_state(const std::string& email, ICloudCardState& out) {
        std::lock_guard<std::mutex> lock(mu);
        auto it = find_by_icl_email(email);
        if (it == icl_connections.end()) {
            return false;
        }
        out.profile_loaded = it->profile.loaded;
        out.profile = it->profile;
        out.is_connected = it->is_authenticated;
        return true;
    }

    void ServicesState::mark_icl_disconnected(const std::string& email) {
        std::lock_guard<std::mutex> lock(mu);
        auto it = find_by_icl_email(email);
        if (it == icl_connections.end()) return;
        ICLConnection conn = *it;
        icl_connections.erase(it);
        conn.is_authenticated = false;
        icl_connections.insert(conn);
        error_msg = "iCloud session expired. Please sign in again.";
        success_msg = "";
    }

    void ServicesState::initiate_icl_login(const std::string& email, const std::string& password) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, email, password]() {
                std::string base = core::EnvManager::get().get("ICLOUD_PROXY_URL", "");
                if (base.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    icl_auth_error = "ICLOUD_PROXY_URL not configured";
                    return;
                }

                nlohmann::json body;
                body["email"] = email;
                body["password"] = password;

                std::map<std::string, std::string> headers;
                headers["Content-Type"] = "application/json";

                core::HttpResponse response = core::HTTPClient::get().post(
                    base + "/auth/login", body.dump(), headers);

                std::lock_guard<std::mutex> lock(mu);
                if (response.status_code >= 200 && response.status_code < 300) {
                    try {
                        auto json = nlohmann::json::parse(response.body);
                        std::string message = json.value("message", std::string(""));
                        if (message == "2fa") {
                            icl_awaiting_2fa = true;
                            icl_pending_2fa_email = email;
                            icl_auth_error.clear();
                        } else {
                            ICLConnection conn;
                            conn.profile.email = email;
                            conn.profile.loaded = true;
                            conn.is_authenticated = true;
                            icl_connections.insert(conn);
                            icl_awaiting_2fa = false;
                            icl_auth_error.clear();
                            show_icl_login_modal = false;
                        }
                    } catch (const std::exception& e) {
                        icl_auth_error = std::string("Failed to parse login response: ") + e.what();
                    }
                } else {
                    try {
                        auto json = nlohmann::json::parse(response.body);
                        icl_auth_error = json.value("detail", std::string("Login failed"));
                    } catch (...) {
                        icl_auth_error = "Login failed: HTTP " + std::to_string(response.status_code);
                    }
                }
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                icl_auth_error = err;
            }
        );
    }

    void ServicesState::verify_icl_2fa(const std::string& email, const std::string& code) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, email, code]() {
                std::string base = core::EnvManager::get().get("ICLOUD_PROXY_URL", "");
                if (base.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    icl_auth_error = "ICLOUD_PROXY_URL not configured";
                    return;
                }

                nlohmann::json body;
                body["email"] = email;
                body["code"] = code;

                std::map<std::string, std::string> headers;
                headers["Content-Type"] = "application/json";

                core::HttpResponse response = core::HTTPClient::get().post(
                    base + "/auth/verify", body.dump(), headers);

                std::lock_guard<std::mutex> lock(mu);
                if (response.status_code >= 200 && response.status_code < 300) {
                    ICLConnection conn;
                    conn.profile.email = email;
                    conn.profile.loaded = true;
                    conn.is_authenticated = true;
                    icl_connections.insert(conn);
                    icl_awaiting_2fa = false;
                    icl_pending_2fa_email.clear();
                    icl_auth_error.clear();
                    show_icl_login_modal = false;
                } else {
                    try {
                        auto json = nlohmann::json::parse(response.body);
                        icl_auth_error = json.value("detail", std::string("Verification failed"));
                    } catch (...) {
                        icl_auth_error = "Verification failed: HTTP " + std::to_string(response.status_code);
                    }
                }
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                icl_auth_error = err;
            }
        );
    }

    void ServicesState::disconnect_icloud(const std::string& email) {
        std::lock_guard<std::mutex> lock(mu);
        auto it = find_by_icl_email(email);
        if (it != icl_connections.end()) {
            icl_connections.erase(it);
        }
        error_msg = "";
        success_msg = "";
    }

    void ServicesState::fetch_icloud_files(const std::string& email,
                                            const std::string& path,
                                            ICLFilesCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, email, path, callback]() {
                std::string base = core::EnvManager::get().get("ICLOUD_PROXY_URL", "");
                if (base.empty()) {
                    callback(false, "", "ICLOUD_PROXY_URL not set");
                    return;
                }

                std::string url = base + "/drive/ls?email=" + core::url_encode(email)
                    + "&path=" + core::url_encode(path);

                std::map<std::string, std::string> headers;
                headers["Accept"] = "application/json";

                core::HttpResponse response = core::HTTPClient::get().get(url, headers);

                if (response.status_code >= 200 && response.status_code < 300) {
                    callback(true, response.body, "");
                } else if (response.status_code == 401) {
                    mark_icl_disconnected(email);
                    callback(false, "", "Session expired. Please sign in again.");
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

    void ServicesState::download_icl_file(const std::string& email,
                                           const std::string& filename,
                                           const std::string& folder_path,
                                           const std::string& local_path,
                                           ICLDownloadCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, email, filename, folder_path, local_path, callback]() {
                std::string base = core::EnvManager::get().get("ICLOUD_PROXY_URL", "");
                if (base.empty()) {
                    callback(false, "", "ICLOUD_PROXY_URL not set");
                    return;
                }

                std::filesystem::path path(local_path);
                std::error_code ec;
                std::filesystem::create_directories(path.parent_path(), ec);

                std::string url = base + "/drive/download?email=" + core::url_encode(email)
                    + "&filename=" + core::url_encode(filename)
                    + "&folder_path=" + core::url_encode(folder_path);

                core::HttpResponse response = core::HTTPClient::get().get(url);

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
                    mark_icl_disconnected(email);
                    callback(false, "", "Session expired. Please sign in again.");
                } else {
                    callback(false, "", "Download failed: HTTP " + std::to_string(response.status_code));
                }
            },
            []() {},
            [callback](const std::string& err) {
                callback(false, "", err);
            }
        );
    }

}
