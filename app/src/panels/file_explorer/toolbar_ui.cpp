#include "panels/file_explorer/file_explorer_panel.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>

#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"
#include "panels/search/search_state.h"

using namespace misty::core;

namespace misty::panel {
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

    bool can_back = !state.back_history.empty();
    if (!can_back) ImGui::BeginDisabled();
    if (ImGui::Button("<", ImVec2(button_width, 0)) && !state.back_history.empty()) {
        state.forward_history.push(std::string(state.current_path));
        std::string target = state.back_history.top();
        state.back_history.pop();
        navigate_to_path(target, false);
    }
    if (!can_back) ImGui::EndDisabled();

    ImGui::SameLine(0, spacing);

    bool can_fwd = !state.forward_history.empty();
    if (!can_fwd) ImGui::BeginDisabled();
    if (ImGui::Button(">", ImVec2(button_width, 0)) && !state.forward_history.empty()) {
        state.back_history.push(std::string(state.current_path));
        std::string target = state.forward_history.top();
        state.forward_history.pop();
        navigate_to_path(target, false);
    }
    if (!can_fwd) ImGui::EndDisabled();

    ImGui::SameLine(0, spacing);
    ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.21f, 0.21f, 0.21f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.28f, 0.28f, 0.28f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.16f, 0.16f, 0.16f, 1.0f));
    auto& sync_tex = AssetManager::get().get_svg_texture("sync-16", 16);
    if (sync_tex.id != 0) {
        if (ImGui::ImageButton("##refresh", sync_tex.id, ImVec2(16, 16), ImVec2(0, 0), ImVec2(1, 1),
                ImVec4(0, 0, 0, 0), ImVec4(0.7f, 0.7f, 0.7f, 1.0f))) {
            std::string current(state.current_path);
            if (!current.empty()) navigate_to_path(current, false);
        }
    } else if (ImGui::Button("R", ImVec2(button_width, 0))) {
        std::string current(state.current_path);
        if (!current.empty()) navigate_to_path(current, false);
    }
    if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip("Refresh (%s)", CommandManager::get().label("explorer.refresh").c_str());
    }
    ImGui::PopStyleColor(3);
    ImGui::PopStyleVar(2);
}

void FileExplorerPanel::show_search_bar(FileExplorerState& state) {
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10, 8));
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);

    const float icon_size = 16.0f;
    const float btn_size = 32.0f;
    const float spacing = 8.0f;
    const bool is_local = !path_utils::is_remote_path(state.current_path);
    const int icon_button_count = is_local ? 4 : 3;
    const float icon_button_width = icon_size + ImGui::GetStyle().FramePadding.x * 2.0f;
    const float total_available = ImGui::GetContentRegionAvail().x;
    const float path_width = std::max(
        100.0f,
        total_available - icon_button_width * icon_button_count - spacing * icon_button_count
    );

    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.21f, 0.21f, 0.21f, 1.0f));
    ImGui::SetNextItemWidth(path_width);
    bool entered = ImGui::InputTextWithHint("##path", "Go to path...", state.search_path, sizeof(state.search_path) - 1, ImGuiInputTextFlags_EnterReturnsTrue);
    if (entered) {
        navigate_to_path(state.search_path, true, false);
    }
    ImGui::PopStyleColor();

    ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.21f, 0.21f, 0.21f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.28f, 0.28f, 0.28f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.16f, 0.16f, 0.16f, 1.0f));

    ImGui::SameLine(0, spacing);
    auto& search_tex = AssetManager::get().get_svg_texture("search-16", 16);
    if (search_tex.id != 0) {
        if (ImGui::ImageButton("##opensearch", search_tex.id, ImVec2(icon_size, icon_size), ImVec2(0, 0), ImVec2(1, 1),
                ImVec4(0, 0, 0, 0), ImVec4(0.7f, 0.7f, 0.7f, 1.0f))) {
            registry_.get_state<SearchState>(search_state_key_).is_open = true;
        }
    } else if (ImGui::Button("S", ImVec2(btn_size, 0))) {
        registry_.get_state<SearchState>(search_state_key_).is_open = true;
    }
    if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip("Search (%s)", CommandManager::get().label("search.toggle").c_str());
    }

    ImGui::SameLine(0, spacing);
    ImVec4 icon_tint = state.grid_view
        ? ImVec4(0.95f, 0.95f, 0.95f, 1.0f)
        : ImVec4(0.7f, 0.7f, 0.7f, 1.0f);
    auto& grid_tex = AssetManager::get().get_svg_texture("apps-16", 16);
    if (grid_tex.id != 0) {
        if (ImGui::ImageButton("##gridview", grid_tex.id, ImVec2(icon_size, icon_size), ImVec2(0, 0), ImVec2(1, 1),
                ImVec4(0, 0, 0, 0), icon_tint)) {
            state.grid_view = true;
        }
    } else if (ImGui::Button("G", ImVec2(btn_size, 0))) {
        state.grid_view = true;
    }
    if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip("Grid View");
    }

    ImGui::SameLine(0, spacing);
    icon_tint = !state.grid_view
        ? ImVec4(0.95f, 0.95f, 0.95f, 1.0f)
        : ImVec4(0.7f, 0.7f, 0.7f, 1.0f);
    auto& list_tex = AssetManager::get().get_svg_texture("rows-16", 16);
    if (list_tex.id != 0) {
        if (ImGui::ImageButton("##listview", list_tex.id, ImVec2(icon_size, icon_size), ImVec2(0, 0), ImVec2(1, 1),
                ImVec4(0, 0, 0, 0), icon_tint)) {
            state.grid_view = false;
        }
    } else if (ImGui::Button("L", ImVec2(btn_size, 0))) {
        state.grid_view = false;
    }
    if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip("List View");
    }

    if (is_local) {
        ImGui::SameLine(0, spacing);
        icon_tint = state.show_hidden
            ? ImVec4(0.95f, 0.95f, 0.95f, 1.0f)
            : ImVec4(0.7f, 0.7f, 0.7f, 1.0f);
        auto& hidden_tex = AssetManager::get().get_svg_texture(state.show_hidden ? "eye-16" : "eye-closed-16", 16);
        if (hidden_tex.id != 0) {
            if (ImGui::ImageButton("##togglehidden", hidden_tex.id, ImVec2(icon_size, icon_size), ImVec2(0, 0), ImVec2(1, 1),
                    ImVec4(0, 0, 0, 0), icon_tint)) {
                state.show_hidden = !state.show_hidden;
                std::string current(state.current_path);
                if (!current.empty()) navigate_to_path(current, false);
            }
        } else if (ImGui::Button("H", ImVec2(btn_size, 0))) {
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

} // namespace misty::panel
