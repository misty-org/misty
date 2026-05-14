#include "panels/file_explorer/file_explorer_panel.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>

#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"
#include "panels/search/search_panel.h"
#include "panels/search/search_state.h"
using namespace misty::core;

namespace misty::panel {
namespace {
constexpr float kPathFieldTrim = 96.0f;
constexpr ImVec4 kExplorerChromeBg = ImVec4(0.14f, 0.14f, 0.15f, 1.0f);
constexpr ImVec4 kExplorerChromeBgHover = ImVec4(0.18f, 0.18f, 0.20f, 1.0f);
constexpr ImVec4 kExplorerChromeBgActive = ImVec4(0.11f, 0.11f, 0.12f, 1.0f);

int oversampled_icon_size(float display_size) {
    return std::max(16, static_cast<int>(std::ceil(display_size * 2.0f)));
}

struct BreadcrumbSegment {
    std::string label;
    std::string target_path;
};

std::vector<BreadcrumbSegment> build_breadcrumb_segments(const std::string& current_path) {
    std::vector<BreadcrumbSegment> segments;
    if (current_path.empty()) {
        return segments;
    }

    if (current_path == FileExplorerState::VIRTUAL_PATH_RECENT) {
        return {{"Recent", current_path}};
    }
    if (current_path == FileExplorerState::VIRTUAL_PATH_STARRED) {
        return {{"Starred", current_path}};
    }
    if (current_path == FileExplorerState::VIRTUAL_PATH_TRASH) {
        return {{"Trash", current_path}};
    }

    const char* home = std::getenv("HOME");
    const std::string home_path = home ? home : "";
    fs::path path(current_path);
    fs::path cumulative;

    if (!home_path.empty() && current_path.rfind(home_path, 0) == 0) {
        cumulative = fs::path(home_path);
        segments.push_back({"~", cumulative.string()});
        std::error_code ec;
        fs::path relative = fs::relative(path, cumulative, ec);
        if (!ec) {
            for (const auto& part : relative) {
                cumulative /= part;
                segments.push_back({part.string(), cumulative.string()});
            }
            return segments;
        }
    }

    if (path.is_absolute()) {
        cumulative = path.root_path();
        segments.push_back({cumulative.string().empty() ? "/" : cumulative.string(), cumulative.string().empty() ? "/" : cumulative.string()});
    }
    for (const auto& part : path.relative_path()) {
        cumulative /= part;
        segments.push_back({part.string(), cumulative.string()});
    }
    if (segments.empty()) {
        segments.push_back({current_path, current_path});
    }
    return segments;
}

void clear_scoped_search(SearchState& search_state) {
    std::lock_guard<std::mutex> lock(search_state.mu);
    search_state.is_open = false;
    search_state.focus_query = false;
    search_state.selected_index = 0;
    search_state.results.clear();
    search_state.search_pending = false;
    search_state.search_in_flight = false;
    ++search_state.request_generation;
    search_state.last_submitted_query.clear();
    search_state.last_err.clear();
}

void discard_current_history_entries(std::stack<std::string>& history, const std::string& current_path) {
    while (!history.empty() && path_utils::same_history_path(history.top(), current_path)) {
        history.pop();
    }
}

void push_history_entry_if_distinct(std::stack<std::string>& history, const std::string& path) {
    if (path.empty()) {
        return;
    }
    if (!history.empty() && path_utils::same_history_path(history.top(), path)) {
        return;
    }
    history.push(path);
}
} // namespace

void FileExplorerPanel::show_nav_history(FileExplorerState& state, float button_width, float spacing) {
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(6.0f, 6.0f));

    const std::string current_path(state.current_path);
    discard_current_history_entries(state.back_history, current_path);
    discard_current_history_entries(state.forward_history, current_path);

    bool can_back = !state.back_history.empty();
    std::string back_target;
    if (can_back) back_target = state.back_history.top();
    if (!can_back) ImGui::BeginDisabled();
    if (ImGui::Button("<", ImVec2(button_width, 0)) && !state.back_history.empty()) {
        push_history_entry_if_distinct(state.forward_history, current_path);
        std::string target = state.back_history.top();
        state.back_history.pop();
        navigate_to_path(target, false);
    }
    if (!can_back) ImGui::EndDisabled();
    if (can_back) {
        const ImVec2 min = ImGui::GetItemRectMin();
        const ImVec2 max = ImGui::GetItemRectMax();
        handle_drag_navigation_target(state, back_target, min, max, true, [this, &state, back_target]() {
            if (state.back_history.empty()) return;
            push_history_entry_if_distinct(state.forward_history, std::string(state.current_path));
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
    if (!can_fwd) ImGui::BeginDisabled();
    if (ImGui::Button(">", ImVec2(button_width, 0)) && !state.forward_history.empty()) {
        push_history_entry_if_distinct(state.back_history, current_path);
        std::string target = state.forward_history.top();
        state.forward_history.pop();
        navigate_to_path(target, false);
    }
    if (!can_fwd) ImGui::EndDisabled();
    if (can_fwd) {
        const ImVec2 min = ImGui::GetItemRectMin();
        const ImVec2 max = ImGui::GetItemRectMax();
        handle_drag_navigation_target(state, forward_target, min, max, true, [this, &state, forward_target]() {
            if (state.forward_history.empty()) return;
            push_history_entry_if_distinct(state.back_history, std::string(state.current_path));
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
    const bool is_local = true;
    const int action_button_count = 4;
    const float total_available = ImGui::GetContentRegionAvail().x;
    const float action_width = action_btn_size * action_button_count +
                               spacing * static_cast<float>(std::max(0, action_button_count - 1));
    const float search_button_width = action_btn_size;
    const float reserved_trailing_width = action_width + search_button_width + spacing;
    const float path_width = std::max(120.0f, total_available - reserved_trailing_width - spacing - kPathFieldTrim);

    if (CommandManager::get().matches("search.toggle")) {
        search_state.is_open = true;
        search_state.focus_query = true;
    }

    ImGui::PushStyleColor(ImGuiCol_FrameBg, kExplorerChromeBg);
    ImGui::SetNextItemWidth(path_width);
    const bool path_submitted = ImGui::InputTextWithHint("##path_input", "Jump to path", state.search_path,
                                                         sizeof(state.search_path), ImGuiInputTextFlags_EnterReturnsTrue);
    ImGui::PopStyleColor();
    if (path_submitted) {
        std::string target(state.search_path);
        if (!target.empty()) {
            navigate_to_path(target, true, false);
        }
    }

    ImGui::SameLine(0, spacing);
    ImGui::PushStyleColor(ImGuiCol_Button, kExplorerChromeBg);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, kExplorerChromeBgHover);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, kExplorerChromeBgActive);
    const ImVec4 search_tint = search_state.is_open
        ? ImVec4(0.95f, 0.95f, 0.95f, 1.0f)
        : ImVec4(0.7f, 0.7f, 0.7f, 1.0f);
    auto& search_tex = AssetManager::get().get_svg_texture("search-16", oversampled_icon_size(action_btn_size));
    if (search_tex.id != 0) {
        if (ImGui::ImageButton("##togglesearch", search_tex.id, ImVec2(action_btn_size, action_btn_size),
                ImVec2(0, 0), ImVec2(1, 1), ImVec4(0, 0, 0, 0), search_tint)) {
            if (search_panel_) {
                search_panel_->toggle();
            }
        }
    } else if (ImGui::Button("S", ImVec2(action_btn_size, action_btn_size))) {
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
    ImVec4 icon_tint = state.grid_view
        ? active_tint
        : inactive_tint;
    auto& grid_tex = AssetManager::get().get_svg_texture("apps-16", oversampled_icon_size(action_btn_size));
    if (grid_tex.id != 0) {
        if (ImGui::ImageButton("##gridview", grid_tex.id, ImVec2(action_btn_size, action_btn_size), ImVec2(0, 0), ImVec2(1, 1),
                ImVec4(0, 0, 0, 0), icon_tint)) {
            state.grid_view = true;
        }
    } else if (ImGui::Button("G", ImVec2(action_btn_size, action_btn_size))) {
        state.grid_view = true;
    }
    if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip("Grid View");
    }

    ImGui::SameLine(0, spacing);
    icon_tint = !state.grid_view
        ? active_tint
        : inactive_tint;
    auto& list_tex = AssetManager::get().get_svg_texture("rows-16", oversampled_icon_size(action_btn_size));
    if (list_tex.id != 0) {
        if (ImGui::ImageButton("##listview", list_tex.id, ImVec2(action_btn_size, action_btn_size), ImVec2(0, 0), ImVec2(1, 1),
                ImVec4(0, 0, 0, 0), icon_tint)) {
            state.grid_view = false;
        }
    } else if (ImGui::Button("L", ImVec2(action_btn_size, action_btn_size))) {
        state.grid_view = false;
    }
    if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip("List View");
    }

    ImGui::SameLine(0, spacing);
    ImVec4 preview_tint = preview_pane_open_
        ? active_tint
        : inactive_tint;
    auto& preview_tex = AssetManager::get().get_svg_texture("file-media-16", oversampled_icon_size(action_btn_size));
    if (preview_tex.id != 0) {
        if (ImGui::ImageButton("##togglepreview", preview_tex.id, ImVec2(action_btn_size, action_btn_size),
                ImVec2(0, 0), ImVec2(1, 1), ImVec4(0, 0, 0, 0), preview_tint)) {
            preview_pane_open_ = !preview_pane_open_;
        }
    } else if (ImGui::Button("P", ImVec2(action_btn_size, action_btn_size))) {
        preview_pane_open_ = !preview_pane_open_;
    }
    if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip(preview_pane_open_ ? "Hide Preview Pane" : "Show Preview Pane");
    }

    if (is_local) {
        ImGui::SameLine(0, spacing);
        icon_tint = state.show_hidden
            ? active_tint
            : inactive_tint;
        auto& hidden_tex = AssetManager::get().get_svg_texture(
            state.show_hidden ? "eye-16" : "eye-closed-16",
            oversampled_icon_size(action_btn_size));
        if (hidden_tex.id != 0) {
            if (ImGui::ImageButton("##togglehidden", hidden_tex.id, ImVec2(action_btn_size, action_btn_size), ImVec2(0, 0), ImVec2(1, 1),
                    ImVec4(0, 0, 0, 0), icon_tint)) {
                state.show_hidden = !state.show_hidden;
                std::string current(state.current_path);
                if (!current.empty()) navigate_to_path(current, false);
            }
        } else if (ImGui::Button("H", ImVec2(action_btn_size, action_btn_size))) {
            state.show_hidden = !state.show_hidden;
            std::string current(state.current_path);
            if (!current.empty()) navigate_to_path(current, false);
        }
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip(state.show_hidden ? "Hide Hidden Files" : "Show Hidden Files");
        }
    }

    ImGui::PopStyleColor(3);
    ImGui::PopStyleVar(2);
}

void FileExplorerPanel::show_breadcrumb_bar(FileExplorerState& state) {
    const std::vector<BreadcrumbSegment> breadcrumbs = build_breadcrumb_segments(state.current_path);
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
        const bool is_active = breadcrumbs[index].target_path == state.current_path;
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

} // namespace misty::panel
