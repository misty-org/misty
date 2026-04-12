#include "activity_panel.h"
#include "core/ui/imgui_utils.h"
#include "panels/services/services_state.h"
#include "imgui.h"
#include <filesystem>
#include <sstream>
#include <iomanip>
#include <algorithm>

namespace misty::panel {

    namespace {
        void right_align_after_tabs(float item_width) {
            ImGui::SameLine();
            ImGui::Dummy(ImVec2(std::max(0.0f, ImGui::GetContentRegionAvail().x - item_width), 0.0f));
            ImGui::SameLine();
        }
    } // namespace

    ActivityPanel::ActivityPanel(core::UIRegistry& registry)
        : registry_(registry) {
    }

    void ActivityPanel::render() {
        ImGuiWindowFlags flags = ImGuiWindowFlags_NoTitleBar |
                                  ImGuiWindowFlags_NoMove |
                                  ImGuiWindowFlags_NoCollapse |
                                  ImGuiWindowFlags_NoResize;

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.12f, 0.12f, 0.12f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(24.0f, 24.0f));

        if (ImGui::Begin("Activity", nullptr, flags)) {
            render_header();
            ImGui::Spacing();
            render_category_tabs();
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            switch (current_category_) {
                case ActivityCategory::DOWNLOADS:
                    render_download_filter_tabs();
                    ImGui::Spacing();
                    render_download_list();
                    break;
                case ActivityCategory::UPLOADS:
                    render_upload_filter_tabs();
                    ImGui::Spacing();
                    render_upload_list();
                    break;
            }
        }
        ImGui::End();

        ImGui::PopStyleVar();
        ImGui::PopStyleColor();
    }

    /* Header */

    void ActivityPanel::render_header() {
        auto& download_state = registry_.get_state<DownloadState>("Downloads");
        auto& upload_state = registry_.get_state<UploadState>("Uploads");

        ImGui::PushFont(ImGui::GetIO().Fonts->Fonts[0]);
        ImGui::Text("Activity");
        ImGui::PopFont();
    }

    void ActivityPanel::render_category_tabs() {
        auto& download_state = registry_.get_state<DownloadState>("Downloads");
        auto& upload_state = registry_.get_state<UploadState>("Uploads");

        size_t downloads = download_state.total_count();
        size_t uploads = upload_state.total_count();

        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(14.0f, 8.0f));

        auto render_category = [this](const char* label, size_t count, ActivityCategory category) {
            bool is_selected = (current_category_ == category);

            if (is_selected) {
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
            } else {
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.15f, 0.15f, 0.15f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
            }

            std::string btn_label = std::string(label) + " (" + std::to_string(count) + ")";
            if (ImGui::Button(btn_label.c_str())) {
                current_category_ = category;
            }
            ImGui::PopStyleColor(2);
            ImGui::SameLine();
        };

        render_category("Downloads", downloads, ActivityCategory::DOWNLOADS);
        render_category("Uploads", uploads, ActivityCategory::UPLOADS);

        ImGui::PopStyleVar(2);
        ImGui::NewLine();
    }

    /* Downloads */

    void ActivityPanel::render_download_filter_tabs() {
        auto& download_state = registry_.get_state<DownloadState>("Downloads");
        auto all_downloads = download_state.get_all_downloads();

        size_t all_count = all_downloads.size();
        size_t active_count = 0;
        size_t completed_count = 0;
        size_t failed_count = 0;

        for (const auto& item : all_downloads) {
            switch (item.status) {
                case DownloadStatus::PENDING:
                case DownloadStatus::DOWNLOADING:
                    active_count++;
                    break;
                case DownloadStatus::COMPLETED:
                    completed_count++;
                    break;
                case DownloadStatus::FAILED:
                    failed_count++;
                    break;
            }
        }

        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 6.0f));

        auto render_tab = [this](const char* label, size_t count, ActivityFilter filter) {
            bool is_selected = (download_filter_ == filter);

            if (is_selected) {
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.25f, 0.25f, 0.25f, 1.0f));
            } else {
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.15f, 0.15f, 0.15f, 1.0f));
            }

            std::string btn_label = std::string(label) + " (" + std::to_string(count) + ")";
            if (ImGui::Button(btn_label.c_str())) {
                download_filter_ = filter;
            }
            ImGui::PopStyleColor();
            ImGui::SameLine();
        };

        render_tab("All##dl", all_count, ActivityFilter::ALL);
        render_tab("Active##dl", active_count, ActivityFilter::ACTIVE);
        render_tab("Completed##dl", completed_count, ActivityFilter::COMPLETED);
        render_tab("Failed##dl", failed_count, ActivityFilter::FAILED);

        const float clear_button_w = 136.0f;
        right_align_after_tabs(clear_button_w);
        if (ImGui::Button("Clear Completed##dl", ImVec2(clear_button_w, 0.0f))) {
            download_state.clear_completed();
        }

        ImGui::PopStyleVar(2);
        ImGui::NewLine();
    }

    void ActivityPanel::render_download_list() {
        auto& download_state = registry_.get_state<DownloadState>("Downloads");
        auto downloads = download_state.get_all_downloads();

        std::vector<DownloadItem> filtered;
        for (const auto& item : downloads) {
            bool include = false;
            switch (download_filter_) {
                case ActivityFilter::ALL:
                    include = true;
                    break;
                case ActivityFilter::ACTIVE:
                    include = item.is_active();
                    break;
                case ActivityFilter::COMPLETED:
                    include = (item.status == DownloadStatus::COMPLETED);
                    break;
                case ActivityFilter::FAILED:
                    include = (item.status == DownloadStatus::FAILED);
                    break;
            }
            if (include) {
                filtered.push_back(item);
            }
        }

        if (filtered.empty()) {
            render_download_empty();
            return;
        }

        ImGui::BeginChild("DownloadList", ImVec2(0, 0), false);

        for (const auto& item : filtered) {
            render_download_item(item);
            ImGui::Spacing();
        }

        ImGui::EndChild();
    }

    void ActivityPanel::render_download_item(const DownloadItem& item) {
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

        std::string child_id = "download_" + std::to_string(item.id);
        if (ImGui::BeginChild(child_id.c_str(), ImVec2(0, 80), true)) {
            ImVec4 status_color;
            const char* status_text;
            switch (item.status) {
                case DownloadStatus::DOWNLOADING:
                    status_color = ImVec4(0.4f, 0.7f, 1.0f, 1.0f);
                    status_text = "Downloading...";
                    break;
                case DownloadStatus::PENDING:
                    status_color = ImVec4(0.7f, 0.7f, 0.4f, 1.0f);
                    status_text = "Pending";
                    break;
                case DownloadStatus::COMPLETED:
                    status_color = ImVec4(0.4f, 0.8f, 0.4f, 1.0f);
                    status_text = "Completed";
                    break;
                case DownloadStatus::FAILED:
                    status_color = ImVec4(0.9f, 0.4f, 0.4f, 1.0f);
                    status_text = "Failed";
                    break;
            }

            ImGui::Text("%s", item.file_name.c_str());

            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
            ImGui::Text("%s", item.source.c_str());
            ImGui::PopStyleColor();

            ImGui::SameLine();
            ImGui::PushStyleColor(ImGuiCol_Text, status_color);
            ImGui::Text("  %s", status_text);
            ImGui::PopStyleColor();

            if (item.is_active() && item.file_size > 0) {
                float progress = item.get_progress();
                ImGui::ProgressBar(progress, ImVec2(-1, 4));
            }

            if (item.file_size > 0) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
                if (item.is_active()) {
                    ImGui::Text("%s / %s", format_file_size(item.downloaded_bytes).c_str(),
                               format_file_size(item.file_size).c_str());
                } else {
                    ImGui::Text("%s", format_file_size(item.file_size).c_str());
                }
                ImGui::PopStyleColor();
            }

            if (!item.is_active()) {
                const float timestamp_w = 112.0f;
                right_align_after_tabs(timestamp_w);
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
                ImGui::Text("%s", format_time_ago(item.completed_at).c_str());
                ImGui::PopStyleColor();
            }

            if (item.status == DownloadStatus::FAILED && !item.error_message.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.9f, 0.5f, 0.5f, 1.0f));
                ImGui::TextWrapped("%s", item.error_message.c_str());
                ImGui::PopStyleColor();
            }
        }
        ImGui::EndChild();

        ImGui::PopStyleColor();
        ImGui::PopStyleVar();
    }

    void ActivityPanel::render_download_empty() {
        ImVec2 available = ImGui::GetContentRegionAvail();
        ImVec2 text_size = ImGui::CalcTextSize("No downloads");

        ImGui::SetCursorPos(ImVec2(
            (available.x - text_size.x) * 0.5f,
            available.y * 0.4f
        ));

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
        ImGui::Text("No downloads");
        ImGui::PopStyleColor();
    }

    /* Uploads */

    void ActivityPanel::render_upload_filter_tabs() {
        auto& upload_state = registry_.get_state<UploadState>("Uploads");
        auto all_uploads = upload_state.get_all_uploads();

        size_t all_count = all_uploads.size();
        size_t active_count = 0;
        size_t completed_count = 0;
        size_t failed_count = 0;

        for (const auto& item : all_uploads) {
            switch (item.status) {
                case UploadStatus::PENDING:
                case UploadStatus::UPLOADING:
                    active_count++;
                    break;
                case UploadStatus::COMPLETED:
                    completed_count++;
                    break;
                case UploadStatus::FAILED:
                    failed_count++;
                    break;
            }
        }

        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 6.0f));

        auto render_tab = [this](const char* label, size_t count, ActivityFilter filter) {
            bool is_selected = (upload_filter_ == filter);

            if (is_selected) {
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.25f, 0.25f, 0.25f, 1.0f));
            } else {
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.15f, 0.15f, 0.15f, 1.0f));
            }

            std::string btn_label = std::string(label) + " (" + std::to_string(count) + ")";
            if (ImGui::Button(btn_label.c_str())) {
                upload_filter_ = filter;
            }
            ImGui::PopStyleColor();
            ImGui::SameLine();
        };

        render_tab("All##ul", all_count, ActivityFilter::ALL);
        render_tab("Active##ul", active_count, ActivityFilter::ACTIVE);
        render_tab("Completed##ul", completed_count, ActivityFilter::COMPLETED);
        render_tab("Failed##ul", failed_count, ActivityFilter::FAILED);

        const float clear_button_w = 136.0f;
        right_align_after_tabs(clear_button_w);
        if (ImGui::Button("Clear Completed##ul", ImVec2(clear_button_w, 0.0f))) {
            upload_state.clear_completed();
        }

        ImGui::PopStyleVar(2);
        ImGui::NewLine();
    }

    void ActivityPanel::render_upload_list() {
        auto& upload_state = registry_.get_state<UploadState>("Uploads");
        auto uploads = upload_state.get_all_uploads();

        std::vector<UploadItem> filtered;
        for (const auto& item : uploads) {
            bool include = false;
            switch (upload_filter_) {
                case ActivityFilter::ALL:
                    include = true;
                    break;
                case ActivityFilter::ACTIVE:
                    include = item.is_active();
                    break;
                case ActivityFilter::COMPLETED:
                    include = (item.status == UploadStatus::COMPLETED);
                    break;
                case ActivityFilter::FAILED:
                    include = (item.status == UploadStatus::FAILED);
                    break;
            }
            if (include) {
                filtered.push_back(item);
            }
        }

        if (filtered.empty()) {
            render_upload_empty();
            return;
        }

        ImGui::BeginChild("UploadList", ImVec2(0, 0), false);

        for (const auto& item : filtered) {
            render_upload_item(item);
            ImGui::Spacing();
        }

        ImGui::EndChild();
    }

    void ActivityPanel::render_upload_item(const UploadItem& item) {
        const bool show_retry = item.can_retry();
        const bool show_error = item.status == UploadStatus::FAILED && !item.error_message.empty();
        const float child_height = (show_retry || show_error) ? 112.0f : 80.0f;

        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

        std::string child_id = "upload_" + std::to_string(item.id);
        if (ImGui::BeginChild(child_id.c_str(), ImVec2(0, child_height), true)) {
            ImVec4 status_color;
            const char* status_text;
            switch (item.status) {
                case UploadStatus::UPLOADING:
                    status_color = ImVec4(0.4f, 0.8f, 0.6f, 1.0f);
                    status_text = "Uploading...";
                    break;
                case UploadStatus::PENDING:
                    status_color = ImVec4(0.7f, 0.7f, 0.4f, 1.0f);
                    status_text = "Pending";
                    break;
                case UploadStatus::COMPLETED:
                    status_color = ImVec4(0.4f, 0.8f, 0.4f, 1.0f);
                    status_text = "Completed";
                    break;
                case UploadStatus::FAILED:
                    status_color = ImVec4(0.9f, 0.4f, 0.4f, 1.0f);
                    status_text = "Failed";
                    break;
            }

            ImGui::Text("%s", item.file_name.c_str());

            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
            ImGui::Text("%s", item.destination.c_str());
            ImGui::PopStyleColor();

            ImGui::SameLine();
            ImGui::PushStyleColor(ImGuiCol_Text, status_color);
            ImGui::Text("  %s", status_text);
            ImGui::PopStyleColor();

            if (item.is_active() && item.file_size > 0) {
                float progress = item.get_progress();
                ImGui::ProgressBar(progress, ImVec2(-1, 4));
            }

            if (item.file_size > 0) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
                if (item.is_active()) {
                    ImGui::Text("%s / %s", format_file_size(item.uploaded_bytes).c_str(),
                               format_file_size(item.file_size).c_str());
                } else {
                    ImGui::Text("%s", format_file_size(item.file_size).c_str());
                }
                ImGui::PopStyleColor();
            }

            if (!item.is_active()) {
                const float timestamp_w = 112.0f;
                right_align_after_tabs(timestamp_w);
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
                ImGui::Text("%s", format_time_ago(item.completed_at).c_str());
                ImGui::PopStyleColor();
            }

            if (item.status == UploadStatus::FAILED && !item.error_message.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.9f, 0.5f, 0.5f, 1.0f));
                ImGui::TextWrapped("%s", item.error_message.c_str());
                ImGui::PopStyleColor();
            }

            if (show_retry) {
                if (ImGui::Button(("Retry##upload_" + std::to_string(item.id)).c_str(), ImVec2(84.0f, 0.0f))) {
                    retry_upload(item);
                }
            }
        }
        ImGui::EndChild();

        ImGui::PopStyleColor();
        ImGui::PopStyleVar();
    }

    void ActivityPanel::render_upload_empty() {
        ImVec2 available = ImGui::GetContentRegionAvail();
        ImVec2 text_size = ImGui::CalcTextSize("No uploads");

        ImGui::SetCursorPos(ImVec2(
            (available.x - text_size.x) * 0.5f,
            available.y * 0.4f
        ));

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
        ImGui::Text("No uploads");
        ImGui::PopStyleColor();
    }

    void ActivityPanel::retry_upload(const UploadItem& item) {
        namespace fs = std::filesystem;

        auto& uploads = registry_.get_state<UploadState>("Uploads");
        auto& services = registry_.get_state<ServicesState>("Services");
        auto& notifications = registry_.get_state<NotificationState>("Notifications");

        std::error_code ec;
        if (item.local_path.empty() || !fs::exists(item.local_path, ec)) {
            notifications.add_notification(
                "Retry Failed",
                "File not found: " + item.local_path,
                NotificationType::ERROR,
                5.0f
            );
            return;
        }

        const std::string file_name = fs::path(item.local_path).filename().string();
        const int64_t file_size = item.file_size > 0 ? item.file_size : static_cast<int64_t>(fs::file_size(item.local_path, ec));
        if (ec) {
            notifications.add_notification(
                "Retry Failed",
                "Failed to inspect local file: " + ec.message(),
                NotificationType::ERROR,
                5.0f
            );
            return;
        }

        uint64_t upload_id = uploads.start_upload(file_name, item.local_path, item.destination, file_size);
        uploads.set_retry_context(upload_id, item.remote_name, item.remote_path);

        services.upload_file(
            item.remote_name, item.remote_path, item.local_path,
            [this, upload_id](size_t bytes_uploaded, size_t) -> bool {
                auto& upload_state = registry_.get_state<UploadState>("Uploads");
                upload_state.update_progress(upload_id, static_cast<int64_t>(bytes_uploaded));
                return true;
            },
            [this, file_name, upload_id](bool success, const std::string& error_msg) {
                auto& upload_state = registry_.get_state<UploadState>("Uploads");
                auto& notif_state = registry_.get_state<NotificationState>("Notifications");
                if (success) {
                    upload_state.complete_upload(upload_id);
                    notif_state.add_notification("Upload Complete", file_name, NotificationType::SUCCESS, 5.0f);
                } else {
                    upload_state.fail_upload(upload_id, error_msg);
                    notif_state.add_notification("Upload Failed", file_name + ": " + error_msg, NotificationType::ERROR, 5.0f);
                }
            }
        );

        notifications.add_notification("Uploading", file_name, NotificationType::DOWNLOAD, 15.0f);
    }

    /* Helpers */

    std::string ActivityPanel::format_file_size(int64_t bytes) {
        std::ostringstream ss;
        ss << std::fixed << std::setprecision(1);

        if (bytes < 1024) {
            ss << bytes << " B";
        } else if (bytes < 1024 * 1024) {
            ss << (bytes / 1024.0) << " KB";
        } else if (bytes < 1024 * 1024 * 1024) {
            ss << (bytes / (1024.0 * 1024.0)) << " MB";
        } else {
            ss << (bytes / (1024.0 * 1024.0 * 1024.0)) << " GB";
        }

        return ss.str();
    }

    std::string ActivityPanel::format_time_ago(std::chrono::steady_clock::time_point time) {
        auto now = std::chrono::steady_clock::now();
        auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(now - time).count();

        if (elapsed < 60) {
            return "Just now";
        } else if (elapsed < 3600) {
            return std::to_string(elapsed / 60) + " min ago";
        } else if (elapsed < 86400) {
            return std::to_string(elapsed / 3600) + " hr ago";
        } else {
            return std::to_string(elapsed / 86400) + " days ago";
        }
    }

}
