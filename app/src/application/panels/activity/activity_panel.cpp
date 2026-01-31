#include "activity_panel.h"
#include "imgui.h"
#include <sstream>
#include <iomanip>

namespace minidfs::panel {

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
            render_filter_tabs();
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            render_download_list();
        }
        ImGui::End();

        ImGui::PopStyleVar();
        ImGui::PopStyleColor();
    }

    void ActivityPanel::render_header() {
        auto& download_state = registry_.get_state<DownloadState>("Downloads");

        ImGui::PushFont(ImGui::GetIO().Fonts->Fonts[0]);  // Use default font, larger if available
        ImGui::Text("Activity");
        ImGui::PopFont();

        ImGui::SameLine();

        size_t active = download_state.active_count();
        if (active > 0) {
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.4f, 0.7f, 1.0f, 1.0f));
            ImGui::Text("(%zu active)", active);
            ImGui::PopStyleColor();
        }

        // Clear completed button
        ImGui::SameLine(ImGui::GetWindowWidth() - 140);
        if (ImGui::Button("Clear Completed")) {
            download_state.clear_completed();
        }
    }

    void ActivityPanel::render_filter_tabs() {
        auto& download_state = registry_.get_state<DownloadState>("Downloads");
        auto all_downloads = download_state.get_all_downloads();

        // Count items for each filter
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
            bool is_selected = (current_filter_ == filter);

            if (is_selected) {
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
            } else {
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.15f, 0.15f, 0.15f, 1.0f));
            }

            std::string btn_label = std::string(label) + " (" + std::to_string(count) + ")";
            if (ImGui::Button(btn_label.c_str())) {
                current_filter_ = filter;
            }
            ImGui::PopStyleColor();
            ImGui::SameLine();
        };

        render_tab("All", all_count, ActivityFilter::ALL);
        render_tab("Active", active_count, ActivityFilter::ACTIVE);
        render_tab("Completed", completed_count, ActivityFilter::COMPLETED);
        render_tab("Failed", failed_count, ActivityFilter::FAILED);

        ImGui::PopStyleVar(2);
        ImGui::NewLine();
    }

    void ActivityPanel::render_download_list() {
        auto& download_state = registry_.get_state<DownloadState>("Downloads");
        auto downloads = download_state.get_all_downloads();

        // Filter based on current selection
        std::vector<DownloadItem> filtered;
        for (const auto& item : downloads) {
            bool include = false;
            switch (current_filter_) {
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
            render_empty_state();
            return;
        }

        // Render in scrollable area
        ImGui::BeginChild("DownloadList", ImVec2(0, 0), false);

        for (const auto& item : filtered) {
            render_download_item(item);
            ImGui::Spacing();
        }

        ImGui::EndChild();
    }

    void ActivityPanel::render_download_item(const DownloadItem& item) {
        auto& download_state = registry_.get_state<DownloadState>("Downloads");

        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

        std::string child_id = "download_" + std::to_string(item.id);
        if (ImGui::BeginChild(child_id.c_str(), ImVec2(0, 80), true)) {
            // Status indicator color
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

            // File name
            ImGui::Text("%s", item.file_name.c_str());

            // Source and status
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
            ImGui::Text("%s", item.source.c_str());
            ImGui::PopStyleColor();

            ImGui::SameLine();
            ImGui::PushStyleColor(ImGuiCol_Text, status_color);
            ImGui::Text("  %s", status_text);
            ImGui::PopStyleColor();

            // Progress bar for active downloads
            if (item.is_active() && item.file_size > 0) {
                float progress = item.get_progress();
                ImGui::ProgressBar(progress, ImVec2(-1, 4));
            }

            // Size info
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

            // Time info for completed items
            if (!item.is_active()) {
                ImGui::SameLine(ImGui::GetWindowWidth() - 120);
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
                ImGui::Text("%s", format_time_ago(item.completed_at).c_str());
                ImGui::PopStyleColor();
            }

            // Error message for failed items
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

    void ActivityPanel::render_empty_state() {
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
