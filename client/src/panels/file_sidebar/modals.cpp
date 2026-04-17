#include "file_sidebar_panel.h"

#include "panels/file_explorer/file_explorer_state.h"

#include <cstdio>

namespace misty::panel {
    void FileSidebarPanel::show_chooser_modal(FileSidebarState& state)
    {
        if (state.show_chooser_modal)
            ImGui::OpenPopup("New");

        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(
            ImVec2(vp->WorkPos.x + 16, vp->WorkPos.y + 16),
            ImGuiCond_Appearing);

        ImGui::SetNextWindowSize(ImVec2(320, 360), ImGuiCond_Appearing);

        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(24, 24));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(12, 16));

        if (ImGui::BeginPopupModal("New", &state.show_chooser_modal,
            ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove))
        {
            float w = ImGui::GetContentRegionAvail().x;

            ImGui::TextDisabled("Upload");
            ImGui::Separator();

            if (ImGui::Button("Upload Files", ImVec2(w, 40))) {
                state.show_uploader_modal = true;
                state.show_chooser_modal = false;
            }

            ImGui::TextDisabled("Create");
            ImGui::Separator();

            if (ImGui::Button("Create File", ImVec2(w, 40))) {
                state.create_is_dir = false;
                state.show_create_entry_modal = true;
                state.show_chooser_modal = false;
            }

            if (ImGui::Button("Create Folder", ImVec2(w, 40))) {
                state.create_is_dir = true;
                state.show_create_entry_modal = true;
                state.show_chooser_modal = false;
            }

            ImGui::EndPopup();
        }

        ImGui::PopStyleVar(3);
    }


    void FileSidebarPanel::show_create_entry_modal(FileSidebarState& state) {
        const char* title = state.create_is_dir ? "Create Folder" : "Create File";

        if (state.show_create_entry_modal) {
            ImGui::OpenPopup(title); // Match the title exactly
            state.show_create_entry_modal = false;
        }

        // Centering and Styling
        ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, { 0.5f, 0.5f });
        ImGui::SetNextWindowSize({ 420, 190 }, ImGuiCond_Appearing);

        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, { 24, 24 });
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, { 12, 16 });
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, { 12, 10 });

        if (ImGui::BeginPopupModal(title, nullptr, ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove)) {

            ImGui::Text("%s Name", state.create_is_dir ? "Folder" : "File");
            ImGui::SetNextItemWidth(-1);
            ImGui::InputTextWithHint("##name", "Enter name...", state.name_buffer, IM_ARRAYSIZE(state.name_buffer));

            ImGui::Separator();

            float w = (ImGui::GetContentRegionAvail().x - ImGui::GetStyle().ItemSpacing.x) * 0.5f;

            if (ImGui::Button("Create", { w, 36 }) && state.name_buffer[0]) {
                // Use the pointer we stored in the state to avoid registry deadlocks!
                const std::string explorer_state_key =
                    active_explorer_state_key_provider_ ? active_explorer_state_key_provider_() : "Files";
				auto& file_explorer_state = registry_.get_state<FileExplorerState>(explorer_state_key);
                fs::path p = fs::path(file_explorer_state.current_path) / state.name_buffer;
                create_file(p.generic_string());

                state.name_buffer[0] = '\0';
                ImGui::CloseCurrentPopup();
            }

            ImGui::SameLine();

            if (ImGui::Button("Cancel", { w, 36 })) {
                state.name_buffer[0] = '\0';
                ImGui::CloseCurrentPopup();
            }

            ImGui::EndPopup();
        }
        ImGui::PopStyleVar(4);
    }

    // ─── Devices section ──────────────────────────────────────────────────────

    static std::string format_bytes(uint64_t bytes) {
        if (bytes == 0) return "";
        if (bytes < 1024ULL * 1024)
            return std::to_string(bytes / 1024) + " KB";
        double gb = static_cast<double>(bytes) / (1024.0 * 1024.0 * 1024.0);
        if (gb >= 1.0) {
            char buf[32];
            std::snprintf(buf, sizeof(buf), "%.1f GB", gb);
            return buf;
        }
        char buf[32];
        std::snprintf(buf, sizeof(buf), "%.0f MB", static_cast<double>(bytes) / (1024.0 * 1024.0));
        return buf;
    }

    void FileSidebarPanel::show_add_device_modal() {
        if (show_add_device_modal_) {
            ImGui::OpenPopup("Add Mount Point");
            show_add_device_modal_ = false;
        }

        ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, {0.5f, 0.5f});
        ImGui::SetNextWindowSize({460, 280}, ImGuiCond_Appearing);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,  {24, 24});
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,    {12, 14});
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding,   {12, 10});

        bool modal_open = true;
        if (ImGui::BeginPopupModal("Add Mount Point", &modal_open,
                ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove)) {

            // Close on the X button
            if (!modal_open) {
                add_device_path_buf_[0] = '\0';
                ImGui::CloseCurrentPopup();
            }

            ImGui::Text("Mount Path");
            ImGui::Spacing();
            ImGui::SetNextItemWidth(-1);
            ImGui::InputTextWithHint("##addpath", "/Volumes/MyDrive",
                                     add_device_path_buf_, sizeof(add_device_path_buf_));

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            float w = (ImGui::GetContentRegionAvail().x - ImGui::GetStyle().ItemSpacing.x) * 0.5f;
            bool has_path = add_device_path_buf_[0] != '\0';
            if (!has_path) ImGui::BeginDisabled();
            if (ImGui::Button("Add", {w, 38})) {
                std::string path = add_device_path_buf_;
                if (path.size() > 1 && path.back() == '/') path.pop_back();
                if (std::find(custom_mount_paths_.begin(), custom_mount_paths_.end(), path)
                        == custom_mount_paths_.end()) {
                    custom_mount_paths_.push_back(path);
                    hidden_device_paths_.erase(path);
                }
                add_device_path_buf_[0] = '\0';
                ImGui::CloseCurrentPopup();
            }
            if (!has_path) ImGui::EndDisabled();
            ImGui::SameLine();
            if (ImGui::Button("Cancel", {w, 38})) {
                add_device_path_buf_[0] = '\0';
                ImGui::CloseCurrentPopup();
            }
            ImGui::EndPopup();
        }
        ImGui::PopStyleVar(4);
    }

    void FileSidebarPanel::show_device_rename_modal() {
        if (!device_renaming_path_.empty())
            ImGui::OpenPopup("Rename Drive");

        ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, {0.5f, 0.5f});
        ImGui::SetNextWindowSize({420, 160}, ImGuiCond_Appearing);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,  {24, 24});
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,    {12, 16});
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding,   {12, 10});

        if (ImGui::BeginPopupModal("Rename Drive", nullptr,
                ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove)) {
            ImGui::Text("Drive Name");
            ImGui::SetNextItemWidth(-1);
            ImGui::InputText("##drvname", device_rename_buf_, sizeof(device_rename_buf_));
            ImGui::Separator();

            float w = (ImGui::GetContentRegionAvail().x - ImGui::GetStyle().ItemSpacing.x) * 0.5f;
            if (ImGui::Button("Save", {w, 36}) && device_rename_buf_[0]) {
                device_name_overrides_[device_renaming_path_] = device_rename_buf_;
                device_renaming_path_.clear();
                ImGui::CloseCurrentPopup();
            }
            ImGui::SameLine();
            if (ImGui::Button("Cancel", {w, 36})) {
                device_renaming_path_.clear();
                ImGui::CloseCurrentPopup();
            }
            ImGui::EndPopup();
        }
        ImGui::PopStyleVar(4);
    }
}
