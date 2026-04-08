#include "panels/file_explorer/file_explorer_panel.h"

#include <cstring>
#include <cstdio>

#include "core/commands/command_manager.h"
#include "core/file_picker/application_picker.h"
#include "core/manager/open_with_manager.h"
#include "core/system/util.h"
#include "panels/notification/notification_state.h"
#include "panels/search/search_state.h"
#include "panels/services/services_state.h"

namespace fs = std::filesystem;

using namespace misty::core;

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
    const UnifiedFileItem* file = find_context_menu_target(state);
    if (!file || file->is_dir || !fs::exists(file->path)) {
        return false;
    }

    auto associated_app = OpenWithManager::get().association_for_path(file->path);
    if (associated_app.has_value()) {
        return core::open_path_with_application(*associated_app, file->path);
    }

    return core::open_path_default(file->path);
}

void FileExplorerPanel::show_context_menu(FileExplorerState& state) {
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 8.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(10.0f, 6.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_PopupRounding, 6.0f);
    ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.15f, 0.15f, 0.15f, 0.95f));
    ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.3f, 0.3f, 0.3f, 0.6f));

    if (ImGui::BeginPopup("FileContextMenu")) {
        bool show_menu = false;
        for (const auto& f : state.files) {
            if (f.path == state.context_menu_target_path) {
                show_menu = true;
                break;
            }
        }

        if (show_menu) {
            bool is_trash_view = (std::string(state.current_path) == FileExplorerState::VIRTUAL_PATH_TRASH);
            const UnifiedFileItem* target_file = find_context_menu_target(state);
            const bool can_open_directly = target_file && !target_file->is_dir && fs::exists(target_file->path);
            bool all_local_available = !state.selected_files.empty();
            for (const auto& f : state.files) {
                if (state.selected_files.count(f.path) == 0) continue;
                bool is_avail = (f.status == SyncStatus::LOCAL || f.status == SyncStatus::SYNCED || f.status == SyncStatus::MODIFIED);
                if (!is_avail) {
                    all_local_available = false;
                    break;
                }
            }

            if (ImGui::MenuItem("Open", nullptr, false, can_open_directly)) {
                if (!open_context_menu_target(state)) {
                    auto& notif = registry_.get_state<NotificationState>("Notifications");
                    notif.add_notification("Open Failed", "Could not open file.", NotificationType::ERROR);
                }
            }

            if (ImGui::MenuItem("Open With...", nullptr, false, can_open_directly)) {
                std::string target_path = target_file ? target_file->path : "";
                if (!target_path.empty()) {
                    core::ApplicationPicker::pick([this, target_path](std::optional<std::string> app) {
                        if (!app.has_value()) return;
                        OpenWithManager::get().set_association_for_path(target_path, *app);
                        if (!core::open_path_with_application(*app, target_path)) {
                            auto& notif = registry_.get_state<NotificationState>("Notifications");
                            notif.add_notification("Open With Failed", "Could not open file.", NotificationType::ERROR);
                        }
                    });
                }
            }

            if (can_open_directly) {
                ImGui::Separator();
            }

            if (all_local_available) {
                if (ImGui::MenuItem("Copy", CommandManager::get().label("explorer.copy").c_str())) perform_copy(state);
                if (ImGui::MenuItem("Cut", CommandManager::get().label("explorer.cut").c_str())) perform_cut(state);
            } else {
                ImGui::MenuItem("Copy", CommandManager::get().label("explorer.copy").c_str(), false, false);
                ImGui::MenuItem("Cut", CommandManager::get().label("explorer.cut").c_str(), false, false);
            }

            bool can_paste = state.clipboard_op != ClipboardOp::NONE && !state.clipboard_items.empty();
            if (ImGui::MenuItem("Paste", CommandManager::get().label("explorer.paste").c_str(), false, can_paste)) perform_paste(state);

            ImGui::Separator();

            if (all_local_available && state.selected_files.size() == 1) {
                if (ImGui::MenuItem("Rename", CommandManager::get().label("explorer.rename").c_str())) initiate_rename(state);
            } else {
                ImGui::MenuItem("Rename", CommandManager::get().label("explorer.rename").c_str(), false, false);
            }

            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.4f, 0.4f, 1.0f));
            if (all_local_available || is_trash_view) {
                if (ImGui::MenuItem("Delete", "Del")) perform_delete_selected(state);
            } else {
                ImGui::MenuItem("Delete", "Del", false, false);
            }
            ImGui::PopStyleColor();

            ImGui::Separator();
            bool is_starred = state.is_starred(state.context_menu_target_path);
            if (ImGui::MenuItem(is_starred ? "Remove from Starred" : "Add to Starred")) {
                for (const auto& f : state.files) {
                    if (f.path != state.context_menu_target_path) continue;
                    state.toggle_star(f);
                    auto& notif = registry_.get_state<NotificationState>("Notifications");
                    notif.add_notification("Starred", is_starred ? "Removed from starred" : "Added to starred", NotificationType::SUCCESS);
                    break;
                }
            }

            ImGui::Separator();
            if (ImGui::MenuItem("New File")) {
                state.new_entry_is_dir = false;
                state.new_entry_name_buffer[0] = '\0';
                state.show_new_entry_modal = true;
            }
            if (ImGui::MenuItem("New Folder")) {
                state.new_entry_is_dir = true;
                state.new_entry_name_buffer[0] = '\0';
                state.show_new_entry_modal = true;
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
    if (state.show_rename_modal) {
        ImGui::OpenPopup("Rename##Modal");
    }

    ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
    ImGui::SetNextWindowSize(ImVec2(400, 0), ImGuiCond_Appearing);

    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(20.0f, 16.0f));
    ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.16f, 0.16f, 0.16f, 1.0f));

    if (ImGui::BeginPopupModal("Rename##Modal", &state.show_rename_modal, ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_AlwaysAutoResize)) {
        ImGui::Text("Enter new name:");
        ImGui::Spacing();

        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10, 8));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
        ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.21f, 0.21f, 0.21f, 1.0f));

        float width = ImGui::GetContentRegionAvail().x;
        ImGui::SetNextItemWidth(width);
        bool entered = ImGui::InputText("##rename_input", state.rename_buffer, sizeof(state.rename_buffer), ImGuiInputTextFlags_EnterReturnsTrue);
        if (ImGui::IsWindowAppearing()) ImGui::SetKeyboardFocusHere(-1);

        ImGui::PopStyleColor();
        ImGui::PopStyleVar(2);
        ImGui::Spacing();
        ImGui::Spacing();

        float button_width = (width - 8.0f) * 0.5f;
        bool confirm_shortcut = CommandManager::get().matches("modal.confirm");
        bool cancel_shortcut = CommandManager::get().matches("modal.cancel");

        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.5f, 0.9f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.6f, 1.0f, 1.0f));
        if (ImGui::Button("Rename", ImVec2(button_width, 32)) || entered || confirm_shortcut) {
            std::string new_name(state.rename_buffer);
            if (!new_name.empty() && !state.rename_target_path.empty()) {
                fs::path old_path(state.rename_target_path);
                fs::path new_path = old_path.parent_path() / new_name;
                std::error_code ec;
                fs::rename(old_path, new_path, ec);
                if (!ec) {
                    auto& notif = registry_.get_state<NotificationState>("Notifications");
                    notif.add_notification("Renamed", "Renamed to " + new_name, NotificationType::SUCCESS);
                    navigate_to_path(std::string(state.current_path), false);
                }
            }
            state.show_rename_modal = false;
            ImGui::CloseCurrentPopup();
        }
        ImGui::PopStyleColor(2);

        ImGui::SameLine(0, 8.0f);
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.4f, 0.4f, 0.4f, 1.0f));
        if (ImGui::Button("Cancel", ImVec2(button_width, 32)) || cancel_shortcut) {
            state.show_rename_modal = false;
            ImGui::CloseCurrentPopup();
        }
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar();
        ImGui::EndPopup();
    }

    ImGui::PopStyleColor();
    ImGui::PopStyleVar(2);
}

void FileExplorerPanel::show_background_context_menu(FileExplorerState& state) {
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 8.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(10.0f, 6.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_PopupRounding, 6.0f);
    ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.15f, 0.15f, 0.15f, 0.95f));
    ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.3f, 0.3f, 0.3f, 0.6f));

    if (ImGui::BeginPopup("BackgroundContextMenu")) {
        bool is_cloud = path_utils::is_remote_path(state.current_path);
        bool can_paste = state.clipboard_op != ClipboardOp::NONE && !state.clipboard_items.empty();
        if (ImGui::MenuItem("Paste", CommandManager::get().label("explorer.paste").c_str(), false, can_paste)) perform_paste(state);

        ImGui::Separator();
        if (ImGui::MenuItem("New File")) {
            state.new_entry_is_dir = false;
            state.new_entry_name_buffer[0] = '\0';
            state.show_new_entry_modal = true;
        }
        if (ImGui::MenuItem("New Folder")) {
            state.new_entry_is_dir = true;
            state.new_entry_name_buffer[0] = '\0';
            state.show_new_entry_modal = true;
        }

        if (!is_cloud) {
            ImGui::Separator();
            if (ImGui::MenuItem("Show Hidden Files", nullptr, state.show_hidden)) {
                state.show_hidden = !state.show_hidden;
                navigate_to_path(std::string(state.current_path), false);
            }
        }

        ImGui::EndPopup();
    }

    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar(3);
}

void FileExplorerPanel::show_new_entry_modal(FileExplorerState& state) {
    const char* title = state.new_entry_is_dir ? "New Folder##explorer" : "New File##explorer";

    if (state.show_new_entry_modal) {
        ImGui::OpenPopup(title);
        state.show_new_entry_modal = false;
    }

    ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
    ImGui::SetNextWindowSize(ImVec2(400, 0), ImGuiCond_Appearing);

    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(20.0f, 16.0f));
    ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.16f, 0.16f, 0.16f, 1.0f));

    if (ImGui::BeginPopupModal(title, nullptr, ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_AlwaysAutoResize)) {
        ImGui::Text("%s name:", state.new_entry_is_dir ? "Folder" : "File");
        ImGui::Spacing();

        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10, 8));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
        ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.21f, 0.21f, 0.21f, 1.0f));

        float width = ImGui::GetContentRegionAvail().x;
        ImGui::SetNextItemWidth(width);
        bool entered = ImGui::InputText("##new_entry_input", state.new_entry_name_buffer, sizeof(state.new_entry_name_buffer), ImGuiInputTextFlags_EnterReturnsTrue);
        if (ImGui::IsWindowAppearing()) ImGui::SetKeyboardFocusHere(-1);

        ImGui::PopStyleColor();
        ImGui::PopStyleVar(2);
        ImGui::Spacing();
        ImGui::Spacing();

        float button_width = (width - 8.0f) * 0.5f;
        bool confirm_shortcut = CommandManager::get().matches("modal.confirm");
        bool cancel_shortcut = CommandManager::get().matches("modal.cancel");

        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.5f, 0.9f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.6f, 1.0f, 1.0f));
        if (ImGui::Button("Create##new_entry", ImVec2(button_width, 32)) || entered || confirm_shortcut) {
            std::string name(state.new_entry_name_buffer);
            std::string current_dir(state.current_path);
            bool is_cloud_dir = path_utils::is_remote_path(current_dir);

            if (!name.empty()) {
                fs::path p = fs::path(current_dir) / name;
                std::error_code ec;

                if (state.new_entry_is_dir) {
                    fs::create_directory(p, ec);
                    if (!ec && is_cloud_dir) {
                        auto [remote_name, remote_path] = path_utils::parse_remote_name_and_path(current_dir);
                        if (!remote_name.empty()) {
                            std::string folder_path = remote_path.empty() ? name : remote_path + "/" + name;
                            auto& services = registry_.get_state<ServicesState>("Services");
                            services.create_folder(remote_name, folder_path,
                                [this, name](bool success, const std::string&, const std::string& error) {
                                    auto& notif = registry_.get_state<NotificationState>("Notifications");
                                    if (success) notif.add_notification("Created", "Folder " + name + " created", NotificationType::SUCCESS);
                                    else notif.add_notification("Cloud Error", "Failed to create folder: " + error, NotificationType::ERROR);
                                });
                        }
                    }
                } else {
                    if (auto f = std::fopen(p.string().c_str(), "w")) std::fclose(f);
                    if (is_cloud_dir) trigger_upload(p.string(), current_dir);
                }

                if (!ec) {
                    auto& notif = registry_.get_state<NotificationState>("Notifications");
                    notif.add_notification("Created", std::string(state.new_entry_is_dir ? "Folder " : "File ") + name + " created", NotificationType::SUCCESS);
                    navigate_to_path(current_dir, false);
                }
            }
            state.new_entry_name_buffer[0] = '\0';
            ImGui::CloseCurrentPopup();
        }
        ImGui::PopStyleColor(2);

        ImGui::SameLine(0, 8.0f);
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.4f, 0.4f, 0.4f, 1.0f));
        if (ImGui::Button("Cancel##new_entry", ImVec2(button_width, 32)) || cancel_shortcut) {
            state.new_entry_name_buffer[0] = '\0';
            ImGui::CloseCurrentPopup();
        }
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar();
        ImGui::EndPopup();
    }

    ImGui::PopStyleColor();
    ImGui::PopStyleVar(2);
}

} // namespace misty::panel
