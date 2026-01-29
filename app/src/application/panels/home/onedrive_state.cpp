#include "onedrive_state.h"
#include "panels/services/services_state.h"
#include "core/env_manager.h"
#include "core/http_client.h"
#include <nlohmann/json.hpp>
#include <thread>
#include <filesystem>
#include <iostream>

namespace minidfs::panel {

    void OneDriveState::upload_file(
        ServicesState& services,
        const std::string& local_path,
        core::UploadProgressCallback progress_cb,
        UploadCallback callback
    ) {
        // Get upload context (thread-safe copy)
        UploadContext ctx = get_upload_context();

        if (ctx.drive_id.empty() || ctx.folder_id.empty() || ctx.ms_user_id.empty()) {
            callback(false, "No OneDrive folder context. Navigate to a OneDrive folder first.");
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

        // Get token BEFORE starting the thread to avoid dangling reference
        std::string token = services.get_token_for_user(ctx.ms_user_id);
        if (token.empty()) {
            callback(false, "No valid token for OneDrive account. Please reconnect.");
            return;
        }

        // Capture a pointer to services for potential token refresh
        ServicesState* services_ptr = &services;

        // Run upload in background thread
        std::thread([this, services_ptr, ctx, local_path, file_name, file_size, token, progress_cb, callback]() {

            std::string base_url = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
            if (base_url.empty()) {
                callback(false, "PROXY_SERVICE_URL not configured");
                return;
            }

            // Step 1: Create upload session via proxy
            std::string upload_session_url = base_url + "/api/ms/file/upload";

            nlohmann::json request_body;
            request_body["drive_id"] = ctx.drive_id;
            request_body["parent_id"] = ctx.folder_id;
            request_body["file_name"] = file_name;
            request_body["file_size"] = file_size;

            std::string current_token = token;

            std::map<std::string, std::string> headers;
            headers["Authorization"] = "Bearer " + current_token;
            headers["Content-Type"] = "application/json";

            core::HttpResponse session_response = core::HttpClient::get().post(
                upload_session_url,
                request_body.dump(),
                headers
            );

            // Handle 401 - try to refresh token
            if (session_response.status_code == 401 && services_ptr) {
                std::string new_token = services_ptr->refresh_ms_token(ctx.ms_user_id);
                if (!new_token.empty()) {
                    current_token = new_token;
                    headers["Authorization"] = "Bearer " + current_token;
                    session_response = core::HttpClient::get().post(
                        upload_session_url,
                        request_body.dump(),
                        headers
                    );
                }
            }

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

            std::cout << "[OneDriveState] Got upload URL, starting chunked upload for: " << file_name << std::endl;

            // Step 2: Upload file using chunked upload
            // Note: The uploadUrl from Microsoft doesn't need Authorization header
            core::ChunkedUploadResult result = core::HttpClient::get().chunked_upload(
                upload_url,
                local_path,
                10 * 1024 * 1024,  // 10MB chunks
                progress_cb,
                nullptr  // TODO: Pass cancel flag from state
            );

            if (result.success) {
                std::cout << "[OneDriveState] Upload complete: " << file_name << std::endl;
                callback(true, "");
            } else {
                std::cout << "[OneDriveState] Upload failed: " << result.error_message << std::endl;
                callback(false, result.error_message);
            }
        }).detach();
    }

}
