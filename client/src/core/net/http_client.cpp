#include <curl/curl.h>
#include <nlohmann/json.hpp>
#include <sstream>
#include <iostream>
#include <fstream>
#include <vector>
#include <cstring>
#include <filesystem>
#include <chrono>
#include <atomic>

#include "core/net/http_client.h"
#include "core/manager/session_manager.h"
#include "core/manager/env_manager.h"
#include "core/manager/proxy_manager.h"
#include "core/system/util.h"

namespace misty::core {
    namespace fs = std::filesystem;

    namespace {
        fs::path staging_download_path_for(const fs::path& final_path) {
            static std::atomic<uint64_t> counter{0};

            const char* home = std::getenv("HOME");
            fs::path root = fs::path(home ? home : "/tmp") / "misty" / "tmp" / "downloads";
            std::error_code ec;
            fs::create_directories(root, ec);

            const auto now = std::chrono::steady_clock::now().time_since_epoch();
            const auto ticks = std::chrono::duration_cast<std::chrono::microseconds>(now).count();

            fs::path staged_name = final_path.filename();
            if (staged_name.empty()) {
                staged_name = "download";
            }

            return root / (std::to_string(ticks) + "-" +
                           std::to_string(counter.fetch_add(1, std::memory_order_relaxed)) + "-" +
                           staged_name.string());
        }
    }

    struct CurlData {
        std::string response_body;
        std::map<std::string, std::string> response_headers;
    };

    struct DownloadFileData {
        std::ofstream file;
        DownloadProgressCallback progress_cb;
        std::string error_message;
    };

    struct StreamResponseData {
        std::string response_body;
        std::map<std::string, std::string> response_headers;
        std::string partial_line;
        StreamLineCallback line_callback;
    };

    static size_t WriteCallback(void* contents, size_t size, size_t nmemb, void* userp) {
        size_t total_size = size * nmemb;
        CurlData* data = static_cast<CurlData*>(userp);
        data->response_body.append(static_cast<char*>(contents), total_size);
        return total_size;
    }

    static size_t HeaderCallback(char* buffer, size_t size, size_t nitems, void* userp) {
        size_t total_size = size * nitems;
        CurlData* data = static_cast<CurlData*>(userp);
        
        std::string header_line(buffer, total_size);
        
        // Remove trailing \r\n
        if (header_line.length() >= 2) {
            header_line = header_line.substr(0, header_line.length() - 2);
        }
        
        // Parse header (format: "Key: Value")
        size_t colon_pos = header_line.find(':');
        if (colon_pos != std::string::npos) {
            std::string key = header_line.substr(0, colon_pos);
            std::string value = header_line.substr(colon_pos + 1);
            
            // Trim whitespace
            key.erase(0, key.find_first_not_of(" \t"));
            key.erase(key.find_last_not_of(" \t") + 1);
            value.erase(0, value.find_first_not_of(" \t"));
            value.erase(value.find_last_not_of(" \t") + 1);
            
            data->response_headers[key] = value;
        }
        
        return total_size;
    }

    static size_t StreamHeaderCallback(char* buffer, size_t size, size_t nitems, void* userp) {
        size_t total_size = size * nitems;
        StreamResponseData* data = static_cast<StreamResponseData*>(userp);
        if (!data) {
            return 0;
        }

        std::string header_line(buffer, total_size);
        if (header_line.length() >= 2) {
            header_line = header_line.substr(0, header_line.length() - 2);
        }

        size_t colon_pos = header_line.find(':');
        if (colon_pos != std::string::npos) {
            std::string key = header_line.substr(0, colon_pos);
            std::string value = header_line.substr(colon_pos + 1);

            key.erase(0, key.find_first_not_of(" \t"));
            key.erase(key.find_last_not_of(" \t") + 1);
            value.erase(0, value.find_first_not_of(" \t"));
            value.erase(value.find_last_not_of(" \t") + 1);

            data->response_headers[key] = value;
        }

        return total_size;
    }

    static size_t StreamWriteCallback(void* contents, size_t size, size_t nmemb, void* userp) {
        size_t total_size = size * nmemb;
        StreamResponseData* data = static_cast<StreamResponseData*>(userp);
        if (!data) {
            return 0;
        }

        const char* bytes = static_cast<const char*>(contents);
        data->response_body.append(bytes, total_size);
        data->partial_line.append(bytes, total_size);

        std::size_t newline_pos = std::string::npos;
        while ((newline_pos = data->partial_line.find('\n')) != std::string::npos) {
            std::string line = data->partial_line.substr(0, newline_pos);
            data->partial_line.erase(0, newline_pos + 1);
            if (!line.empty() && line.back() == '\r') {
                line.pop_back();
            }
            if (line.empty()) {
                continue;
            }
            if (data->line_callback && !data->line_callback(line)) {
                return 0;
            }
        }

        return total_size;
    }

    static size_t FileWriteCallback(void* contents, size_t size, size_t nmemb, void* userp) {
        size_t total_size = size * nmemb;
        DownloadFileData* data = static_cast<DownloadFileData*>(userp);
        data->file.write(static_cast<const char*>(contents), static_cast<std::streamsize>(total_size));
        if (!data->file.good()) {
            data->error_message = "Failed to write downloaded data to disk";
            return 0;
        }
        return total_size;
    }

    static int DownloadProgressFunc(void* clientp,
                                    curl_off_t dltotal,
                                    curl_off_t dlnow,
                                    curl_off_t /*ultotal*/,
                                    curl_off_t /*ulnow*/) {
        DownloadFileData* data = static_cast<DownloadFileData*>(clientp);
        if (!data || !data->progress_cb) return 0;

        size_t total = dltotal > 0 ? static_cast<size_t>(dltotal) : 0;
        size_t now = dlnow > 0 ? static_cast<size_t>(dlnow) : 0;
        return data->progress_cb(now, total) ? 0 : 1;
    }

    static HttpResponse execute_curl_request_with_timeouts(const std::string& method,
                                                           const std::string& url,
                                                           const std::string& body,
                                                           const std::map<std::string, std::string>& headers,
                                                           long connect_timeout_seconds,
                                                           long total_timeout_seconds);

    HTTPClient& HTTPClient::get() {
        static HTTPClient instance;
        return instance;
    }

    bool HTTPClient::is_proxy_url(const std::string& url) const {
        std::string proxy_url = EnvManager::get().get("PROXY_SERVICE_URL", "");
        return !proxy_url.empty() && url.rfind(proxy_url, 0) == 0;
    }

    void HTTPClient::update_proxy_status(const std::string& url, int status_code) {
        if (!is_proxy_url(url)) return;

        if (status_code == 0) {
            ProxyManager::get().record_proxy_request_result(false);
        } else {
            ProxyManager::get().record_proxy_request_result(true);
        }
    }

    HttpResponse HTTPClient::get(const std::string& url, const std::map<std::string, std::string>& headers) {
        return perform_request("GET", url, "", headers);
    }

    HttpResponse HTTPClient::get_with_timeouts(const std::string& url,
                                               long connect_timeout_seconds,
                                               long total_timeout_seconds,
                                               const std::map<std::string, std::string>& headers) {
        auto merged_headers = SessionManager::get().get_auth_headers();
        for (const auto& [key, value] : headers) {
            merged_headers[key] = value;
        }

        HttpResponse response = execute_curl_request_with_timeouts("GET", url, "", merged_headers, connect_timeout_seconds, total_timeout_seconds);
        if (response.status_code == 0 && is_proxy_url(url) && ProxyManager::get().ensure_running()) {
            response = execute_curl_request_with_timeouts("GET", url, "", merged_headers, connect_timeout_seconds, total_timeout_seconds);
        }
        update_proxy_status(url, response.status_code);

        if (response.status_code == 401 &&
            !SessionManager::get().is_session_expired() &&
            !is_refreshing_.exchange(true)) {
            RefreshResult refresh_result = attempt_token_refresh();
            if (refresh_result == RefreshResult::Success) {
                auto retry_headers = SessionManager::get().get_auth_headers();
                for (const auto& [key, value] : headers) {
                    retry_headers[key] = value;
                }
                response = execute_curl_request_with_timeouts("GET", url, "", retry_headers, connect_timeout_seconds, total_timeout_seconds);
                update_proxy_status(url, response.status_code);
            } else if (refresh_result == RefreshResult::Failed) {
                SessionManager::get().mark_session_expired();
            }
            is_refreshing_.store(false);
        }

        return response;
    }

    HttpResponse HTTPClient::get_stream_with_timeouts(const std::string& url,
                                                      long connect_timeout_seconds,
                                                      long total_timeout_seconds,
                                                      StreamLineCallback line_callback,
                                                      const std::map<std::string, std::string>& headers) {
        auto merged_headers = SessionManager::get().get_auth_headers();
        for (const auto& [key, value] : headers) {
            merged_headers[key] = value;
        }

        auto execute_stream_request = [&](const std::map<std::string, std::string>& request_headers) {
            HttpResponse response;
            response.status_code = 0;

            CURL* curl = curl_easy_init();
            if (!curl) {
                std::cerr << "Failed to initialize CURL" << std::endl;
                return response;
            }

            StreamResponseData data;
            data.line_callback = line_callback;

            curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
            curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, StreamWriteCallback);
            curl_easy_setopt(curl, CURLOPT_WRITEDATA, &data);
            curl_easy_setopt(curl, CURLOPT_HEADERFUNCTION, StreamHeaderCallback);
            curl_easy_setopt(curl, CURLOPT_HEADERDATA, &data);
            curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
            curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, connect_timeout_seconds);
            curl_easy_setopt(curl, CURLOPT_TIMEOUT, total_timeout_seconds);

            struct curl_slist* header_list = nullptr;
            for (const auto& [key, value] : request_headers) {
                std::string header = key + ": " + value;
                header_list = curl_slist_append(header_list, header.c_str());
            }
            if (header_list) {
                curl_easy_setopt(curl, CURLOPT_HTTPHEADER, header_list);
            }

            CURLcode res = curl_easy_perform(curl);
            if (res == CURLE_OK) {
                long response_code = 0;
                curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response_code);
                response.status_code = static_cast<int>(response_code);
                response.body = data.response_body;
                response.headers = data.response_headers;
            } else {
                std::cerr << "CURL error: " << curl_easy_strerror(res) << std::endl;
            }

            if (header_list) {
                curl_slist_free_all(header_list);
            }
            curl_easy_cleanup(curl);
            return response;
        };

        HttpResponse response = execute_stream_request(merged_headers);
        if (response.status_code == 0 && is_proxy_url(url) && ProxyManager::get().ensure_running()) {
            response = execute_stream_request(merged_headers);
        }
        update_proxy_status(url, response.status_code);

        if (response.status_code == 401 &&
            !SessionManager::get().is_session_expired() &&
            !is_refreshing_.exchange(true)) {
            RefreshResult refresh_result = attempt_token_refresh();
            if (refresh_result == RefreshResult::Success) {
                auto retry_headers = SessionManager::get().get_auth_headers();
                for (const auto& [key, value] : headers) {
                    retry_headers[key] = value;
                }
                response = execute_stream_request(retry_headers);
                update_proxy_status(url, response.status_code);
            } else if (refresh_result == RefreshResult::Failed) {
                SessionManager::get().mark_session_expired();
            }
            is_refreshing_.store(false);
        }

        return response;
    }

    HttpResponse HTTPClient::post_with_timeouts(const std::string& url,
                                                const std::string& body,
                                                long connect_timeout_seconds,
                                                long total_timeout_seconds,
                                                const std::map<std::string, std::string>& headers) {
        auto merged_headers = SessionManager::get().get_auth_headers();
        for (const auto& [key, value] : headers) {
            merged_headers[key] = value;
        }

        HttpResponse response = execute_curl_request_with_timeouts("POST", url, body, merged_headers, connect_timeout_seconds, total_timeout_seconds);
        if (response.status_code == 0 && is_proxy_url(url) && ProxyManager::get().ensure_running()) {
            response = execute_curl_request_with_timeouts("POST", url, body, merged_headers, connect_timeout_seconds, total_timeout_seconds);
        }
        update_proxy_status(url, response.status_code);

        if (response.status_code == 401 &&
            !SessionManager::get().is_session_expired() &&
            !is_refreshing_.exchange(true)) {
            RefreshResult refresh_result = attempt_token_refresh();
            if (refresh_result == RefreshResult::Success) {
                auto retry_headers = SessionManager::get().get_auth_headers();
                for (const auto& [key, value] : headers) {
                    retry_headers[key] = value;
                }
                response = execute_curl_request_with_timeouts("POST", url, body, retry_headers, connect_timeout_seconds, total_timeout_seconds);
                update_proxy_status(url, response.status_code);
            } else if (refresh_result == RefreshResult::Failed) {
                SessionManager::get().mark_session_expired();
            }
            is_refreshing_.store(false);
        }

        return response;
    }

    HttpResponse HTTPClient::post(const std::string& url, const std::string& body, const std::map<std::string, std::string>& headers) {
        return perform_request("POST", url, body, headers);
    }

    HttpResponse HTTPClient::put(const std::string& url, const std::string& body, const std::map<std::string, std::string>& headers) {
        return perform_request("PUT", url, body, headers);
    }

    HttpResponse HTTPClient::del(const std::string& url, const std::map<std::string, std::string>& headers) {
        return perform_request("DELETE", url, "", headers);
    }

    // Makes a single HTTP request (no retry logic)
    static HttpResponse execute_curl_request_with_timeouts(const std::string& method,
                                                           const std::string& url,
                                                           const std::string& body,
                                                           const std::map<std::string, std::string>& headers,
                                                           long connect_timeout_seconds,
                                                           long total_timeout_seconds) {
        HttpResponse response;
        response.status_code = 0;
        response.body = "";

        CURL* curl = curl_easy_init();
        if (!curl) {
            std::cerr << "Failed to initialize CURL" << std::endl;
            return response;
        }

        CurlData data;

        // Set URL
        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());

        // Set callback functions
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &data);
        curl_easy_setopt(curl, CURLOPT_HEADERFUNCTION, HeaderCallback);
        curl_easy_setopt(curl, CURLOPT_HEADERDATA, &data);

        // Set HTTP method
        if (method == "POST") {
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
            curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE_LARGE, static_cast<curl_off_t>(body.size()));
        } else if (method == "PUT") {
            curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "PUT");
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
            curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE_LARGE, static_cast<curl_off_t>(body.size()));
        } else if (method == "DELETE") {
            curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "DELETE");
        }

        // Set headers
        struct curl_slist* header_list = nullptr;
        for (const auto& [key, value] : headers) {
            std::string header = key + ": " + value;
            header_list = curl_slist_append(header_list, header.c_str());
        }
        if (header_list) {
            curl_easy_setopt(curl, CURLOPT_HTTPHEADER, header_list);
        }

        // Follow redirects
        curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);

        // Set timeouts to prevent blocking forever
        curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, connect_timeout_seconds);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, total_timeout_seconds);

        // Perform request
        CURLcode res = curl_easy_perform(curl);

        if (res == CURLE_OK) {
            long response_code;
            curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response_code);
            response.status_code = static_cast<int>(response_code);
            response.body = data.response_body;
            response.headers = data.response_headers;
        } else {
            std::cerr << "CURL error: " << curl_easy_strerror(res) << std::endl;
        }

        // Cleanup
        if (header_list) {
            curl_slist_free_all(header_list);
        }
        curl_easy_cleanup(curl);

        return response;
    }

    static HttpResponse execute_curl_request(const std::string& method,
                                            const std::string& url,
                                            const std::string& body,
                                            const std::map<std::string, std::string>& headers) {
        return execute_curl_request_with_timeouts(method, url, body, headers, 10L, 30L);
    }

    static DownloadResult execute_curl_download(const std::string& url,
                                                const std::string& local_path,
                                                const std::map<std::string, std::string>& headers,
                                                DownloadProgressCallback progress_cb) {
        namespace fs = std::filesystem;

        DownloadResult result;
        result.final_status_code = 0;

        fs::path final_path(local_path);
        fs::path temp_path = staging_download_path_for(final_path);

        std::error_code ec;
        fs::create_directories(final_path.parent_path(), ec);
        fs::create_directories(temp_path.parent_path(), ec);

        DownloadFileData data;
        data.file.open(temp_path, std::ios::binary | std::ios::trunc);
        if (!data.file.is_open()) {
            result.error_message = "Failed to create local file: " + local_path;
            return result;
        }
        data.progress_cb = std::move(progress_cb);

        CURL* curl = curl_easy_init();
        if (!curl) {
            data.file.close();
            fs::remove(temp_path, ec);
            result.error_message = "Failed to initialize CURL";
            return result;
        }

        CurlData header_data;

        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, FileWriteCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &data);
        curl_easy_setopt(curl, CURLOPT_HEADERFUNCTION, HeaderCallback);
        curl_easy_setopt(curl, CURLOPT_HEADERDATA, &header_data);
        curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
        curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 10L);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 0L);

        if (data.progress_cb) {
            curl_easy_setopt(curl, CURLOPT_NOPROGRESS, 0L);
            curl_easy_setopt(curl, CURLOPT_XFERINFOFUNCTION, DownloadProgressFunc);
            curl_easy_setopt(curl, CURLOPT_XFERINFODATA, &data);
        }

        struct curl_slist* header_list = nullptr;
        for (const auto& [key, value] : headers) {
            std::string header = key + ": " + value;
            header_list = curl_slist_append(header_list, header.c_str());
        }
        if (header_list) {
            curl_easy_setopt(curl, CURLOPT_HTTPHEADER, header_list);
        }

        CURLcode res = curl_easy_perform(curl);

        long response_code = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response_code);
        result.final_status_code = static_cast<int>(response_code);

        if (header_list) {
            curl_slist_free_all(header_list);
        }
        curl_easy_cleanup(curl);
        data.file.close();

        if (res != CURLE_OK) {
            fs::remove(temp_path, ec);
            if (!data.error_message.empty()) {
                result.error_message = data.error_message;
            } else if (res == CURLE_ABORTED_BY_CALLBACK) {
                result.error_message = "Download cancelled";
            } else {
                result.error_message = "CURL error: " + std::string(curl_easy_strerror(res));
            }
            return result;
        }

        if (response_code < 200 || response_code >= 300) {
            fs::remove(temp_path, ec);
            result.error_message = "Download failed: HTTP " + std::to_string(response_code);
            return result;
        }

        fs::remove(final_path, ec);
        fs::rename(temp_path, final_path, ec);
        if (ec) {
            fs::remove(temp_path, ec);
            result.error_message = "Failed to finalize downloaded file: " + ec.message();
            return result;
        }

        result.success = true;
        return result;
    }

    HTTPClient::RefreshResult HTTPClient::attempt_token_refresh() {
        std::string refresh_token = SessionManager::get().get_refresh_token();
        if (refresh_token.empty()) {
            return RefreshResult::Failed;
        }

        std::string proxy_url = EnvManager::get().get("PROXY_SERVICE_URL", "");
        if (proxy_url.empty()) {
            return RefreshResult::Failed;
        }

        std::map<std::string, std::string> json_fields;
        json_fields["refresh_token"] = refresh_token;
        std::string json_body = build_json_object(json_fields);

        std::map<std::string, std::string> headers;
        headers["Content-Type"] = "application/json";

        auto response = execute_curl_request("POST", proxy_url + "/api/refresh", json_body, headers);
        if (response.status_code == 0 && ProxyManager::get().ensure_running()) {
            response = execute_curl_request("POST", proxy_url + "/api/refresh", json_body, headers);
        }
        update_proxy_status(proxy_url + "/api/refresh", response.status_code);

        if (response.status_code == 200) {
            try {
                auto json_resp = nlohmann::json::parse(response.body);
                std::string new_token = json_resp["token"].get<std::string>();
                std::string new_refresh = json_resp["refresh_token"].get<std::string>();
                if (!SessionManager::get().update_tokens(new_token, new_refresh)) {
                    std::cerr << "[HTTPClient] Token refresh succeeded but session persistence failed" << std::endl;
                }
                std::cerr << "[HTTPClient] Token refresh succeeded" << std::endl;
                return RefreshResult::Success;
            } catch (...) {
                std::cerr << "[HTTPClient] Failed to parse refresh response" << std::endl;
            }
        } else if (response.status_code == 0) {
            std::cerr << "[HTTPClient] Token refresh failed because proxy is unavailable" << std::endl;
            return RefreshResult::Unavailable;
        } else {
            std::cerr << "[HTTPClient] Token refresh failed with status " << response.status_code << std::endl;
        }

        return RefreshResult::Failed;
    }

    HttpResponse HTTPClient::perform_request(const std::string& method, const std::string& url, const std::string& body, const std::map<std::string, std::string>& headers) {
        // Merge auth headers (caller-provided headers take priority)
        auto merged_headers = SessionManager::get().get_auth_headers();
        for (const auto& [key, value] : headers) {
            merged_headers[key] = value;
        }

        HttpResponse response = execute_curl_request(method, url, body, merged_headers);
        if (response.status_code == 0 && is_proxy_url(url) && ProxyManager::get().ensure_running()) {
            response = execute_curl_request(method, url, body, merged_headers);
        }
        update_proxy_status(url, response.status_code);

        // Auto-refresh on 401 if we're not already in a refresh call
        // Guard: skip if session already expired or another thread is refreshing
        if (response.status_code == 401 &&
            !SessionManager::get().is_session_expired() &&
            !is_refreshing_.exchange(true)) {
            RefreshResult refresh_result = attempt_token_refresh();
            if (refresh_result == RefreshResult::Success) {
                // Retry with new auth headers
                auto retry_headers = SessionManager::get().get_auth_headers();
                for (const auto& [key, value] : headers) {
                    retry_headers[key] = value;
                }
                response = execute_curl_request(method, url, body, retry_headers);
                update_proxy_status(url, response.status_code);
            } else if (refresh_result == RefreshResult::Failed) {
                // Refresh failed — mark session as expired so UI can prompt reconnect
                // Tokens are preserved so the user can re-authenticate without re-entering credentials
                SessionManager::get().mark_session_expired();
            }
            is_refreshing_.store(false);
        }

        return response;
    }

    UploadResult HTTPClient::chunked_upload(
        const std::string& upload_url,
        const std::string& file_path,
        size_t chunk_size,
        size_t chunk_alignment,
        UploadProgressCallback progress_cb,
        std::atomic<bool>* cancel_flag
    ) {
        UploadResult result;

        // Align chunk size if required by the service (e.g. 320KB for OneDrive, 256KB for GDrive)
        if (chunk_alignment > 0) {
            chunk_size = (chunk_size / chunk_alignment) * chunk_alignment;
            if (chunk_size == 0) chunk_size = chunk_alignment;
        }

        // Open file and get size
        std::ifstream file(file_path, std::ios::binary | std::ios::ate);
        if (!file.is_open()) {
            result.error_message = "Failed to open file: " + file_path;
            return result;
        }

        size_t file_size = static_cast<size_t>(file.tellg());
        file.seekg(0, std::ios::beg);

        if (file_size == 0) {
            result.error_message = "File is empty";
            return result;
        }

        // Allocate buffer for chunks
        std::vector<char> buffer(chunk_size);

        size_t bytes_uploaded = 0;

        while (bytes_uploaded < file_size) {
            // Check for cancellation
            if (cancel_flag && cancel_flag->load()) {
                result.error_message = "Upload cancelled";
                return result;
            }

            // Calculate this chunk's size
            size_t remaining = file_size - bytes_uploaded;
            size_t current_chunk_size = std::min(chunk_size, remaining);

            // Read chunk from file
            file.read(buffer.data(), current_chunk_size);
            if (!file && !file.eof()) {
                result.error_message = "Failed to read file at offset " + std::to_string(bytes_uploaded);
                return result;
            }

            size_t bytes_read = static_cast<size_t>(file.gcount());
            if (bytes_read == 0) {
                break;
            }

            // Calculate byte range for Content-Range header
            size_t range_start = bytes_uploaded;
            size_t range_end = bytes_uploaded + bytes_read - 1;

            // Format: "bytes start-end/total"
            std::string content_range = "bytes " + std::to_string(range_start) + "-"
                                       + std::to_string(range_end) + "/" + std::to_string(file_size);

            // Initialize curl for this chunk
            CURL* curl = curl_easy_init();
            if (!curl) {
                result.error_message = "Failed to initialize CURL";
                return result;
            }

            CurlData response_data;

            curl_easy_setopt(curl, CURLOPT_URL, upload_url.c_str());
            curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "PUT");
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, buffer.data());
            curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, bytes_read);

            curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
            curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response_data);
            curl_easy_setopt(curl, CURLOPT_HEADERFUNCTION, HeaderCallback);
            curl_easy_setopt(curl, CURLOPT_HEADERDATA, &response_data);

            // Set headers
            struct curl_slist* headers = nullptr;
            headers = curl_slist_append(headers, ("Content-Length: " + std::to_string(bytes_read)).c_str());
            headers = curl_slist_append(headers, ("Content-Range: " + content_range).c_str());
            curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

            // Follow redirects
            curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);

            // Perform the request
            CURLcode res = curl_easy_perform(curl);

            long http_code = 0;
            curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);

            curl_slist_free_all(headers);
            curl_easy_cleanup(curl);

            if (res != CURLE_OK) {
                result.error_message = "CURL error: " + std::string(curl_easy_strerror(res));
                return result;
            }

            // Check response status
            // 202 Accepted = more chunks expected
            // 200/201 = upload complete
            // 4xx/5xx = error
            if (http_code >= 400) {
                result.final_status_code = static_cast<int>(http_code);
                result.error_message = "Upload failed with status " + std::to_string(http_code) + ": " + response_data.response_body;
                result.response_body = response_data.response_body;
                return result;
            }

            bytes_uploaded += bytes_read;

            // Call progress callback
            if (progress_cb) {
                if (!progress_cb(bytes_uploaded, file_size)) {
                    result.error_message = "Upload cancelled by callback";
                    return result;
                }
            }

            // Check if upload is complete (200 or 201 response)
            if (http_code == 200 || http_code == 201) {
                result.success = true;
                result.final_status_code = static_cast<int>(http_code);
                result.response_body = response_data.response_body;
                return result;
            }
        }

        // If we get here without a 200/201, something unexpected happened
        if (!result.success) {
            result.error_message = "Upload ended unexpectedly without completion response";
        }

        return result;
    }

    DownloadResult HTTPClient::download_to_file(
        const std::string& url,
        const std::string& local_path,
        const std::map<std::string, std::string>& headers,
        DownloadProgressCallback progress_cb
    ) {
        auto merged_headers = SessionManager::get().get_auth_headers();
        for (const auto& [key, value] : headers) {
            merged_headers[key] = value;
        }

        DownloadResult result = execute_curl_download(url, local_path, merged_headers, progress_cb);
        if (result.final_status_code == 0 && is_proxy_url(url) && ProxyManager::get().ensure_running()) {
            result = execute_curl_download(url, local_path, merged_headers, progress_cb);
        }
        update_proxy_status(url, result.final_status_code);

        if (result.final_status_code == 401 &&
            !SessionManager::get().is_session_expired() &&
            !is_refreshing_.exchange(true)) {
            RefreshResult refresh_result = attempt_token_refresh();
            if (refresh_result == RefreshResult::Success) {
                auto retry_headers = SessionManager::get().get_auth_headers();
                for (const auto& [key, value] : headers) {
                    retry_headers[key] = value;
                }
                result = execute_curl_download(url, local_path, retry_headers, progress_cb);
                update_proxy_status(url, result.final_status_code);
            } else if (refresh_result == RefreshResult::Failed) {
                SessionManager::get().mark_session_expired();
            }
            is_refreshing_.store(false);
        }

        return result;
    }

    bool HTTPClient::probe_proxy() {
        std::string proxy_url = EnvManager::get().get("PROXY_SERVICE_URL", "");
        if (proxy_url.empty()) {
            SessionManager::get().mark_proxy_unavailable("PROXY_SERVICE_URL is not configured.");
            return false;
        }

        HttpResponse response = execute_curl_request("GET", proxy_url + "/api/hello", "", {});
        update_proxy_status(proxy_url + "/api/hello", response.status_code);
        return response.status_code != 0;
    }

    std::string build_json_object(const std::map<std::string, std::string>& fields) {
        nlohmann::json j;
        for (const auto& [key, value] : fields) {
            j[key] = value;
        }
        return j.dump();
    }

    std::string url_encode(const std::string& str) {
        std::string result;
        result.reserve(str.size());
        for (unsigned char c : str) {
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~') {
                result += c;
            } else {
                char buf[4];
                snprintf(buf, sizeof(buf), "%%%02X", c);
                result += buf;
            }
        }
        return result;
    }

}
