#include "panels/file_explorer/file_explorer_panel.h"

#include "panels/context_menu/context_menu_state.h"

namespace misty::panel {

const UnifiedFileItem* FileExplorerPanel::find_context_menu_target(const FileExplorerState& state) const {
    for (const auto& file : state.files) {
        if (file.path == state.context_menu_target_path) {
            return &file;
        }
    }
    return nullptr;
}

void FileExplorerPanel::open_context_menu(FileExplorerState& state) {
    ContextMenuRequest request;
    request.source_key = state_key_;
    request.anchor_pos = ImGui::GetMousePos();
    if (ImGuiViewport* viewport = ImGui::GetWindowViewport()) {
        request.viewport_id = viewport->ID;
    }

    if (find_context_menu_target(state) != nullptr) {
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
    copy_path_entry.on_select = [path = state.context_menu_target_path]() {
        ImGui::SetClipboardText(path.c_str());
    };
    request.entries.push_back(std::move(copy_path_entry));

    registry_.get_state<ContextMenuState>(kContextMenuStateKey).open(std::move(request));
}

void FileExplorerPanel::show_rename_modal(FileExplorerState& state) {
    if (!state.show_rename_modal) {
        return;
    }

    state.rename_buffer[0] = '\0';
    state.rename_target_path.clear();
    state.show_rename_modal = false;
}

void FileExplorerPanel::open_background_context_menu(FileExplorerState& state) {
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
    show_hidden_entry.secondary_label = state.show_hidden ? "On" : "Off";
    show_hidden_entry.on_select = [registry = &registry_, state_key = state_key_]() {
        auto& current_state = registry->get_state<FileExplorerState>(state_key);
        current_state.show_hidden = !current_state.show_hidden;
        current_state.pending_navigation_path = std::string(current_state.current_path);
    };
    request.entries.push_back(std::move(show_hidden_entry));

    registry_.get_state<ContextMenuState>(kContextMenuStateKey).open(std::move(request));
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
