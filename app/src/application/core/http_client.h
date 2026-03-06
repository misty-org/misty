#pragma once

#include <string>
#include <map>
#include <functional>
#include <atomic>

namespace misty::core {
    struct HttpResponse {
        int status_code;
        std::string body;
        std::map<std::string, std::string> headers;
    };

    using UploadProgressCallback = std::function<bool(size_t bytes_uploaded, size_t total_bytes)>;

    struct UploadResult {
        bool success = false;
        int final_status_code = 0;
        std::string error_message;
        std::string response_body;  // Final response from server (contains file metadata on success)
    };

  

    class HTTPClient {
    public:
        static HTTPClient& get();

        HttpResponse get(const std::string& url, const std::map<std::string, std::string>& headers = {});
        HttpResponse post(const std::string& url, const std::string& body, const std::map<std::string, std::string>& headers = {});
        HttpResponse put(const std::string& url, const std::string& body, const std::map<std::string, std::string>& headers = {});
        HttpResponse del(const std::string& url, const std::map<std::string, std::string>& headers = {});

        UploadResult chunked_upload (
            const std::string& upload_url,
            const std::string& file_path,
            size_t chunk_size = 10 * 1024 * 1024,  // 10MB default
            size_t chunk_alignment = 0,             // 0 = no alignment (e.g. 320*1024 for OneDrive, 256*1024 for GDrive)
            UploadProgressCallback progress_cb = nullptr,
            std::atomic<bool>* cancel_flag = nullptr
        );

    private:
        HTTPClient() = default;
        ~HTTPClient() = default;
        HTTPClient(const HTTPClient&) = delete;
        HTTPClient& operator=(const HTTPClient&) = delete;

        HttpResponse perform_request(const std::string& method, const std::string& url, const std::string& body = "", const std::map<std::string, std::string>& headers = {});
        bool attempt_token_refresh();

        std::atomic<bool> is_refreshing_{false};
    };

    std::string build_json_object(const std::map<std::string, std::string>& fields);
    std::string url_encode(const std::string& str);

}
