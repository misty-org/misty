#include "panels/file_explorer/file_explorer_panel.h"

#include <algorithm>
#include <filesystem>

#include "core/commands/command_manager.h"
#include "panels/context_menu/context_menu_state.h"
#include "panels/file_explorer/content/file_explorer_content_util.h"
#include "panels/file_explorer/state/clipboard_state.h"
#include "panels/file_explorer/state/file_sidebar_state.h"

namespace misty::panel {
namespace {

std::string delete_target_label(const std::vector<std::string>& paths) {
    if (paths.empty()) {
        return "selected item";
    }
    if (paths.size() == 1) {
        const std::string filename = std::filesystem::path(paths.front()).filename().string();
        return filename.empty() ? paths.front() : filename;
    }
    return std::to_string(paths.size()) + " items";
}

bool can_create_entry_in(const std::string& path) {
    if (path.empty() || path.rfind("misty://", 0) == 0) {
        return false;
    }
    std::error_code ec;
    return std::filesystem::is_directory(path, ec) && !ec;
}

} // namespace

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
    const bool has_file_master_selection = selected_items_are_file_master_items(ui.selected_files, listing);
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
    copy_entry.disabled = !has_file_master_selection;
    copy_entry.on_select = [this, &state]() {
        perform_copy(state);
    };
    request.entries.push_back(std::move(copy_entry));

    ContextMenuEntry cut_entry;
    cut_entry.id = "cut";
    cut_entry.label = "Cut";
    cut_entry.secondary_label = core::CommandManager::get().label("explorer.cut");
    cut_entry.disabled = !has_file_master_selection;
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

    ContextMenuEntry new_folder_entry;
    new_folder_entry.id = "new_folder";
    new_folder_entry.label = "New Folder";
    new_folder_entry.disabled = !can_create_entry_in(std::string(state.current_path)) || rename_mode_active();
    new_folder_entry.on_select = [this, &state]() {
        create_new_entry_inline(state, true);
    };
    request.entries.push_back(std::move(new_folder_entry));

    ContextMenuEntry new_file_entry;
    new_file_entry.id = "new_file";
    new_file_entry.label = "New File";
    new_file_entry.disabled = !can_create_entry_in(std::string(state.current_path)) || rename_mode_active();
    new_file_entry.on_select = [this, &state]() {
        create_new_entry_inline(state, false);
    };
    request.entries.push_back(std::move(new_file_entry));

    request.entries.push_back(ContextMenuEntry::separator());

    ContextMenuEntry rename_entry;
    rename_entry.id = "rename";
    rename_entry.label = "Rename";
    rename_entry.secondary_label = core::CommandManager::get().label("explorer.rename");
    rename_entry.disabled = !has_file_master_selection;
    rename_entry.on_select = [this, &ui]() {
        initiate_rename(ui);
    };
    request.entries.push_back(std::move(rename_entry));

    ContextMenuEntry delete_entry;
    delete_entry.id = "delete";
    delete_entry.label = "Delete";
    delete_entry.secondary_label = core::CommandManager::get().label("explorer.delete");
    delete_entry.disabled = !has_file_master_selection;
    delete_entry.destructive = true;
    delete_entry.on_select = [this, &state]() {
        perform_delete_selected(state);
    };
    request.entries.push_back(std::move(delete_entry));

    request.entries.push_back(ContextMenuEntry::separator());

    auto& sidebar_state = registry_.get_state<FileSidebarState>("FileSidebar");
    const bool target_is_pinnable_dir = target != nullptr && target->is_dir && is_file_master_item(*target);
    const std::string target_pin_path = target ? target->path : std::string{};
    const std::string target_pin_key = normalize_quick_access_pin_path(target_pin_path);
    const bool target_is_pinned = !target_pin_key.empty() &&
                                  sidebar_state.pinned_quick_access_seen.count(target_pin_key) > 0;
    ContextMenuEntry pin_entry;
    pin_entry.id = target_is_pinned ? "unpin_quick_access" : "pin_quick_access";
    pin_entry.label = target_is_pinned ? "Unpin from Quick access" : "Pin to Quick access";
    pin_entry.disabled = !target_is_pinnable_dir;
    pin_entry.on_select = [this, target_pin_path, target_is_pinned]() {
        auto& sidebar_state = registry_.get_state<FileSidebarState>("FileSidebar");
        if (target_is_pinned) {
            unpin_quick_access_path(sidebar_state, target_pin_path);
        } else {
            pin_quick_access_path(sidebar_state, target_pin_path);
        }
    };
    request.entries.push_back(std::move(pin_entry));

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

void FileExplorerPanel::open_background_context_menu(FileExplorerState& state, FileExplorerPanel::TransientUiState& ui) {
    ContextMenuRequest request;
    request.source_key = state_key_;
    request.anchor_pos = ImGui::GetMousePos();
    if (ImGuiViewport* viewport = ImGui::GetWindowViewport()) {
        request.viewport_id = viewport->ID;
    }

    const bool has_clipboard = registry_.get_state<ClipboardState>("Clipboard").has_content();

    ContextMenuEntry new_folder_entry;
    new_folder_entry.id = "new_folder";
    new_folder_entry.label = "New Folder";
    new_folder_entry.disabled = !can_create_entry_in(std::string(state.current_path)) || rename_mode_active();
    new_folder_entry.on_select = [this, &state]() {
        create_new_entry_inline(state, true);
    };
    request.entries.push_back(std::move(new_folder_entry));

    ContextMenuEntry new_file_entry;
    new_file_entry.id = "new_file";
    new_file_entry.label = "New File";
    new_file_entry.disabled = !can_create_entry_in(std::string(state.current_path)) || rename_mode_active();
    new_file_entry.on_select = [this, &state]() {
        create_new_entry_inline(state, false);
    };
    request.entries.push_back(std::move(new_file_entry));

    request.entries.push_back(ContextMenuEntry::separator());

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
    if (ui.show_permanent_delete_modal || ImGui::IsPopupOpen("##file_delete_modal")) {
        ImGui::GetIO().WantCaptureMouse = true;
        ImGui::GetIO().WantCaptureKeyboard = true;
    }

    if (ui.show_permanent_delete_modal) {
        ImGui::OpenPopup("##file_delete_modal");
    }

    ImGui::SetNextWindowSize(ImVec2(360.0f, 0.0f), ImGuiCond_Always);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(18.0f, 16.0f));
    ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.075f, 0.085f, 0.105f, 1.0f));
    if (ImGui::BeginPopupModal("##file_delete_modal",
                               nullptr,
                               ImGuiWindowFlags_AlwaysAutoResize | ImGuiWindowFlags_NoTitleBar)) {
        const std::string target = delete_target_label(ui.permanent_delete_paths);
        ImGui::TextUnformatted("Delete File");
        ImGui::Dummy(ImVec2(0.0f, 8.0f));
        ImGui::TextWrapped("Delete \"%s\"? This cannot be undone.", target.c_str());
        ImGui::Dummy(ImVec2(0.0f, 12.0f));

        constexpr float button_w = 92.0f;
        ImGui::SetCursorPosX(ImGui::GetWindowWidth() - button_w * 2.0f - 28.0f);
        if (ImGui::Button("Cancel", ImVec2(button_w, 30.0f))) {
            ui.show_permanent_delete_modal = false;
            ui.permanent_delete_paths.clear();
            ImGui::CloseCurrentPopup();
        }
        ImGui::SameLine();
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.48f, 0.16f, 0.14f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.62f, 0.20f, 0.17f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.42f, 0.12f, 0.11f, 1.0f));
        if (ImGui::Button("Delete", ImVec2(button_w, 30.0f))) {
            confirm_permanent_delete(ui);
            ImGui::CloseCurrentPopup();
        }
        ImGui::PopStyleColor(3);

        ImGui::EndPopup();
    }
    ImGui::PopStyleColor();
    ImGui::PopStyleVar(2);
}

} // namespace misty::panel
