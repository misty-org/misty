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
    using DownloadProgressCallback = std::function<bool(size_t bytes_downloaded, size_t total_bytes)>;

    struct UploadResult {
        bool success = false;
        int final_status_code = 0;
        std::string error_message;
        std::string response_body;  // Final response from server (contains file metadata on success)
    };

    struct DownloadResult {
        bool success = false;
        int final_status_code = 0;
        std::string error_message;
    };

    using StreamLineCallback = std::function<bool(const std::string& line)>;

    struct HttpTimeoutOptions {
        long connect_timeout_seconds = 10L;
        long total_timeout_seconds = 30L;
    };

    struct HttpRequestOptions {
        std::map<std::string, std::string> headers;
        HttpTimeoutOptions timeouts;
    };

    HttpResponse execute_raw_http_request(const std::string& method,
                                          const std::string& url,
                                          const std::string& body = "",
                                          const HttpRequestOptions& options = {});

    class HTTPClient {
    public:
        static HTTPClient& get();

        HttpResponse get(const std::string& url,
                         const HttpRequestOptions& options = {});
        HttpResponse get_stream(const std::string& url,
                                StreamLineCallback line_callback,
                                const HttpRequestOptions& options = {});
        HttpResponse post(const std::string& url,
                          const std::string& body,
                          const HttpRequestOptions& options = {});
        HttpResponse put(const std::string& url,
                         const std::string& body,
                         const HttpRequestOptions& options = {});
        HttpResponse del(const std::string& url,
                         const HttpRequestOptions& options = {});

        UploadResult chunked_upload (
            const std::string& upload_url,
            const std::string& file_path,
            size_t chunk_size = 10 * 1024 * 1024,  // 10MB default
            size_t chunk_alignment = 0,             // 0 = no alignment (e.g. 320*1024 for OneDrive, 256*1024 for GDrive)
            UploadProgressCallback progress_cb = nullptr,
            std::atomic<bool>* cancel_flag = nullptr
        );

        DownloadResult download_to_file(
            const std::string& url,
            const std::string& local_path,
            const std::map<std::string, std::string>& headers = {},
            DownloadProgressCallback progress_cb = nullptr
        );

        bool probe_proxy();

    private:
        HTTPClient() = default;
        ~HTTPClient() = default;
        HTTPClient(const HTTPClient&) = delete;
        HTTPClient& operator=(const HTTPClient&) = delete;

        HttpResponse perform_request(const std::string& method,
                                    const std::string& url,
                                    const std::string& body,
                                    const HttpRequestOptions& options);
        bool is_proxy_url(const std::string& url) const;
        void update_proxy_status(const std::string& url, int status_code);

    };

    std::string build_json_object(const std::map<std::string, std::string>& fields);
    std::string url_encode(const std::string& str);

}
