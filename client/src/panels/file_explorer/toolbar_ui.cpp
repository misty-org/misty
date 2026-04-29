#include "panels/file_explorer/file_explorer_panel.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>

#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"
#include "panels/search/search_state.h"
#include "panels/services/services_state.h"

using namespace misty::core;

namespace misty::panel {
namespace {
constexpr float kPathFieldTrim = 96.0f;

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

    if (path_utils::is_remote_path(current_path) || current_path == path_utils::get_mount_root() || current_path == path_utils::get_mount_root() + "/") {
        const std::string mount_root = path_utils::get_mount_root();
        segments.push_back({"Cloud", mount_root});
        const auto info = path_utils::parse_remote_path(current_path);
        if (!info.provider_folder.empty()) {
            const std::string provider_path = mount_root + "/" + info.provider_folder;
            segments.push_back({info.provider_folder, provider_path});
            if (!info.remote_name.empty()) {
                std::string remote_path = provider_path + "/" + info.remote_name;
                segments.push_back({info.remote_name, remote_path});
                if (!info.relative_path.empty()) {
                    std::string cumulative = remote_path;
                    for (const auto& part : path_utils::split_path(info.relative_path)) {
                        cumulative += "/" + part;
                        segments.push_back({part, cumulative});
                    }
                }
            }
        }
        return segments;
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
    search_state.is_open = false;
    search_state.pending_submit = false;
    search_state.pending_navigate_index = -1;
    search_state.selected_index = 0;
    search_state.cache_results.clear();
    search_state.api_results.clear();
    search_state.seen_ids.clear();
    search_state.pending_api_tasks.store(0);
    search_state.api_search_done = true;
    search_state.last_submitted_query.clear();
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

void FileExplorerPanel::show_inline_search(FileExplorerState& state, SearchState& search_state) {
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10, 7));
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

    const float close_w = 28.0f;
    const float spacing = 6.0f;
    ImGui::SetNextItemWidth(ImGui::GetContentRegionAvail().x - close_w - spacing);

    if (search_state.just_opened) {
        ImGui::SetKeyboardFocusHere();
        search_state.just_opened = false;
    }

    bool changed = ImGui::InputTextWithHint("##inline_search", "Search files and cloud providers...",
        search_state.query_buf, sizeof(search_state.query_buf));

    ImGui::PopStyleColor();

    ImGui::SameLine(0, spacing);
    ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0, 0, 0, 0));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.35f, 0.35f, 0.35f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.25f, 0.25f, 0.25f, 1.0f));
    if (ImGui::Button("x", ImVec2(close_w, 0))) {
        search_state.is_open = false;
        std::memset(search_state.query_buf, 0, sizeof(search_state.query_buf));
    }
    ImGui::PopStyleColor(3);
    ImGui::PopStyleVar(2);

    if (CommandManager::get().matches("search.cancel")) {
        search_state.is_open = false;
        std::memset(search_state.query_buf, 0, sizeof(search_state.query_buf));
        return;
    }

    static auto last_change = std::chrono::steady_clock::now();
    if (changed) last_change = std::chrono::steady_clock::now();
    float elapsed_ms = std::chrono::duration<float, std::milli>(std::chrono::steady_clock::now() - last_change).count();
    std::string q(search_state.query_buf);
    if (q.size() >= 2 && q != search_state.last_submitted_query && elapsed_ms >= 500.0f) {
        search_state.pending_submit = true;
    }

    if (CommandManager::get().matches("search.prev", true) && search_state.selected_index > 0) {
        --search_state.selected_index;
    }
    if (CommandManager::get().matches("search.next", true)) {
        ++search_state.selected_index;
    }
    if (CommandManager::get().matches("search.confirm")) {
        search_state.pending_navigate_index = search_state.selected_index;
    }
}

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
    ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.21f, 0.21f, 0.21f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.28f, 0.28f, 0.28f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.16f, 0.16f, 0.16f, 1.0f));
    const bool sync_in_flight = state.sync_request_in_flight;
    const char* refresh_icon_name = "sync-16";
    const ImVec4 refresh_tint(0.7f, 0.7f, 0.7f, 1.0f);

    if (sync_in_flight) ImGui::BeginDisabled();
    auto& sync_tex = AssetManager::get().get_svg_texture(refresh_icon_name, 16);
    if (sync_tex.id != 0) {
        if (ImGui::ImageButton("##refresh", sync_tex.id, ImVec2(16, 16), ImVec2(0, 0), ImVec2(1, 1),
                ImVec4(0, 0, 0, 0), refresh_tint)) {
            request_manual_refresh(state);
        }
    } else if (ImGui::Button("R", ImVec2(button_width, 0))) {
        request_manual_refresh(state);
    }
    if (sync_in_flight) ImGui::EndDisabled();
    if (ImGui::IsItemHovered()) {
        if (sync_in_flight) {
            ImGui::SetTooltip("Syncing remote changes...");
        } else if (path_utils::is_remote_path(state.current_path)) {
            ImGui::SetTooltip("Sync Now (%s)", CommandManager::get().label("explorer.refresh").c_str());
        } else {
            ImGui::SetTooltip("Refresh (%s)", CommandManager::get().label("explorer.refresh").c_str());
        }
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
    const bool is_local = !path_utils::is_remote_path(state.current_path);
    const auto remote_info = path_utils::parse_remote_path(state.current_path);
    const bool can_toggle_watch = !is_local && !remote_info.provider_folder.empty() && !remote_info.remote_name.empty();
    const int action_button_count = is_local ? 4 : (can_toggle_watch ? 4 : 3);
    const float total_available = ImGui::GetContentRegionAvail().x;
    const float action_width = action_btn_size * action_button_count +
                               spacing * static_cast<float>(std::max(0, action_button_count - 1));
    const float search_width = std::clamp(total_available * 0.18f, 130.0f, 190.0f);
    const float reserved_trailing_width = action_width + search_width + spacing;
    const float path_width = std::max(120.0f, total_available - reserved_trailing_width - spacing - kPathFieldTrim);

    if (CommandManager::get().matches("search.toggle")) {
        search_state.is_open = true;
        search_state.just_opened = true;
    }

    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.21f, 0.21f, 0.21f, 1.0f));
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
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.21f, 0.21f, 0.21f, 1.0f));
    ImGui::SetNextItemWidth(search_width);
    if (search_state.just_opened) {
        ImGui::SetKeyboardFocusHere();
        search_state.just_opened = false;
    }
    bool changed = ImGui::InputTextWithHint("##scope_search", "Find in folder...  (:pdf)", search_state.query_buf,
                                            sizeof(search_state.query_buf), ImGuiInputTextFlags_EnterReturnsTrue);
    const bool submitted = ImGui::IsItemDeactivatedAfterEdit();
    const bool input_active = ImGui::IsItemActive();
    ImGui::PopStyleColor();

    std::string query(search_state.query_buf);
    if (changed) {
        search_state.last_input_change_at = std::chrono::steady_clock::now();
        search_state.pending_submit = false;
        search_state.pending_navigate_index = -1;
        search_state.selected_index = 0;
        if (query.empty()) {
            clear_scoped_search(search_state);
        } else {
            search_state.is_open = true;
        }
    }
    if (submitted && ((!query.empty() && query[0] == ':' && query.size() > 1) || query.size() >= 2)) {
        search_state.pending_submit = true;
        search_state.is_open = true;
    } else if (!query.empty()) {
        const auto elapsed = std::chrono::steady_clock::now() - search_state.last_input_change_at;
        const bool type_filter = query[0] == ':' && query.size() > 1;
        if ((type_filter || query.size() >= 2) &&
            query != search_state.last_submitted_query &&
            elapsed >= std::chrono::milliseconds(type_filter ? 0 : 180)) {
            search_state.pending_submit = true;
            search_state.is_open = true;
        }
    } else if (!input_active) {
        clear_scoped_search(search_state);
    }
    if (CommandManager::get().matches("search.cancel")) {
        std::memset(search_state.query_buf, 0, sizeof(search_state.query_buf));
        clear_scoped_search(search_state);
    }

    ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.21f, 0.21f, 0.21f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.28f, 0.28f, 0.28f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.16f, 0.16f, 0.16f, 1.0f));

    const ImVec4 inactive_tint(0.7f, 0.7f, 0.7f, 1.0f);
    const ImVec4 active_tint(0.95f, 0.95f, 0.95f, 1.0f);
    if (can_toggle_watch) {
        ImGui::SameLine(0, spacing);
        const bool watch_busy = state.sync_watch_request_in_flight;
        const bool watched = state.current_dir_watched;
        const char* watch_icon_name = watched ? "git-branch-check-16" : "git-branch-16";
        const ImVec4 watch_tint = watched ? ImVec4(0.96f, 0.83f, 0.29f, 1.0f) : inactive_tint;
        auto& watch_tex = AssetManager::get().get_svg_texture(watch_icon_name, 16);
        if (watch_busy) ImGui::BeginDisabled();
        if (watch_tex.id != 0) {
            if (ImGui::ImageButton("##togglewatchdir", watch_tex.id, ImVec2(action_btn_size, action_btn_size),
                    ImVec2(0, 0), ImVec2(1, 1), ImVec4(0, 0, 0, 0), watch_tint)) {
                toggle_current_sync_watch(state);
            }
        } else if (ImGui::Button(watched ? "B*" : "B", ImVec2(action_btn_size, action_btn_size))) {
            toggle_current_sync_watch(state);
        }
        if (watch_busy) ImGui::EndDisabled();
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip(watched ? "Unwatch Sync Directory" : "Watch Sync Directory");
        }
    }

    ImGui::SameLine(0, spacing);
    ImVec4 icon_tint = state.grid_view
        ? active_tint
        : inactive_tint;
    auto& grid_tex = AssetManager::get().get_svg_texture("apps-16", 16);
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
    auto& list_tex = AssetManager::get().get_svg_texture("rows-16", 16);
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
    auto& preview_tex = AssetManager::get().get_svg_texture("file-media-16", 16);
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
        auto& hidden_tex = AssetManager::get().get_svg_texture(state.show_hidden ? "eye-16" : "eye-closed-16", 16);
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
