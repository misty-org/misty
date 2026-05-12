#include "panels/filetree/filetree_panel.h"

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <stack>
#include <unordered_set>

#include <nlohmann/json.hpp>

#include "core/commands/command_manager.h"
#include "panels/activity/activity_state.h"
#include "panels/file_explorer/file_explorer_state.h"
#include "panels/notification/notification_state.h"
#include "panels/profile/profile_state.h"
#include "panels/search/search_state.h"
#include "panels/transfers/transfer_window_state.h"

namespace fs = std::filesystem;

namespace misty::panel {
    namespace {
        using json = nlohmann::json;

        constexpr const char* kTabPayloadType = "FILETREE_TAB";
        constexpr const char* kPanePayloadType = "FILETREE_PANE";

        std::vector<std::string> stack_to_vector(std::stack<std::string> stack) {
            std::vector<std::string> items;
            while (!stack.empty()) {
                items.push_back(stack.top());
                stack.pop();
            }
            std::reverse(items.begin(), items.end());
            return items;
        }

        std::stack<std::string> vector_to_stack(const std::vector<std::string>& items) {
            std::stack<std::string> stack;
            for (const auto& item : items) {
                stack.push(item);
            }
            return stack;
        }

        std::string title_for_path(const std::string& path) {
            if (path.empty()) {
                return "Files";
            }
            if (path == FileExplorerState::VIRTUAL_PATH_RECENT) {
                return "Recent";
            }
            if (path == FileExplorerState::VIRTUAL_PATH_STARRED) {
                return "Starred";
            }
            if (path == FileExplorerState::VIRTUAL_PATH_TRASH) {
                return "Trash";
            }

            if (path_utils::is_remote_path(path)) {
                const auto info = path_utils::parse_remote_path(path);
                if (!info.relative_path.empty()) {
                    const auto parts = path_utils::split_path(info.relative_path);
                    if (!parts.empty()) {
                        return parts.back();
                    }
                }
                if (!info.remote_name.empty()) {
                    return info.remote_name;
                }
                if (!info.provider_folder.empty()) {
                    return info.provider_folder;
                }
            }

            const char* home = std::getenv("HOME");
            if (home && path == home) {
                return "Home";
            }

            fs::path path_obj(path);
            std::string leaf = path_obj.filename().string();
            if (!leaf.empty()) {
                return leaf;
            }

            leaf = path_obj.root_name().string();
            if (!leaf.empty()) {
                return leaf;
            }

            leaf = path_obj.root_directory().string();
            return leaf.empty() ? path : leaf;
        }
    }

    FileTreePanel::FileTreePanel(core::UIRegistry& ui_registry,
                                 core::WorkerPool& worker_pool,
                                 std::shared_ptr<MistyClient> client)
        : ui_registry_(ui_registry)
        , worker_pool_(worker_pool)
        , client_(std::move(client)) {
        if (!restore_layout_state()) {
            init_default_layout();
        }
    }

    FileTreePanel::~FileTreePanel() noexcept {
        try {
            save_layout_state();
        } catch (...) {
        }
    }

    void FileTreePanel::init_default_layout() {
        explorer_panes_.clear();
        explorer_tabs_.clear();
        columns_.clear();
        closed_pane_snapshots_.clear();
        next_pane_id_ = 1;
        next_tab_id_ = 1;
        vertical_split_ratio_ = 0.5f;
        column_split_ratios_ = {0.5f, 0.5f};

        const int primary_pane_id = create_pane_instance();
        create_tab_instance(primary_pane_id, true, "", false, "Files", "Search", "primary");
        columns_.push_back({std::vector<int>{primary_pane_id}});
        active_pane_id_ = primary_pane_id;
    }

    void FileTreePanel::handle_commands() {
        if (core::CommandManager::get().matches("explorer.toggle_chat")) {
            if (ExplorerTab* tab = get_active_tab(active_pane_id_)) {
                tab->explorer_panel->toggle_chat_overlay();
            }
        }
        if (core::CommandManager::get().matches("explorer.new_tab")) {
            create_tab_from_active_pane(active_pane_id_);
        }
        if (core::CommandManager::get().matches("explorer.restore_tab")) {
            ExplorerPane* pane = get_pane(active_pane_id_);
            if (pane && !pane->closed_tabs.empty()) {
                restore_last_closed_tab(active_pane_id_);
            } else {
                restore_last_closed_pane();
            }
        }
        if (core::CommandManager::get().matches("explorer.close_pane")) {
            ExplorerPane* pane = get_pane(active_pane_id_);
            if (pane && pane->tab_order.size() > 1 && pane->active_tab_id >= 0) {
                close_tab(active_pane_id_, pane->active_tab_id);
            } else {
                close_active_pane();
            }
        }
        if (core::CommandManager::get().matches("explorer.restore_pane")) {
            restore_last_closed_pane();
        }
        if (core::CommandManager::get().matches("explorer.split_vertical")) {
            split_active_vertical();
        }
        if (core::CommandManager::get().matches("explorer.split_horizontal")) {
            split_active_horizontal();
        }
        for (int index = 0; index < 9; ++index) {
            const std::string command_id = "explorer.tab_" + std::to_string(index + 1);
            if (core::CommandManager::get().matches(command_id)) {
                activate_tab_by_index(active_pane_id_, static_cast<size_t>(index));
            }
        }
    }

    void FileTreePanel::toggle_active_search() {
        if (SearchPanel* search_panel = active_search_panel()) {
            search_panel->toggle();
        }
    }

    std::string FileTreePanel::active_explorer_state_key() const {
        const ExplorerTab* tab = get_active_tab(active_pane_id_);
        return tab ? tab->explorer_state_key : "Files";
    }

    bool FileTreePanel::invoke_command(const std::string& command_id) {
        if (ExplorerTab* tab = get_active_tab(active_pane_id_)) {
            if (command_id == "explorer.preview.toggle") {
                return tab->explorer_panel->toggle_preview_pane();
            }
            if (command_id == "explorer.preview.zoom_in") {
                return tab->explorer_panel->zoom_preview_in();
            }
            if (command_id == "explorer.preview.zoom_out") {
                return tab->explorer_panel->zoom_preview_out();
            }
            if (command_id == "explorer.preview.zoom_reset") {
                return tab->explorer_panel->reset_preview_zoom();
            }
        }
        return false;
    }

    bool FileTreePanel::drop_selected_items_to_path(const std::string& source_state_key,
                                                    const std::string& dest_path,
                                                    ClipboardOp op) {
        if (dest_path.empty() || op == ClipboardOp::NONE) {
            return false;
        }

        ExplorerTab* active_tab = get_active_tab(active_pane_id_);
        if (!active_tab || !active_tab->explorer_panel) {
            return false;
        }

        const std::string effective_source_key = source_state_key.empty()
            ? active_tab->explorer_state_key
            : source_state_key;
        auto& source_state = ui_registry_.get_state<FileExplorerState>(effective_source_key);

        std::vector<UnifiedFileItem> items;
        items.reserve(source_state.selected_files.size());
        for (const auto& selected_id : source_state.selected_files) {
            auto it = std::find_if(source_state.files.begin(), source_state.files.end(),
                [&](const UnifiedFileItem& candidate) { return candidate.id == selected_id; });
            if (it != source_state.files.end()) {
                items.push_back(*it);
            }
        }
        if (items.empty()) {
            return false;
        }

        auto& target_state = ui_registry_.get_state<FileExplorerState>(active_tab->explorer_state_key);
        active_tab->explorer_panel->perform_drop_items(target_state, items, dest_path, op);
        return true;
    }

    void FileTreePanel::render(const ImVec2& pos, const ImVec2& size) {
        current_area_size_ = size;
        pending_pane_move_.reset();
        pending_tab_append_.reset();
        const bool transfer_modal_open =
            ui_registry_.get_state<TransferWindowState>(kTransferWindowStateKey).is_open();

        if (columns_.empty()) {
            return;
        }

        if (columns_.size() == 1) {
            render_column(0, pos, size);
        } else {
            ImGuiIO& io = ImGui::GetIO();
            ImDrawList* fg = ImGui::GetForegroundDrawList();

            const float available = std::max(size.x - kPaneHandleWidth, kPaneMinWidth * 2.0f);
            const float min_ratio = kPaneMinWidth / available;
            vertical_split_ratio_ = std::clamp(vertical_split_ratio_, min_ratio, 1.0f - min_ratio);

            float left_w = available * vertical_split_ratio_;
            float right_w = available - left_w;
            ImVec2 right_pos(pos.x + left_w + kPaneHandleWidth, pos.y);

            const float handle_x0 = right_pos.x - kPaneHandleWidth;
            const float handle_x1 = right_pos.x;
            const bool hovered = !transfer_modal_open &&
                                 io.MousePos.x >= handle_x0 && io.MousePos.x <= handle_x1 &&
                                 io.MousePos.y >= pos.y && io.MousePos.y <= pos.y + size.y;
            static bool resizing_vertical_split = false;

            if (transfer_modal_open) {
                resizing_vertical_split = false;
            }

            if (hovered || resizing_vertical_split) {
                ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeEW);
            }
            if (hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
                resizing_vertical_split = true;
            }
            if (resizing_vertical_split) {
                if (ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
                    const float new_ratio = (io.MousePos.x - pos.x) / available;
                    vertical_split_ratio_ = std::clamp(new_ratio, min_ratio, 1.0f - min_ratio);
                    left_w = available * vertical_split_ratio_;
                    right_w = available - left_w;
                    right_pos.x = pos.x + left_w + kPaneHandleWidth;
                } else {
                    resizing_vertical_split = false;
                }
            }

            render_column(0, pos, ImVec2(left_w, size.y));
            render_column(1, right_pos, ImVec2(right_w, size.y));
            if (!transfer_modal_open) {
                fg->AddLine(ImVec2(right_pos.x - kPaneHandleWidth * 0.5f, pos.y),
                            ImVec2(right_pos.x - kPaneHandleWidth * 0.5f, pos.y + size.y),
                            IM_COL32(100, 100, 100, 180), 2.0f);
            }
        }

        if (pending_tab_append_) {
            append_tab_to_pane(pending_tab_append_->source_pane_id,
                               pending_tab_append_->target_pane_id,
                               pending_tab_append_->tab_id);
        }
        if (pending_pane_move_) {
            move_pane_relative(pending_pane_move_->source_pane_id,
                               pending_pane_move_->target_pane_id,
                               pending_pane_move_->insert_before);
        }

        maybe_persist_layout_state();
    }

    void FileTreePanel::render_column(int column_index, const ImVec2& pos, const ImVec2& size) {
        if (column_index < 0 || column_index >= static_cast<int>(columns_.size())) {
            return;
        }

        Column& column = columns_[static_cast<size_t>(column_index)];
        if (column.pane_ids.empty()) {
            return;
        }

        if (column.pane_ids.size() == 1) {
            render_pane(column.pane_ids.front(), pos, size);
            return;
        }

        ImGuiIO& io = ImGui::GetIO();
        ImDrawList* fg = ImGui::GetForegroundDrawList();

        const float available = std::max(size.y - kPaneHandleWidth, kPaneMinHeight * 2.0f);
        const float min_ratio = kPaneMinHeight / available;
        float& split_ratio = column_split_ratios_[static_cast<size_t>(std::clamp(column_index, 0, 1))];
        split_ratio = std::clamp(split_ratio, min_ratio, 1.0f - min_ratio);

        float top_h = available * split_ratio;
        float bottom_h = available - top_h;
        ImVec2 bottom_pos(pos.x, pos.y + top_h + kPaneHandleWidth);

        const float handle_y0 = bottom_pos.y - kPaneHandleWidth;
        const float handle_y1 = bottom_pos.y;
        const bool hovered = !ui_registry_.get_state<TransferWindowState>(kTransferWindowStateKey).is_open() &&
                             io.MousePos.y >= handle_y0 && io.MousePos.y <= handle_y1 &&
                             io.MousePos.x >= pos.x && io.MousePos.x <= pos.x + size.x;
        static int resizing_column = -1;

        if (ui_registry_.get_state<TransferWindowState>(kTransferWindowStateKey).is_open()) {
            resizing_column = -1;
        }

        if (hovered || resizing_column == column_index) {
            ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeNS);
        }
        if (hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
            resizing_column = column_index;
        }
        if (resizing_column == column_index) {
            if (ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
                const float new_ratio = (io.MousePos.y - pos.y) / available;
                split_ratio = std::clamp(new_ratio, min_ratio, 1.0f - min_ratio);
                top_h = available * split_ratio;
                bottom_h = available - top_h;
                bottom_pos.y = pos.y + top_h + kPaneHandleWidth;
            } else {
                resizing_column = -1;
            }
        }

        render_pane(column.pane_ids[0], pos, ImVec2(size.x, top_h));
        render_pane(column.pane_ids[1], bottom_pos, ImVec2(size.x, bottom_h));
        if (!ui_registry_.get_state<TransferWindowState>(kTransferWindowStateKey).is_open()) {
            fg->AddLine(ImVec2(pos.x, bottom_pos.y - kPaneHandleWidth * 0.5f),
                        ImVec2(pos.x + size.x, bottom_pos.y - kPaneHandleWidth * 0.5f),
                        IM_COL32(100, 100, 100, 180), 2.0f);
        }
    }

    void FileTreePanel::render_pane(int pane_id, const ImVec2& pos, const ImVec2& size) {
        ExplorerPane* pane = get_pane(pane_id);
        if (!pane) {
            return;
        }
        const bool transfer_modal_open =
            ui_registry_.get_state<TransferWindowState>(kTransferWindowStateKey).is_open();

        float tab_height = 0.0f;
        render_tab_strip(pane_id, pos, size, tab_height);

        ExplorerTab* active_tab = get_active_tab(pane_id);
        if (!active_tab) {
            return;
        }

        const float explorer_y = pos.y + tab_height + kTabBarGap;
        const float explorer_h = std::max(0.0f, size.y - tab_height - kTabBarGap);
        if (explorer_h <= 0.0f) {
            return;
        }

        ImGui::SetNextWindowPos(ImVec2(pos.x, explorer_y));
        ImGui::SetNextWindowSize(ImVec2(size.x, explorer_h));
        active_tab->explorer_panel->set_body_drag_source_callback([this, pane_id, active_tab]() {
            if (ImGui::BeginDragDropSource(ImGuiDragDropFlags_SourceAllowNullID)) {
                const PanePayload payload{pane_id};
                ImGui::SetDragDropPayload(kPanePayloadType, &payload, sizeof(payload));
                ImGui::Text("Move %s", make_tab_title(*active_tab).c_str());
                ImGui::EndDragDropSource();
            }
        });
        active_tab->explorer_panel->render();
        if (active_tab->explorer_panel->consume_activation_request()) {
            active_pane_id_ = pane_id;
            pane->active_tab_id = active_tab->tab_id;
        }

        const ImGuiPayload* drag_payload = ImGui::GetDragDropPayload();
        if (drag_payload != nullptr) {
            render_drag_overlay(pane_id, ImVec2(pos.x, explorer_y), ImVec2(size.x, explorer_h));
        }

        const bool activity_panel_open =
            ui_registry_.get_state<ActivityState>("Activity").is_open;
        const bool profile_panel_open =
            ui_registry_.get_state<ProfileState>("Profile").is_open;
        if (!transfer_modal_open && !activity_panel_open && !profile_panel_open &&
            active_pane_id_ == pane_id && drag_payload == nullptr) {
            ImDrawList* draw_list = ImGui::GetForegroundDrawList();
            const ImVec2 border_max(std::max(pos.x, pos.x + size.x - 1.0f),
                                    std::max(pos.y, pos.y + size.y - 1.0f));
            draw_list->PushClipRect(pos, ImVec2(pos.x + size.x, pos.y + size.y), true);
            draw_list->AddRect(pos, border_max, IM_COL32(255, 255, 255, 220), 0.0f, 0, 2.0f);
            draw_list->PopClipRect();
        }
    }

    void FileTreePanel::render_tab_strip(int pane_id, const ImVec2& pos, const ImVec2& size, float& out_height) {
        ExplorerPane* pane = get_pane(pane_id);
        if (!pane) {
            return;
        }

        normalize_tab_order(*pane);
        constexpr float kTabStripScrollbarSize = 8.0f;
        constexpr float kTabHeight = 26.0f;
        constexpr float kTabMinWidth = 90.0f;
        constexpr float kTabMaxWidth = 220.0f;
        constexpr float kTabPaddingX = 12.0f;
        constexpr float kCloseHitSize = 18.0f;
        constexpr float kCloseGap = 6.0f;
        constexpr float kTabSpacing = 6.0f;
        constexpr float kNewTabButtonWidth = 28.0f;
        constexpr float kAppendTargetMinWidth = 32.0f;
        constexpr float kTabStripSidePadding = 16.0f;

        float total_tab_content_width = kNewTabButtonWidth + kAppendTargetMinWidth;
        bool has_any_tabs = false;
        for (int tab_id : pane->tab_order) {
            const ExplorerTab* tab = get_tab(tab_id);
            if (!tab) {
                continue;
            }

            const bool can_close = pane->tab_order.size() > 1;
            const ImVec2 label_size = ImGui::CalcTextSize(make_tab_button_label(*tab).c_str());
            const float button_width = std::clamp(
                label_size.x + kTabPaddingX * 2.0f + (can_close ? (kCloseHitSize + kCloseGap) : 0.0f),
                kTabMinWidth,
                kTabMaxWidth);
            if (has_any_tabs) {
                total_tab_content_width += kTabSpacing;
            }
            total_tab_content_width += button_width;
            has_any_tabs = true;
        }

        const float visible_tab_width = std::max(0.0f, size.x - kTabStripSidePadding);
        const bool allow_horizontal_scroll = pane_count() > 1;
        const bool needs_horizontal_scroll = allow_horizontal_scroll && total_tab_content_width > visible_tab_width;
        out_height = std::min(
            kTabBarHeight + (needs_horizontal_scroll ? (kTabStripScrollbarSize + 4.0f) : 4.0f),
            size.y);

        ImGui::SetNextWindowPos(pos);
        ImGui::SetNextWindowSize(ImVec2(size.x, out_height));
        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoSavedSettings;

        const std::string window_name = "##filetree_tabs_" + std::to_string(pane_id);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(8.0f, 6.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 1.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
        ImGui::PushStyleColor(ImGuiCol_WindowBg, IM_COL32(25, 25, 25, 255));
        ImGui::PushStyleColor(ImGuiCol_Border, IM_COL32(55, 55, 55, 255));

        int activate_tab_id = -1;
        int close_tab_id = -1;
        int toggle_pin_tab_id = -1;
        int drag_tab_id = -1;
        int drag_target_tab_id = -1;
        int append_tab_source_pane_id = -1;
        int append_tab_id = -1;
        bool create_tab = false;
        const ImVec4 scrollbar_bg(1.0f, 1.0f, 1.0f, 0.04f);
        const ImVec4 scrollbar_grab(0.96f, 0.96f, 0.96f, 0.32f);
        const ImVec4 scrollbar_grab_hovered(0.98f, 0.98f, 0.98f, 0.46f);
        const ImVec4 scrollbar_grab_active(1.0f, 1.0f, 1.0f, 0.62f);

        if (ImGui::Begin(window_name.c_str(), nullptr, flags)) {
            if (ImGui::IsWindowHovered(ImGuiHoveredFlags_ChildWindows) &&
                ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
                active_pane_id_ = pane_id;
            }

            ImGui::SetCursorPos(ImVec2(8.0f, 6.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_ScrollbarSize, kTabStripScrollbarSize);
            ImGui::PushStyleColor(ImGuiCol_ScrollbarBg, scrollbar_bg);
            ImGui::PushStyleColor(ImGuiCol_ScrollbarGrab, scrollbar_grab);
            ImGui::PushStyleColor(ImGuiCol_ScrollbarGrabHovered, scrollbar_grab_hovered);
            ImGui::PushStyleColor(ImGuiCol_ScrollbarGrabActive, scrollbar_grab_active);
            ImGuiWindowFlags child_flags = ImGuiWindowFlags_NoScrollWithMouse;
            if (needs_horizontal_scroll) {
                child_flags |= ImGuiWindowFlags_HorizontalScrollbar;
            }
            if (ImGui::BeginChild("##tab_scroll_region",
                                  ImVec2(0.0f, out_height - 12.0f),
                                  false,
                                  child_flags)) {
                ImGui::SetCursorPos(ImVec2(0.0f, 0.0f));

                for (size_t index = 0; index < pane->tab_order.size(); ++index) {
                    ExplorerTab* tab = get_tab(pane->tab_order[index]);
                    if (!tab) {
                        continue;
                    }

                    ImGui::PushID(tab->tab_id);
                    if (index > 0) {
                        ImGui::SameLine(0.0f, kTabSpacing);
                    }

                    const bool is_active = pane->active_tab_id == tab->tab_id;
                    const bool can_close = pane->tab_order.size() > 1;
                    const std::string button_label = make_tab_button_label(*tab);
                    const ImVec2 label_size = ImGui::CalcTextSize(button_label.c_str());
                    const float button_width = std::clamp(
                        label_size.x + kTabPaddingX * 2.0f + (can_close ? (kCloseHitSize + kCloseGap) : 0.0f),
                        kTabMinWidth,
                        kTabMaxWidth);

                    const bool pressed = ImGui::InvisibleButton("##tab", ImVec2(button_width, kTabHeight));
                    const ImVec2 tab_min = ImGui::GetItemRectMin();
                    const ImVec2 tab_max = ImGui::GetItemRectMax();
                    const bool tab_hovered = ImGui::IsItemHovered();
                    const bool tab_held = ImGui::IsItemActive();

                    const ImVec2 close_min(
                        tab_max.x - kTabPaddingX - kCloseHitSize,
                        tab_min.y + std::floor((kTabHeight - kCloseHitSize) * 0.5f));
                    const ImVec2 close_max(close_min.x + kCloseHitSize, close_min.y + kCloseHitSize);
                    const bool show_close_button = can_close && tab_hovered;
                    const bool close_hovered =
                        show_close_button && ImGui::IsMouseHoveringRect(close_min, close_max);

                    const ImU32 bg_color = is_active
                        ? IM_COL32(64, 64, 64, 255)
                        : tab_held
                            ? IM_COL32(92, 92, 92, 255)
                            : tab_hovered
                                ? IM_COL32(78, 78, 78, 255)
                                : IM_COL32(40, 40, 40, 255);
                    const ImU32 border_color = is_active
                        ? IM_COL32(95, 95, 95, 255)
                        : IM_COL32(58, 58, 58, 255);
                    ImDrawList* draw_list = ImGui::GetWindowDrawList();
                    draw_list->AddRectFilled(tab_min, tab_max, bg_color, 6.0f);
                    draw_list->AddRect(tab_min, tab_max, border_color, 6.0f, 0, 1.0f);

                    const float text_right = can_close ? (close_min.x - kCloseGap) : (tab_max.x - kTabPaddingX);
                    const ImVec2 text_pos(
                        tab_min.x + kTabPaddingX,
                        tab_min.y + std::floor((kTabHeight - label_size.y) * 0.5f));
                    draw_list->PushClipRect(
                        ImVec2(text_pos.x, tab_min.y),
                        ImVec2(text_right, tab_max.y),
                        true);
                    draw_list->AddText(text_pos, IM_COL32(230, 230, 230, 255), button_label.c_str());
                    draw_list->PopClipRect();

                    if (show_close_button) {
                        const ImU32 close_bg = close_hovered
                            ? IM_COL32(255, 255, 255, 28)
                            : IM_COL32(255, 255, 255, 0);
                        const ImU32 close_color = close_hovered
                            ? IM_COL32(255, 255, 255, 230)
                            : IM_COL32(225, 225, 225, 180);
                        draw_list->AddRectFilled(close_min, close_max, close_bg, 4.0f);

                        const float cross_inset = 5.0f;
                        draw_list->AddLine(
                            ImVec2(close_min.x + cross_inset, close_min.y + cross_inset),
                            ImVec2(close_max.x - cross_inset, close_max.y - cross_inset),
                            close_color,
                            1.5f);
                        draw_list->AddLine(
                            ImVec2(close_min.x + cross_inset, close_max.y - cross_inset),
                            ImVec2(close_max.x - cross_inset, close_min.y + cross_inset),
                            close_color,
                            1.5f);
                    }

                    if (pressed) {
                        if (close_hovered) {
                            close_tab_id = tab->tab_id;
                        } else {
                            activate_tab_id = tab->tab_id;
                        }
                    }

                    if (tab_hovered && ImGui::IsMouseReleased(ImGuiMouseButton_Middle) &&
                        pane->tab_order.size() > 1) {
                        close_tab_id = tab->tab_id;
                    }

                    if (tab_hovered && label_size.x > (text_right - text_pos.x)) {
                        ImGui::SetTooltip("%s", button_label.c_str());
                    }

                    if (ImGui::BeginPopupContextItem("##tab_context")) {
                        if (ImGui::MenuItem(tab->pinned ? "Unpin Tab" : "Pin Tab")) {
                            toggle_pin_tab_id = tab->tab_id;
                        }
                        if (ImGui::MenuItem("Close Tab", nullptr, false, pane->tab_order.size() > 1)) {
                            close_tab_id = tab->tab_id;
                        }
                        ImGui::EndPopup();
                    }

                    if (!close_hovered && ImGui::BeginDragDropSource(ImGuiDragDropFlags_SourceNoDisableHover)) {
                        const TabPayload payload{pane_id, tab->tab_id};
                        ImGui::SetDragDropPayload(kTabPayloadType, &payload, sizeof(payload));
                        ImGui::TextUnformatted(button_label.c_str());
                        ImGui::EndDragDropSource();
                    }

                    if (ImGui::BeginDragDropTarget()) {
                        if (const ImGuiPayload* payload = ImGui::AcceptDragDropPayload(
                                kTabPayloadType, ImGuiDragDropFlags_AcceptBeforeDelivery)) {
                            if (payload->DataSize == sizeof(TabPayload)) {
                                const auto* data = static_cast<const TabPayload*>(payload->Data);
                                if (data->tab_id != tab->tab_id) {
                                    if (payload->IsDelivery()) {
                                        drag_tab_id = data->tab_id;
                                        drag_target_tab_id = tab->tab_id;
                                    }
                                }
                            }
                        }
                        ImGui::EndDragDropTarget();
                    }

                    ImGui::PopID();
                }

                // Cross-pane append target for the visible tab strip area.
                if (!pane->tab_order.empty()) {
                    ImGui::SameLine(0.0f, 0.0f);
                }
                ImGui::PushStyleColor(ImGuiCol_Button, IM_COL32(36, 36, 36, 255));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, IM_COL32(62, 62, 62, 255));
                ImGui::PushStyleColor(ImGuiCol_ButtonActive, IM_COL32(74, 74, 74, 255));
                if (ImGui::Button("+", ImVec2(28.0f, 28.0f))) {
                    create_tab = true;
                }
                if (ImGui::BeginDragDropTarget()) {
                    if (const ImGuiPayload* payload = ImGui::AcceptDragDropPayload(
                            kTabPayloadType, ImGuiDragDropFlags_AcceptBeforeDelivery)) {
                        if (payload->DataSize == sizeof(TabPayload)) {
                            const auto* data = static_cast<const TabPayload*>(payload->Data);
                            if (data->source_pane_id != pane_id) {
                                if (payload->IsDelivery()) {
                                    append_tab_source_pane_id = data->source_pane_id;
                                    append_tab_id = data->tab_id;
                                }
                            }
                        }
                    }
                    ImGui::EndDragDropTarget();
                }
                if (ImGui::IsItemHovered()) {
                    ImGui::SetTooltip("New Tab (%s)", core::CommandManager::get().label("explorer.new_tab").c_str());
                }
                ImGui::PopStyleColor(3);

                ImGui::SameLine(0.0f, 0.0f);
                ImGui::InvisibleButton("##tab_strip_append_target",
                                       ImVec2(std::max(32.0f, ImGui::GetContentRegionAvail().x), 28.0f));
                if (ImGui::BeginDragDropTarget()) {
                    if (const ImGuiPayload* payload = ImGui::AcceptDragDropPayload(
                            kTabPayloadType, ImGuiDragDropFlags_AcceptBeforeDelivery)) {
                        if (payload->DataSize == sizeof(TabPayload)) {
                            const auto* data = static_cast<const TabPayload*>(payload->Data);
                            if (data->source_pane_id != pane_id) {
                                if (payload->IsDelivery()) {
                                    append_tab_source_pane_id = data->source_pane_id;
                                    append_tab_id = data->tab_id;
                                }
                            }
                        }
                    }
                    ImGui::EndDragDropTarget();
                }
            }
            ImGui::EndChild();
            ImGui::PopStyleColor(4);
            ImGui::PopStyleVar();
        }
        ImGui::End();

        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(3);

        if (drag_tab_id >= 0 && drag_target_tab_id >= 0) {
            move_tab_before(pane_id, drag_tab_id, drag_target_tab_id);
        }
        if (append_tab_source_pane_id >= 0 && append_tab_id >= 0) {
            append_tab_to_pane(append_tab_source_pane_id, pane_id, append_tab_id);
        }
        if (toggle_pin_tab_id >= 0) {
            if (ExplorerTab* tab = get_tab(toggle_pin_tab_id)) {
                tab->pinned = !tab->pinned;
            }
            normalize_tab_order(*pane);
        }
        if (close_tab_id >= 0) {
            close_tab(pane_id, close_tab_id);
        }
        if (create_tab) {
            create_tab_from_active_pane(pane_id);
        }
        if (activate_tab_id >= 0) {
            activate_tab(pane_id, activate_tab_id);
        }
    }

    void FileTreePanel::render_drag_overlay(int pane_id, const ImVec2& pos, const ImVec2& size) {
        const std::string window_name = "##filetree_drag_overlay_" + std::to_string(pane_id);
        ImGui::SetNextWindowPos(pos);
        ImGui::SetNextWindowSize(size);
        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoSavedSettings |
            ImGuiWindowFlags_NoBackground;

        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
        if (ImGui::Begin(window_name.c_str(), nullptr, flags)) {
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            const PaneLocation target_location = find_pane(pane_id);
            const bool target_is_quarter =
                target_location.column_index >= 0 &&
                columns_[static_cast<size_t>(target_location.column_index)].pane_ids.size() == 2;
            const ImVec2 pane_max(pos.x + size.x, pos.y + size.y);
            const ImVec2 border_max(std::max(pos.x, pane_max.x - 1.0f),
                                    std::max(pos.y, pane_max.y - 1.0f));
            const float split_y = pos.y + std::floor(size.y * 0.5f);
            const ImVec2 top_max(pos.x + size.x, split_y);
            const ImVec2 bottom_pos(pos.x, split_y);
            const ImVec2 top_border_max(std::max(pos.x, top_max.x - 1.0f),
                                        std::max(pos.y, top_max.y - 1.0f));

            ImGui::SetCursorPos(ImVec2(0.0f, 0.0f));
            ImGui::InvisibleButton("##tab_overlay_target", size);
            if (ImGui::BeginDragDropTarget()) {
                if (const ImGuiPayload* payload = ImGui::AcceptDragDropPayload(
                        kTabPayloadType, ImGuiDragDropFlags_AcceptBeforeDelivery)) {
                    if (payload->DataSize == sizeof(TabPayload)) {
                        const auto* data = static_cast<const TabPayload*>(payload->Data);
                        if (data->source_pane_id != pane_id) {
                            draw_list->PushClipRect(pos, pane_max, true);
                            draw_list->AddRectFilled(pos, pane_max, IM_COL32(65, 105, 225, 42));
                            draw_list->AddRect(pos, border_max, IM_COL32(110, 150, 255, 170), 0.0f, 0, 2.0f);
                            draw_list->PopClipRect();
                            if (payload->IsDelivery()) {
                                pending_tab_append_ = PendingTabAppend{
                                    data->source_pane_id,
                                    pane_id,
                                    data->tab_id,
                                };
                            }
                        }
                    }
                }
                ImGui::EndDragDropTarget();
            }

            if (target_is_quarter) {
                const bool insert_before = target_location.row_index == 0;
                ImGui::SetCursorPos(ImVec2(0.0f, 0.0f));
                ImGui::InvisibleButton("##pane_overlay_full", size);
                if (ImGui::BeginDragDropTarget()) {
                    if (const ImGuiPayload* payload = ImGui::AcceptDragDropPayload(
                            kPanePayloadType, ImGuiDragDropFlags_AcceptBeforeDelivery)) {
                        if (payload->DataSize == sizeof(PanePayload)) {
                            const auto* data = static_cast<const PanePayload*>(payload->Data);
                            if (can_move_pane_relative(data->pane_id, pane_id, insert_before)) {
                                draw_list->PushClipRect(pos, pane_max, true);
                                draw_list->AddRectFilled(pos, pane_max, IM_COL32(65, 105, 225, 42));
                                draw_list->AddRect(pos, border_max, IM_COL32(110, 150, 255, 170), 0.0f, 0, 2.0f);
                                draw_list->PopClipRect();
                                if (payload->IsDelivery()) {
                                    pending_pane_move_ = PendingPaneMove{
                                        data->pane_id,
                                        pane_id,
                                        insert_before,
                                    };
                                }
                            }
                        }
                    }
                    ImGui::EndDragDropTarget();
                }
            } else {
                const ImVec2 half_size(size.x, split_y - pos.y);

                ImGui::SetCursorPos(ImVec2(0.0f, 0.0f));
                ImGui::InvisibleButton("##pane_overlay_top", half_size);
                if (ImGui::BeginDragDropTarget()) {
                    if (const ImGuiPayload* payload = ImGui::AcceptDragDropPayload(
                            kPanePayloadType, ImGuiDragDropFlags_AcceptBeforeDelivery)) {
                        if (payload->DataSize == sizeof(PanePayload)) {
                            const auto* data = static_cast<const PanePayload*>(payload->Data);
                            if (can_move_pane_relative(data->pane_id, pane_id, true)) {
                                draw_list->PushClipRect(pos, pane_max, true);
                                draw_list->AddRectFilled(pos, top_max, IM_COL32(65, 105, 225, 42));
                                draw_list->AddRect(pos, top_border_max, IM_COL32(110, 150, 255, 170), 0.0f, 0, 2.0f);
                                draw_list->PopClipRect();
                                if (payload->IsDelivery()) {
                                    pending_pane_move_ = PendingPaneMove{
                                        data->pane_id,
                                        pane_id,
                                        true,
                                    };
                                }
                            }
                        }
                    }
                    ImGui::EndDragDropTarget();
                }

                ImGui::SetCursorPos(ImVec2(0.0f, half_size.y));
                ImGui::InvisibleButton("##pane_overlay_bottom", half_size);
                if (ImGui::BeginDragDropTarget()) {
                    if (const ImGuiPayload* payload = ImGui::AcceptDragDropPayload(
                            kPanePayloadType, ImGuiDragDropFlags_AcceptBeforeDelivery)) {
                        if (payload->DataSize == sizeof(PanePayload)) {
                            const auto* data = static_cast<const PanePayload*>(payload->Data);
                            if (can_move_pane_relative(data->pane_id, pane_id, false)) {
                                draw_list->PushClipRect(pos, pane_max, true);
                                draw_list->AddRectFilled(bottom_pos, pane_max, IM_COL32(65, 105, 225, 42));
                                draw_list->AddRect(bottom_pos, border_max, IM_COL32(110, 150, 255, 170), 0.0f, 0, 2.0f);
                                draw_list->PopClipRect();
                                if (payload->IsDelivery()) {
                                    pending_pane_move_ = PendingPaneMove{
                                        data->pane_id,
                                        pane_id,
                                        false,
                                    };
                                }
                            }
                        }
                    }
                    ImGui::EndDragDropTarget();
                }
            }
        }
        ImGui::End();
        ImGui::PopStyleVar();
    }

    int FileTreePanel::create_pane_instance(int preferred_pane_id) {
        const int pane_id = preferred_pane_id >= 0 ? preferred_pane_id : next_pane_id_++;
        next_pane_id_ = std::max(next_pane_id_, pane_id + 1);

        ExplorerPane pane;
        pane.pane_id = pane_id;
        explorer_panes_.emplace(pane_id, std::move(pane));
        return pane_id;
    }

    int FileTreePanel::create_tab_instance(int pane_id,
                                           bool restore_persistent_state,
                                           const std::string& initial_path,
                                           bool pinned,
                                           const std::string& preferred_explorer_state_key,
                                           const std::string& preferred_search_state_key,
                                           const std::string& preferred_panel_id,
                                           int preferred_tab_id) {
        ExplorerPane* pane = get_pane(pane_id);
        if (!pane) {
            return -1;
        }

        const int tab_id = preferred_tab_id >= 0 ? preferred_tab_id : next_tab_id_++;
        next_tab_id_ = std::max(next_tab_id_, tab_id + 1);

        const bool is_primary = pane->tab_order.empty() &&
                                pane_id == 1 &&
                                preferred_explorer_state_key.empty() &&
                                preferred_search_state_key.empty() &&
                                preferred_panel_id.empty();
        const std::string explorer_state_key = preferred_explorer_state_key.empty()
            ? (is_primary ? "Files" : "FilesTab" + std::to_string(tab_id))
            : preferred_explorer_state_key;
        const std::string search_state_key = preferred_search_state_key.empty()
            ? (is_primary ? "Search" : "SearchTab" + std::to_string(tab_id))
            : preferred_search_state_key;
        const std::string panel_id = preferred_panel_id.empty()
            ? (is_primary ? "primary" : "tab_" + std::to_string(tab_id))
            : preferred_panel_id;

        ExplorerTab tab;
        tab.tab_id = tab_id;
        tab.pinned = pinned;
        tab.explorer_state_key = explorer_state_key;
        tab.search_state_key = search_state_key;
        tab.panel_id = panel_id;
        tab.explorer_panel = std::make_shared<FileExplorerPanel>(
            ui_registry_,
            worker_pool_,
            client_,
            explorer_state_key,
            search_state_key,
            panel_id,
            restore_persistent_state,
            initial_path
        );
        tab.search_panel = std::make_shared<SearchPanel>(
            ui_registry_, worker_pool_, explorer_state_key, search_state_key);
        tab.explorer_panel->set_search_panel(tab.search_panel.get());
        tab.explorer_panel->set_shared_path_refresh_callback(
            [this, explorer_state_key](const std::string& path) {
                refresh_matching_tabs(path, explorer_state_key);
            });

        explorer_tabs_.emplace(tab_id, std::move(tab));
        pane->tab_order.push_back(tab_id);
        if (pane->active_tab_id < 0) {
            pane->active_tab_id = tab_id;
        }
        normalize_tab_order(*pane);
        return tab_id;
    }

    int FileTreePanel::restore_pane_instance(const PaneSnapshot& snapshot) {
        const int pane_id = create_pane_instance();
        for (const TabSnapshot& tab_snapshot : snapshot.tabs) {
            const int tab_id = create_tab_instance(pane_id, false, tab_snapshot.current_path, tab_snapshot.pinned);
            if (ExplorerTab* tab = get_tab(tab_id)) {
                apply_tab_snapshot(*tab, tab_snapshot);
                tab->pinned = tab_snapshot.pinned;
            }
        }

        ExplorerPane* pane = get_pane(pane_id);
        if (!pane) {
            return -1;
        }

        pane->closed_tabs = snapshot.closed_tabs;
        normalize_tab_order(*pane);
        if (!pane->tab_order.empty()) {
            const int clamped_index =
                std::clamp(snapshot.active_tab_index, 0, static_cast<int>(pane->tab_order.size()) - 1);
            pane->active_tab_id = pane->tab_order[static_cast<size_t>(clamped_index)];
        }
        return pane_id;
    }

    void FileTreePanel::destroy_pane_instance(int pane_id) {
        ExplorerPane* pane = get_pane(pane_id);
        if (!pane) {
            return;
        }
        for (int tab_id : pane->tab_order) {
            explorer_tabs_.erase(tab_id);
        }
        explorer_panes_.erase(pane_id);
    }

    void FileTreePanel::split_active_vertical() {
        if (columns_.size() == 2) {
            const PaneLocation location = find_pane(active_pane_id_);
            if (location.column_index == 0) {
                collapse_right_column();
            } else {
                notify_layout_error("Pane Already Split", "Vertical split only applies to the full files view.");
            }
            return;
        }

        if (!can_split_vertical()) {
            notify_layout_error("Pane Limit Reached", "Vertical split is only available on the initial full pane.");
            return;
        }

        ExplorerTab* source_tab = get_active_tab(active_pane_id_);
        if (!source_tab) {
            return;
        }

        const TabSnapshot source_snapshot = capture_tab_snapshot(*source_tab);
        const int new_pane_id = create_pane_instance();
        const int new_tab_id = create_tab_instance(new_pane_id, false, source_snapshot.current_path);
        if (ExplorerTab* new_tab = get_tab(new_tab_id)) {
            apply_tab_snapshot(*new_tab, source_snapshot);
        }

        columns_.push_back({std::vector<int>{new_pane_id}});
        vertical_split_ratio_ = 0.5f;
        active_pane_id_ = new_pane_id;
    }

    void FileTreePanel::split_active_horizontal() {
        const PaneLocation location = find_pane(active_pane_id_);
        if (location.column_index < 0) {
            return;
        }

        Column& column = columns_[static_cast<size_t>(location.column_index)];
        if (column.pane_ids.size() == 2) {
            if (location.row_index == 0) {
                collapse_bottom_of_column(location.column_index);
            } else {
                notify_layout_error("Pane Already Split", "That column already has two panes.");
            }
            return;
        }

        if (!can_split_horizontal(active_pane_id_)) {
            notify_layout_error("Pane Limit Reached", "Misty supports up to 4 panes in a 2x2 grid.");
            return;
        }

        ExplorerTab* source_tab = get_active_tab(active_pane_id_);
        if (!source_tab) {
            return;
        }

        const TabSnapshot source_snapshot = capture_tab_snapshot(*source_tab);
        const int new_pane_id = create_pane_instance();
        const int new_tab_id = create_tab_instance(new_pane_id, false, source_snapshot.current_path);
        if (ExplorerTab* new_tab = get_tab(new_tab_id)) {
            apply_tab_snapshot(*new_tab, source_snapshot);
        }

        column.pane_ids.push_back(new_pane_id);
        column_split_ratios_[static_cast<size_t>(std::clamp(location.column_index, 0, 1))] = 0.5f;
        active_pane_id_ = new_pane_id;
    }

    void FileTreePanel::collapse_right_column() {
        if (columns_.size() != 2) {
            return;
        }

        ClosedPaneSnapshot snapshot;
        snapshot.restore_mode = RestoreMode::Column;
        snapshot.column_index = 1;
        snapshot.row_index = 0;
        for (int pane_id : columns_[1].pane_ids) {
            snapshot.panes.push_back(capture_pane_snapshot(pane_id));
        }
        if (!snapshot.panes.empty()) {
            closed_pane_snapshots_.push_back(std::move(snapshot));
            if (closed_pane_snapshots_.size() > kMaxClosedPaneSnapshots) {
                closed_pane_snapshots_.erase(closed_pane_snapshots_.begin());
            }
        }

        for (int pane_id : columns_[1].pane_ids) {
            destroy_pane_instance(pane_id);
        }
        columns_.erase(columns_.begin() + 1);
        normalize_columns();
        if (!columns_.empty() && !columns_[0].pane_ids.empty()) {
            active_pane_id_ = columns_[0].pane_ids.front();
        }
    }

    void FileTreePanel::collapse_bottom_of_column(int column_index) {
        if (column_index < 0 || column_index >= static_cast<int>(columns_.size())) {
            return;
        }
        Column& column = columns_[static_cast<size_t>(column_index)];
        if (column.pane_ids.size() != 2) {
            return;
        }

        ClosedPaneSnapshot snapshot;
        snapshot.restore_mode = RestoreMode::Row;
        snapshot.column_index = column_index;
        snapshot.row_index = 1;
        snapshot.panes.push_back(capture_pane_snapshot(column.pane_ids[1]));
        closed_pane_snapshots_.push_back(std::move(snapshot));
        if (closed_pane_snapshots_.size() > kMaxClosedPaneSnapshots) {
            closed_pane_snapshots_.erase(closed_pane_snapshots_.begin());
        }

        destroy_pane_instance(column.pane_ids[1]);
        column.pane_ids.erase(column.pane_ids.begin() + 1);
        active_pane_id_ = column.pane_ids.front();
        normalize_columns();
    }

    void FileTreePanel::close_active_pane() {
        if (pane_count() <= 1) {
            return;
        }

        const PaneLocation location = find_pane(active_pane_id_);
        if (location.column_index < 0) {
            return;
        }

        ClosedPaneSnapshot snapshot;
        const Column& column = columns_[static_cast<size_t>(location.column_index)];
        snapshot.restore_mode = (columns_.size() == 2 && column.pane_ids.size() == 1)
            ? RestoreMode::Column
            : RestoreMode::Row;
        snapshot.column_index = location.column_index;
        snapshot.row_index = location.row_index;
        snapshot.panes.push_back(capture_pane_snapshot(active_pane_id_));
        closed_pane_snapshots_.push_back(std::move(snapshot));
        if (closed_pane_snapshots_.size() > kMaxClosedPaneSnapshots) {
            closed_pane_snapshots_.erase(closed_pane_snapshots_.begin());
        }

        const int next_focus = choose_focus_after_removal(active_pane_id_, location);
        remove_pane_from_layout(active_pane_id_);
        destroy_pane_instance(active_pane_id_);
        normalize_columns();
        active_pane_id_ = next_focus >= 0 ? next_focus : active_pane_id_;
        if (get_pane(active_pane_id_) == nullptr && !columns_.empty() && !columns_[0].pane_ids.empty()) {
            active_pane_id_ = columns_[0].pane_ids.front();
        }
    }

    void FileTreePanel::restore_last_closed_pane() {
        if (closed_pane_snapshots_.empty()) {
            return;
        }

        const ClosedPaneSnapshot snapshot = closed_pane_snapshots_.back();
        if (snapshot.panes.empty()) {
            closed_pane_snapshots_.pop_back();
            return;
        }

        if (pane_count() + static_cast<int>(snapshot.panes.size()) > kMaxPaneCount) {
            notify_layout_error("Pane Limit Reached", "Close another pane before restoring this one.");
            return;
        }

        if (snapshot.restore_mode == RestoreMode::Column) {
            if (columns_.size() >= 2) {
                notify_layout_error("Pane Limit Reached", "There is no open column available for this restore.");
                return;
            }

            Column restored_column;
            for (const PaneSnapshot& pane_snapshot : snapshot.panes) {
                const int pane_id = restore_pane_instance(pane_snapshot);
                if (pane_id >= 0) {
                    restored_column.pane_ids.push_back(pane_id);
                }
            }
            if (restored_column.pane_ids.empty()) {
                notify_layout_error("Restore Failed", "Misty could not restore the closed pane.");
                return;
            }

            const int insert_index = std::clamp(snapshot.column_index, 0, static_cast<int>(columns_.size()));
            columns_.insert(columns_.begin() + insert_index, std::move(restored_column));
            normalize_columns();
            active_pane_id_ = columns_[static_cast<size_t>(insert_index)].pane_ids.front();
            closed_pane_snapshots_.pop_back();
            return;
        }

        const int column_index = std::clamp(snapshot.column_index, 0, static_cast<int>(columns_.size()) - 1);
        Column& column = columns_[static_cast<size_t>(column_index)];
        if (column.pane_ids.size() >= 2) {
            notify_layout_error("Pane Limit Reached", "That column already has two panes.");
            return;
        }

        const int restored_pane_id = restore_pane_instance(snapshot.panes.front());
        if (restored_pane_id < 0) {
            notify_layout_error("Restore Failed", "Misty could not restore the closed pane.");
            return;
        }

        const int insert_index = std::clamp(snapshot.row_index, 0, static_cast<int>(column.pane_ids.size()));
        column.pane_ids.insert(column.pane_ids.begin() + insert_index, restored_pane_id);
        normalize_columns();
        active_pane_id_ = restored_pane_id;
        closed_pane_snapshots_.pop_back();
    }

    void FileTreePanel::activate_tab(int pane_id, int tab_id) {
        ExplorerPane* pane = get_pane(pane_id);
        if (!pane || !get_tab(tab_id)) {
            return;
        }
        pane->active_tab_id = tab_id;
        active_pane_id_ = pane_id;
    }

    void FileTreePanel::create_tab_from_active_pane(int pane_id) {
        ExplorerPane* pane = get_pane(pane_id);
        ExplorerTab* active_tab = get_active_tab(pane_id);
        if (!pane || !active_tab) {
            return;
        }

        TabSnapshot snapshot = capture_tab_snapshot(*active_tab);
        snapshot.pinned = false;
        snapshot.search_open = false;
        snapshot.search_query.clear();

        const int new_tab_id = create_tab_instance(pane_id, false, snapshot.current_path, false);
        if (ExplorerTab* new_tab = get_tab(new_tab_id)) {
            apply_tab_snapshot(*new_tab, snapshot);
            activate_tab(pane_id, new_tab_id);
        }
    }

    void FileTreePanel::close_tab(int pane_id, int tab_id) {
        ExplorerPane* pane = get_pane(pane_id);
        ExplorerTab* tab = get_tab(tab_id);
        if (!pane || !tab || pane->tab_order.size() <= 1) {
            return;
        }

        pane->closed_tabs.push_back(capture_tab_snapshot(*tab));
        if (pane->closed_tabs.size() > 12) {
            pane->closed_tabs.erase(pane->closed_tabs.begin());
        }

        const auto current_it = std::find(pane->tab_order.begin(), pane->tab_order.end(), tab_id);
        const size_t current_index = current_it == pane->tab_order.end()
            ? 0
            : static_cast<size_t>(std::distance(pane->tab_order.begin(), current_it));

        pane->tab_order.erase(std::remove(pane->tab_order.begin(), pane->tab_order.end(), tab_id), pane->tab_order.end());
        explorer_tabs_.erase(tab_id);

        if (pane->active_tab_id == tab_id) {
            if (!pane->tab_order.empty()) {
                const size_t next_index = std::min(current_index, pane->tab_order.size() - 1);
                pane->active_tab_id = pane->tab_order[next_index];
            } else {
                pane->active_tab_id = -1;
            }
        }

        normalize_tab_order(*pane);
        active_pane_id_ = pane_id;
    }

    void FileTreePanel::restore_last_closed_tab(int pane_id) {
        ExplorerPane* pane = get_pane(pane_id);
        if (!pane || pane->closed_tabs.empty()) {
            return;
        }

        TabSnapshot snapshot = pane->closed_tabs.back();
        pane->closed_tabs.pop_back();

        const int tab_id = create_tab_instance(pane_id, false, snapshot.current_path, snapshot.pinned);
        if (ExplorerTab* tab = get_tab(tab_id)) {
            apply_tab_snapshot(*tab, snapshot);
            tab->pinned = snapshot.pinned;
            normalize_tab_order(*pane);
            activate_tab(pane_id, tab_id);
        }
    }

    void FileTreePanel::activate_tab_by_index(int pane_id, size_t tab_index) {
        ExplorerPane* pane = get_pane(pane_id);
        if (!pane || tab_index >= pane->tab_order.size()) {
            return;
        }
        activate_tab(pane_id, pane->tab_order[tab_index]);
    }

    void FileTreePanel::move_tab_before(int pane_id, int dragged_tab_id, int target_tab_id) {
        ExplorerPane* target_pane = get_pane(pane_id);
        ExplorerTab* dragged_tab = get_tab(dragged_tab_id);
        ExplorerTab* target_tab = get_tab(target_tab_id);
        if (!target_pane || !dragged_tab || !target_tab || dragged_tab_id == target_tab_id) {
            return;
        }

        ExplorerPane* source_pane = nullptr;
        for (auto& [_, pane] : explorer_panes_) {
            if (std::find(pane.tab_order.begin(), pane.tab_order.end(), dragged_tab_id) != pane.tab_order.end()) {
                source_pane = &pane;
                break;
            }
        }
        if (!source_pane) {
            return;
        }

        auto target_it = std::find(target_pane->tab_order.begin(), target_pane->tab_order.end(), target_tab_id);
        if (target_it == target_pane->tab_order.end()) {
            return;
        }

        if (source_pane == target_pane) {
            auto dragged_it = std::find(target_pane->tab_order.begin(), target_pane->tab_order.end(), dragged_tab_id);
            if (dragged_it == target_pane->tab_order.end()) {
                return;
            }

            const int dragged = *dragged_it;
            target_pane->tab_order.erase(dragged_it);
            target_it = std::find(target_pane->tab_order.begin(), target_pane->tab_order.end(), target_tab_id);
            target_pane->tab_order.insert(target_it, dragged);
            normalize_tab_order(*target_pane);
            activate_tab(pane_id, dragged_tab_id);
            return;
        }

        source_pane->tab_order.erase(
            std::remove(source_pane->tab_order.begin(), source_pane->tab_order.end(), dragged_tab_id),
            source_pane->tab_order.end());
        target_it = std::find(target_pane->tab_order.begin(), target_pane->tab_order.end(), target_tab_id);
        target_pane->tab_order.insert(target_it, dragged_tab_id);

        if (source_pane->active_tab_id == dragged_tab_id) {
            source_pane->active_tab_id = source_pane->tab_order.empty() ? -1 : source_pane->tab_order.front();
        }

        normalize_tab_order(*target_pane);
        normalize_tab_order(*source_pane);
        activate_tab(pane_id, dragged_tab_id);

        if (source_pane->tab_order.empty()) {
            const int emptied_pane_id = source_pane->pane_id;
            const PaneLocation location = find_pane(emptied_pane_id);
            const int next_focus = choose_focus_after_removal(emptied_pane_id, location);
            remove_pane_from_layout(emptied_pane_id);
            destroy_pane_instance(emptied_pane_id);
            normalize_columns();
            if (active_pane_id_ == emptied_pane_id) {
                active_pane_id_ = next_focus >= 0 ? next_focus : pane_id;
            }
        }
    }

    void FileTreePanel::append_tab_to_pane(int source_pane_id, int target_pane_id, int tab_id) {
        if (source_pane_id == target_pane_id) {
            return;
        }

        ExplorerPane* source_pane = get_pane(source_pane_id);
        ExplorerPane* target_pane = get_pane(target_pane_id);
        ExplorerTab* tab = get_tab(tab_id);
        if (!source_pane || !target_pane || !tab) {
            return;
        }

        source_pane->tab_order.erase(
            std::remove(source_pane->tab_order.begin(), source_pane->tab_order.end(), tab_id),
            source_pane->tab_order.end());
        target_pane->tab_order.push_back(tab_id);
        normalize_tab_order(*target_pane);
        activate_tab(target_pane_id, tab_id);

        if (source_pane->active_tab_id == tab_id) {
            source_pane->active_tab_id = source_pane->tab_order.empty() ? -1 : source_pane->tab_order.front();
        }
        normalize_tab_order(*source_pane);

        if (source_pane->tab_order.empty()) {
            const PaneLocation location = find_pane(source_pane_id);
            const int next_focus = choose_focus_after_removal(source_pane_id, location);
            remove_pane_from_layout(source_pane_id);
            destroy_pane_instance(source_pane_id);
            normalize_columns();
            active_pane_id_ = next_focus >= 0 ? next_focus : target_pane_id;
        }
    }

    void FileTreePanel::normalize_tab_order(ExplorerPane& pane) {
        std::vector<int> pinned_tabs;
        std::vector<int> normal_tabs;
        std::unordered_set<int> seen;

        for (int tab_id : pane.tab_order) {
            ExplorerTab* tab = get_tab(tab_id);
            if (!tab || !seen.insert(tab_id).second) {
                continue;
            }
            if (tab->pinned) {
                pinned_tabs.push_back(tab_id);
            } else {
                normal_tabs.push_back(tab_id);
            }
        }

        pane.tab_order.clear();
        pane.tab_order.insert(pane.tab_order.end(), pinned_tabs.begin(), pinned_tabs.end());
        pane.tab_order.insert(pane.tab_order.end(), normal_tabs.begin(), normal_tabs.end());

        if (pane.active_tab_id < 0 ||
            std::find(pane.tab_order.begin(), pane.tab_order.end(), pane.active_tab_id) == pane.tab_order.end()) {
            pane.active_tab_id = pane.tab_order.empty() ? -1 : pane.tab_order.front();
        }
    }

    bool FileTreePanel::move_pane_relative(int source_pane_id, int target_pane_id, bool insert_before) {
        if (!can_move_pane_relative(source_pane_id, target_pane_id, insert_before)) {
            return false;
        }

        if (source_pane_id == target_pane_id) {
            return false;
        }

        const PaneLocation source = find_pane(source_pane_id);
        const PaneLocation target = find_pane(target_pane_id);
        if (source.column_index < 0 || target.column_index < 0) {
            return false;
        }

        if (source.column_index == target.column_index) {
            Column& column = columns_[static_cast<size_t>(source.column_index)];
            auto source_it = std::find(column.pane_ids.begin(), column.pane_ids.end(), source_pane_id);
            auto target_it = std::find(column.pane_ids.begin(), column.pane_ids.end(), target_pane_id);
            if (source_it == column.pane_ids.end() || target_it == column.pane_ids.end()) {
                return false;
            }

            column.pane_ids.erase(source_it);
            target_it = std::find(column.pane_ids.begin(), column.pane_ids.end(), target_pane_id);
            if (!insert_before) {
                ++target_it;
            }
            column.pane_ids.insert(target_it, source_pane_id);
            active_pane_id_ = source_pane_id;
            return true;
        }

        Column& source_column = columns_[static_cast<size_t>(source.column_index)];
        Column& target_column = columns_[static_cast<size_t>(target.column_index)];

        if (target_column.pane_ids.size() == 1) {
            source_column.pane_ids.erase(source_column.pane_ids.begin() + source.row_index);
            normalize_columns();

            PaneLocation refreshed_target = find_pane(target_pane_id);
            if (refreshed_target.column_index < 0) {
                return false;
            }

            Column& refreshed_target_column = columns_[static_cast<size_t>(refreshed_target.column_index)];
            const int insert_index = insert_before ? refreshed_target.row_index : refreshed_target.row_index + 1;
            refreshed_target_column.pane_ids.insert(
                refreshed_target_column.pane_ids.begin() + insert_index,
                source_pane_id);
            active_pane_id_ = source_pane_id;
            return true;
        }

        const int displaced_index = target.row_index == 0 ? 1 : 0;
        const int displaced_pane_id = target_column.pane_ids[static_cast<size_t>(displaced_index)];
        const std::vector<int> reordered_target = insert_before
            ? std::vector<int>{source_pane_id, target_pane_id}
            : std::vector<int>{target_pane_id, source_pane_id};
        target_column.pane_ids = reordered_target;

        if (source_column.pane_ids.size() == 1) {
            source_column.pane_ids[0] = displaced_pane_id;
        } else {
            source_column.pane_ids[static_cast<size_t>(source.row_index)] = displaced_pane_id;
        }

        active_pane_id_ = source_pane_id;
        return true;
    }

    bool FileTreePanel::can_move_pane_relative(int source_pane_id, int target_pane_id, bool insert_before) const {
        if (source_pane_id == target_pane_id) {
            return false;
        }

        const PaneLocation source = find_pane(source_pane_id);
        const PaneLocation target = find_pane(target_pane_id);
        if (source.column_index < 0 || target.column_index < 0) {
            return false;
        }

        if (source.column_index == target.column_index) {
            const Column& column = columns_[static_cast<size_t>(source.column_index)];
            if (column.pane_ids.size() != 2) {
                return false;
            }
            return insert_before
                ? source.row_index > target.row_index
                : source.row_index < target.row_index;
        }

        const Column& source_column = columns_[static_cast<size_t>(source.column_index)];
        const Column& target_column = columns_[static_cast<size_t>(target.column_index)];
        if (source_column.pane_ids.empty() || target_column.pane_ids.empty()) {
            return false;
        }

        return target_column.pane_ids.size() <= 2;
    }

    void FileTreePanel::remove_pane_from_layout(int pane_id) {
        for (auto column_it = columns_.begin(); column_it != columns_.end(); ++column_it) {
            auto pane_it = std::find(column_it->pane_ids.begin(), column_it->pane_ids.end(), pane_id);
            if (pane_it == column_it->pane_ids.end()) {
                continue;
            }
            column_it->pane_ids.erase(pane_it);
            break;
        }
    }

    void FileTreePanel::normalize_columns() {
        columns_.erase(
            std::remove_if(columns_.begin(), columns_.end(), [](const Column& column) {
                return column.pane_ids.empty();
            }),
            columns_.end());

        for (Column& column : columns_) {
            if (column.pane_ids.size() > 2) {
                column.pane_ids.resize(2);
            }
        }

        if (columns_.size() > 2) {
            columns_.resize(2);
        }
    }

    bool FileTreePanel::can_split_vertical() const {
        return pane_count() == 1 && columns_.size() == 1;
    }

    bool FileTreePanel::can_split_horizontal(int pane_id) const {
        if (pane_count() >= kMaxPaneCount) {
            return false;
        }
        const PaneLocation location = find_pane(pane_id);
        if (location.column_index < 0) {
            return false;
        }
        return columns_[static_cast<size_t>(location.column_index)].pane_ids.size() == 1;
    }

    int FileTreePanel::pane_count() const {
        int total = 0;
        for (const Column& column : columns_) {
            total += static_cast<int>(column.pane_ids.size());
        }
        return total;
    }

    FileTreePanel::PaneLocation FileTreePanel::find_pane(int pane_id) const {
        for (size_t column_index = 0; column_index < columns_.size(); ++column_index) {
            const Column& column = columns_[column_index];
            for (size_t row_index = 0; row_index < column.pane_ids.size(); ++row_index) {
                if (column.pane_ids[row_index] == pane_id) {
                    return PaneLocation{
                        static_cast<int>(column_index),
                        static_cast<int>(row_index),
                    };
                }
            }
        }
        return {};
    }

    int FileTreePanel::choose_focus_after_removal(int removed_pane_id, const PaneLocation& location) const {
        if (location.column_index < 0 || location.column_index >= static_cast<int>(columns_.size())) {
            return -1;
        }

        const Column& column = columns_[static_cast<size_t>(location.column_index)];
        if (column.pane_ids.size() > 1) {
            const int sibling_index = location.row_index == 0 ? 1 : 0;
            if (sibling_index >= 0 && sibling_index < static_cast<int>(column.pane_ids.size())) {
                return column.pane_ids[static_cast<size_t>(sibling_index)];
            }
        }

        const int other_column_index = location.column_index == 0 ? 1 : 0;
        if (other_column_index >= 0 && other_column_index < static_cast<int>(columns_.size())) {
            const Column& other = columns_[static_cast<size_t>(other_column_index)];
            if (!other.pane_ids.empty()) {
                return other.pane_ids.front();
            }
        }

        return removed_pane_id;
    }

    FileTreePanel::PaneSnapshot FileTreePanel::capture_pane_snapshot(int pane_id) const {
        PaneSnapshot snapshot;
        const ExplorerPane* pane = get_pane(pane_id);
        if (!pane) {
            return snapshot;
        }

        for (int tab_id : pane->tab_order) {
            const ExplorerTab* tab = get_tab(tab_id);
            if (!tab) {
                continue;
            }
            snapshot.tabs.push_back(capture_tab_snapshot(*tab));
        }

        auto active_it = std::find(pane->tab_order.begin(), pane->tab_order.end(), pane->active_tab_id);
        snapshot.active_tab_index = active_it == pane->tab_order.end()
            ? 0
            : static_cast<int>(std::distance(pane->tab_order.begin(), active_it));
        snapshot.closed_tabs = pane->closed_tabs;
        return snapshot;
    }

    FileTreePanel::TabSnapshot FileTreePanel::capture_tab_snapshot(const ExplorerTab& tab) const {
        TabSnapshot snapshot;
        snapshot.pinned = tab.pinned;

        auto& state = ui_registry_.get_state<FileExplorerState>(tab.explorer_state_key);
        {
            std::lock_guard<std::mutex> lock(state.mu);
            snapshot.current_path = !state.pending_navigation_path.empty()
                ? state.pending_navigation_path
                : std::string(state.current_path);
            snapshot.show_hidden = state.show_hidden;
            snapshot.grid_view = state.grid_view;
            snapshot.back_history = stack_to_vector(state.back_history);
            snapshot.forward_history = stack_to_vector(state.forward_history);
        }

        auto& search_state = ui_registry_.get_state<SearchState>(tab.search_state_key);
        {
            std::lock_guard<std::mutex> lock(search_state.mu);
            snapshot.search_open = search_state.is_open;
            snapshot.search_query = search_state.query_buf;
        }

        return snapshot;
    }

    void FileTreePanel::apply_tab_snapshot(const ExplorerTab& tab, const TabSnapshot& snapshot) {
        auto& state = ui_registry_.get_state<FileExplorerState>(tab.explorer_state_key);
        {
            std::lock_guard<std::mutex> lock(state.mu);
            state.show_hidden = snapshot.show_hidden;
            state.grid_view = snapshot.grid_view;
            state.back_history = vector_to_stack(snapshot.back_history);
            state.forward_history = vector_to_stack(snapshot.forward_history);
            state.selected_files.clear();
            state.last_selected_index = -1;
            if (!snapshot.current_path.empty()) {
                state.pending_navigation_path = snapshot.current_path;
            }
        }

        auto& search_state = ui_registry_.get_state<SearchState>(tab.search_state_key);
        {
            std::lock_guard<std::mutex> lock(search_state.mu);
            search_state.is_open = snapshot.search_open;
            search_state.focus_query = false;
            search_state.selected_index = 0;
            search_state.results.clear();
            search_state.search_pending = false;
            search_state.search_in_flight = false;
            ++search_state.request_generation;
            search_state.last_submitted_query.clear();
            search_state.last_err.clear();
            std::memset(search_state.query_buf, 0, sizeof(search_state.query_buf));
            std::strncpy(search_state.query_buf, snapshot.search_query.c_str(), sizeof(search_state.query_buf) - 1);
        }
    }

    FileTreePanel::ExplorerPane* FileTreePanel::get_pane(int pane_id) {
        auto it = explorer_panes_.find(pane_id);
        return it == explorer_panes_.end() ? nullptr : &it->second;
    }

    const FileTreePanel::ExplorerPane* FileTreePanel::get_pane(int pane_id) const {
        auto it = explorer_panes_.find(pane_id);
        return it == explorer_panes_.end() ? nullptr : &it->second;
    }

    FileTreePanel::ExplorerTab* FileTreePanel::get_tab(int tab_id) {
        auto it = explorer_tabs_.find(tab_id);
        return it == explorer_tabs_.end() ? nullptr : &it->second;
    }

    const FileTreePanel::ExplorerTab* FileTreePanel::get_tab(int tab_id) const {
        auto it = explorer_tabs_.find(tab_id);
        return it == explorer_tabs_.end() ? nullptr : &it->second;
    }

    FileTreePanel::ExplorerTab* FileTreePanel::get_active_tab(int pane_id) {
        ExplorerPane* pane = get_pane(pane_id);
        return pane ? get_tab(pane->active_tab_id) : nullptr;
    }

    const FileTreePanel::ExplorerTab* FileTreePanel::get_active_tab(int pane_id) const {
        const ExplorerPane* pane = get_pane(pane_id);
        return pane ? get_tab(pane->active_tab_id) : nullptr;
    }

    SearchPanel* FileTreePanel::active_search_panel() const {
        const ExplorerTab* tab = get_active_tab(active_pane_id_);
        return tab ? tab->search_panel.get() : nullptr;
    }

    std::string FileTreePanel::current_tab_path(const ExplorerTab& tab) const {
        auto& state = ui_registry_.get_state<FileExplorerState>(tab.explorer_state_key);
        std::lock_guard<std::mutex> lock(state.mu);
        if (!state.pending_navigation_path.empty()) {
            return state.pending_navigation_path;
        }
        return state.current_path;
    }

    std::string FileTreePanel::make_tab_title(const ExplorerTab& tab) const {
        return title_for_path(current_tab_path(tab));
    }

    std::string FileTreePanel::make_tab_button_label(const ExplorerTab& tab) const {
        return tab.pinned ? "[P] " + make_tab_title(tab) : make_tab_title(tab);
    }

    void FileTreePanel::refresh_matching_tabs(const std::string& path, const std::string& source_state_key) {
        if (path.empty()) {
            return;
        }

        for (auto& [_, tab] : explorer_tabs_) {
            if (tab.explorer_state_key == source_state_key) {
                continue;
            }

            auto& state = ui_registry_.get_state<FileExplorerState>(tab.explorer_state_key);
            std::lock_guard<std::mutex> lock(state.mu);
            const std::string effective_path = !state.pending_navigation_path.empty()
                ? state.pending_navigation_path
                : std::string(state.current_path);
            if (effective_path == path) {
                state.pending_navigation_path = path;
            }
        }
    }

    void FileTreePanel::notify_layout_error(const std::string& title, const std::string& message) {
        auto& notifications = ui_registry_.get_state<NotificationState>("Notifications");
        notifications.add_notification(title + ": " + message, 3.5f);
    }

    std::string FileTreePanel::layout_state_file_path() const {
        const char* home = std::getenv("HOME");
        if (!home) {
            return "";
        }
        return std::string(home) + "/misty/.cache/filetree_state.json";
    }

    bool FileTreePanel::restore_layout_state() {
        const std::string path = layout_state_file_path();
        if (path.empty() || !fs::exists(path)) {
            return false;
        }

        std::ifstream input(path);
        json j = json::parse(input, nullptr, false);
        if (j.is_discarded() || !j.contains("columns") || !j.contains("panes")) {
            return false;
        }

        explorer_panes_.clear();
        explorer_tabs_.clear();
        columns_.clear();
        closed_pane_snapshots_.clear();
        active_pane_id_ = -1;
        next_pane_id_ = 1;
        next_tab_id_ = 1;
        vertical_split_ratio_ = j.value("vertical_split_ratio", 0.5f);

        if (j.contains("column_split_ratios")) {
            const auto ratios = j["column_split_ratios"].get<std::vector<float>>();
            for (size_t index = 0; index < std::min(ratios.size(), column_split_ratios_.size()); ++index) {
                column_split_ratios_[index] = ratios[index];
            }
        }

        for (const auto& pane_json : j["panes"]) {
            const int pane_id = pane_json.value("pane_id", -1);
            if (pane_id < 0) {
                continue;
            }

            create_pane_instance(pane_id);
            ExplorerPane* pane = get_pane(pane_id);
            if (!pane) {
                continue;
            }

            std::unordered_map<int, json> tabs_by_id;
            if (pane_json.contains("tabs")) {
                for (const auto& tab_json : pane_json["tabs"]) {
                    tabs_by_id.emplace(tab_json.value("tab_id", -1), tab_json);
                }
            }

            std::vector<int> tab_order;
            if (pane_json.contains("tab_order")) {
                for (const auto& tab_id_json : pane_json["tab_order"]) {
                    tab_order.push_back(tab_id_json.get<int>());
                }
            }

            for (int tab_id : tab_order) {
                auto tab_it = tabs_by_id.find(tab_id);
                if (tab_it == tabs_by_id.end()) {
                    continue;
                }

                const json& tab_json = tab_it->second;
                const bool pinned = tab_json.value("pinned", false);
                const int created_tab_id = create_tab_instance(
                    pane_id,
                    false,
                    tab_json.value("current_path", ""),
                    pinned,
                    tab_json.value("explorer_state_key", ""),
                    tab_json.value("search_state_key", ""),
                    tab_json.value("panel_id", ""),
                    tab_id
                );

                ExplorerTab* tab = get_tab(created_tab_id);
                if (!tab) {
                    continue;
                }

                TabSnapshot snapshot;
                snapshot.pinned = pinned;
                snapshot.current_path = tab_json.value("current_path", "");
                snapshot.show_hidden = tab_json.value("show_hidden", false);
                snapshot.grid_view = tab_json.value("grid_view", false);
                snapshot.search_open = tab_json.value("search_open", false);
                snapshot.search_query = tab_json.value("search_query", "");
                if (tab_json.contains("back_history")) {
                    snapshot.back_history = tab_json["back_history"].get<std::vector<std::string>>();
                }
                if (tab_json.contains("forward_history")) {
                    snapshot.forward_history = tab_json["forward_history"].get<std::vector<std::string>>();
                }
                apply_tab_snapshot(*tab, snapshot);
                tab->pinned = pinned;
            }

            pane->active_tab_id = pane_json.value("active_tab_id", pane->active_tab_id);
            if (pane_json.contains("closed_tabs")) {
                for (const auto& closed_json : pane_json["closed_tabs"]) {
                    TabSnapshot snapshot;
                    snapshot.pinned = closed_json.value("pinned", false);
                    snapshot.current_path = closed_json.value("current_path", "");
                    snapshot.show_hidden = closed_json.value("show_hidden", false);
                    snapshot.grid_view = closed_json.value("grid_view", false);
                    snapshot.search_open = closed_json.value("search_open", false);
                    snapshot.search_query = closed_json.value("search_query", "");
                    if (closed_json.contains("back_history")) {
                        snapshot.back_history = closed_json["back_history"].get<std::vector<std::string>>();
                    }
                    if (closed_json.contains("forward_history")) {
                        snapshot.forward_history = closed_json["forward_history"].get<std::vector<std::string>>();
                    }
                    pane->closed_tabs.push_back(std::move(snapshot));
                }
            }
            normalize_tab_order(*pane);
        }

        for (const auto& column_json : j["columns"]) {
            Column column;
            if (column_json.contains("pane_ids")) {
                column.pane_ids = column_json["pane_ids"].get<std::vector<int>>();
            }
            if (!column.pane_ids.empty()) {
                columns_.push_back(std::move(column));
            }
        }

        active_pane_id_ = j.value("active_pane_id", -1);
        if (active_pane_id_ < 0 || !get_pane(active_pane_id_)) {
            if (!columns_.empty() && !columns_[0].pane_ids.empty()) {
                active_pane_id_ = columns_[0].pane_ids.front();
            }
        }

        if (j.contains("closed_panes")) {
            for (const auto& closed_json : j["closed_panes"]) {
                ClosedPaneSnapshot snapshot;
                snapshot.restore_mode = closed_json.value("restore_mode", "row") == "column"
                    ? RestoreMode::Column
                    : RestoreMode::Row;
                snapshot.column_index = closed_json.value("column_index", 0);
                snapshot.row_index = closed_json.value("row_index", 0);

                if (closed_json.contains("panes")) {
                    for (const auto& pane_json : closed_json["panes"]) {
                        PaneSnapshot pane_snapshot;
                        pane_snapshot.active_tab_index = pane_json.value("active_tab_index", 0);
                        if (pane_json.contains("tabs")) {
                            for (const auto& tab_json : pane_json["tabs"]) {
                                TabSnapshot tab_snapshot;
                                tab_snapshot.pinned = tab_json.value("pinned", false);
                                tab_snapshot.current_path = tab_json.value("current_path", "");
                                tab_snapshot.show_hidden = tab_json.value("show_hidden", false);
                                tab_snapshot.grid_view = tab_json.value("grid_view", false);
                                tab_snapshot.search_open = tab_json.value("search_open", false);
                                tab_snapshot.search_query = tab_json.value("search_query", "");
                                if (tab_json.contains("back_history")) {
                                    tab_snapshot.back_history = tab_json["back_history"].get<std::vector<std::string>>();
                                }
                                if (tab_json.contains("forward_history")) {
                                    tab_snapshot.forward_history = tab_json["forward_history"].get<std::vector<std::string>>();
                                }
                                pane_snapshot.tabs.push_back(std::move(tab_snapshot));
                            }
                        }
                        if (pane_json.contains("closed_tabs")) {
                            for (const auto& tab_json : pane_json["closed_tabs"]) {
                                TabSnapshot tab_snapshot;
                                tab_snapshot.pinned = tab_json.value("pinned", false);
                                tab_snapshot.current_path = tab_json.value("current_path", "");
                                tab_snapshot.show_hidden = tab_json.value("show_hidden", false);
                                tab_snapshot.grid_view = tab_json.value("grid_view", false);
                                tab_snapshot.search_open = tab_json.value("search_open", false);
                                tab_snapshot.search_query = tab_json.value("search_query", "");
                                if (tab_json.contains("back_history")) {
                                    tab_snapshot.back_history = tab_json["back_history"].get<std::vector<std::string>>();
                                }
                                if (tab_json.contains("forward_history")) {
                                    tab_snapshot.forward_history = tab_json["forward_history"].get<std::vector<std::string>>();
                                }
                                pane_snapshot.closed_tabs.push_back(std::move(tab_snapshot));
                            }
                        }
                        snapshot.panes.push_back(std::move(pane_snapshot));
                    }
                }

                if (!snapshot.panes.empty()) {
                    closed_pane_snapshots_.push_back(std::move(snapshot));
                }
            }
        }

        normalize_columns();
        if (columns_.empty() || explorer_panes_.empty()) {
            explorer_panes_.clear();
            explorer_tabs_.clear();
            columns_.clear();
            closed_pane_snapshots_.clear();
            return false;
        }

        last_layout_snapshot_ = j.dump();
        return true;
    }

    void FileTreePanel::maybe_persist_layout_state() {
        const double now = ImGui::GetTime();
        if (now - last_layout_save_time_ < kLayoutPersistIntervalSeconds) {
            return;
        }
        last_layout_save_time_ = now;
        save_layout_state();
    }

    void FileTreePanel::save_layout_state() {
        const std::string path = layout_state_file_path();
        if (path.empty() || columns_.empty() || explorer_panes_.empty()) {
            return;
        }

        json j;
        j["active_pane_id"] = active_pane_id_;
        j["vertical_split_ratio"] = vertical_split_ratio_;
        j["column_split_ratios"] = std::vector<float>(column_split_ratios_.begin(), column_split_ratios_.end());
        j["columns"] = json::array();
        j["panes"] = json::array();
        j["closed_panes"] = json::array();

        for (const Column& column : columns_) {
            j["columns"].push_back(json{{"pane_ids", column.pane_ids}});
        }

        std::vector<int> pane_ids;
        pane_ids.reserve(explorer_panes_.size());
        for (const auto& [pane_id, _] : explorer_panes_) {
            pane_ids.push_back(pane_id);
        }
        std::sort(pane_ids.begin(), pane_ids.end());

        for (int pane_id : pane_ids) {
            const ExplorerPane* pane = get_pane(pane_id);
            if (!pane) {
                continue;
            }

            json pane_json;
            pane_json["pane_id"] = pane_id;
            pane_json["active_tab_id"] = pane->active_tab_id;
            pane_json["tab_order"] = pane->tab_order;
            pane_json["tabs"] = json::array();
            pane_json["closed_tabs"] = json::array();

            for (int tab_id : pane->tab_order) {
                const ExplorerTab* tab = get_tab(tab_id);
                if (!tab) {
                    continue;
                }

                const TabSnapshot snapshot = capture_tab_snapshot(*tab);
                pane_json["tabs"].push_back(json{
                    {"tab_id", tab_id},
                    {"pinned", tab->pinned},
                    {"explorer_state_key", tab->explorer_state_key},
                    {"search_state_key", tab->search_state_key},
                    {"panel_id", tab->panel_id},
                    {"current_path", snapshot.current_path},
                    {"show_hidden", snapshot.show_hidden},
                    {"grid_view", snapshot.grid_view},
                    {"back_history", snapshot.back_history},
                    {"forward_history", snapshot.forward_history},
                    {"search_open", snapshot.search_open},
                    {"search_query", snapshot.search_query},
                });
            }

            for (const TabSnapshot& snapshot : pane->closed_tabs) {
                pane_json["closed_tabs"].push_back(json{
                    {"pinned", snapshot.pinned},
                    {"current_path", snapshot.current_path},
                    {"show_hidden", snapshot.show_hidden},
                    {"grid_view", snapshot.grid_view},
                    {"back_history", snapshot.back_history},
                    {"forward_history", snapshot.forward_history},
                    {"search_open", snapshot.search_open},
                    {"search_query", snapshot.search_query},
                });
            }

            j["panes"].push_back(std::move(pane_json));
        }

        for (const ClosedPaneSnapshot& snapshot : closed_pane_snapshots_) {
            json closed_json;
            closed_json["restore_mode"] = snapshot.restore_mode == RestoreMode::Column ? "column" : "row";
            closed_json["column_index"] = snapshot.column_index;
            closed_json["row_index"] = snapshot.row_index;
            closed_json["panes"] = json::array();

            for (const PaneSnapshot& pane_snapshot : snapshot.panes) {
                json pane_json;
                pane_json["active_tab_index"] = pane_snapshot.active_tab_index;
                pane_json["tabs"] = json::array();
                pane_json["closed_tabs"] = json::array();

                for (const TabSnapshot& tab_snapshot : pane_snapshot.tabs) {
                    pane_json["tabs"].push_back(json{
                        {"pinned", tab_snapshot.pinned},
                        {"current_path", tab_snapshot.current_path},
                        {"show_hidden", tab_snapshot.show_hidden},
                        {"grid_view", tab_snapshot.grid_view},
                        {"back_history", tab_snapshot.back_history},
                        {"forward_history", tab_snapshot.forward_history},
                        {"search_open", tab_snapshot.search_open},
                        {"search_query", tab_snapshot.search_query},
                    });
                }
                for (const TabSnapshot& tab_snapshot : pane_snapshot.closed_tabs) {
                    pane_json["closed_tabs"].push_back(json{
                        {"pinned", tab_snapshot.pinned},
                        {"current_path", tab_snapshot.current_path},
                        {"show_hidden", tab_snapshot.show_hidden},
                        {"grid_view", tab_snapshot.grid_view},
                        {"back_history", tab_snapshot.back_history},
                        {"forward_history", tab_snapshot.forward_history},
                        {"search_open", tab_snapshot.search_open},
                        {"search_query", tab_snapshot.search_query},
                    });
                }
                closed_json["panes"].push_back(std::move(pane_json));
            }

            j["closed_panes"].push_back(std::move(closed_json));
        }

        const std::string snapshot = j.dump();
        if (snapshot == last_layout_snapshot_) {
            return;
        }

        try {
            fs::create_directories(fs::path(path).parent_path());
            std::ofstream output(path);
            output << j.dump(2);
            last_layout_snapshot_ = snapshot;
        } catch (...) {
        }
    }
}
