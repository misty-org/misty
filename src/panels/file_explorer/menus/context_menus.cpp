#include "panels/file_explorer/file_explorer_panel.h"

#include <algorithm>

#include "core/commands/command_manager.h"
#include "panels/context_menu/context_menu_state.h"
#include "panels/file_explorer/state/clipboard_state.h"

namespace misty::panel {
namespace {

bool is_local_item(const FileItem& item) {
    return item.type == FileType::LOCAL;
}

bool selected_items_are_local(const FileExplorerPanel::TransientUiState& ui, const FileListing& listing) {
    if (ui.selected_files.empty()) {
        return false;
    }

    for (const auto& selected_id : ui.selected_files) {
        const auto it = std::find_if(listing.files.begin(), listing.files.end(), [&](const FileItem& item) {
            return item.id == selected_id;
        });
        if (it == listing.files.end() || !is_local_item(*it)) {
            return false;
        }
    }
    return true;
}

}  // namespace

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
    const auto& listing = active_listing();
    const FileItem* target = find_context_menu_target(state, listing, ui);
    const bool has_local_selection = selected_items_are_local(ui, listing);
    const bool has_clipboard = registry_.get_state<ClipboardState>("Clipboard").has_content();

    ContextMenuRequest request;
    request.source_key = state_key_;
    request.anchor_pos = ImGui::GetMousePos();
    if (ImGuiViewport* viewport = ImGui::GetWindowViewport()) {
        request.viewport_id = viewport->ID;
    }

    ContextMenuEntry copy_entry;
    copy_entry.id = "copy";
    copy_entry.label = "Copy";
    copy_entry.secondary_label = core::CommandManager::get().label("explorer.copy");
    copy_entry.disabled = !has_local_selection;
    copy_entry.on_select = [this, &state]() {
        perform_copy(state);
    };
    request.entries.push_back(std::move(copy_entry));

    ContextMenuEntry cut_entry;
    cut_entry.id = "cut";
    cut_entry.label = "Cut";
    cut_entry.secondary_label = core::CommandManager::get().label("explorer.cut");
    cut_entry.disabled = !has_local_selection;
    cut_entry.on_select = [this, &state]() {
        perform_cut(state);
    };
    request.entries.push_back(std::move(cut_entry));

    ContextMenuEntry paste_entry;
    paste_entry.id = "paste";
    paste_entry.label = "Paste";
    paste_entry.secondary_label = core::CommandManager::get().label("explorer.paste");
    paste_entry.disabled = !has_clipboard;
    paste_entry.on_select = [this, &state]() {
        perform_paste(state);
    };
    request.entries.push_back(std::move(paste_entry));

    request.entries.push_back(ContextMenuEntry::separator());

    ContextMenuEntry delete_entry;
    delete_entry.id = "delete";
    delete_entry.label = "Delete";
    delete_entry.secondary_label = core::CommandManager::get().label("explorer.delete");
    delete_entry.disabled = !has_local_selection;
    delete_entry.destructive = true;
    delete_entry.on_select = [this, &state]() {
        perform_delete_selected(state);
    };
    request.entries.push_back(std::move(delete_entry));

    request.entries.push_back(ContextMenuEntry::separator());

    ContextMenuEntry copy_path_entry;
    copy_path_entry.id = "copy_path";
    copy_path_entry.label = "Copy Path";
    copy_path_entry.disabled = target == nullptr;
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

    const bool has_clipboard = registry_.get_state<ClipboardState>("Clipboard").has_content();

    ContextMenuEntry paste_entry;
    paste_entry.id = "paste";
    paste_entry.label = "Paste";
    paste_entry.secondary_label = core::CommandManager::get().label("explorer.paste");
    paste_entry.disabled = !has_clipboard;
    paste_entry.on_select = [this, &state]() {
        perform_paste(state);
    };
    request.entries.push_back(std::move(paste_entry));

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
