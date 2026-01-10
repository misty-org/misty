#include "file_explorer_panel.h"
#include <iostream>

namespace fs = std::filesystem;

namespace minidfs::FileExplorer {
    
    FileExplorerPanel::FileExplorerPanel(UIRegistry& registry, WorkerPool& worker_pool, std::shared_ptr<MiniDFSClient> client) 
        : registry_(registry), worker_pool_(worker_pool), client_(std::move(client)) {

        get_files(client_->GetClientMountPath());
    }

    void FileExplorerPanel::render() {
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");

        ImGuiWindowFlags file_explorer_flags = ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoResize;

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

        if (ImGui::Begin("File Explorer", nullptr, file_explorer_flags)) {
            std::unique_lock<std::mutex> lock(state.mu, std::try_to_lock);

            if (lock.owns_lock()) {
                if (ImGui::BeginChild("TopBar", ImVec2(0, 50), false, ImGuiWindowFlags_NoScrollbar)) {
                    ImGui::SetCursorPosY(8.0f);
                    
                    show_nav_history(state, 30.0f, 8.0f);
                    
                    ImGui::SameLine(0, 8.0f);
                    ImGui::SetCursorPosY(7.0f);

                    
                    show_search_bar(state);
                }
                ImGui::EndChild();

                ImGui::Separator();
                show_directory_contents(state);
                show_error_modal(state);
            }
            else {
                ImGui::Text("Syncing...");
            }
        }
        ImGui::End();
        ImGui::PopStyleColor();
    }

    void FileExplorerPanel::show_nav_history(FileExplorerState& state, float button_width, float spacing) {
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(6.0f, 6.0f));

        bool can_go_back = !state.back_history.empty();
        if (!can_go_back) ImGui::BeginDisabled();
        if (ImGui::Button("<", ImVec2(button_width, 0))) {
            navigate_back();
        }
        if (!can_go_back) ImGui::EndDisabled();

        ImGui::SameLine(0, spacing);

        bool can_go_forward = !state.forward_history.empty();
        if (!can_go_forward) ImGui::BeginDisabled();
        if (ImGui::Button(">", ImVec2(button_width, 0))) {
            navigate_forward();
        }
        if (!can_go_forward) ImGui::EndDisabled();

        ImGui::PopStyleVar(2);
    }

    void FileExplorerPanel::show_search_bar(FileExplorerState& state) {

        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10, 8));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);

        ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.21f, 0.21f, 0.21f, 1.0f));


        float available_width = ImGui::GetContentRegionAvail().x;
        ImGui::SetNextItemWidth(available_width);

        if (ImGui::InputTextWithHint("##search", "Search or enter path...",
            state.current_path,
            sizeof(state.current_path) - 1,
            ImGuiInputTextFlags_EnterReturnsTrue)) {
            get_files(state.current_path);
        }

        ImGui::PopStyleColor();
        ImGui::PopStyleVar(2);
    }

    void FileExplorerPanel::show_directory_contents(FileExplorerState& state) {
        static ImGuiTableFlags flags = ImGuiTableFlags_Reorderable | ImGuiTableFlags_Sortable |
            ImGuiTableFlags_Hideable | ImGuiTableFlags_RowBg |
            ImGuiTableFlags_ScrollY | ImGuiTableFlags_Resizable;

        if (ImGui::BeginTable("FileTable", 4, flags)) {
            ImGui::TableSetupColumn("Name", ImGuiTableColumnFlags_WidthStretch);
            ImGui::TableSetupColumn("Size", ImGuiTableColumnFlags_WidthFixed, 80.0f);
            ImGui::TableSetupColumn("Type", ImGuiTableColumnFlags_WidthFixed, 80.0f);
            ImGui::TableSetupColumn("Last Modified", ImGuiTableColumnFlags_WidthFixed, 150.0f);
            ImGui::TableHeadersRow();

            if (state.files.empty()) {
                ImGui::TableNextRow();
                ImGui::TableNextColumn();
                float column_width = ImGui::GetColumnWidth();

                const char* text = "No files found...";
                float text_width = ImGui::CalcTextSize(text).x;
                float padding = (column_width - text_width) * 0.5f;
                if (padding > 0) {
                    ImGui::SetCursorPosX(ImGui::GetCursorPosX() + padding);
                }
                ImGui::TextDisabled("%s", text);
            }
            else {
                for (int i = 0; i < (int)state.files.size(); i++) {
                    show_file_item(state, i);
                }
            }

            if (ImGuiTableSortSpecs* sorts_specs = ImGui::TableGetSortSpecs()) {
                if (sorts_specs->SpecsDirty) {
                    sorts_specs->SpecsDirty = false;
                }
            }

            ImGui::EndTable();
        }
    }

    void FileExplorerPanel::show_file_item(FileExplorerState& state, int i) {
        ImGuiIO& io = ImGui::GetIO();
        minidfs::FileInfo file = state.files[i];
        std::string display_name = fs::path(file.file_path()).filename().generic_string();

        bool is_currently_selected = state.selected_files.count(file.file_path()) > 0;

        ImGui::TableNextRow();
        ImGui::TableNextColumn();

        std::string label = (file.is_dir() ? "[DIR] " : "[FILE] ") + display_name;

        if (ImGui::Selectable(label.c_str(), is_currently_selected, ImGuiSelectableFlags_SpanAllColumns | ImGuiSelectableFlags_AllowDoubleClick)) {

            if (io.KeyCtrl) {
                if (is_currently_selected) state.selected_files.erase(file.file_path());
                else state.selected_files.insert(file.file_path());
            }
            else if (io.KeyShift && state.last_selected_index != -1) {
                state.selected_files.clear();
                int start = std::min(state.last_selected_index, i);
                int end = std::max(state.last_selected_index, i);
                for (int j = start; j <= end; j++) state.selected_files.insert(state.files[j].file_path());
            }
            else {
                state.selected_files.clear();
                state.selected_files.insert(file.file_path());
            }
            state.last_selected_index = i;

            if (ImGui::IsItemHovered() && ImGui::IsMouseDoubleClicked(0)) {
                if (file.is_dir()) {
                    get_files(file.file_path()); // Direct path
                }
                else {
                    open_file(file.file_path()); // Direct path
                }
            }
        }
    }
    
    void FileExplorerPanel::show_error_modal(FileExplorerState& state) {
        if (!state.error_msg.empty()) {
            ImGui::OpenPopup("Error Alert");
        }
        
        if (ImGui::BeginPopupModal("Error Alert", NULL, ImGuiWindowFlags_AlwaysAutoResize)) {
            ImGui::TextColored(ImVec4(1.0f, 0.4f, 0.4f, 1.0f), "SYSTEM ERROR");
            ImGui::Separator();
            ImGui::TextWrapped("%s", state.error_msg.c_str());
            ImGui::Spacing();

            if (ImGui::Button("OK", ImVec2(120, 0))) {
                state.error_msg = "";
                ImGui::CloseCurrentPopup();
            }
            ImGui::EndPopup();
        }
    }
        
    void FileExplorerPanel::get_files(const std::string& path, bool update_history) {
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");

        try {
            std::vector<minidfs::FileInfo> new_files;
            for (const auto& entry : fs::directory_iterator(path)) {
                minidfs::FileInfo file_info;
                file_info.set_file_path(entry.path().generic_string());
                file_info.set_is_dir(entry.is_directory());
                new_files.push_back(file_info);
            }
            state.update_files(path, std::move(new_files), update_history);
        }
        catch (const std::exception& e) {
            state.error_msg = e.what();
            state.is_loading = false;
        }
    }

    void FileExplorerPanel::navigate_back() {
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");
        std::string previous_path = state.go_back();
        if (!previous_path.empty()) {
            get_files(previous_path, false);
        }
    }

    void FileExplorerPanel::navigate_forward() {
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");
        std::string next_path = state.go_forward();
        if (!next_path.empty()) {
            get_files(next_path, false);
        }
    }

    void FileExplorerPanel::create_file(const std::string& filename) {
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");

        std::string full_path = (fs::path(state.current_path) / filename).string();

        try {
            std::ofstream file(full_path);
            file.close();

            // Refresh view - don't update history for refresh
            get_files(state.current_path, false);
        }
        catch (const std::exception& e) {
            state.error_msg = e.what();
        }
    }

    void FileExplorerPanel::upload_file(const std::string& source_path) {
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");

        std::string filename = fs::path(source_path).filename().generic_string();
        std::string dest_path = (fs::path(state.current_path) / filename).generic_string();

        try {
            fs::copy_file(source_path, dest_path, fs::copy_options::overwrite_existing);

            // Refresh view - don't update history for refresh
            get_files(state.current_path, false);
        }
        catch (const std::exception& e) {
            state.error_msg = e.what();
        }
    }

   
#ifdef _WIN32
#include <windows.h>
#include <shellapi.h>

    void FileExplorerPanel::open_file(const std::string& path) {
        ShellExecuteA(NULL, "open", path.c_str(), NULL, NULL, SW_SHOWNORMAL);
    }
#elif __APPLE__
    void FileExplorerPanel::open_file(const std::string& path) {
        std::string cmd = "open \"" + path + "\"";
        system(cmd.c_str());
    }
#elif __linux__
    void FileExplorerPanel::open_file(const std::string& path) {
        std::string cmd = "xdg-open \"" + path + "\"";
        system(cmd.c_str());
    }
#endif
}