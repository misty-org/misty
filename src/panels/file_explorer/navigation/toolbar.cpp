#include "panels/file_explorer/file_explorer_panel.h"

#include <algorithm>
#include <chrono>
#include <cstring>
#include <filesystem>

#include "core/manager/asset_manager.h"
#include "panels/file_explorer/content/file_explorer_content_util.h"
#include "panels/file_explorer/navigation/history_util.h"
#include "panels/file_explorer/navigation/toolbar_util.h"
#include "panels/file_explorer/state/clipboard_state.h"
#include "panels/file_explorer/state/remote_mount_state.h"
using namespace misty::core;

namespace misty::panel {
namespace {
namespace fs = std::filesystem;

constexpr ImVec4 kExplorerChromeBg = ImVec4(0.14f, 0.14f, 0.15f, 1.0f);
constexpr ImVec4 kExplorerChromeBgHover = ImVec4(0.18f, 0.18f, 0.20f, 1.0f);
constexpr ImVec4 kExplorerChromeBgActive = ImVec4(0.11f, 0.11f, 0.12f, 1.0f);
constexpr ImVec4 kTextDisabled(0.42f, 0.42f, 0.42f, 1.0f);
constexpr float kToolbarButtonSize = 34.0f;
constexpr float kToolbarIconSize = 18.0f;
constexpr float kCommandToolbarGap = 14.0f;
constexpr float kActionToolbarGap = 14.0f;
constexpr float kActionButtonWidth = 34.0f;
constexpr float kNewButtonWidth = 104.0f;
constexpr float kToolbarRightPadX = 8.0f;
constexpr float kViewToggleWidth = 76.0f;

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

bool can_create_entry_for_path(const std::string& path) {
    if (path.empty() || path.rfind("misty://", 0) == 0) {
        return false;
    }
    std::error_code ec;
    return fs::is_directory(path, ec) && !ec;
}

std::string parent_path_for(const std::string& path) {
    if (path.empty()) {
        return {};
    }
    fs::path current(path);
    fs::path parent = current.parent_path();
    if (parent.empty() || parent == current) {
        return {};
    }
    return parent.string();
}

void draw_toolbar_button_frame(const ImVec2& min, const ImVec2& max, bool hovered, bool active) {
    const ImU32 fill = active ? IM_COL32(29, 32, 38, 255)
                     : hovered ? IM_COL32(41, 45, 54, 255)
                               : IM_COL32(31, 34, 40, 255);
    ImDrawList* dl = ImGui::GetWindowDrawList();
    dl->AddRectFilled(min, max, fill, 8.0f);
    dl->AddRect(min, max, hovered ? IM_COL32(72, 82, 104, 230) : IM_COL32(46, 50, 60, 190), 8.0f);
}

void draw_grid_toggle_icon(const ImVec2& center, float icon_size, ImU32 tint) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    const float cell_size = std::max(3.0f, icon_size * 0.28f);
    const float gap = std::max(2.0f, icon_size * 0.10f);
    const float total = cell_size * 2.0f + gap;
    const ImVec2 start(center.x - total * 0.5f, center.y - total * 0.5f);

    for (int row = 0; row < 2; ++row) {
        for (int col = 0; col < 2; ++col) {
            const ImVec2 cell_min(start.x + col * (cell_size + gap),
                                  start.y + row * (cell_size + gap));
            const ImVec2 cell_max(cell_min.x + cell_size, cell_min.y + cell_size);
            dl->AddRectFilled(cell_min, cell_max, tint, 2.0f);
        }
    }
}

void draw_icon_at(const char* icon_path, const ImVec2& center, float icon_size, ImU32 tint);

bool toolbar_icon_button(const char* id,
                         const char* icon_path,
                         const char* tooltip,
                         bool enabled,
                         const ImVec2& size,
                         float icon_size = kToolbarIconSize,
                         ImVec4 active_tint = ImVec4(0.88f, 0.88f, 0.88f, 1.0f),
                         ImVec4 disabled_tint = kTextDisabled) {
    ImGui::PushID(id);
    const bool pressed = ImGui::InvisibleButton("##toolbar_icon", size);
    const bool hovered = enabled && ImGui::IsItemHovered();
    const bool active = enabled && ImGui::IsItemActive();
    const ImVec2 min = ImGui::GetItemRectMin();
    const ImVec2 max = ImGui::GetItemRectMax();
    ImGui::PopID();

    if (hovered || active) {
        ImDrawList* dl = ImGui::GetWindowDrawList();
        const ImU32 fill = active ? IM_COL32(255, 255, 255, 30) : IM_COL32(255, 255, 255, 18);
        dl->AddRectFilled(min, max, fill, 8.0f);
    }
    auto& tex = AssetManager::get().get_svg_texture_path(icon_path, oversampled_icon_size(icon_size));
    if (tex.id != 0) {
        const ImVec2 icon_min(min.x + (size.x - icon_size) * 0.5f,
                              min.y + (size.y - icon_size) * 0.5f);
        const ImVec4 tint = enabled ? active_tint : disabled_tint;
        ImGui::GetWindowDrawList()->AddImage(tex.id,
                                             icon_min,
                                             ImVec2(icon_min.x + icon_size, icon_min.y + icon_size),
                                             ImVec2(0, 0),
                                             ImVec2(1, 1),
                                             ImGui::ColorConvertFloat4ToU32(tint));
    }
    if (hovered && tooltip) {
        ImGui::SetTooltip("%s", tooltip);
    }
    return enabled && pressed;
}

bool toolbar_text_icon_button(const char* id,
                              const char* icon_path,
                              const char* label,
                              const char* trailing_icon_path,
                              const char* tooltip,
                              bool enabled,
                              const ImVec2& size) {
    ImGui::PushID(id);
    const bool pressed = ImGui::InvisibleButton("##toolbar_text_icon", size);
    const bool hovered = enabled && ImGui::IsItemHovered();
    const bool active = enabled && ImGui::IsItemActive();
    const ImVec2 min = ImGui::GetItemRectMin();
    const ImVec2 max = ImGui::GetItemRectMax();
    ImGui::PopID();

    draw_toolbar_button_frame(min, max, hovered, active);

    const ImU32 tint = ImGui::ColorConvertFloat4ToU32(enabled ? ImVec4(0.88f, 0.88f, 0.88f, 1.0f) : kTextDisabled);
    constexpr float icon_size = 16.0f;
    constexpr float leading_pad = 14.0f;
    constexpr float icon_label_gap = 8.0f;
    constexpr float trailing_pad = 15.0f;
    constexpr float trailing_icon_size = 12.0f;
    float x = min.x + leading_pad;
    const float center_y = min.y + size.y * 0.5f;

    draw_icon_at(icon_path, ImVec2(x + icon_size * 0.5f, center_y), icon_size, tint);
    x += icon_size + icon_label_gap;
    const ImVec2 label_size = ImGui::CalcTextSize(label ? label : "");
    ImGui::GetWindowDrawList()->AddText(ImVec2(x, min.y + (size.y - label_size.y) * 0.5f),
                                        tint,
                                        label ? label : "");

    if (trailing_icon_path) {
        draw_icon_at(trailing_icon_path,
                     ImVec2(max.x - trailing_pad - trailing_icon_size * 0.5f, center_y),
                     trailing_icon_size,
                     tint);
    }

    if (hovered && tooltip) {
        ImGui::SetTooltip("%s", tooltip);
    }
    return enabled && pressed;
}

bool popup_action_row(const char* id,
                      const char* icon_path,
                      const char* label,
                      bool enabled,
                      const ImVec2& size,
                      float icon_size = 18.0f) {
    ImGui::PushID(id);
    const bool pressed = ImGui::InvisibleButton("##popup_action", size);
    const bool hovered = enabled && ImGui::IsItemHovered();
    const bool active = enabled && ImGui::IsItemActive();
    const ImVec2 min = ImGui::GetItemRectMin();
    const ImVec2 max = ImGui::GetItemRectMax();
    ImGui::PopID();

    ImDrawList* dl = ImGui::GetWindowDrawList();
    if (hovered || active) {
        dl->AddRectFilled(min,
                          max,
                          active ? IM_COL32(255, 255, 255, 30) : IM_COL32(255, 255, 255, 18),
                          7.0f);
    }

    const ImU32 icon_tint = enabled ? IM_COL32(176, 184, 198, 235) : IM_COL32(120, 126, 138, 160);
    const ImU32 text_tint = enabled ? IM_COL32(226, 231, 240, 245) : IM_COL32(130, 136, 148, 170);
    const float center_y = min.y + size.y * 0.5f;
    draw_icon_at(icon_path, ImVec2(min.x + 20.0f, center_y), icon_size, icon_tint);

    const ImVec2 label_size = ImGui::CalcTextSize(label ? label : "");
    dl->AddText(ImVec2(min.x + 42.0f, min.y + (size.y - label_size.y) * 0.5f),
                text_tint,
                label ? label : "");

    return enabled && pressed;
}

void draw_icon_at(const char* icon_path, const ImVec2& center, float icon_size, ImU32 tint) {
    auto& tex = AssetManager::get().get_svg_texture_path(icon_path, oversampled_icon_size(icon_size));
    if (tex.id == 0) {
        return;
    }
    const ImVec2 min(center.x - icon_size * 0.5f, center.y - icon_size * 0.5f);
    ImGui::GetWindowDrawList()->AddImage(tex.id,
                                         min,
                                         ImVec2(min.x + icon_size, min.y + icon_size),
                                         ImVec2(0, 0),
                                         ImVec2(1, 1),
                                         tint);
}
} // namespace

void FileExplorerPanel::show_nav_history(FileExplorerState& state, float button_width, float spacing) {
    const ImVec2 button_size(button_width, button_width);

    const std::string current_path(state.current_path);
    bool can_back = !state.back_history.empty();
    std::string back_target;
    if (can_back) back_target = state.back_history.top();
    if (toolbar_icon_button("history_back",
                            "assets/icons/arrow-left-24.svg",
                            can_back ? "Back" : "No previous folder",
                            can_back,
                            button_size)) {
        push_history_path(state.forward_history, current_path);
        std::string target = state.back_history.top();
        state.back_history.pop();
        navigate_to_path(target, false);
    }
    ImGui::SameLine(0, spacing);

    bool can_fwd = !state.forward_history.empty();
    std::string forward_target;
    if (can_fwd) forward_target = state.forward_history.top();
    if (toolbar_icon_button("history_forward",
                            "assets/icons/arrow-right-24.svg",
                            can_fwd ? "Forward" : "No next folder",
                            can_fwd,
                            button_size)) {
        push_history_path(state.back_history, current_path);
        std::string target = state.forward_history.top();
        state.forward_history.pop();
        navigate_to_path(target, false);
    }
    ImGui::SameLine(0, spacing);

    const std::string parent_path = parent_path_for(current_path);
    const bool can_go_up = !parent_path.empty();
    if (toolbar_icon_button("history_up",
                            "assets/icons/arrow-up-24.svg",
                            can_go_up ? "Up" : "No parent folder",
                            can_go_up,
                            button_size)) {
        navigate_to_path(parent_path, true, false);
    }
}

void FileExplorerPanel::show_toolbar_actions(FileExplorerState& state) {
    const ImVec4 inactive_tint(0.7f, 0.7f, 0.7f, 1.0f);
    const ImVec2 button_size(kToolbarButtonSize, kToolbarButtonSize);

    show_view_mode_toggle();

    ImGui::SameLine(0, kActionToolbarGap);
    if (toolbar_icon_button("more_actions",
                            "assets/icons/kebab-horizontal-24.svg",
                            "More",
                            true,
                            button_size,
                            kToolbarIconSize,
                            inactive_tint)) {
        ImGui::OpenPopup("##toolbar_more_actions");
    }
    if (ImGui::BeginPopup("##toolbar_more_actions")) {
        if (ImGui::MenuItem("Refresh")) {
            request_manual_refresh(state);
        }
        ImGui::EndPopup();
    }
}

void FileExplorerPanel::show_file_action_toolbar(FileExplorerState& state) {
    const ImVec2 button_size(kActionButtonWidth, kToolbarButtonSize);
    const ImVec4 disabled_action_tint(0.86f, 0.88f, 0.92f, 0.40f);
    const auto& listing = active_listing();
    const bool rename_active = rename_mode_active();
    const bool has_file_master_selection = selected_items_are_file_master_items(ui_.selected_files, listing);
    const bool has_single_file_master_selection = exactly_one_file_master_item_selected(ui_.selected_files, listing);
    const bool has_clipboard = registry_.get_state<ClipboardState>("Clipboard").has_content();
    const bool can_create = !rename_active && can_create_entry_for_path(std::string(state.current_path));

    const bool new_pressed = toolbar_text_icon_button("new_entry",
                                                      "assets/icons/plus-24.svg",
                                                      "New",
                                                      "assets/icons/chevron-down-24.svg",
                                                      "New",
                                                      can_create,
                                                      ImVec2(kNewButtonWidth, kToolbarButtonSize));
    const ImVec2 new_button_min = ImGui::GetItemRectMin();
    const ImVec2 new_button_max = ImGui::GetItemRectMax();
    if (new_pressed) {
        ImGui::OpenPopup("##file_action_new");
    }
    ImGui::SetNextWindowPos(ImVec2(new_button_min.x, new_button_max.y + 6.0f), ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(176.0f, 0.0f), ImGuiCond_Always);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(8.0f, 8.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 4.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_PopupRounding, 8.0f);
    ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.07f, 0.085f, 0.105f, 0.98f));
    if (ImGui::BeginPopup("##file_action_new")) {
        const float popup_width = ImGui::GetContentRegionAvail().x;
        if (popup_action_row("new_folder",
                             "assets/icons/file-directory-24.svg",
                             "Folder",
                             can_create,
                             ImVec2(popup_width, 38.0f),
                             18.0f)) {
            create_new_entry_inline(state, true);
            ImGui::CloseCurrentPopup();
        }
        if (popup_action_row("new_file",
                             "assets/icons/file-16.svg",
                             "File",
                             can_create,
                             ImVec2(popup_width, 38.0f),
                             16.0f)) {
            create_new_entry_inline(state, false);
            ImGui::CloseCurrentPopup();
        }
        ImGui::EndPopup();
    }
    ImGui::PopStyleColor();
    ImGui::PopStyleVar(3);

    ImGui::SameLine(0.0f, kCommandToolbarGap);
    if (toolbar_icon_button("cut_selection",
                            "assets/icons/cut-24.svg",
                            "Cut",
                            has_file_master_selection && !rename_active,
                            button_size,
                            kToolbarIconSize,
                            ImVec4(0.88f, 0.88f, 0.88f, 1.0f),
                            disabled_action_tint)) {
        perform_cut(state);
    }

    ImGui::SameLine(0.0f, kActionToolbarGap);
    if (toolbar_icon_button("copy_selection",
                            "assets/icons/copy-24.svg",
                            "Copy",
                            has_file_master_selection && !rename_active,
                            button_size,
                            kToolbarIconSize,
                            ImVec4(0.88f, 0.88f, 0.88f, 1.0f),
                            disabled_action_tint)) {
        perform_copy(state);
    }

    ImGui::SameLine(0.0f, kActionToolbarGap);
    if (toolbar_icon_button("paste_selection",
                            "assets/icons/paste-24.svg",
                            "Paste",
                            has_clipboard && !rename_active,
                            button_size,
                            kToolbarIconSize,
                            ImVec4(0.88f, 0.88f, 0.88f, 1.0f),
                            disabled_action_tint)) {
        perform_paste(state);
    }

    ImGui::SameLine(0.0f, kActionToolbarGap);
    if (toolbar_icon_button("rename_selection",
                            "assets/icons/rename-24.svg",
                            "Rename",
                            has_file_master_selection,
                            button_size,
                            kToolbarIconSize,
                            ImVec4(0.88f, 0.88f, 0.88f, 1.0f),
                            disabled_action_tint)) {
        initiate_rename(ui_);
    }

    ImGui::SameLine(0.0f, kActionToolbarGap);
    if (toolbar_icon_button("delete_selection",
                            "assets/icons/trash-24.svg",
                            "Delete",
                            has_file_master_selection && !rename_active,
                            button_size,
                            kToolbarIconSize,
                            ImVec4(0.88f, 0.88f, 0.88f, 1.0f),
                            disabled_action_tint)) {
        perform_delete_selected(state);
    }

    bool show_rename_status = false;
    {
        auto& session = rename_session_state();
        std::lock_guard<std::mutex> lock(session.mu);
        show_rename_status = session.active;
    }
    if (show_rename_status) {
        ImGui::SameLine(0.0f, kActionToolbarGap);
        const float status_width = std::max(260.0f, ImGui::GetWindowContentRegionMax().x - ImGui::GetCursorPosX() - 140.0f);
        render_rename_status_banner(status_width);
    }

    const float right_controls_width = kViewToggleWidth + kActionToolbarGap + kToolbarButtonSize;
    const float next_action_x = ImGui::GetCursorPosX() + kActionToolbarGap;
    const float right_aligned_x = ImGui::GetWindowContentRegionMax().x - kToolbarRightPadX - right_controls_width;
    ImGui::SameLine(std::max(next_action_x, right_aligned_x), 0.0f);
    show_toolbar_actions(state);
}

void FileExplorerPanel::show_path_control(FileExplorerState& state, float width) {
    const float height = ImGui::GetFrameHeight();
    const std::string current_path(state.current_path);
    if (ui_.breadcrumb_path != current_path) {
        ui_.breadcrumb_path = current_path;
        ui_.breadcrumb_segments = build_breadcrumb_segments(current_path);
        ui_.path_bar_scroll_to_end = true;
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
    const bool bar_clicked = ImGui::IsItemClicked();
    draw_toolbar_button_frame(cursor, ImVec2(cursor.x + width, cursor.y + height), hovered, active);

    ImDrawList* dl = ImGui::GetWindowDrawList();
    const ImU32 text_col = IM_COL32(232, 236, 244, 255);
    const ImU32 muted_col = IM_COL32(142, 149, 162, 255);
    const ImU32 hover_col = IM_COL32(255, 255, 255, 20);
    const ImU32 chip_active_col = IM_COL32(255, 255, 255, 32);
    const float content_origin_x = cursor.x + 12.0f;
    float content_width = 0.0f;
    const auto& segments = ui_.breadcrumb_segments;
    for (size_t index = 0; index < segments.size(); ++index) {
        if (index > 0) {
            content_width += ImGui::CalcTextSize(">").x + 11.0f;
        }
        content_width += ImGui::CalcTextSize(segments[index].label.c_str()).x + 13.0f;
    }
    content_width += 12.0f;

    const float viewport_width = std::max(1.0f, width - 16.0f);
    const float max_scroll = std::max(0.0f, content_width - viewport_width);
    if (ui_.path_bar_scroll_to_end) {
        ui_.path_bar_scroll_x = max_scroll;
        ui_.path_bar_scroll_to_end = false;
    }
    if (hovered) {
        ImGuiIO& io = ImGui::GetIO();
        float scroll_delta = io.MouseWheelH;
        if (scroll_delta == 0.0f && io.KeyShift) {
            scroll_delta = io.MouseWheel;
        }
        if (scroll_delta != 0.0f) {
            ui_.path_bar_scroll_x = std::clamp(ui_.path_bar_scroll_x - scroll_delta * 38.0f, 0.0f, max_scroll);
        }
    }
    ui_.path_bar_scroll_x = std::clamp(ui_.path_bar_scroll_x, 0.0f, max_scroll);

    float x = content_origin_x - ui_.path_bar_scroll_x;
    const float y = cursor.y + (height - ImGui::GetTextLineHeight()) * 0.5f;

    const ImVec2 clip_min(cursor.x + 8.0f, cursor.y);
    const ImVec2 clip_max(cursor.x + width - 8.0f, cursor.y + height);
    ImGui::PushClipRect(clip_min, clip_max, true);
    bool segment_clicked = false;
    bool segment_hovered = false;

    for (size_t index = 0; index < segments.size(); ++index) {
        if (index > 0) {
            dl->AddText(ImVec2(x, y), muted_col, ">");
            x += ImGui::CalcTextSize(">").x + 11.0f;
        }
        const bool last = index + 1 == segments.size();
        const ImVec2 label_size = ImGui::CalcTextSize(segments[index].label.c_str());
        const ImVec2 chip_min(x - 8.0f, cursor.y + 5.0f);
        const ImVec2 chip_max(x + label_size.x + 8.0f, cursor.y + height - 5.0f);
        const ImVec2 visible_chip_min(std::max(chip_min.x, clip_min.x), chip_min.y);
        const ImVec2 visible_chip_max(std::min(chip_max.x, clip_max.x), chip_max.y);
        const bool chip_visible = visible_chip_max.x > visible_chip_min.x;
        const bool chip_hovered = chip_visible && ImGui::IsMouseHoveringRect(visible_chip_min, visible_chip_max);
        if (chip_hovered) {
            segment_hovered = true;
            dl->AddRectFilled(chip_min, chip_max, active && bar_clicked ? chip_active_col : hover_col, 5.0f);
            if (bar_clicked) {
                segment_clicked = true;
                navigate_to_path(segments[index].target_path, true, false);
            }
        }
        dl->AddText(ImVec2(x, y), last ? text_col : IM_COL32(200, 206, 218, 255),
                    segments[index].label.c_str());
        x += label_size.x + 13.0f;
    }
    if (segments.empty()) {
        dl->AddText(ImVec2(x, y), muted_col, "Enter file path");
    }
    ImGui::PopClipRect();

    if (max_scroll > 0.0f) {
        const float track_x = cursor.x + 12.0f;
        const float track_y = cursor.y + height - 4.0f;
        const float track_w = width - 24.0f;
        const float thumb_w = std::clamp((viewport_width / content_width) * track_w, 28.0f, track_w);
        const float thumb_x = track_x + (max_scroll <= 0.0f ? 0.0f : (ui_.path_bar_scroll_x / max_scroll) * (track_w - thumb_w));
        dl->AddRectFilled(ImVec2(track_x, track_y), ImVec2(track_x + track_w, track_y + 2.0f),
                          IM_COL32(255, 255, 255, 24), 1.0f);
        dl->AddRectFilled(ImVec2(thumb_x, track_y), ImVec2(thumb_x + thumb_w, track_y + 2.0f),
                          IM_COL32(145, 190, 255, 145), 1.0f);
    }

    if (bar_clicked && !segment_clicked) {
        std::strncpy(state.search_path, current_path.c_str(), sizeof(state.search_path) - 1);
        state.search_path[sizeof(state.search_path) - 1] = '\0';
        ui_.path_bar_editing = true;
        ui_.path_bar_focus = true;
    }
    if (hovered) {
        ImGui::SetTooltip("%s", segment_hovered ? "Open folder" : "Edit path");
    }
}

void FileExplorerPanel::show_search_field(FileExplorerState& state, float width) {
    (void)state;
    const float height = ImGui::GetFrameHeight();
    const char* placeholder = "Search or run command";
    ImGui::InvisibleButton("##toolbar_search_trigger", ImVec2(width, height));
    const bool hovered = ImGui::IsItemHovered();
    const bool active = ImGui::IsItemActive();
    const bool activated = ImGui::IsItemActivated();
    const bool clicked = ImGui::IsItemClicked();
    const ImVec2 min = ImGui::GetItemRectMin();
    const ImVec2 max = ImGui::GetItemRectMax();
    draw_toolbar_button_frame(min, max, hovered, active);
    draw_icon_at("assets/icons/search-24.svg",
                 ImVec2(min.x + 17.0f, min.y + height * 0.5f),
                 16.0f,
                 IM_COL32(180, 186, 198, 235));
    const ImU32 text_color = IM_COL32(148, 156, 171, 235);
    ImGui::GetWindowDrawList()->AddText(ImVec2(min.x + 34.0f, min.y + (height - ImGui::GetTextLineHeight()) * 0.5f),
                                        text_color,
                                        placeholder);

    if ((activated || clicked) && search_palette_open_handler_) {
        search_palette_open_handler_();
    }
}

void FileExplorerPanel::show_view_mode_toggle() {
    constexpr float kToggleWidth = 76.0f;
    constexpr float kHalfWidth = kToggleWidth * 0.5f;
    const ImVec2 cursor = ImGui::GetCursorScreenPos();
    const ImVec2 total_size(kToggleWidth, kToolbarButtonSize);

    ImGui::PushID("view_mode_toggle");
    ImGui::InvisibleButton("##grid", ImVec2(kHalfWidth, kToolbarButtonSize));
    const bool grid_pressed = ImGui::IsItemClicked();
    const bool grid_hovered = ImGui::IsItemHovered();
    if (grid_hovered) {
        ImGui::SetTooltip("Grid View");
    }
    ImGui::SameLine(0.0f, 0.0f);
    ImGui::InvisibleButton("##list", ImVec2(kHalfWidth, kToolbarButtonSize));
    const bool list_pressed = ImGui::IsItemClicked();
    const bool list_hovered = ImGui::IsItemHovered();
    if (list_hovered) {
        ImGui::SetTooltip("List View");
    }
    ImGui::PopID();

    if (grid_pressed) {
        ui_.grid_view = true;
    }
    if (list_pressed) {
        ui_.grid_view = false;
    }

    ImDrawList* dl = ImGui::GetWindowDrawList();
    const ImVec2 max(cursor.x + total_size.x, cursor.y + total_size.y);
    dl->AddRectFilled(cursor, max, IM_COL32(31, 34, 40, 255), 8.0f);
    dl->AddRect(cursor, max,
                (grid_hovered || list_hovered) ? IM_COL32(72, 82, 104, 230) : IM_COL32(46, 50, 60, 190),
                8.0f);

    const bool grid_active = ui_.grid_view;
    const ImVec2 active_min = grid_active ? cursor : ImVec2(cursor.x + kHalfWidth, cursor.y);
    const ImVec2 active_max = ImVec2(active_min.x + kHalfWidth, cursor.y + kToolbarButtonSize);
    dl->AddRectFilled(active_min, active_max, IM_COL32(48, 55, 69, 245), 7.0f,
                      grid_active ? ImDrawFlags_RoundCornersLeft : ImDrawFlags_RoundCornersRight);

    draw_grid_toggle_icon(ImVec2(cursor.x + kHalfWidth * 0.5f, cursor.y + kToolbarButtonSize * 0.5f),
                          18.0f,
                          grid_active ? IM_COL32(240, 244, 250, 255) : IM_COL32(170, 176, 188, 235));
    draw_icon_at("assets/icons/rows-24.svg",
                 ImVec2(cursor.x + kHalfWidth + kHalfWidth * 0.5f, cursor.y + kToolbarButtonSize * 0.5f),
                 18.0f,
                 !grid_active ? IM_COL32(240, 244, 250, 255) : IM_COL32(170, 176, 188, 235));
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
    }
    ImGui::EndChild();
    ImGui::PopStyleVar(2);
}

void FileExplorerPanel::show_command_toolbar(FileExplorerState& state) {
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(kCommandToolbarGap, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 7.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(8.0f, 8.0f));

    const float viewport_width = std::max(0.0f, ImGui::GetContentRegionAvail().x - kToolbarRightPadX);
    constexpr float kSearchMinWidth = 140.0f;
    constexpr float kSearchPreferredWidth = 240.0f;
    constexpr float kSearchCompactWidth = 72.0f;
    constexpr float kPathMinWidth = 100.0f;
    constexpr float kStaticWidth = kToolbarButtonSize * 4.0f + kCommandToolbarGap * 5.0f;

    const float flexible_width = std::max(0.0f, viewport_width - kStaticWidth);
    float search_width = kSearchPreferredWidth;
    float path_width = std::max(1.0f, flexible_width - search_width);
    if (flexible_width < kPathMinWidth + kSearchMinWidth) {
        search_width = std::max(1.0f, std::min(kSearchCompactWidth, flexible_width * 0.38f));
        path_width = std::max(1.0f, flexible_width - search_width);
    } else {
        search_width = std::clamp(flexible_width * 0.28f, kSearchMinWidth, kSearchPreferredWidth);
        path_width = std::max(kPathMinWidth, flexible_width - search_width);
    }

    if (ImGui::BeginChild("##toolbar_scroll_region",
                          ImVec2(0.0f, kToolbarButtonSize),
                          false,
                              ImGuiWindowFlags_NoScrollbar |
                              ImGuiWindowFlags_NoScrollWithMouse |
                              ImGuiWindowFlags_NoBackground)) {
        show_nav_history(state, kToolbarButtonSize, kCommandToolbarGap);

        ImGui::SameLine(0.0f, kCommandToolbarGap);
        if (toolbar_icon_button("refresh",
                                "assets/icons/sync-24.svg",
                                "Refresh",
                                true,
                                ImVec2(kToolbarButtonSize, kToolbarButtonSize),
                                kToolbarIconSize)) {
            request_manual_refresh(state);
        }

        ImGui::SameLine(0.0f, kCommandToolbarGap);
        show_path_control(state, path_width);

        ImGui::SameLine(0.0f, kCommandToolbarGap);
        show_search_field(state, search_width);
    }
    ImGui::EndChild();

    ImGui::PopStyleVar(3);
}

} // namespace misty::panel
