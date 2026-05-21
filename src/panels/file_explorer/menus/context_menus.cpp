#include "panels/file_explorer/file_explorer_panel.h"

#include "panels/context_menu/context_menu_state.h"

namespace misty::panel {

const FileItem* FileExplorerPanel::find_context_menu_target(const FileExplorerState& state,
                                                            const FileListing& listing,
                                                            const FileExplorerPanel::TransientUiState& ui) const {
    (void)state;
    for (const auto& file : listing.files) {
        if (file.path == ui.context_menu_target_path) {
            return &file;
        }
    }
    return nullptr;
}

void FileExplorerPanel::open_context_menu(FileExplorerState& state, FileExplorerPanel::TransientUiState& ui) {
    ContextMenuRequest request;
    request.source_key = state_key_;
    request.anchor_pos = ImGui::GetMousePos();
    if (ImGuiViewport* viewport = ImGui::GetWindowViewport()) {
        request.viewport_id = viewport->ID;
    }

    if (find_context_menu_target(state, active_listing(), ui) != nullptr) {
        ContextMenuEntry readonly_entry;
        readonly_entry.id = "readonly";
        readonly_entry.label = "Read-only view";
        readonly_entry.disabled = true;
        request.entries.push_back(std::move(readonly_entry));
        request.entries.push_back(ContextMenuEntry::separator());
    }

    ContextMenuEntry copy_path_entry;
    copy_path_entry.id = "copy_path";
    copy_path_entry.label = "Copy Path";
    copy_path_entry.on_select = [path = ui.context_menu_target_path]() {
        ImGui::SetClipboardText(path.c_str());
    };
    request.entries.push_back(std::move(copy_path_entry));

    registry_.get_state<ContextMenuState>(kContextMenuStateKey).open(std::move(request));
}

void FileExplorerPanel::show_rename_modal(FileExplorerPanel::TransientUiState& ui) {
    if (!ui.show_rename_modal) {
        return;
    }

    ui.rename_buffer[0] = '\0';
    ui.rename_target_path.clear();
    ui.show_rename_modal = false;
}

void FileExplorerPanel::open_background_context_menu(FileExplorerState& state, FileExplorerPanel::TransientUiState& ui) {
    ContextMenuRequest request;
    request.source_key = state_key_;
    request.anchor_pos = ImGui::GetMousePos();
    if (ImGuiViewport* viewport = ImGui::GetWindowViewport()) {
        request.viewport_id = viewport->ID;
    }

    ContextMenuEntry readonly_entry;
    readonly_entry.id = "readonly";
    readonly_entry.label = "Read-only view";
    readonly_entry.disabled = true;
    request.entries.push_back(std::move(readonly_entry));
    request.entries.push_back(ContextMenuEntry::separator());

    ContextMenuEntry show_hidden_entry;
    show_hidden_entry.id = "show_hidden";
    show_hidden_entry.label = "Show Hidden Files";
    show_hidden_entry.secondary_label = ui.show_hidden ? "On" : "Off";
    show_hidden_entry.on_select = [this, &state, &ui]() {
        ui.show_hidden = !ui.show_hidden;
        navigate_to_path(std::string(state.current_path), false);
    };
    request.entries.push_back(std::move(show_hidden_entry));

    registry_.get_state<ContextMenuState>(kContextMenuStateKey).open(std::move(request));
}

void FileExplorerPanel::show_new_entry_modal(FileExplorerPanel::TransientUiState& ui) {
    if (!ui.show_new_entry_modal) {
        return;
    }

    ui.new_entry_name_buffer[0] = '\0';
    ui.show_new_entry_modal = false;
}

void FileExplorerPanel::show_permission_delete_modal(FileExplorerPanel::TransientUiState& ui) {
    if (!ui.show_permission_delete_modal) {
        return;
    }

    ui.show_permission_delete_modal = false;
    ui.permission_delete_paths.clear();
    ui.permission_delete_permanent = false;
}

void FileExplorerPanel::show_permanent_delete_modal(FileExplorerPanel::TransientUiState& ui) {
    if (!ui.show_permanent_delete_modal) {
        return;
    }

    ui.show_permanent_delete_modal = false;
    ui.permanent_delete_paths.clear();
}

} // namespace misty::panel
