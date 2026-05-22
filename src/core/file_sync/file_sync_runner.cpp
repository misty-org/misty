#include "core/file_sync/file_sync_runner.h"

#include <curl/curl.h>

#include <cctype>
#include <filesystem>
#include <iostream>
#include <nlohmann/json.hpp>
#include <string>
#include <utility>
#include <vector>

#include "core/manager/env_manager.h"
#include "core/manager/session_manager.h"
#include "core/net/http_client.h"
#include "core/system/util.h"

namespace fs = std::filesystem;

namespace misty::core {
namespace {

std::string normalize_path(const std::string& path) {
    return path_utf8_generic_string(fs::path(path).lexically_normal());
}

std::string trim_trailing_slash(std::string path) {
    while (path.size() > 1 && path.back() == '/') {
        path.pop_back();
    }
    return path;
}

std::string relative_to_root(const std::string& root, const std::string& path) {
    fs::path rel = fs::path(path).lexically_relative(fs::path(root));
    if (rel.empty() || rel == ".") {
        return "";
    }
    return path_utf8_generic_string(rel);
}

std::string parent_path_for_remote(const std::string& rel_path) {
    return path_utf8_generic_string(fs::path(rel_path).parent_path());
}

std::string filename_for_remote(const std::string& rel_path) {
    return path_utf8_filename(fs::path(rel_path));
}

std::string response_error(const HttpResponse& response, const std::string& fallback) {
    if (!response.body.empty()) {
        return response.body;
    }
    if (response.status_code > 0) {
        return fallback + " (HTTP " + std::to_string(response.status_code) + ")";
    }
    return fallback;
}

bool response_ok(const HttpResponse& response) {
    return response.status_code >= 200 && response.status_code < 300;
}

bool response_not_found(const HttpResponse& response) {
    if (response.status_code == 404) {
        return true;
    }

    std::string body = response.body;
    for (char& c : body) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    return body.find("not found") != std::string::npos ||
           body.find("does not exist") != std::string::npos ||
           body.find("no such file") != std::string::npos;
}

HttpRequestOptions short_file_op_options() {
    HttpRequestOptions options;
    options.headers["Accept"] = "application/json";
    options.timeouts.connect_timeout_seconds = 3L;
    options.timeouts.total_timeout_seconds = 10L;
    return options;
}

size_t write_response(char* ptr, size_t size, size_t nmemb, void* userdata) {
    auto* out = static_cast<std::string*>(userdata);
    const size_t total = size * nmemb;
    out->append(ptr, total);
    return total;
}

HttpResponse upload_multipart(const std::string& url,
                              const std::string& local_path,
                              const std::string& remote,
                              const std::string& remote_dir) {
    HttpResponse response;
    response.status_code = 0;

    CURL* curl = curl_easy_init();
    if (!curl) {
        response.body = "Failed to initialize CURL";
        return response;
    }

    std::string response_body;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_response);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response_body);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 10L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 0L);

    struct curl_slist* headers = nullptr;
    SessionManager::get().ensure_session_ready();
    auto auth_headers = SessionManager::get().get_auth_headers();
    for (const auto& [key, value] : auth_headers) {
        const std::string header = key + ": " + value;
        headers = curl_slist_append(headers, header.c_str());
    }
    if (headers) {
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    }

    curl_mime* mime = curl_mime_init(curl);
    curl_mimepart* part = curl_mime_addpart(mime);
    curl_mime_name(part, "remote");
    curl_mime_data(part, remote.c_str(), CURL_ZERO_TERMINATED);

    part = curl_mime_addpart(mime);
    curl_mime_name(part, "path");
    curl_mime_data(part, remote_dir.c_str(), CURL_ZERO_TERMINATED);

    part = curl_mime_addpart(mime);
    curl_mime_name(part, "file");
    curl_mime_filedata(part, local_path.c_str());
    curl_easy_setopt(curl, CURLOPT_MIMEPOST, mime);

    CURLcode result = curl_easy_perform(curl);
    if (result == CURLE_OK) {
        long status = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
        response.status_code = static_cast<int>(status);
        response.body = response_body;
    } else {
        response.body = curl_easy_strerror(result);
    }

    curl_mime_free(mime);
    if (headers) {
        curl_slist_free_all(headers);
    }
    curl_easy_cleanup(curl);
    return response;
}

} // namespace

FileSyncRunner::FileSyncRunner(std::string mount_root, FileSyncGate& gate)
    : gate_(gate),
      mount_root_(trim_trailing_slash(normalize_path(std::move(mount_root)))) {}

FileSyncRunner::~FileSyncRunner() {
    stop();
}

void FileSyncRunner::start() {
    if (running_.exchange(true)) {
        return;
    }
    worker_thread_ = std::thread(&FileSyncRunner::run_loop, this);
}

void FileSyncRunner::stop() {
    if (!running_.exchange(false)) {
        return;
    }
    cv_.notify_all();
    if (worker_thread_.joinable()) {
        worker_thread_.join();
    }
}

void FileSyncRunner::enqueue(FileSyncFinalEvent event) {
    if (!running_.load()) {
        return;
    }
    {
        std::lock_guard<std::mutex> lock(mu_);
        queue_.push(std::move(event));
    }
    cv_.notify_all();
}

void FileSyncRunner::run_loop() {
    while (running_.load()) {
        std::queue<FileSyncFinalEvent> ready_events;

        {
            std::unique_lock<std::mutex> lock(mu_);
            cv_.wait(lock, [this] {
                return !running_.load() || !queue_.empty();
            });
            if (!running_.load()) {
                break;
            }
            ready_events.swap(queue_);
        }

        while (running_.load() && !ready_events.empty()) {
            FileSyncFinalEvent event = std::move(ready_events.front());
            ready_events.pop();
            run_event(event);
        }
    }
}

bool FileSyncRunner::run_event(const FileSyncFinalEvent& event) {
    if (event.result.action == FileSyncAction::Noop) {
        return false;
    }

    if (event.result.conflict == FileSyncConflict::LocalTmp && !run_local_tmp(event)) {
        return false;
    }
    if (event.result.conflict == FileSyncConflict::RemoteTmp) {
        std::cout << "[FileSyncRunner] remote preview pending path="
                  << event.pending_event.new_path << std::endl;
    }

    if (event.result.action == FileSyncAction::Conflict) {
        gate_.record(event);
        return false;
    }

    auto remote_path = map_path(event.pending_event.new_path);
    if (!remote_path) {
        std::cout << "[FileSyncRunner] skipped unmapped path=" << event.pending_event.new_path << std::endl;
        return false;
    }

    try {
        bool success = false;
        switch (event.result.action) {
            case FileSyncAction::UploadLocal:
                success = event.change == FileSyncChange::LocalFolder
                    ? run_create_folder(event, *remote_path)
                    : run_upload(event, *remote_path);
                break;
            case FileSyncAction::DeleteRemote:
                success = run_delete(event, *remote_path);
                break;
            case FileSyncAction::RenameRemote: {
                auto old_remote_path = map_path(event.pending_event.old_path);
                if (!old_remote_path || old_remote_path->remote_name != remote_path->remote_name) {
                    std::cout << "[FileSyncRunner] skipped cross-root rename old_path="
                              << event.pending_event.old_path
                              << " new_path=" << event.pending_event.new_path << std::endl;
                    return false;
                }
                success = run_rename(event, *old_remote_path, *remote_path);
                break;
            }
            case FileSyncAction::DownloadRemote:
            case FileSyncAction::DeleteLocal:
            case FileSyncAction::RenameLocal:
                std::cout << "[FileSyncRunner] local apply action pending path="
                          << event.pending_event.new_path << std::endl;
                return false;
            case FileSyncAction::Conflict:
            case FileSyncAction::Noop:
                break;
        }
        if (success) {
            gate_.record(event);
        }
        return success;
    } catch (const std::exception& e) {
        std::cout << "[FileSyncRunner] operation failed path=" << event.pending_event.new_path
                  << " error=" << e.what() << std::endl;
        return false;
    }
}

bool FileSyncRunner::run_local_tmp(const FileSyncFinalEvent& event) {
    const fs::path source(event.pending_event.new_path);
    if (source.empty() || !fs::exists(source) || fs::is_directory(source)) {
        return true;
    }

    const fs::path preview(source.string() + ".loc.tmp");
    std::error_code ec;
    fs::copy_file(source, preview, fs::copy_options::overwrite_existing, ec);
    if (ec) {
        std::cout << "[FileSyncRunner] local preview failed path=" << source
                  << " preview=" << preview
                  << " error=" << ec.message() << std::endl;
        return false;
    }
    std::cout << "[FileSyncRunner] local preview path=" << preview << std::endl;
    return true;
}

bool FileSyncRunner::run_upload(const FileSyncFinalEvent& event, const RemotePath& remote_path) {
    const std::string url = proxy_url("/api/remote/file/upload");
    if (url.empty()) {
        std::cout << "[FileSyncRunner] upload skipped: PROXY_SERVICE_URL not set" << std::endl;
        return false;
    }

    const std::string remote_dir = parent_path_for_remote(remote_path.rel_path);
    HttpResponse response = upload_multipart(url, event.pending_event.new_path, remote_path.remote_name, remote_dir);
    if (!response_ok(response)) {
        std::cout << "[FileSyncRunner] upload failed remote=" << remote_path.remote_name
                  << " path=" << remote_path.rel_path
                  << " error=" << response_error(response, "upload failed") << std::endl;
        return false;
    }
    std::cout << "[FileSyncRunner] uploaded remote=" << remote_path.remote_name
              << " path=" << remote_path.rel_path << std::endl;
    return true;
}

bool FileSyncRunner::run_create_folder(const FileSyncFinalEvent&, const RemotePath& remote_path) {
    if (remote_path.rel_path.empty()) {
        std::cout << "[FileSyncRunner] create folder skipped for remote root remote="
                  << remote_path.remote_name << std::endl;
        return false;
    }

    const std::string url = proxy_url("/api/remote/file/mkdir");
    if (url.empty()) {
        std::cout << "[FileSyncRunner] create folder skipped: PROXY_SERVICE_URL not set" << std::endl;
        return false;
    }

    nlohmann::json body;
    body["remote"] = remote_path.remote_name;
    body["path"] = remote_path.rel_path;

    HttpRequestOptions options;
    options.headers["Content-Type"] = "application/json";
    options.headers["Accept"] = "application/json";
    options.timeouts.connect_timeout_seconds = 3L;
    options.timeouts.total_timeout_seconds = 10L;

    HttpResponse response = HTTPClient::get().post(url, body.dump(), options);
    if (!response_ok(response)) {
        std::cout << "[FileSyncRunner] create folder failed remote=" << remote_path.remote_name
                  << " path=" << remote_path.rel_path
                  << " error=" << response_error(response, "create folder failed") << std::endl;
        return false;
    }

    std::cout << "[FileSyncRunner] created folder remote=" << remote_path.remote_name
              << " path=" << remote_path.rel_path << std::endl;
    return true;
}

bool FileSyncRunner::run_delete(const FileSyncFinalEvent&, const RemotePath& remote_path) {
    std::cout << "[FileSyncRunner] deleting remote=" << remote_path.remote_name
              << " path=" << remote_path.rel_path << std::endl;

    const auto exists = remote_path_exists(remote_path);
    if (exists && !*exists) {
        std::cout << "[FileSyncRunner] delete no-op remote missing remote=" << remote_path.remote_name
                  << " path=" << remote_path.rel_path << std::endl;
        return true;
    }
    if (!exists) {
        std::cout << "[FileSyncRunner] delete existence unknown; attempting remote delete remote="
                  << remote_path.remote_name << " path=" << remote_path.rel_path << std::endl;
    }

    const std::string url = proxy_url("/api/remote/file?remote=" + url_encode(remote_path.remote_name) +
                                      "&path=" + url_encode(remote_path.rel_path));
    if (url.empty()) {
        std::cout << "[FileSyncRunner] delete skipped: PROXY_SERVICE_URL not set" << std::endl;
        return false;
    }

    HttpResponse response = HTTPClient::get().del(url, short_file_op_options());
    if (!response_ok(response)) {
        if (response_not_found(response)) {
            std::cout << "[FileSyncRunner] delete no-op remote missing remote=" << remote_path.remote_name
                      << " path=" << remote_path.rel_path << std::endl;
            return true;
        }
        std::cout << "[FileSyncRunner] delete failed remote=" << remote_path.remote_name
                  << " path=" << remote_path.rel_path
                  << " error=" << response_error(response, "delete failed") << std::endl;
        return false;
    }
    std::cout << "[FileSyncRunner] deleted remote=" << remote_path.remote_name
              << " path=" << remote_path.rel_path << std::endl;
    return true;
}

bool FileSyncRunner::run_rename(const FileSyncFinalEvent&,
                                const RemotePath& old_remote_path,
                                const RemotePath& new_remote_path) {
    const std::string url = proxy_url("/api/remote/file/rename");
    if (url.empty()) {
        std::cout << "[FileSyncRunner] rename skipped: PROXY_SERVICE_URL not set" << std::endl;
        return false;
    }

    nlohmann::json body;
    body["remote"] = new_remote_path.remote_name;
    body["old_path"] = old_remote_path.rel_path;
    body["new_path"] = new_remote_path.rel_path;

    HttpRequestOptions options;
    options.headers["Content-Type"] = "application/json";
    options.headers["Accept"] = "application/json";
    HttpResponse response = HTTPClient::get().post(url, body.dump(), options);
    if (!response_ok(response)) {
        std::cout << "[FileSyncRunner] rename failed remote=" << new_remote_path.remote_name
                  << " old_path=" << old_remote_path.rel_path
                  << " new_path=" << new_remote_path.rel_path
                  << " error=" << response_error(response, "rename failed") << std::endl;
        return false;
    }
    std::cout << "[FileSyncRunner] renamed remote=" << new_remote_path.remote_name
              << " old_path=" << old_remote_path.rel_path
              << " new_path=" << new_remote_path.rel_path << std::endl;
    return true;
}

std::optional<FileSyncRunner::RemotePath> FileSyncRunner::map_path(const std::string& absolute_path) const {
    const std::string normalized_path = normalize_path(absolute_path);
    const std::string normalized_root = trim_trailing_slash(mount_root_);
    if (normalized_path != normalized_root &&
        normalized_path.rfind(normalized_root + "/", 0) != 0) {
        return std::nullopt;
    }

    const std::string relative_mount_path = relative_to_root(normalized_root, normalized_path);
    const std::vector<std::string> parts = split_path(relative_mount_path);
    if (parts.size() < 2) {
        return std::nullopt;
    }

    const std::string provider_folder = parts[0];
    const std::string remote_name = parts[1];
    if (provider_folder.empty() || remote_name.empty()) {
        return std::nullopt;
    }

    const std::string remote_root =
        trim_trailing_slash(normalize_path((fs::path(normalized_root) / provider_folder / remote_name).string()));
    return RemotePath{
        remote_name,
        relative_to_root(remote_root, normalized_path),
    };
}

std::optional<bool> FileSyncRunner::remote_path_exists(const RemotePath& remote_path) const {
    if (remote_path.rel_path.empty()) {
        return false;
    }

    const std::string parent_path = parent_path_for_remote(remote_path.rel_path);
    const std::string name = filename_for_remote(remote_path.rel_path);
    if (name.empty()) {
        return false;
    }

    const std::string url = proxy_url("/api/remote/file/list?remote=" + url_encode(remote_path.remote_name) +
                                      "&path=" + url_encode(parent_path));
    if (url.empty()) {
        return std::nullopt;
    }

    HttpRequestOptions options = short_file_op_options();
    HttpResponse response = HTTPClient::get().get(url, options);
    if (!response_ok(response)) {
        std::cout << "[FileSyncRunner] remote exists check failed remote=" << remote_path.remote_name
                  << " path=" << remote_path.rel_path
                  << " error=" << response_error(response, "list failed") << std::endl;
        return std::nullopt;
    }

    const auto parsed = nlohmann::json::parse(response.body, nullptr, false);
    if (!parsed.is_array()) {
        return std::nullopt;
    }

    for (const auto& item : parsed) {
        const std::string item_name = item.value("name", std::string{});
        const std::string item_path = item.value("path", std::string{});
        if (item_name == name || item_path == remote_path.rel_path) {
            return true;
        }
    }
    return false;
}

std::string FileSyncRunner::proxy_url(const std::string& path) const {
    const std::string base = EnvManager::get().get("PROXY_SERVICE_URL", "");
    if (base.empty()) {
        return "";
    }
    return base + path;
}

} // namespace misty::core
