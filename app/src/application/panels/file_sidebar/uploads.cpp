#include "file_sidebar_panel.h"

#include "core/file_picker/file_picker.h"
#include "panels/file_explorer/file_explorer_state.h"
#include "panels/notification/notification_state.h"
#include "panels/activity/upload_state.h"

#include <cstdio>

namespace fs = std::filesystem;

namespace misty::panel {
    void FileSidebarPanel::show_uploader_modal(FileSidebarState& state) {
        if (!state.show_uploader_modal) return;

        // Detect which cloud service has upload context
        UploadTarget target_service = UploadTarget::ONEDRIVE;
        bool has_context = false;

        auto& onedrive_state = registry_.get_state<OneDriveState>("OneDrive");
        auto& gdrive_state = registry_.get_state<GDriveState>("GDrive");
        auto& dropbox_state = registry_.get_state<DropboxState>("Dropbox");

        if (onedrive_state.has_upload_context()) {
            target_service = UploadTarget::ONEDRIVE;
            has_context = true;
        } else if (gdrive_state.has_upload_context()) {
            target_service = UploadTarget::GDRIVE;
            has_context = true;
        } else if (dropbox_state.has_upload_context()) {
            target_service = UploadTarget::DROPBOX;
            has_context = true;
        }

        if (!has_context) {
            state.show_uploader_modal = false;
            state.status_message = "Navigate to a cloud folder first.";
            return;
        }

        // Open file picker (this blocks until user selects files or cancels)
        core::FilePickerOptions options;
        options.title = "Select Files to Upload";
        core::FilePickerResult result = core::FilePicker::show_dialog(options);

        state.show_uploader_modal = false;

        if (result.has_selection()) {
            // Queue files for upload
            {
                std::lock_guard<std::mutex> lock(state.upload_mutex);
                state.upload_queue.clear();
                state.current_upload_index = 0;
                state.cancel_upload.store(false);

                for (const auto& path : result.paths) {
                    FileUploadProgress progress;
                    progress.file_path = path;
                    progress.file_name = fs::path(path).filename().string();
                    progress.target_service = target_service;

                    std::error_code ec;
                    progress.file_size = fs::file_size(path, ec);
                    if (ec) progress.file_size = 0;

                    progress.bytes_uploaded = 0;
                    progress.is_complete = false;
                    progress.has_error = false;

                    state.upload_queue.push_back(progress);
                }
            }

            if (!state.upload_queue.empty()) {
                state.is_uploading = true;
                start_next_upload(state);
            }
        }
    }

    void FileSidebarPanel::start_next_upload(FileSidebarState& state) {
        size_t index;
        std::string file_path;
        std::string file_name;
        int64_t file_size = 0;
        UploadTarget target_service;

        {
            std::lock_guard<std::mutex> lock(state.upload_mutex);
            if (state.current_upload_index >= state.upload_queue.size()) {
                state.is_uploading = false;
                return;
            }
            index = state.current_upload_index;
            file_path = state.upload_queue[index].file_path;
            file_name = state.upload_queue[index].file_name;
            file_size = static_cast<int64_t>(state.upload_queue[index].file_size);
            target_service = state.upload_queue[index].target_service;
        }

        std::string service_name = (target_service == UploadTarget::ONEDRIVE) ? "OneDrive" :
                                   (target_service == UploadTarget::GDRIVE) ? "Google Drive" : "Dropbox";

        // Register this upload in UploadState for activity tracking
        auto& upload_state = registry_.get_state<UploadState>("Uploads");
        uint64_t upload_id = upload_state.start_upload(file_name, file_path, service_name, file_size);

        // Progress callback - updates both the sidebar UI state and the activity UploadState
        auto progress_cb = [&state, &upload_state, index, upload_id](size_t bytes_uploaded, size_t total_bytes) -> bool {
            {
                std::lock_guard<std::mutex> lock(state.upload_mutex);
                if (index < state.upload_queue.size()) {
                    state.upload_queue[index].bytes_uploaded = bytes_uploaded;
                }
            }
            upload_state.update_progress(upload_id, static_cast<int64_t>(bytes_uploaded));
            return !state.cancel_upload.load();
        };

        // Completion callback
        auto completion_cb = [this, &state, &upload_state, index, upload_id](bool success, const std::string& error_msg) {
            {
                std::lock_guard<std::mutex> lock(state.upload_mutex);
                if (index < state.upload_queue.size()) {
                    state.upload_queue[index].is_complete = true;
                    state.upload_queue[index].has_error = !success;
                    state.upload_queue[index].error_message = error_msg;
                }
                state.current_upload_index++;
            }

            // Update activity UploadState
            if (success) {
                upload_state.complete_upload(upload_id);
            } else {
                upload_state.fail_upload(upload_id, error_msg);
            }

            // Start next upload or finish
            if (!state.cancel_upload.load()) {
                start_next_upload(state);
            } else {
                state.is_uploading = false;
            }
        };

        // Dispatch to the appropriate service
        if (target_service == UploadTarget::ONEDRIVE) {
            auto& onedrive_state = registry_.get_state<OneDriveState>("OneDrive");
            onedrive_state.set_worker_pool(worker_pool_);
            auto ctx = onedrive_state.get_upload_context();
            upload_state.set_onedrive_retry_context(upload_id, ctx.ms_user_id, ctx.drive_id, ctx.folder_id);
            onedrive_state.upload_file(file_path, ctx, progress_cb, completion_cb);
        } else if (target_service == UploadTarget::GDRIVE) {
            auto& gdrive_state = registry_.get_state<GDriveState>("GDrive");
            gdrive_state.set_worker_pool(worker_pool_);
            auto ctx = gdrive_state.get_upload_context();
            upload_state.set_gdrive_retry_context(upload_id, ctx.gd_user_id, ctx.folder_id);
            gdrive_state.upload_file(file_path, ctx, progress_cb, completion_cb);
        } else if (target_service == UploadTarget::DROPBOX) {
            auto& dropbox_state = registry_.get_state<DropboxState>("Dropbox");
            dropbox_state.set_worker_pool(worker_pool_);
            auto ctx = dropbox_state.get_upload_context();
            upload_state.set_dropbox_retry_context(upload_id, ctx.dbx_user_id, ctx.folder_path);
            dropbox_state.upload_file(file_path, ctx, progress_cb, completion_cb);
        }
    }

    void FileSidebarPanel::show_upload_progress_modal(FileSidebarState& state) {
        if (!state.is_uploading && state.upload_queue.empty()) return;

        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(
            ImVec2(vp->WorkPos.x + vp->WorkSize.x - 340, vp->WorkPos.y + vp->WorkSize.y - 200),
            ImGuiCond_Appearing);
        ImGui::SetNextWindowSize(ImVec2(320, 180), ImGuiCond_Appearing);

        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16, 16));

        ImGuiWindowFlags flags = ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoCollapse;

        bool show = true;
        if (ImGui::Begin("Upload Progress", &show, flags)) {
            std::lock_guard<std::mutex> lock(state.upload_mutex);

            size_t total = state.upload_queue.size();
            size_t completed = 0;
            for (const auto& item : state.upload_queue) {
                if (item.is_complete) completed++;
            }

            ImGui::Text("Uploading %zu of %zu files", completed + (state.is_uploading ? 1 : 0), total);
            ImGui::Separator();

            // Show current upload progress
            if (state.current_upload_index < state.upload_queue.size()) {
                const auto& current = state.upload_queue[state.current_upload_index];
                ImGui::Text("%s", current.file_name.c_str());

                float progress = current.file_size > 0
                    ? static_cast<float>(current.bytes_uploaded) / static_cast<float>(current.file_size)
                    : 0.0f;
                ImGui::ProgressBar(progress, ImVec2(-1, 0));

                if (current.has_error) {
                    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.3f, 0.3f, 1.0f));
                    ImGui::TextWrapped("Error: %s", current.error_message.c_str());
                    ImGui::PopStyleColor();
                }
            }

            ImGui::Spacing();

            // Cancel button
            if (state.is_uploading) {
                if (ImGui::Button("Cancel", ImVec2(-1, 0))) {
                    state.cancel_upload.store(true);
                }
            } else {
                if (ImGui::Button("Close", ImVec2(-1, 0))) {
                    state.upload_queue.clear();
                }
            }
        }
        ImGui::End();

        ImGui::PopStyleVar(2);

        if (!show) {
            state.cancel_upload.store(true);
            state.upload_queue.clear();
            state.is_uploading = false;
        }
    }


}
