#include "services_state.h"

#include "core/cache/listing_cache.h"
#include "core/manager/env_manager.h"
#include "core/net/http_client.h"
#include "core/system/util.h"

#include <algorithm>
#include <cctype>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <nlohmann/json.hpp>

namespace misty::panel {
    namespace fs = std::filesystem;
    using json = nlohmann::json;

    ServicesState::ServicesState() = default;
    ServicesState::~ServicesState() = default;

    namespace {
        fs::path remote_metadata_path() {
            const char* home = std::getenv("HOME");
            return fs::path(home ? home : "/tmp") / "misty" / "remotes.json";
        }

        std::string trim_copy(std::string value) {
            auto not_space = [](unsigned char c) { return !std::isspace(c); };
            value.erase(value.begin(), std::find_if(value.begin(), value.end(), not_space));
            value.erase(std::find_if(value.rbegin(), value.rend(), not_space).base(), value.end());
            return value;
        }

        // Map rclone provider type to a human-readable display name.
        std::string display_name_for_type(const std::string& type) {
            if (type == "onedrive") return "OneDrive";
            if (type == "drive")    return "Google Drive";
            if (type == "dropbox")  return "Dropbox";
            if (type == "s3")       return "Amazon S3";
            if (type == "sftp")     return "SFTP";
            if (!type.empty()) {
                std::string out = type;
                out[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(out[0])));
                return out;
            }
            return type;
        }

        std::string lowercase_copy(std::string value) {
            std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
                return static_cast<char>(std::tolower(c));
            });
            return value;
        }

        std::string first_line(const std::string& text) {
            if (text.empty()) return "";
            std::string line = text.substr(0, text.find('\n'));
            return trim_copy(line);
        }

        std::string title_case_words(std::string text) {
            bool new_word = true;
            for (char& c : text) {
                if (std::isspace(static_cast<unsigned char>(c))) {
                    new_word = true;
                    continue;
                }
                c = static_cast<char>(new_word ? std::toupper(static_cast<unsigned char>(c))
                                               : std::tolower(static_cast<unsigned char>(c)));
                new_word = false;
            }
            return text;
        }

        std::string prettify_field_name(std::string raw_name) {
            if (raw_name.empty()) return "";

            for (char& c : raw_name) {
                if (c == '_' || c == '-') c = ' ';
            }

            raw_name = trim_copy(raw_name);
            if (raw_name == "config type") return "Account Type";
            if (raw_name == "drive id" || raw_name == "driveid") return "Drive";
            if (raw_name == "client id") return "Client ID";
            if (raw_name == "client secret") return "Client Secret";
            if (raw_name == "access key id") return "Access Key ID";
            if (raw_name == "secret access key") return "Secret Access Key";
            if (raw_name == "host") return "Server";
            if (raw_name == "user") return "Username";
            if (raw_name == "key file") return "SSH Key File";
            return title_case_words(raw_name);
        }

        bool looks_opaque_choice_value(const std::string& value) {
            if (value.size() < 10) return false;
            if (value.find('@') != std::string::npos) return false;

            bool has_alpha = false;
            bool has_digit = false;
            bool has_sep = false;
            for (unsigned char c : value) {
                has_alpha = has_alpha || std::isalpha(c);
                has_digit = has_digit || std::isdigit(c);
                has_sep = has_sep || c == '-' || c == '_' || c == ':' || c == '.';
            }
            return has_alpha && has_digit && has_sep;
        }

        std::string normalize_question_help(const std::string& provider_type,
                                            const std::string& option_name,
                                            const std::string& raw_help) {
            const std::string key = lowercase_copy(option_name);
            if (provider_type == "onedrive" && (key == "driveid" || key == "drive id")) {
                return "Choose which OneDrive location Misty should use for this connection.";
            }
            if (key == "config_type" || key == "config type") {
                return "Choose the account type that matches the service you are connecting.";
            }
            if (key == "scope") {
                return "Choose how much access Misty should request for this remote.";
            }
            return trim_copy(raw_help);
        }

        ServicesState::ConfigChoice normalize_choice(const std::string& provider_type,
                                                     const std::string& option_name,
                                                     const std::string& raw_value,
                                                     const std::string& raw_help) {
            ServicesState::ConfigChoice choice;
            choice.value = raw_value;

            const std::string summary = first_line(raw_help);
            const std::string summary_lower = lowercase_copy(summary);
            const std::string option_key = lowercase_copy(option_name);

            if (provider_type == "onedrive" && (option_key == "driveid" || option_key == "drive id")) {
                if (summary_lower.find("personal") != std::string::npos) {
                    choice.label = "Personal";
                } else if (summary_lower.find("business") != std::string::npos) {
                    choice.label = "Business";
                } else if (!summary.empty()) {
                    choice.label = summary;
                }
            } else if (!summary.empty() && looks_opaque_choice_value(raw_value)) {
                choice.label = summary;
            } else if (raw_value == "true") {
                choice.label = "Yes";
            } else if (raw_value == "false") {
                choice.label = "No";
            }

            if (choice.label.empty()) {
                choice.label = raw_value;
            }

            choice.help = trim_copy(raw_help);
            if (!summary.empty() && choice.label == summary) {
                choice.help.clear();
            }
            return choice;
        }
    }

    void ServicesState::init(core::WorkerPool& pool) {
        if (worker_pool_) return;
        worker_pool_ = &pool;
        {
            std::lock_guard<std::mutex> lock(mu);
            load_remote_aliases_locked();
        }
        refresh_connections();
    }

    void ServicesState::load_remote_aliases_locked() {
        remote_aliases_.clear();

        const fs::path path = remote_metadata_path();
        if (!fs::exists(path)) return;

        try {
            std::ifstream file(path);
            if (!file.is_open()) return;

            json j = json::parse(file, nullptr, true, true);
            const auto& remotes = j.value("remotes", json::object());
            if (!remotes.is_object()) return;

            for (auto it = remotes.begin(); it != remotes.end(); ++it) {
                if (!it.value().is_object()) continue;
                std::string alias = trim_copy(it.value().value("alias", std::string("")));
                if (!alias.empty()) {
                    remote_aliases_[it.key()] = alias;
                }
            }
        } catch (const std::exception& ex) {
            std::cerr << "load_remote_aliases_locked: " << ex.what() << std::endl;
        }
    }

    void ServicesState::save_remote_aliases_locked() const {
        const fs::path path = remote_metadata_path();

        try {
            fs::create_directories(path.parent_path());

            json remotes = json::object();
            for (const auto& [remote_name, alias] : remote_aliases_) {
                if (alias.empty()) continue;
                remotes[remote_name] = {
                    {"alias", alias},
                };
            }

            std::ofstream file(path);
            if (!file.is_open()) return;
            file << json{{"remotes", remotes}}.dump(2);
        } catch (const std::exception& ex) {
            std::cerr << "save_remote_aliases_locked: " << ex.what() << std::endl;
        }
    }

    void ServicesState::refresh_connections() {
        if (!worker_pool_) return;

        {
            std::lock_guard<std::mutex> lock(mu);
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
                                std::set<RemoteConnection> new_connections;
                                for (const auto& obj : json) {
                                    RemoteConnection conn;
                                    conn.name = obj.value("name", std::string(""));
                                    conn.type = obj.value("type", std::string(""));
                                    conn.display_name = display_name_for_type(conn.type);
                                    auto alias_it = remote_aliases_.find(conn.name);
                                    if (alias_it != remote_aliases_.end()) {
                                        conn.alias = alias_it->second;
                                    }
                                    conn.connected = true;
                                    if (!conn.name.empty()) {
                                        new_connections.insert(conn);
                                    }
                                }
                                connections = std::move(new_connections);
                                mappings_dirty = true;
                            }
                        } catch (const std::exception& ex) {
                            error_msg = std::string("Failed to parse remotes: ") + ex.what();
                        }
                    } else {
                        error_msg = "Failed to fetch remotes (HTTP " + std::to_string(response.status_code) + "): " + response.body;
                        std::cerr << "refresh_connections: " << error_msg << std::endl;
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
        out.alias = it->alias;
        out.connected = it->connected;
        return true;
    }

    std::string ServicesState::get_remote_alias(const std::string& remote_name) {
        std::lock_guard<std::mutex> lock(mu);
        auto it = remote_aliases_.find(remote_name);
        return it == remote_aliases_.end() ? std::string() : it->second;
    }

    bool ServicesState::set_remote_alias(const std::string& remote_name, const std::string& alias) {
        std::lock_guard<std::mutex> lock(mu);
        if (remote_name.empty()) return false;

        const std::string trimmed = trim_copy(alias);
        if (trimmed.empty()) {
            remote_aliases_.erase(remote_name);
        } else {
            remote_aliases_[remote_name] = trimmed;
        }
        save_remote_aliases_locked();

        RemoteConnection search;
        search.name = remote_name;
        auto it = connections.find(search);
        if (it != connections.end()) {
            RemoteConnection updated = *it;
            connections.erase(it);
            updated.alias = trimmed;
            connections.insert(std::move(updated));
        }
        mappings_dirty = true;
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
                mappings_dirty = true;
            }
            remote_aliases_.erase(remote_name);
            save_remote_aliases_locked();
            error_msg.clear();
            success_msg.clear();
        }

        if (!worker_pool_ || remote_name.empty()) return;

        // Drop any cached folder listings for this remote — they're now
        // stale/invalid and would mislead a future re-connect.
        core::listing_cache::clear_remote(remote_name);

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
                    std::string err = "HTTP " + std::to_string(response.status_code);
                    if (!response.body.empty()) err += ": " + response.body;
                    std::cerr << "fetch_files(" << remote << ", " << path << "): " << err << std::endl;
                    callback(false, "", err);
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

    // ---------------------------------------------------------------------
    // Interactive remote-config flow
    // ---------------------------------------------------------------------

    namespace {
        ServicesState::ConfigStepKind parse_kind(const std::string& s) {
            if (s == "done")    return ServicesState::ConfigStepKind::DONE;
            if (s == "choose")  return ServicesState::ConfigStepKind::CHOOSE;
            if (s == "suggest") return ServicesState::ConfigStepKind::SUGGEST;
            if (s == "confirm") return ServicesState::ConfigStepKind::CONFIRM;
            if (s == "input")   return ServicesState::ConfigStepKind::INPUT;
            return ServicesState::ConfigStepKind::NONE;
        }

        // Apply a parsed JSON step to state. Caller MUST hold state.mu.
        void apply_step_locked(ServicesState& state, const nlohmann::json& j) {
            state.config_kind = parse_kind(j.value("kind", std::string("")));
            state.config_state = j.value("state", std::string(""));
            state.config_warning = j.value("error", std::string(""));
            state.config_choices.clear();
            state.config_question_name.clear();
            state.config_question_help.clear();
            state.config_default.clear();
            state.config_question_password = false;
            std::memset(state.config_input_buf, 0, sizeof(state.config_input_buf));

            // The server may rename the remote on the terminal DONE step —
            // e.g. "onedrive-1712345678" → "onedrive-alice@contoso.com" once
            // the email is resolved. Track the latest name so success
            // messages and any post-DONE refresh show the final form.
            if (j.contains("name") && j["name"].is_string()) {
                std::string server_name = j["name"].get<std::string>();
                if (!server_name.empty()) {
                    state.config_remote_name = server_name;
                }
            }

            if (j.contains("option") && j["option"].is_object()) {
                const auto& opt = j["option"];
                const std::string raw_name = opt.value("name", std::string(""));
                const std::string raw_help = opt.value("help", std::string(""));
                state.config_question_name = prettify_field_name(raw_name);
                state.config_question_help = normalize_question_help(state.config_provider_type, raw_name, raw_help);
                state.config_default       = opt.value("default", std::string(""));
                state.config_question_password = opt.value("password", false);
                if (opt.contains("examples") && opt["examples"].is_array()) {
                    for (const auto& ex : opt["examples"]) {
                        ServicesState::ConfigChoice c = normalize_choice(
                            state.config_provider_type,
                            raw_name,
                            ex.value("value", std::string("")),
                            ex.value("help",  std::string("")));
                        state.config_choices.push_back(std::move(c));
                    }
                    if (state.config_provider_type == "onedrive" &&
                        (lowercase_copy(raw_name) == "driveid" || lowercase_copy(raw_name) == "drive id")) {
                        std::stable_sort(state.config_choices.begin(), state.config_choices.end(),
                            [](const ServicesState::ConfigChoice& lhs, const ServicesState::ConfigChoice& rhs) {
                                const bool lhs_personal = lowercase_copy(lhs.label).find("personal") != std::string::npos;
                                const bool rhs_personal = lowercase_copy(rhs.label).find("personal") != std::string::npos;
                                return lhs_personal && !rhs_personal;
                            });
                    }
                }
                // Pre-fill input buffer with default
                if (state.config_kind == ServicesState::ConfigStepKind::INPUT ||
                    state.config_kind == ServicesState::ConfigStepKind::SUGGEST) {
                    if (state.config_default.size() < sizeof(state.config_input_buf)) {
                        std::memcpy(state.config_input_buf,
                                    state.config_default.c_str(),
                                    state.config_default.size() + 1);
                    }
                }
            }
        }
    }

    void ServicesState::start_remote_config(const std::string& provider_type,
                                             const std::string& remote_name) {
        if (!worker_pool_) return;

        {
            std::lock_guard<std::mutex> lock(mu);
            config_modal_open    = true;
            config_in_flight     = true;
            config_remote_name   = remote_name;
            config_provider_type = provider_type;
            config_kind          = ConfigStepKind::NONE;
            config_state.clear();
            config_error.clear();
            config_warning.clear();
            config_choices.clear();
        }

        worker_pool_->add(
            [this, provider_type, remote_name]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    config_error = "PROXY_SERVICE_URL not set";
                    config_in_flight = false;
                    return;
                }

                nlohmann::json body;
                body["name"] = remote_name;
                body["type"] = provider_type;

                std::map<std::string, std::string> headers;
                headers["Content-Type"] = "application/json";

                auto response = core::HTTPClient::get().post(
                    base + "/api/remotes/config/start", body.dump(), headers);

                std::lock_guard<std::mutex> lock(mu);
                config_in_flight = false;
                if (response.status_code >= 200 && response.status_code < 300) {
                    try {
                        auto json = nlohmann::json::parse(response.body);
                        apply_step_locked(*this, json);
                        if (config_kind == ConfigStepKind::DONE) {
                            // apply_step_locked may have updated
                            // config_remote_name with the server-side
                            // renamed form — use it instead of the temp.
                            success_msg = "Connected " + config_remote_name;
                        }
                    } catch (const std::exception& ex) {
                        config_error = std::string("Failed to parse step: ") + ex.what();
                    }
                } else {
                    config_error = "HTTP " + std::to_string(response.status_code);
                    if (!response.body.empty()) config_error += ": " + response.body;
                }
            },
            [this]() {
                // On success, refresh the connections list when the flow finishes.
                std::lock_guard<std::mutex> lock(mu);
                if (config_kind == ConfigStepKind::DONE) {
                    // Trigger a refresh from the UI thread on next render via flag.
                }
            },
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                config_in_flight = false;
                config_error = err;
            }
        );
    }

    void ServicesState::continue_remote_config(const std::string& result) {
        if (!worker_pool_) return;

        std::string name;
        std::string state_token;
        {
            std::lock_guard<std::mutex> lock(mu);
            name = config_remote_name;
            state_token = config_state;
            config_in_flight = true;
            config_error.clear();
        }
        if (name.empty()) return;

        worker_pool_->add(
            [this, name, state_token, result]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    config_error = "PROXY_SERVICE_URL not set";
                    config_in_flight = false;
                    return;
                }

                nlohmann::json body;
                body["name"]   = name;
                body["state"]  = state_token;
                body["result"] = result;

                std::map<std::string, std::string> headers;
                headers["Content-Type"] = "application/json";

                auto response = core::HTTPClient::get().post(
                    base + "/api/remotes/config/continue", body.dump(), headers);

                std::lock_guard<std::mutex> lock(mu);
                config_in_flight = false;
                if (response.status_code >= 200 && response.status_code < 300) {
                    try {
                        auto json = nlohmann::json::parse(response.body);
                        apply_step_locked(*this, json);
                    } catch (const std::exception& ex) {
                        config_error = std::string("Failed to parse step: ") + ex.what();
                    }
                } else {
                    config_error = "HTTP " + std::to_string(response.status_code);
                    if (!response.body.empty()) config_error += ": " + response.body;
                }
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                config_in_flight = false;
                config_error = err;
            }
        );
    }

    void ServicesState::cancel_remote_config() {
        std::string name;
        {
            std::lock_guard<std::mutex> lock(mu);
            name = config_remote_name;
            config_modal_open = false;
            config_kind = ConfigStepKind::NONE;
            config_state.clear();
            config_choices.clear();
            config_remote_name.clear();
            config_provider_type.clear();
            config_error.clear();
            config_warning.clear();
            config_in_flight = false;
        }

        if (!worker_pool_ || name.empty()) return;

        worker_pool_->add(
            [name]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) return;
                std::string url = base + "/api/remotes/config?name=" + core::url_encode(name);
                std::map<std::string, std::string> headers;
                core::HTTPClient::get().del(url, headers);
            },
            []() {},
            [](const std::string&) {}
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
