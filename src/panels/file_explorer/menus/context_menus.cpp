#include "panels/file_explorer/file_explorer_panel.h"

#include <algorithm>
#include <filesystem>

#include "core/commands/command_manager.h"
#include "panels/context_menu/context_menu_state.h"
#include "panels/file_explorer/content/file_explorer_content_util.h"
#include "panels/file_explorer/state/clipboard_state.h"

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

    ImGui::OpenPopup("Rename");
    bool open = true;
    if (ImGui::BeginPopupModal("Rename", &open, ImGuiWindowFlags_AlwaysAutoResize)) {
        ImGui::InputTextWithHint("##rename_name", "Name", ui.rename_buffer, IM_ARRAYSIZE(ui.rename_buffer));
        const bool submitted = ImGui::IsItemDeactivatedAfterEdit() && ImGui::IsKeyPressed(ImGuiKey_Enter);

        if (ImGui::Button("Cancel", ImVec2(90.0f, 0.0f))) {
            ui.rename_buffer[0] = '\0';
            ui.rename_target_path.clear();
            ui.show_rename_modal = false;
            ImGui::CloseCurrentPopup();
        }
        ImGui::SameLine();
        if (ImGui::Button("Rename", ImVec2(90.0f, 0.0f)) || submitted) {
            perform_rename_from_modal(ui);
            ui.rename_buffer[0] = '\0';
            ui.rename_target_path.clear();
            ui.show_rename_modal = false;
            ImGui::CloseCurrentPopup();
        }

        ImGui::EndPopup();
    }
    if (!open) {
        ui.rename_buffer[0] = '\0';
        ui.rename_target_path.clear();
        ui.show_rename_modal = false;
    }
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
