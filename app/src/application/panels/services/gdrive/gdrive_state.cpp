#include "gdrive_state.h"
#include "core/env_manager.h"
#include "core/http_client.h"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <iostream>

namespace misty::panel {

    void GDriveState::upload_file(
        const std::string& local_path,
        core::UploadProgressCallback progress_cb,
        GDUploadCallback callback
    ) {
        // Get upload context (thread-safe copy)
        UploadContext ctx = get_upload_context();

        if (ctx.folder_id.empty() || ctx.gd_user_id.empty()) {
            callback(false, "No Google Drive folder context. Navigate to a Google Drive folder first.");
            return;
        }

        // Get file info
        std::error_code ec;
        if (!std::filesystem::exists(local_path, ec)) {
            callback(false, "File not found: " + local_path);
            return;
        }

        int64_t file_size = std::filesystem::file_size(local_path, ec);
        if (ec) {
            callback(false, "Failed to get file size: " + ec.message());
            return;
        }

        std::string file_name = std::filesystem::path(local_path).filename().string();

        if (!worker_pool_) {
            callback(false, "WorkerPool not set");
            return;
        }

        worker_pool_->add(
            [this, ctx, local_path, file_name, file_size, progress_cb, callback]() {

                std::string base_url = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base_url.empty()) {
                    callback(false, "PROXY_SERVICE_URL not configured");
                    return;
                }
                std::string user_id = core::EnvManager::get().get("USER_ID", "");
                if (user_id.empty()) {
                    callback(false, "USER_ID not configured");
                    return;
                }

                // Step 1: Create upload session via proxy
                std::string upload_session_url = base_url + "/api/gd/file/upload?user_id=" + user_id
                    + "&gd_user_id=" + ctx.gd_user_id;

                nlohmann::json request_body;
                request_body["parent_id"] = ctx.folder_id;
                request_body["file_name"] = file_name;
                request_body["file_size"] = file_size;

                std::map<std::string, std::string> headers;
                headers["Content-Type"] = "application/json";

                core::HttpResponse session_response = core::HTTPClient::get().post(
                    upload_session_url,
                    request_body.dump(),
                    headers
                );

                if (session_response.status_code < 200 || session_response.status_code >= 300) {
                    callback(false, "Failed to create upload session: HTTP " + std::to_string(session_response.status_code));
                    return;
                }

                // Parse upload session response
                std::string upload_url;
                try {
                    auto json = nlohmann::json::parse(session_response.body);
                    upload_url = json.value("uploadUrl", std::string(""));
                    if (upload_url.empty()) {
                        callback(false, "No uploadUrl in session response");
                        return;
                    }
                } catch (const std::exception& e) {
                    callback(false, std::string("Failed to parse upload session: ") + e.what());
                    return;
                }

                std::cout << "[GDriveState] Got upload URL, starting chunked upload for: " << file_name << std::endl;

                // Step 2: Upload file using chunked upload
                core::UploadResult result = core::HTTPClient::get().chunked_upload(
                    upload_url,
                    local_path,
                    10 * 1024 * 1024,  // 10MB chunks
                    256 * 1024,        // Google Drive requires 256KB alignment
                    progress_cb,
                    nullptr
                );

                if (result.success) {
                    std::cout << "[GDriveState] Upload complete: " << file_name << std::endl;
                    callback(true, "");
                } else {
                    std::cout << "[GDriveState] Upload failed: " << result.error_message << std::endl;
                    callback(false, result.error_message);
                }
            },
            []() {},
            [callback](const std::string& err) {
                callback(false, err);
            }
        );
    }

}
