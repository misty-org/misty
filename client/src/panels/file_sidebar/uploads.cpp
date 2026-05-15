#include "file_sidebar_panel.h"

#include "core/file_master/file_master_transfers.h"
#include "core/file_picker/file_picker.h"
#include "panels/file_explorer/file_explorer_state.h"
#include "panels/notification/notification_state.h"

#include <cstdio>
#include <system_error>

namespace fs = std::filesystem;

namespace misty::panel {
    namespace {
        void cleanup_upload_artifact(bool cleanup_after_upload, const std::string& cleanup_path) {
            if (!cleanup_after_upload || cleanup_path.empty()) {
                return;
            }

            std::error_code ec;
            fs::path path(cleanup_path);
            fs::remove(path, ec);

            ec.clear();
            fs::path parent = path.parent_path();
            if (!parent.empty()) {
                fs::remove(parent, ec);
            }
        }
    }

    void FileSidebarPanel::show_uploader_modal(FileSidebarState& state) {
        if (!state.show_uploader_modal) return;

        auto& remote_state = registry_.get_state<RemoteState>("Remote");

        if (!remote_state.has_upload_context()) {
            state.show_uploader_modal = false;
            state.status_message = "Navigate to a cloud folder first.";
            return;
        }

        auto ctx = remote_state.get_upload_context();

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
                    progress.remote_name = ctx.remote_name;
                    progress.remote_path = ctx.remote_path;

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
        std::string remote_name;
        std::string remote_path;
        bool cleanup_after_upload = false;
        std::string cleanup_path;

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
            remote_name = state.upload_queue[index].remote_name;
            remote_path = state.upload_queue[index].remote_path;
            cleanup_after_upload = state.upload_queue[index].cleanup_after_upload;
            cleanup_path = state.upload_queue[index].cleanup_path;
        }

        auto& transfers = registry_.get_state<core::FileMasterTransfers>("FileMasterTransfers");

        // Progress callback
        auto progress_cb = [&state, index](size_t bytes_uploaded, size_t total_bytes) -> bool {
            (void)total_bytes;
            {
                std::lock_guard<std::mutex> lock(state.upload_mutex);
                if (index < state.upload_queue.size()) {
                    state.upload_queue[index].bytes_uploaded = bytes_uploaded;
                }
            }
            return !state.cancel_upload.load();
        };

        // Completion callback
        auto completion_cb = [this, &state, index, cleanup_after_upload, cleanup_path](bool success, const std::string& error_msg) {
            {
                std::lock_guard<std::mutex> lock(state.upload_mutex);
                if (index < state.upload_queue.size()) {
                    state.upload_queue[index].is_complete = true;
                    state.upload_queue[index].has_error = !success;
                    state.upload_queue[index].error_message = error_msg;
                }
                state.current_upload_index++;
            }

            cleanup_upload_artifact(cleanup_after_upload, cleanup_path);

            if (!state.cancel_upload.load()) {
                start_next_upload(state);
            } else {
                state.is_uploading = false;
            }
        };

        auto& services = registry_.get_state<ServicesState>("Services");
        core::FileMasterUploadRequest request;
        request.file_path = file_path;
        request.file_name = file_name;
        request.remote_name = remote_name;
        request.remote_path = remote_path;
        request.file_size = file_size;
        transfers.upload_file(services, request, completion_cb, progress_cb);
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
