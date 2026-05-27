#include "core/file_master/file_master_api.h"

#include <curl/curl.h>
#include <iostream>
#include <thread>

#include <nlohmann/json.hpp>

#include "core/manager/env_manager.h"
#include "core/manager/session_manager.h"
#include "core/net/http_client.h"

namespace misty::core {
namespace {

const FileMasterRemoteContext& source_context(const FileMasterProps& props) {
    return props.remote_source;
}

const FileMasterRemoteContext& dest_context(const FileMasterProps& props) {
    return props.remote_dest;
}

std::string proxy_url() {
    return EnvManager::get().get("PROXY_SERVICE_URL", "");
}

std::map<std::string, std::string> json_headers() {
    auto headers = SessionManager::get().get_auth_headers();
    headers["Accept"] = "application/json";
    headers["Content-Type"] = "application/json";
    return headers;
}

std::string remote_transfer_body(const FileMasterProps& props) {
    return build_json_object({
        {"source_remote", source_context(props).remote_name},
        {"source_path", source_context(props).remote_path},
        {"dest_remote", dest_context(props).remote_name},
        {"dest_path", dest_context(props).remote_path},
    });
}

size_t write_response(char* ptr, size_t size, size_t nmemb, void* userdata) {
    auto* out = static_cast<std::string*>(userdata);
    const size_t total = size * nmemb;
    out->append(ptr, total);
    return total;
}

HttpResponse proxy_config_error() {
    return HttpResponse{500, "PROXY_SERVICE_URL not set", {}};
}

RemoteJobStatus parse_remote_job_status(const std::string& body, std::string* error) {
    RemoteJobStatus status;
    try {
        const auto json = nlohmann::json::parse(body);
        status.job_id = json.value("job_id", std::string{});
        if (status.job_id.empty()) {
            status.job_id = json.value("id", std::string{});
        }
        status.operation = json.value("operation", std::string{});
        status.state = json.value("state", std::string{});
        status.phase = json.value("phase", std::string{});
        status.bytes_completed = json.value("bytes_completed", static_cast<int64_t>(0));
        status.bytes_total = json.value("bytes_total", static_cast<int64_t>(0));
        status.source_remote = json.value("source_remote", std::string{});
        status.source_path = json.value("source_path", std::string{});
        status.dest_remote = json.value("dest_remote", std::string{});
        status.dest_path = json.value("dest_path", std::string{});
        status.message = json.value("message", std::string{});
        status.result_ready = json.value("result_ready", false);
        status.result_kind = json.value("result_kind", std::string{});
    } catch (const std::exception& ex) {
        if (error) {
            *error = ex.what();
        }
    }
    return status;
}

std::string parse_job_id(const std::string& body, std::string* error) {
    try {
        const auto json = nlohmann::json::parse(body);
        return json.value("job_id", std::string{});
    } catch (const std::exception& ex) {
        if (error) {
            *error = ex.what();
        }
        return {};
    }
}

HttpResponse get_job_status_raw(const std::string& job_id) {
    const std::string proxy_service_url = proxy_url();
    if (proxy_service_url.empty()) return proxy_config_error();

    auto headers = SessionManager::get().get_auth_headers();
    headers["Accept"] = "application/json";
    return HTTPClient::get().get(
        proxy_service_url + "/api/remote/file/jobs/" + url_encode(job_id),
        {.headers = headers, .timeouts = {.connect_timeout_seconds = 10L, .total_timeout_seconds = 0L}});
}

HttpResponse stream_remote_job(const std::string& job_id, RemoteJobProgressCallback progress_callback) {
    const std::string proxy_service_url = proxy_url();
    if (proxy_service_url.empty()) return proxy_config_error();

    auto headers = SessionManager::get().get_auth_headers();
    headers["Accept"] = "text/event-stream";

    std::string current_event;
    std::optional<RemoteJobStatus> terminal_status;
    std::string parse_error;
    const HttpResponse response = HTTPClient::get().get_stream(
        proxy_service_url + "/api/remote/file/jobs/" + url_encode(job_id) + "/stream",
        [&](const std::string& line) {
            if (line.rfind("event:", 0) == 0) {
                current_event = line.substr(6);
                while (!current_event.empty() && current_event.front() == ' ') {
                    current_event.erase(current_event.begin());
                }
                return true;
            }
            if (line.rfind("data:", 0) == 0) {
                std::string payload = line.substr(5);
                while (!payload.empty() && payload.front() == ' ') {
                    payload.erase(payload.begin());
                }
                std::string line_error;
                RemoteJobStatus status = parse_remote_job_status(payload, &line_error);
                if (!line_error.empty()) {
                    parse_error = line_error;
                    return false;
                }
                if (progress_callback && !progress_callback(status)) {
                    return false;
                }
                if (status.state == "succeeded" || status.state == "failed" || status.state == "cancelled") {
                    terminal_status = std::move(status);
                }
            }
            return true;
        },
        {.headers = headers, .timeouts = {.connect_timeout_seconds = 10L, .total_timeout_seconds = 0L}});

    if (!parse_error.empty()) {
        return HttpResponse{500, "failed to parse remote SSE event: " + parse_error, {}};
    }
    if (response.status_code >= 200 && response.status_code < 300 && terminal_status.has_value()) {
        const RemoteJobStatus& status = *terminal_status;
        if (status.state == "succeeded") {
            return HttpResponse{200, response.body, response.headers};
        }
        const std::string message = status.message.empty() ? ("remote job " + status.state) : status.message;
        return HttpResponse{502, message, {}};
    }
    return response;
}

HttpResponse wait_for_remote_job(const std::string& job_id, RemoteJobProgressCallback progress_callback) {
    HttpResponse stream_response = stream_remote_job(job_id, progress_callback);
    if (stream_response.status_code >= 200 && stream_response.status_code < 300) {
        return stream_response;
    }
    if (stream_response.status_code != 0 && stream_response.status_code != 500) {
        return stream_response;
    }

    while (true) {
        HttpResponse response = get_job_status_raw(job_id);
        if (response.status_code < 200 || response.status_code >= 300) {
            return response;
        }

        std::string parse_error;
        RemoteJobStatus status = parse_remote_job_status(response.body, &parse_error);
        if (!parse_error.empty()) {
            return HttpResponse{500, "failed to parse remote job status: " + parse_error, {}};
        }
        if (progress_callback && !progress_callback(status)) {
            return HttpResponse{499, "remote job cancelled", {}};
        }
        if (status.state == "succeeded") {
            return response;
        }
        if (status.state == "failed" || status.state == "cancelled") {
            const std::string message = status.message.empty() ? ("remote job " + status.state) : status.message;
            return HttpResponse{502, message, {}};
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(150));
    }
}

HttpResponse fetch_list_result(const std::string& job_id) {
    const std::string proxy_service_url = proxy_url();
    if (proxy_service_url.empty()) return proxy_config_error();

    auto headers = SessionManager::get().get_auth_headers();
    headers["Accept"] = "application/json";
    return HTTPClient::get().get(
        proxy_service_url + "/api/remote/file/jobs/" + url_encode(job_id) + "/result/list",
        {.headers = headers, .timeouts = {.connect_timeout_seconds = 10L, .total_timeout_seconds = 0L}});
}

DownloadResult fetch_download_result(const std::string& job_id,
                                     const std::string& local_path) {
    const std::string proxy_service_url = proxy_url();
    if (proxy_service_url.empty()) {
        return DownloadResult{false, 500, "PROXY_SERVICE_URL not set"};
    }

    auto headers = SessionManager::get().get_auth_headers();
    headers["Accept"] = "application/octet-stream";
    return HTTPClient::get().download_to_file(
        proxy_service_url + "/api/remote/file/jobs/" + url_encode(job_id) + "/result/download",
        local_path,
        headers);
}

HttpResponse start_remote_json_job(const std::string& url,
                                   const std::string& body,
                                   RemoteJobProgressCallback progress_callback) {
    const HttpResponse start_response = HTTPClient::get().post(
        url,
        body,
        {.headers = json_headers(), .timeouts = {.connect_timeout_seconds = 10L, .total_timeout_seconds = 0L}});
    if (start_response.status_code < 200 || start_response.status_code >= 300) {
        return start_response;
    }

    std::string parse_error;
    const std::string job_id = parse_job_id(start_response.body, &parse_error);
    if (job_id.empty()) {
        return HttpResponse{500, "remote job start did not return job_id" + (parse_error.empty() ? "" : ": " + parse_error), {}};
    }
    return wait_for_remote_job(job_id, std::move(progress_callback));
}

}  // namespace

HttpResponse list_remote_call(const FileMasterProps& props, RemoteJobProgressCallback progress_callback) {
    const std::string proxy_service_url = proxy_url();
    if (proxy_service_url.empty()) return proxy_config_error();

    const FileMasterRemoteContext& context =
        !props.remote_source.empty() ? props.remote_source : props.remote_dest;

    auto headers = SessionManager::get().get_auth_headers();
    headers["Accept"] = "application/json";
    const HttpResponse start_response = HTTPClient::get().get(
        proxy_service_url + "/api/remote/file/list?remote=" + url_encode(context.remote_name) +
            "&path=" + url_encode(context.remote_path),
        {.headers = headers, .timeouts = {.connect_timeout_seconds = 10L, .total_timeout_seconds = 0L}});
    if (start_response.status_code < 200 || start_response.status_code >= 300) {
        return start_response;
    }

    std::string parse_error;
    const std::string job_id = parse_job_id(start_response.body, &parse_error);
    if (job_id.empty()) {
        return HttpResponse{500, "remote list start did not return job_id" + (parse_error.empty() ? "" : ": " + parse_error), {}};
    }

    const HttpResponse job_response = wait_for_remote_job(job_id, std::move(progress_callback));
    if (job_response.status_code < 200 || job_response.status_code >= 300) {
        return job_response;
    }
    return fetch_list_result(job_id);
}

HttpResponse remove_remote_call(const FileMasterProps& props, RemoteJobProgressCallback progress_callback) {
    const std::string proxy_service_url = proxy_url();
    if (proxy_service_url.empty()) return proxy_config_error();

    const auto& context = source_context(props);
    auto headers = SessionManager::get().get_auth_headers();
    headers["Accept"] = "application/json";
    const HttpResponse start_response = HTTPClient::get().del(
        proxy_service_url + "/api/remote/file?remote=" + url_encode(context.remote_name) +
            "&path=" + url_encode(context.remote_path),
        {.headers = headers, .timeouts = {.connect_timeout_seconds = 10L, .total_timeout_seconds = 0L}});
    if (start_response.status_code < 200 || start_response.status_code >= 300) {
        return start_response;
    }

    std::string parse_error;
    const std::string job_id = parse_job_id(start_response.body, &parse_error);
    if (job_id.empty()) {
        return HttpResponse{500, "remote remove start did not return job_id" + (parse_error.empty() ? "" : ": " + parse_error), {}};
    }
    return wait_for_remote_job(job_id, std::move(progress_callback));
}

HttpResponse rename_remote_call(const FileMasterProps& props, RemoteJobProgressCallback progress_callback) {
    const std::string proxy_service_url = proxy_url();
    if (proxy_service_url.empty()) return proxy_config_error();

    return start_remote_json_job(
        proxy_service_url + "/api/remote/file/rename",
        build_json_object({
            {"remote", source_context(props).remote_name},
            {"old_path", source_context(props).remote_path},
            {"new_path", dest_context(props).remote_path},
        }),
        std::move(progress_callback));
}

HttpResponse copy_remote_call(const FileMasterProps& props, RemoteJobProgressCallback progress_callback) {
    const std::string proxy_service_url = proxy_url();
    if (proxy_service_url.empty()) return proxy_config_error();

    std::cerr << "[FileMasterRemote] POST /api/remote/file/copy"
              << " source_remote=" << source_context(props).remote_name
              << " source_path=" << source_context(props).remote_path
              << " dest_remote=" << dest_context(props).remote_name
              << " dest_path=" << dest_context(props).remote_path
              << std::endl;
    const HttpResponse response = start_remote_json_job(
        proxy_service_url + "/api/remote/file/copy",
        remote_transfer_body(props),
        std::move(progress_callback));
    std::cerr << "[FileMasterRemote] remote copy terminal -> status="
              << response.status_code
              << " body=" << (response.body.empty() ? "<empty>" : response.body)
              << std::endl;
    return response;
}

HttpResponse move_remote_call(const FileMasterProps& props, RemoteJobProgressCallback progress_callback) {
    const std::string proxy_service_url = proxy_url();
    if (proxy_service_url.empty()) return proxy_config_error();

    std::cerr << "[FileMasterRemote] POST /api/remote/file/move"
              << " source_remote=" << source_context(props).remote_name
              << " source_path=" << source_context(props).remote_path
              << " dest_remote=" << dest_context(props).remote_name
              << " dest_path=" << dest_context(props).remote_path
              << std::endl;
    const HttpResponse response = start_remote_json_job(
        proxy_service_url + "/api/remote/file/move",
        remote_transfer_body(props),
        std::move(progress_callback));
    std::cerr << "[FileMasterRemote] remote move terminal -> status="
              << response.status_code
              << " body=" << (response.body.empty() ? "<empty>" : response.body)
              << std::endl;
    return response;
}

DownloadResult download_remote_call(const FileMasterProps& props,
                                    const std::string& local_path,
                                    RemoteJobProgressCallback progress_callback) {
    const std::string proxy_service_url = proxy_url();
    if (proxy_service_url.empty()) {
        return DownloadResult{false, 500, "PROXY_SERVICE_URL not set"};
    }

    const auto& context = source_context(props);
    auto headers = SessionManager::get().get_auth_headers();
    headers["Accept"] = "application/json";
    const HttpResponse start_response = HTTPClient::get().get(
        proxy_service_url + "/api/remote/file/download?remote=" + url_encode(context.remote_name) +
            "&path=" + url_encode(context.remote_path),
        {.headers = headers, .timeouts = {.connect_timeout_seconds = 10L, .total_timeout_seconds = 0L}});
    if (start_response.status_code < 200 || start_response.status_code >= 300) {
        return DownloadResult{false, start_response.status_code, start_response.body};
    }

    std::string parse_error;
    const std::string job_id = parse_job_id(start_response.body, &parse_error);
    if (job_id.empty()) {
        return DownloadResult{false, 500, "remote download start did not return job_id" + (parse_error.empty() ? "" : ": " + parse_error)};
    }
    const HttpResponse job_response = wait_for_remote_job(job_id, std::move(progress_callback));
    if (job_response.status_code < 200 || job_response.status_code >= 300) {
        return DownloadResult{false, job_response.status_code, job_response.body};
    }
    return fetch_download_result(job_id, local_path);
}

HttpResponse upload_remote_call(const FileMasterProps& props,
                                const std::string& local_path,
                                const std::string& remote_dir,
                                const std::string& file_name,
                                RemoteJobProgressCallback progress_callback) {
    const std::string proxy_service_url = proxy_url();
    if (proxy_service_url.empty()) return proxy_config_error();

    CURL* curl = curl_easy_init();
    if (!curl) {
        return HttpResponse{0, "Failed to initialize CURL", {}};
    }

    const std::string url = proxy_service_url + "/api/remote/file/upload";
    std::string response_body;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_response);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response_body);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 10L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 0L);

    struct curl_slist* headers = nullptr;
    SessionManager::get().ensure_session_ready();
    for (const auto& [key, value] : SessionManager::get().get_auth_headers()) {
        const std::string header = key + ": " + value;
        headers = curl_slist_append(headers, header.c_str());
    }
    if (headers) {
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    }

    curl_mime* mime = curl_mime_init(curl);
    curl_mimepart* part = curl_mime_addpart(mime);
    curl_mime_name(part, "remote");
    curl_mime_data(part, dest_context(props).remote_name.c_str(), CURL_ZERO_TERMINATED);

    part = curl_mime_addpart(mime);
    curl_mime_name(part, "path");
    curl_mime_data(part, remote_dir.c_str(), CURL_ZERO_TERMINATED);

    part = curl_mime_addpart(mime);
    curl_mime_name(part, "file");
    curl_mime_filedata(part, local_path.c_str());
    curl_mime_filename(part, file_name.c_str());
    curl_easy_setopt(curl, CURLOPT_MIMEPOST, mime);

    CURLcode result = curl_easy_perform(curl);
    long status = 0;
    if (result == CURLE_OK) {
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
    } else {
        response_body = curl_easy_strerror(result);
    }

    curl_mime_free(mime);
    if (headers) {
        curl_slist_free_all(headers);
    }
    curl_easy_cleanup(curl);

    if (status < 200 || status >= 300) {
        return HttpResponse{static_cast<int>(status), response_body, {}};
    }
    std::string parse_error;
    const std::string job_id = parse_job_id(response_body, &parse_error);
    if (job_id.empty()) {
        return HttpResponse{500, "remote upload start did not return job_id" + (parse_error.empty() ? "" : ": " + parse_error), {}};
    }
    return wait_for_remote_job(job_id, std::move(progress_callback));
}

HttpResponse mkdir_remote_call(const std::string& remote_name,
                               const std::string& remote_path,
                               RemoteJobProgressCallback progress_callback) {
    const std::string proxy_service_url = proxy_url();
    if (proxy_service_url.empty()) return proxy_config_error();

    return start_remote_json_job(
        proxy_service_url + "/api/remote/file/mkdir",
        build_json_object({
            {"remote", remote_name},
            {"path", remote_path},
        }),
        std::move(progress_callback));
}

} // namespace misty::core
