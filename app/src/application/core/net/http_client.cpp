#include <curl/curl.h>
#include <nlohmann/json.hpp>
#include <sstream>
#include <iostream>
#include <fstream>
#include <vector>
#include <cstring>

#include "core/net/http_client.h"
#include "core/manager/session_manager.h"
#include "core/manager/env_manager.h"
#include "core/system/util.h"

namespace misty::core {

    struct CurlData {
        std::string response_body;
        std::map<std::string, std::string> response_headers;
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

    HTTPClient& HTTPClient::get() {
        static HTTPClient instance;
        return instance;
    }

    HttpResponse HTTPClient::get(const std::string& url, const std::map<std::string, std::string>& headers) {
        return perform_request("GET", url, "", headers);
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
    static HttpResponse execute_curl_request(const std::string& method, const std::string& url, const std::string& body, const std::map<std::string, std::string>& headers) {
        HttpResponse response;
        response.status_code = 0;
        response.body = "";

        CURL* curl = curl_easy_init();
        if (!curl) {
            std::cerr << "Failed to initialize CURL" << std::endl;
            return response;
        }
        std::string ca_cert = EnvManager::get().get("SSL_CERT_PATH", "");
        if (!ca_cert.empty()) {
            curl_easy_setopt(curl, CURLOPT_CAINFO, ca_cert.c_str());
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
        } else if (method == "PUT") {
            curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "PUT");
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
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
        curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 10L);  // 10 seconds to connect
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);          // 30 seconds total

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

    bool HTTPClient::attempt_token_refresh() {
        std::string refresh_token = SessionManager::get().get_refresh_token();
        if (refresh_token.empty()) {
            return false;
        }

        std::string proxy_url = EnvManager::get().get("PROXY_SERVICE_URL", "");
        if (proxy_url.empty()) {
            return false;
        }

        std::map<std::string, std::string> json_fields;
        json_fields["refresh_token"] = refresh_token;
        std::string json_body = build_json_object(json_fields);

        std::map<std::string, std::string> headers;
        headers["Content-Type"] = "application/json";

        auto response = execute_curl_request("POST", proxy_url + "/api/refresh", json_body, headers);

        if (response.status_code == 200) {
            try {
                auto json_resp = nlohmann::json::parse(response.body);
                std::string new_token = json_resp["token"].get<std::string>();
                std::string new_refresh = json_resp["refresh_token"].get<std::string>();
                SessionManager::get().update_tokens(new_token, new_refresh);
                std::cerr << "[HTTPClient] Token refresh succeeded" << std::endl;
                return true;
            } catch (...) {
                std::cerr << "[HTTPClient] Failed to parse refresh response" << std::endl;
            }
        } else {
            std::cerr << "[HTTPClient] Token refresh failed with status " << response.status_code << std::endl;
        }

        return false;
    }

    HttpResponse HTTPClient::perform_request(const std::string& method, const std::string& url, const std::string& body, const std::map<std::string, std::string>& headers) {
        // Merge auth headers (caller-provided headers take priority)
        auto merged_headers = SessionManager::get().get_auth_headers();
        for (const auto& [key, value] : headers) {
            merged_headers[key] = value;
        }

        HttpResponse response = execute_curl_request(method, url, body, merged_headers);

        // Auto-refresh on 401 if we're not already in a refresh call
        // Guard: skip if session already expired or another thread is refreshing
        if (response.status_code == 401 &&
            !SessionManager::get().is_session_expired() &&
            !is_refreshing_.exchange(true)) {
            if (attempt_token_refresh()) {
                // Retry with new auth headers
                auto retry_headers = SessionManager::get().get_auth_headers();
                for (const auto& [key, value] : headers) {
                    retry_headers[key] = value;
                }
                response = execute_curl_request(method, url, body, retry_headers);
            } else {
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
