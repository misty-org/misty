#include "services_state.h"

#include "core/manager/env_manager.h"
#include "core/net/http_client.h"
#include "core/system/util.h"

#include <filesystem>
#include <fstream>
#include <iostream>
#include <nlohmann/json.hpp>

namespace misty::panel {

    ServicesState::ServicesState() = default;
    ServicesState::~ServicesState() = default;

    void ServicesState::init(core::WorkerPool& pool) {
        if (worker_pool_) return;
        worker_pool_ = &pool;
        refresh_connections();
    }

    void ServicesState::refresh_connections() {
        if (!worker_pool_) return;

        {
            std::lock_guard<std::mutex> lock(mu);
            connections.clear();
            error_msg.clear();
            is_refreshing = true;
        }

        worker_pool_->add(
            [this]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    error_msg = "PROXY_SERVICE_URL not set";
                    is_refreshing = false;
                    initial_load_done = true;
                    return;
                }

                std::map<std::string, std::string> headers;
                headers["Accept"] = "application/json";

                auto response = core::HTTPClient::get().get(base + "/api/remotes", headers);

                {
                    std::lock_guard<std::mutex> lock(mu);
                    if (response.status_code >= 200 && response.status_code < 300) {
                        try {
                            auto json = nlohmann::json::parse(response.body);
                            if (json.is_array()) {
                                for (const auto& obj : json) {
                                    RemoteConnection conn;
                                    conn.name = obj.value("name", std::string(""));
                                    conn.type = obj.value("type", std::string(""));
                                    conn.display_name = conn.name;
                                    conn.connected = true;
                                    if (!conn.name.empty()) {
                                        connections.insert(conn);
                                    }
                                }
                            }
                        } catch (const std::exception& ex) {
                            error_msg = std::string("Failed to parse remotes: ") + ex.what();
                        }
                    } else {
                        error_msg = "Failed to fetch remotes (" + std::to_string(response.status_code) + ")";
                    }
                    is_refreshing = false;
                    initial_load_done = true;
                }
            },
            []() {},
            [this](const std::string& err) {
                std::cerr << "refresh_connections error: " << err << std::endl;
                std::lock_guard<std::mutex> lock(mu);
                error_msg = err;
                is_refreshing = false;
                initial_load_done = true;
            }
        );
    }

    bool ServicesState::has_connections() {
        std::lock_guard<std::mutex> lock(mu);
        return !connections.empty();
    }

    bool ServicesState::is_remote_connected(const std::string& remote_name) {
        std::lock_guard<std::mutex> lock(mu);
        RemoteConnection search;
        search.name = remote_name;
        auto it = connections.find(search);
        return it != connections.end() && it->connected;
    }

    bool ServicesState::get_remote_card_state(const std::string& remote_name, RemoteCardState& out) {
        std::lock_guard<std::mutex> lock(mu);
        RemoteConnection search;
        search.name = remote_name;
        auto it = connections.find(search);
        if (it == connections.end()) return false;
        out.name = it->name;
        out.type = it->type;
        out.display_name = it->display_name;
        out.connected = it->connected;
        return true;
    }

    void ServicesState::initiate_login(const std::string& provider_type, const std::string& remote_name) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, provider_type, remote_name]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    auth_error = "PROXY_SERVICE_URL not set";
                    return;
                }

                nlohmann::json body;
                body["name"] = remote_name;
                body["type"] = provider_type;

                std::map<std::string, std::string> headers;
                headers["Content-Type"] = "application/json";

                auto response = core::HTTPClient::get().post(
                    base + "/api/remotes", body.dump(), headers);

                std::lock_guard<std::mutex> lock(mu);
                if (response.status_code == 202 || (response.status_code >= 200 && response.status_code < 300)) {
                    // 202 = OAuth in progress (browser opened by proxy)
                    // 200 = Remote created immediately (e.g. local)
                    auth_error.clear();
                    success_msg = "Authentication started. Complete it in your browser, then refresh.";
                } else {
                    try {
                        auto json = nlohmann::json::parse(response.body);
                        auth_error = json.value("error", std::string("Login failed"));
                    } catch (...) {
                        auth_error = "Login failed: HTTP " + std::to_string(response.status_code);
                    }
                }
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                auth_error = err;
            }
        );
    }

    void ServicesState::disconnect_remote(const std::string& remote_name) {
        {
            std::lock_guard<std::mutex> lock(mu);
            RemoteConnection search;
            search.name = remote_name;
            auto it = connections.find(search);
            if (it != connections.end()) {
                connections.erase(it);
            }
            error_msg.clear();
            success_msg.clear();
        }

        if (!worker_pool_ || remote_name.empty()) return;

        worker_pool_->add(
            [remote_name]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) return;

                std::string url = base + "/api/remotes?name=" + core::url_encode(remote_name);
                std::map<std::string, std::string> headers;
                headers["Accept"] = "application/json";
                core::HTTPClient::get().del(url, headers);
            },
            []() {},
            [](const std::string& err) {
                std::cerr << "disconnect_remote error: " << err << std::endl;
            }
        );
    }

    void ServicesState::fetch_files(const std::string& remote,
                                     const std::string& path,
                                     FilesCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, remote, path, callback]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) {
                    callback(false, "", "PROXY_SERVICE_URL not set");
                    return;
                }

                std::string url = base + "/api/files?remote=" + core::url_encode(remote)
                    + "&path=" + core::url_encode(path);

                std::map<std::string, std::string> headers;
                headers["Accept"] = "application/json";

                auto response = core::HTTPClient::get().get(url, headers);

                if (response.status_code >= 200 && response.status_code < 300) {
                    callback(true, response.body, "");
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

    void ServicesState::download_file(const std::string& remote,
                                       const std::string& remote_path,
                                       const std::string& local_path,
                                       DownloadProgressCallback progress_cb,
                                       DownloadCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [remote, remote_path, local_path, callback, progress_cb]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) {
                    callback(false, "", "PROXY_SERVICE_URL not set");
                    return;
                }

                // Ensure parent directory exists
                std::filesystem::path path(local_path);
                std::error_code ec;
                std::filesystem::create_directories(path.parent_path(), ec);

                std::string url = base + "/api/file/download?remote=" + core::url_encode(remote)
                    + "&path=" + core::url_encode(remote_path);

                core::DownloadResult result = core::HTTPClient::get().download_to_file(
                    url, local_path, {}, progress_cb);

                if (result.success) {
                    callback(true, local_path, "");
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

    void ServicesState::upload_file(const std::string& remote,
                                    const std::string& remote_path,
                                    const std::string& local_path,
                                    core::UploadProgressCallback progress_cb,
                                    UploadCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [remote, remote_path, local_path, callback, progress_cb]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) {
                    callback(false, "PROXY_SERVICE_URL not set");
                    return;
                }

                // Read file content
                std::ifstream file(local_path, std::ios::binary);
                if (!file) {
                    callback(false, "Failed to open file: " + local_path);
                    return;
                }
                std::string file_content((std::istreambuf_iterator<char>(file)),
                                          std::istreambuf_iterator<char>());
                file.close();

                std::string file_name = std::filesystem::path(local_path).filename().string();

                std::string url = base + "/api/file/upload?remote=" + core::url_encode(remote)
                    + "&path=" + core::url_encode(remote_path);

                std::map<std::string, std::string> headers;
                headers["X-File-Name"] = file_name;
                headers["Content-Length"] = std::to_string(file_content.size());

                auto response = core::HTTPClient::get().post(url, file_content, headers);

                if (response.status_code >= 200 && response.status_code < 300) {
                    if (progress_cb) {
                        progress_cb(file_content.size(), file_content.size());
                    }
                    callback(true, "");
                } else {
                    callback(false, "Upload failed: HTTP " + std::to_string(response.status_code));
                }
            },
            []() {},
            [callback](const std::string& err) {
                callback(false, err);
            }
        );
    }

    void ServicesState::create_folder(const std::string& remote,
                                       const std::string& path,
                                       CreateFolderCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [remote, path, callback]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) {
                    callback(false, "", "PROXY_SERVICE_URL not set");
                    return;
                }

                nlohmann::json body;
                body["remote"] = remote;
                body["path"] = path;

                std::map<std::string, std::string> headers;
                headers["Content-Type"] = "application/json";

                auto response = core::HTTPClient::get().post(
                    base + "/api/mkdir", body.dump(), headers);

                if (response.status_code >= 200 && response.status_code < 300) {
                    callback(true, response.body, "");
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

    void ServicesState::search_files(const std::string& remote,
                                      const std::string& query,
                                      const std::string& path,
                                      FilesCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [remote, query, path, callback]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) {
                    callback(false, "", "PROXY_SERVICE_URL not set");
                    return;
                }

                std::string url = base + "/api/search?remote=" + core::url_encode(remote)
                    + "&q=" + core::url_encode(query)
                    + "&path=" + core::url_encode(path);

                std::map<std::string, std::string> headers;
                headers["Accept"] = "application/json";

                auto response = core::HTTPClient::get().get(url, headers);

                if (response.status_code >= 200 && response.status_code < 300) {
                    callback(true, response.body, "");
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

}
