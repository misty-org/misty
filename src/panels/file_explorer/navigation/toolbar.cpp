#include "core/ui/ui_style.h"
#include "panels/file_explorer/file_explorer_panel.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>

#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"
#include "panels/file_explorer/navigation/history_util.h"
#include "panels/file_explorer/navigation/toolbar_util.h"
#include "panels/file_explorer/state/remote_mount_state.h"
#include "panels/search/search_state.h"
using namespace misty::core;

namespace misty::panel {
namespace {
namespace fs = std::filesystem;

constexpr ImVec4 kExplorerChromeBg = ImVec4(0.14f, 0.14f, 0.15f, 1.0f);
constexpr ImVec4 kExplorerChromeBgHover = ImVec4(0.18f, 0.18f, 0.20f, 1.0f);
constexpr ImVec4 kExplorerChromeBgActive = ImVec4(0.11f, 0.11f, 0.12f, 1.0f);
constexpr ImVec4 kTextEnabled(0.88f, 0.88f, 0.88f, 1.0f);
constexpr ImVec4 kTextDisabled(0.42f, 0.42f, 0.42f, 1.0f);
constexpr float kSearchShortcutButtonWidth = 42.0f;

bool nav_button(const char* label, const char* tooltip, bool enabled, const ImVec2& size) {
    bool pressed = false;
    UI::WithStyle([&](UI::StyleScope& style) {
        style.color(ImGuiCol_Button, kExplorerChromeBg);
        style.color(ImGuiCol_ButtonHovered, kExplorerChromeBgHover);
        style.color(ImGuiCol_ButtonActive, kExplorerChromeBgActive);
        style.color(ImGuiCol_Text, enabled ? kTextEnabled : kTextDisabled);
        pressed = ImGui::Button(label, size);
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip("%s", tooltip);
        }
    });
    return enabled && pressed;
}

bool can_create_sync_object_for_path(const std::string& path) {
    if (path.empty() || path.rfind("misty://", 0) == 0) {
        return false;
    }
    const std::string mount_root = get_mount_root();
    if (!mount_root.empty() && path.rfind(mount_root, 0) == 0) {
        return true;
    }
    std::error_code ec;
    return fs::is_directory(path, ec) && !ec;
}

void draw_toolbar_button_frame(const ImVec2& min, const ImVec2& max, bool hovered, bool active) {
    const ImU32 fill = active ? IM_COL32(28, 30, 35, 255)
                     : hovered ? IM_COL32(44, 48, 56, 255)
                               : IM_COL32(35, 38, 45, 255);
    ImDrawList* dl = ImGui::GetWindowDrawList();
    dl->AddRectFilled(min, max, fill, 7.0f);
    dl->AddRect(min, max, IM_COL32(62, 66, 76, 210), 7.0f);
}
} // namespace

void FileExplorerPanel::show_nav_history(FileExplorerState& state, float button_width, float spacing) {
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(6.0f, 6.0f));
    const ImVec2 button_size(button_width, ImGui::GetFrameHeight());

    const std::string current_path(state.current_path);
    bool can_back = !state.back_history.empty();
    std::string back_target;
    if (can_back) back_target = state.back_history.top();
    if (nav_button("<##history_back", can_back ? "Back" : "No previous folder", can_back, button_size)) {
        push_history_path(state.forward_history, current_path);
        std::string target = state.back_history.top();
        state.back_history.pop();
        navigate_to_path(target, false);
    }
    if (can_back) {
        const ImVec2 min = ImGui::GetItemRectMin();
        const ImVec2 max = ImGui::GetItemRectMax();
        handle_drag_navigation_target(state, back_target, min, max, true, [this, &state, back_target]() {
            if (state.back_history.empty()) return;
            push_history_path(state.forward_history, std::string(state.current_path));
            if (state.back_history.top() == back_target) {
                state.back_history.pop();
            }
            navigate_to_path(back_target, false);
        });
    }

    ImGui::SameLine(0, spacing);

    bool can_fwd = !state.forward_history.empty();
    std::string forward_target;
    if (can_fwd) forward_target = state.forward_history.top();
    if (nav_button(">##history_forward", can_fwd ? "Forward" : "No next folder", can_fwd, button_size)) {
        push_history_path(state.back_history, current_path);
        std::string target = state.forward_history.top();
        state.forward_history.pop();
        navigate_to_path(target, false);
    }
    if (can_fwd) {
        const ImVec2 min = ImGui::GetItemRectMin();
        const ImVec2 max = ImGui::GetItemRectMax();
        handle_drag_navigation_target(state, forward_target, min, max, true, [this, &state, forward_target]() {
            if (state.forward_history.empty()) return;
            push_history_path(state.back_history, std::string(state.current_path));
            if (state.forward_history.top() == forward_target) {
                state.forward_history.pop();
            }
            navigate_to_path(forward_target, false);
        });
    }

    ImGui::SameLine(0, spacing);
    ImGui::PushStyleColor(ImGuiCol_Button, kExplorerChromeBg);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, kExplorerChromeBgHover);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, kExplorerChromeBgActive);
    const char* refresh_icon_name = "sync-16";
    const ImVec4 refresh_tint(0.7f, 0.7f, 0.7f, 1.0f);

    auto& sync_tex = AssetManager::get().get_svg_texture(refresh_icon_name, oversampled_icon_size(16.0f));
    if (sync_tex.id != 0) {
        if (ImGui::ImageButton("##refresh", sync_tex.id, ImVec2(16, 16), ImVec2(0, 0), ImVec2(1, 1),
                ImVec4(0, 0, 0, 0), refresh_tint)) {
            request_manual_refresh(state);
        }
    } else if (ImGui::Button("R", ImVec2(button_width, 0))) {
        request_manual_refresh(state);
    }
    if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip("Refresh (%s)", CommandManager::get().label("explorer.refresh").c_str());
    }
    ImGui::PopStyleColor(3);
    ImGui::PopStyleVar(2);
}

void FileExplorerPanel::show_search_bar(FileExplorerState& state, SearchState& search_state) {
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(8, 6));
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);

    const float control_height = ImGui::GetFrameHeight();
    const float action_btn_size = std::max(16.0f, control_height - 10.0f);
    const float spacing = 3.0f;
    const float total_available = ImGui::GetContentRegionAvail().x;
    const float action_width = action_btn_size * 3.0f + kSearchShortcutButtonWidth + spacing * 3.0f;
    const float reserved_trailing_width = action_width + spacing;
    const float search_width = std::clamp(total_available - reserved_trailing_width - spacing, 96.0f, 360.0f);

    if (CommandManager::get().matches("search.toggle")) {
        search_state.is_open = true;
        search_state.focus_query = true;
    }

    ImGui::PushStyleColor(ImGuiCol_FrameBg, kExplorerChromeBg);
    ImGui::SetNextItemWidth(search_width);
    const bool search_submitted = ImGui::InputTextWithHint("##toolbar_search", "Search", search_state.query_buf,
                                                           sizeof(search_state.query_buf),
                                                           ImGuiInputTextFlags_EnterReturnsTrue);
    ImGui::PopStyleColor();
    if (ImGui::IsItemActivated()) {
        search_state.is_open = true;
        search_state.focus_query = true;
    }
    if (search_submitted || ImGui::IsItemEdited()) {
        search_state.is_open = true;
        search_state.search_pending = true;
        search_state.last_input_change_at = std::chrono::steady_clock::now();
    }

    ImGui::SameLine(0, spacing);
    ImGui::PushStyleColor(ImGuiCol_Button, kExplorerChromeBg);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, kExplorerChromeBgHover);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, kExplorerChromeBgActive);
    if (ImGui::Button("CmdF##togglesearch", ImVec2(kSearchShortcutButtonWidth, action_btn_size))) {
        if (search_panel_) {
            search_panel_->toggle();
        }
    }
    if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip("Search in folder (%s)", CommandManager::get().label("search.toggle").c_str());
    }
    ImGui::PopStyleColor(3);

    ImGui::PushStyleColor(ImGuiCol_Button, kExplorerChromeBg);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, kExplorerChromeBgHover);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, kExplorerChromeBgActive);

    const ImVec4 inactive_tint(0.7f, 0.7f, 0.7f, 1.0f);
    const ImVec4 active_tint(0.95f, 0.95f, 0.95f, 1.0f);

    ImGui::SameLine(0, spacing);
    const std::string current_path(state.current_path);
    const bool sync_enabled = can_create_sync_object_for_path(current_path);
    if (!sync_enabled) {
        ImGui::BeginDisabled();
    }
    auto& sync_object_tex = AssetManager::get().get_svg_texture("settings-sync-16", oversampled_icon_size(action_btn_size));
    if (sync_object_tex.id != 0) {
        if (ImGui::ImageButton("##createsyncobject", sync_object_tex.id, ImVec2(action_btn_size, action_btn_size),
                ImVec2(0, 0), ImVec2(1, 1), ImVec4(0, 0, 0, 0), inactive_tint)) {
            create_sync_object_for_current_directory(state);
        }
    } else if (ImGui::Button("+", ImVec2(action_btn_size, action_btn_size))) {
        create_sync_object_for_current_directory(state);
    }
    if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip("%s", sync_enabled
            ? "Create sync object for current folder"
            : "Open a local folder to create a sync object");
    }
    if (!sync_enabled) {
        ImGui::EndDisabled();
    }

    ImGui::SameLine(0, spacing);
    ImVec4 icon_tint = ui_.grid_view ? active_tint : inactive_tint;
    auto& grid_tex = AssetManager::get().get_svg_texture("apps-16", oversampled_icon_size(action_btn_size));
    if (grid_tex.id != 0) {
        if (ImGui::ImageButton("##gridview", grid_tex.id, ImVec2(action_btn_size, action_btn_size), ImVec2(0, 0), ImVec2(1, 1),
                ImVec4(0, 0, 0, 0), icon_tint)) {
            ui_.grid_view = true;
        }
    } else if (ImGui::Button("G", ImVec2(action_btn_size, action_btn_size))) {
        ui_.grid_view = true;
    }
    if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip("Grid View");
    }

    ImGui::SameLine(0, spacing);
    icon_tint = !ui_.grid_view ? active_tint : inactive_tint;
    auto& list_tex = AssetManager::get().get_svg_texture("rows-16", oversampled_icon_size(action_btn_size));
    if (list_tex.id != 0) {
        if (ImGui::ImageButton("##listview", list_tex.id, ImVec2(action_btn_size, action_btn_size), ImVec2(0, 0), ImVec2(1, 1),
                ImVec4(0, 0, 0, 0), icon_tint)) {
            ui_.grid_view = false;
        }
    } else if (ImGui::Button("L", ImVec2(action_btn_size, action_btn_size))) {
        ui_.grid_view = false;
    }
    if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip("List View");
    }

    ImGui::SameLine(0, spacing);
    if (ImGui::Button("...##more_actions", ImVec2(action_btn_size, action_btn_size))) {
        ImGui::OpenPopup("##toolbar_more_actions");
    }
    if (ImGui::BeginPopup("##toolbar_more_actions")) {
        if (ImGui::MenuItem("Refresh")) {
            request_manual_refresh(state);
        }
        if (ImGui::MenuItem("Create Sync Object", nullptr, false, sync_enabled)) {
            create_sync_object_for_current_directory(state);
        }
        ImGui::EndPopup();
    }

    ImGui::PopStyleColor(3);
    ImGui::PopStyleVar(2);
}

void FileExplorerPanel::show_path_control(FileExplorerState& state, float width) {
    const float height = ImGui::GetFrameHeight();
    const std::string current_path(state.current_path);
    if (ui_.breadcrumb_path != current_path) {
        ui_.breadcrumb_path = current_path;
        ui_.breadcrumb_segments = build_breadcrumb_segments(current_path);
    }

    if (ui_.path_bar_editing) {
        ImGui::PushStyleColor(ImGuiCol_FrameBg, kExplorerChromeBg);
        ImGui::PushStyleColor(ImGuiCol_FrameBgHovered, kExplorerChromeBgHover);
        ImGui::PushStyleColor(ImGuiCol_FrameBgActive, kExplorerChromeBgActive);
        ImGui::SetNextItemWidth(width);
        if (ui_.path_bar_focus) {
            ImGui::SetKeyboardFocusHere();
            ui_.path_bar_focus = false;
        }
        const bool submitted = ImGui::InputTextWithHint("##toolbar_path_input", "Enter file path",
                                                        state.search_path,
                                                        sizeof(state.search_path),
                                                        ImGuiInputTextFlags_EnterReturnsTrue |
                                                        ImGuiInputTextFlags_AutoSelectAll);
        const bool escape_pressed = ImGui::IsItemFocused() && ImGui::IsKeyPressed(ImGuiKey_Escape);
        if (submitted) {
            const std::string target(state.search_path);
            ui_.path_bar_editing = false;
            if (!target.empty()) {
                navigate_to_path(target, true, false);
            }
        } else if (escape_pressed || ImGui::IsItemDeactivated()) {
            ui_.path_bar_editing = false;
            std::strncpy(state.search_path, current_path.c_str(), sizeof(state.search_path) - 1);
            state.search_path[sizeof(state.search_path) - 1] = '\0';
        }
        ImGui::PopStyleColor(3);
        return;
    }

    const ImVec2 cursor = ImGui::GetCursorScreenPos();
    ImGui::InvisibleButton("##toolbar_path_breadcrumbs", ImVec2(width, height));
    const bool hovered = ImGui::IsItemHovered();
    const bool active = ImGui::IsItemActive();
    if (ImGui::IsItemClicked()) {
        std::strncpy(state.search_path, current_path.c_str(), sizeof(state.search_path) - 1);
        state.search_path[sizeof(state.search_path) - 1] = '\0';
        ui_.path_bar_editing = true;
        ui_.path_bar_focus = true;
    }
    draw_toolbar_button_frame(cursor, ImVec2(cursor.x + width, cursor.y + height), hovered, active);

    ImDrawList* dl = ImGui::GetWindowDrawList();
    const float icon_size = 18.0f;
    auto& home_tex = AssetManager::get().get_svg_texture("file-directory-open-fill-24", oversampled_icon_size(icon_size));
    const ImU32 text_col = IM_COL32(232, 236, 244, 255);
    const ImU32 muted_col = IM_COL32(142, 149, 162, 255);
    float x = cursor.x + 12.0f;
    const float y = cursor.y + (height - ImGui::GetTextLineHeight()) * 0.5f;
    if (home_tex.id != 0) {
        const ImVec2 icon_min(x, cursor.y + (height - icon_size) * 0.5f);
        dl->AddImage(home_tex.id, icon_min, ImVec2(icon_min.x + icon_size, icon_min.y + icon_size),
                     ImVec2(0, 0), ImVec2(1, 1), text_col);
        x += icon_size + 10.0f;
    }

    const ImVec2 clip_min(cursor.x + 8.0f, cursor.y);
    const ImVec2 clip_max(cursor.x + width - 8.0f, cursor.y + height);
    ImGui::PushClipRect(clip_min, clip_max, true);
    const auto& segments = ui_.breadcrumb_segments;
    const size_t start = segments.size() > 4 ? segments.size() - 4 : 0;
    if (start > 0) {
        dl->AddText(ImVec2(x, y), muted_col, "...");
        x += ImGui::CalcTextSize("...").x + 9.0f;
        dl->AddText(ImVec2(x, y), muted_col, "/");
        x += ImGui::CalcTextSize("/").x + 9.0f;
    }
    for (size_t index = start; index < segments.size(); ++index) {
        if (index > start) {
            dl->AddText(ImVec2(x, y), muted_col, "/");
            x += ImGui::CalcTextSize("/").x + 9.0f;
        }
        const bool last = index + 1 == segments.size();
        dl->AddText(ImVec2(x, y), last ? text_col : IM_COL32(200, 206, 218, 255),
                    segments[index].label.c_str());
        x += ImGui::CalcTextSize(segments[index].label.c_str()).x + 9.0f;
    }
    if (segments.empty()) {
        dl->AddText(ImVec2(x, y), muted_col, "Enter file path");
    }
    ImGui::PopClipRect();
    if (hovered) {
        ImGui::SetTooltip("Click to edit path");
    }
}

void FileExplorerPanel::show_breadcrumb_bar(FileExplorerState& state) {
    const std::string current_path(state.current_path);
    if (ui_.breadcrumb_path != current_path) {
        ui_.breadcrumb_path = current_path;
        ui_.breadcrumb_segments = build_breadcrumb_segments(current_path);
    }
    const auto& breadcrumbs = ui_.breadcrumb_segments;
    const float avail_width = ImGui::GetContentRegionAvail().x;
    constexpr float kBreadcrumbFramePaddingX = 6.0f;
    constexpr float kBreadcrumbSeparatorGap = 6.0f;
    float total_breadcrumb_width = 0.0f;
    for (size_t index = 0; index < breadcrumbs.size(); ++index) {
        if (index > 0) {
            total_breadcrumb_width += kBreadcrumbSeparatorGap;
            total_breadcrumb_width += ImGui::CalcTextSize("/").x;
            total_breadcrumb_width += kBreadcrumbSeparatorGap;
        }
        total_breadcrumb_width += ImGui::CalcTextSize(breadcrumbs[index].label.c_str()).x +
                                  kBreadcrumbFramePaddingX * 2.0f;
    }
    const bool allow_horizontal_scroll = total_breadcrumb_width > avail_width;
    ImGui::PushStyleVar(ImGuiStyleVar_ScrollbarSize, 4.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(kBreadcrumbFramePaddingX, 3.0f));
    ImGuiWindowFlags flags = ImGuiWindowFlags_NoScrollWithMouse;
    if (allow_horizontal_scroll) {
        flags |= ImGuiWindowFlags_HorizontalScrollbar;
    } else {
        flags |= ImGuiWindowFlags_NoScrollbar;
    }
    ImGui::BeginChild("##breadcrumbs", ImVec2(0.0f, 26.0f), false, flags);
    for (size_t index = 0; index < breadcrumbs.size(); ++index) {
        if (index > 0) {
            ImGui::SameLine(0.0f, 6.0f);
            ImGui::TextDisabled("/");
            ImGui::SameLine(0.0f, 6.0f);
        }
        const bool is_active = breadcrumbs[index].target_path == current_path;
        if (is_active) ImGui::BeginDisabled();
        if (ImGui::Button(breadcrumbs[index].label.c_str())) {
            navigate_to_path(breadcrumbs[index].target_path, true, false);
        }
        if (is_active) ImGui::EndDisabled();
        handle_file_drop_target(state,
                                breadcrumbs[index].target_path,
                                ImGui::GetItemRectMin(),
                                ImGui::GetItemRectMax(),
                                true,
                                !is_active);
    }
    ImGui::EndChild();
    ImGui::PopStyleVar(2);
}

void FileExplorerPanel::show_command_toolbar(FileExplorerState& state, SearchState& search_state) {
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(8.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 7.0f);

    show_nav_history(state, 30.0f, 2.0f);

    ImGui::SameLine(0.0f, 8.0f);
    UI::WithStyle([&](UI::StyleScope& style) {
        style.color(ImGuiCol_Button, kExplorerChromeBg);
        style.color(ImGuiCol_ButtonHovered, kExplorerChromeBgHover);
        style.color(ImGuiCol_ButtonActive, kExplorerChromeBgActive);
        if (ImGui::Button("^##path_up", ImVec2(34.0f, 0.0f))) {
            const std::string current(state.current_path);
            if (!current.empty() && current.rfind("misty://", 0) != 0) {
                fs::path parent = fs::path(current).parent_path();
                if (!parent.empty() && parent != fs::path(current)) {
                    navigate_to_path(parent.string(), true, false);
                }
            }
        }
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip("Up one folder");
        }
    });

    ImGui::SameLine(0.0f, 8.0f);
    const float available_after_nav = ImGui::GetContentRegionAvail().x;
    const float path_width = std::clamp(available_after_nav * 0.36f, 140.0f, 420.0f);
    show_path_control(state, path_width);

    ImGui::SameLine(0.0f, 14.0f);
    show_search_bar(state, search_state);

    ImGui::PopStyleVar(2);
}

} // namespace misty::panel
