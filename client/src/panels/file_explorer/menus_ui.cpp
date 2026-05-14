#include "panels/file_explorer/file_explorer_panel.h"

namespace misty::panel {

const UnifiedFileItem* FileExplorerPanel::find_context_menu_target(const FileExplorerState& state) const {
    for (const auto& file : state.files) {
        if (file.path == state.context_menu_target_path) {
            return &file;
        }
    }
    return nullptr;
}

bool FileExplorerPanel::open_context_menu_target(FileExplorerState& state) {
    (void)state;
    return false;
}

void FileExplorerPanel::show_context_menu(FileExplorerState& state) {
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 8.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(10.0f, 6.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_PopupRounding, 6.0f);
    ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.15f, 0.15f, 0.15f, 0.95f));
    ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.3f, 0.3f, 0.3f, 0.6f));

    if (ImGui::BeginPopup("FileContextMenu")) {
        if (find_context_menu_target(state) != nullptr) {
            ImGui::TextDisabled("Read-only view");
            ImGui::Separator();
            if (ImGui::MenuItem("Copy Path")) {
                ImGui::SetClipboardText(state.context_menu_target_path.c_str());
            }
        } else if (ImGui::MenuItem("Copy Path")) {
            ImGui::SetClipboardText(state.context_menu_target_path.c_str());
        }
        ImGui::EndPopup();
    }

    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar(3);
}

void FileExplorerPanel::show_rename_modal(FileExplorerState& state) {
    if (!state.show_rename_modal) {
        return;
    }

    state.rename_buffer[0] = '\0';
    state.rename_target_path.clear();
    state.show_rename_modal = false;
}

void FileExplorerPanel::show_background_context_menu(FileExplorerState& state) {
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 8.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(10.0f, 6.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_PopupRounding, 6.0f);
    ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.15f, 0.15f, 0.15f, 0.95f));
    ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.3f, 0.3f, 0.3f, 0.6f));

    if (ImGui::BeginPopup("BackgroundContextMenu")) {
        ImGui::TextDisabled("Read-only view");

        ImGui::Separator();
        if (ImGui::MenuItem("Show Hidden Files", nullptr, state.show_hidden)) {
            state.show_hidden = !state.show_hidden;
            navigate_to_path(std::string(state.current_path), false);
        }

        ImGui::EndPopup();
    }

    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar(3);
}

void FileExplorerPanel::show_new_entry_modal(FileExplorerState& state) {
    if (!state.show_new_entry_modal) {
        return;
    }

    state.new_entry_name_buffer[0] = '\0';
    state.show_new_entry_modal = false;
}

void FileExplorerPanel::show_permission_delete_modal(FileExplorerState& state) {
    if (!state.show_permission_delete_modal) {
        return;
    }

    state.show_permission_delete_modal = false;
    state.permission_delete_paths.clear();
    state.permission_delete_permanent = false;
}

void FileExplorerPanel::show_permanent_delete_modal(FileExplorerState& state) {
    if (!state.show_permanent_delete_modal) {
        return;
    }

    state.show_permanent_delete_modal = false;
    state.permanent_delete_paths.clear();
}

} // namespace misty::panel
