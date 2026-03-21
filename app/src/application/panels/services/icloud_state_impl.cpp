#include "services_state.h"

#include "core/manager/env_manager.h"
#include "core/net/http_client.h"
#include "core/system/util.h"

#include <filesystem>
#include <iostream>
#include <nlohmann/json.hpp>

namespace misty::panel {
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
                                           DownloadProgressCallback progress_cb,
                                           ICLDownloadCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, email, filename, folder_path, local_path, callback, progress_cb]() {
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

                core::DownloadResult result = core::HTTPClient::get().download_to_file(url, local_path, {}, progress_cb);

                if (result.success) {
                    callback(true, local_path, "");
                } else if (result.final_status_code == 401) {
                    mark_icl_disconnected(email);
                    callback(false, "", "Session expired. Please sign in again.");
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

}
