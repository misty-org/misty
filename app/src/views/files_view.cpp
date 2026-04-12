#include "views/files_view.h"

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <unordered_set>

#include <nlohmann/json.hpp>

#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"
#include "core/manager/proxy_manager.h"
#include "core/manager/session_manager.h"
#include "core/ui/imgui_utils.h"
#include "panels/notification/notification_state.h"
#include "panels/search/search_state.h"

namespace fs = std::filesystem;

namespace misty::view {
    namespace {
        using json = nlohmann::json;

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
            if (path == panel::FileExplorerState::VIRTUAL_PATH_RECENT) {
                return "Recent";
            }
            if (path == panel::FileExplorerState::VIRTUAL_PATH_STARRED) {
                return "Starred";
            }
            if (path == panel::FileExplorerState::VIRTUAL_PATH_TRASH) {
                return "Trash";
            }

            if (panel::path_utils::is_remote_path(path)) {
                const auto info = panel::path_utils::parse_remote_path(path);
                if (!info.relative_path.empty()) {
                    const auto parts = panel::path_utils::split_path(info.relative_path);
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

    FilesView::FilesView(UIRegistry& ui_registry,
        WorkerPool& worker_pool, std::shared_ptr<MistyClient> client) :
        ui_registry_(ui_registry), worker_pool_(worker_pool), client_(std::move(client)) {

        init_panels();
        schedule_proxy_probe();
    }

    FilesView::~FilesView() {
        save_layout_state();
    }

    void FilesView::init_panels() {
        file_sidebar_panel_ = std::make_shared<panel::FileSidebarPanel>(ui_registry_, worker_pool_, client_);
        file_sidebar_panel_->set_mount_path_provider([this]() -> std::string {
            return client_ ? client_->GetClientMountPath() : "";
        });
        file_sidebar_panel_->set_active_explorer_state_key_provider([this]() -> std::string {
            return active_explorer_state_key();
        });
        navbar_panel_ = std::make_shared<panel::NavbarPanel>(ui_registry_);
        notification_panel_ = std::make_shared<panel::NotificationPanel>(ui_registry_);
        claude_panel_ = std::make_shared<panel::ClaudePanel>(ui_registry_, worker_pool_);

        if (!restore_layout_state()) {
            const int primary_pane_id = create_pane_instance();
            create_tab_instance(primary_pane_id, true, "", false, "Files", "Search", "primary");
            root_node_id_ = create_leaf_node(primary_pane_id, -1);
            active_pane_id_ = primary_pane_id;
        }
    }

    view::ViewID FilesView::get_view_id() {
        return view::ViewID::Files;
    }

    void FilesView::render() {
        ImGuiViewport* viewport = ImGui::GetMainViewport();

        float navbar_width = 77.0f;
        float content_x = viewport->WorkPos.x + navbar_width;
        float content_width = viewport->WorkSize.x - navbar_width;
        float proxy_banner_height = render_proxy_status_banner(
            ImVec2(content_x, viewport->WorkPos.y),
            content_width
        );

        ImVec2 navbar_pos = viewport->WorkPos;
        ImVec2 navbar_size = ImVec2(navbar_width, viewport->WorkSize.y);

        float sidebar_w = sidebar_width_;
        float sidebar_h = viewport->WorkSize.y - proxy_banner_height;
        ImVec2 sidebar_pos = ImVec2(content_x, viewport->WorkPos.y + proxy_banner_height);

        // Reserve space for Claude panel on the right when open
        float claude_w = claude_panel_->is_open() ? claude_panel_width_ : 0.0f;

        float explorer_w = viewport->WorkSize.x - navbar_width - sidebar_w - claude_w;
        float explorer_h = viewport->WorkSize.y - proxy_banner_height;
        ImVec2 explorer_pos = ImVec2(sidebar_pos.x + sidebar_w, viewport->WorkPos.y + proxy_banner_height);
        current_explorer_area_size_ = ImVec2(explorer_w, explorer_h);

        float handle_x0 = explorer_pos.x - kResizeHandleWidth * 0.5f;
        float handle_x1 = handle_x0 + kResizeHandleWidth;
        float handle_y0 = sidebar_pos.y;
        float handle_y1 = viewport->WorkPos.y + viewport->WorkSize.y;

        ImGuiIO& io = ImGui::GetIO();

        if (core::CommandManager::get().matches("search.toggle")) {
            if (panel::SearchPanel* search_panel = active_search_panel()) {
                search_panel->toggle();
            }
        }
        if (core::CommandManager::get().matches("app.open_settings")) {
            view::switch_view(view::ViewID::Settings);
        }
        // Toggle Claude panel with Cmd/Ctrl+Shift+A
        if (core::CommandManager::get().matches("explorer.toggle_claude")) {
            claude_panel_->toggle();
        }
        handle_split_commands();

        // Keep Claude panel working dir in sync with active explorer
        if (claude_panel_->is_open()) {
            std::string key = active_explorer_state_key();
            if (!key.empty()) {
                auto& explorer_state = ui_registry_.get_state<panel::FileExplorerState>(key);
                std::string path(explorer_state.current_path);
                if (!path.empty()) {
                    claude_panel_->set_working_dir(path);
                }
            }
        }

        bool hovered = io.MousePos.x >= handle_x0 && io.MousePos.x <= handle_x1 &&
                    io.MousePos.y >= handle_y0 && io.MousePos.y <= handle_y1;

        if (hovered || is_resizing_sidebar_) {
            ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeEW);
        }

        if (hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
            is_resizing_sidebar_ = true;
        }

        if (is_resizing_sidebar_) {
            if (ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
                float new_width = io.MousePos.x - sidebar_pos.x;
                sidebar_width_ = std::clamp(new_width, kSidebarMinWidth, kSidebarMaxWidth);

                sidebar_w = sidebar_width_;
                explorer_w = viewport->WorkSize.x - navbar_width - sidebar_w - claude_w;
                explorer_pos.x = sidebar_pos.x + sidebar_w;
                current_explorer_area_size_ = ImVec2(explorer_w, explorer_h);
            } else {
                is_resizing_sidebar_ = false;
            }
        }

        if (hovered || is_resizing_sidebar_) {
            ImDrawList* fg = ImGui::GetForegroundDrawList();
            float line_x = sidebar_pos.x + sidebar_w;
            fg->AddLine(
                ImVec2(line_x, sidebar_pos.y),
                ImVec2(line_x, viewport->WorkPos.y + viewport->WorkSize.y),
                IM_COL32(100, 100, 100, 180), 2.0f);
        }

        // Claude panel resize handle (left edge of Claude panel)
        if (claude_panel_->is_open()) {
            float claude_handle_x = explorer_pos.x + explorer_w;
            float ch_x0 = claude_handle_x - kResizeHandleWidth * 0.5f;
            float ch_x1 = ch_x0 + kResizeHandleWidth;

            bool ch_hovered = io.MousePos.x >= ch_x0 && io.MousePos.x <= ch_x1 &&
                              io.MousePos.y >= handle_y0 && io.MousePos.y <= handle_y1;

            if (ch_hovered || is_resizing_claude_panel_) {
                ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeEW);
            }
            if (ch_hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
                is_resizing_claude_panel_ = true;
            }
            if (is_resizing_claude_panel_) {
                if (ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
                    float right_edge = viewport->WorkPos.x + viewport->WorkSize.x;
                    float new_w = right_edge - io.MousePos.x;
                    claude_panel_width_ = std::clamp(new_w, kClaudePanelMinWidth, kClaudePanelMaxWidth);
                    claude_w = claude_panel_width_;
                    explorer_w = viewport->WorkSize.x - navbar_width - sidebar_w - claude_w;
                    current_explorer_area_size_ = ImVec2(explorer_w, explorer_h);
                } else {
                    is_resizing_claude_panel_ = false;
                }
            }
            if (ch_hovered || is_resizing_claude_panel_) {
                ImDrawList* fg = ImGui::GetForegroundDrawList();
                fg->AddLine(
                    ImVec2(claude_handle_x, handle_y0),
                    ImVec2(claude_handle_x, handle_y1),
                    IM_COL32(100, 100, 100, 180), 2.0f);
            }
        }

        ImGui::SetNextWindowPos(navbar_pos);
        ImGui::SetNextWindowSize(navbar_size);
        navbar_panel_->render();

        ImGui::SetNextWindowPos(sidebar_pos);
        ImGui::SetNextWindowSize(ImVec2(sidebar_w, sidebar_h));
        file_sidebar_panel_->render();

        render_pane_tree(root_node_id_, explorer_pos, ImVec2(explorer_w, explorer_h));
        maybe_persist_layout_state();

        // Render Claude panel on the right side
        if (claude_panel_->is_open()) {
            float claude_x = explorer_pos.x + explorer_w;
            float claude_y = viewport->WorkPos.y + proxy_banner_height;
            float claude_h = viewport->WorkSize.y - proxy_banner_height;

            ImGui::SetNextWindowPos(ImVec2(claude_x, claude_y));
            ImGui::SetNextWindowSize(ImVec2(claude_w, claude_h));
            ImGuiWindowFlags claude_flags =
                ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoMove |
                ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoCollapse;
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
            if (ImGui::Begin("##claude_window", nullptr, claude_flags)) {
                claude_panel_->render();
            }
            ImGui::End();
            ImGui::PopStyleVar();
        }

        notification_panel_->render();
        show_session_expired_modal();
    }

    void FilesView::handle_split_commands() {
        if (core::CommandManager::get().matches("explorer.toggle_chat")) {
            if (ExplorerTab* tab = get_active_tab(active_pane_id_)) {
                tab->explorer_panel->toggle_chat_overlay();
            }
        }
        if (core::CommandManager::get().matches("explorer.new_tab")) {
            create_tab_from_active_pane(active_pane_id_);
        }
        if (core::CommandManager::get().matches("explorer.restore_tab")) {
            restore_last_closed_tab(active_pane_id_);
        }
        if (core::CommandManager::get().matches("explorer.close_pane")) {
            close_active_pane();
        }
        if (core::CommandManager::get().matches("explorer.restore_pane")) {
            restore_last_closed_pane();
        }
        if (core::CommandManager::get().matches("explorer.split_vertical")) {
            apply_split_command(true);
        }
        if (core::CommandManager::get().matches("explorer.split_horizontal")) {
            apply_split_command(false);
        }
        for (int index = 0; index < 9; ++index) {
            const std::string command_id = "explorer.tab_" + std::to_string(index + 1);
            if (core::CommandManager::get().matches(command_id)) {
                activate_tab_by_index(active_pane_id_, static_cast<size_t>(index));
            }
        }
    }

    void FilesView::apply_split_command(bool vertical) {
        split_active_pane(vertical ? SplitOrientation::Vertical : SplitOrientation::Horizontal);
    }

    void FilesView::render_pane_tree(int node_id, const ImVec2& pos, const ImVec2& size) {
        auto node_it = pane_nodes_.find(node_id);
        if (node_it == pane_nodes_.end()) {
            return;
        }

        PaneNode& node = node_it->second;
        if (node.is_leaf) {
            render_leaf_pane(node.pane_id, pos, size);
            return;
        }

        constexpr float kPaneHandleWidth = 6.0f;
        ImGuiIO& io = ImGui::GetIO();
        ImDrawList* fg = ImGui::GetForegroundDrawList();

        if (node.orientation == SplitOrientation::Vertical) {
            float available = std::max(size.x - kPaneHandleWidth, kExplorerSplitMinSize * 2.0f);
            float min_ratio = kExplorerSplitMinSize / available;
            node.split_ratio = std::clamp(node.split_ratio, min_ratio, 1.0f - min_ratio);

            float first_w = available * node.split_ratio;
            float second_w = available - first_w;
            ImVec2 first_pos = pos;
            ImVec2 second_pos = ImVec2(pos.x + first_w + kPaneHandleWidth, pos.y);

            float handle_x0 = second_pos.x - kPaneHandleWidth;
            float handle_x1 = second_pos.x;
            bool split_hovered = io.MousePos.x >= handle_x0 && io.MousePos.x <= handle_x1 &&
                                 io.MousePos.y >= pos.y && io.MousePos.y <= pos.y + size.y;
            if (split_hovered || resizing_split_node_id_ == node_id) {
                ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeEW);
            }
            if (split_hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
                resizing_split_node_id_ = node_id;
            }
            if (resizing_split_node_id_ == node_id) {
                if (ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
                    float new_ratio = (io.MousePos.x - pos.x) / available;
                    node.split_ratio = std::clamp(new_ratio, min_ratio, 1.0f - min_ratio);
                    first_w = available * node.split_ratio;
                    second_w = available - first_w;
                    second_pos.x = pos.x + first_w + kPaneHandleWidth;
                } else {
                    resizing_split_node_id_ = -1;
                }
            }

            render_pane_tree(node.first_child_id, first_pos, ImVec2(first_w, size.y));
            render_pane_tree(node.second_child_id, second_pos, ImVec2(second_w, size.y));
            fg->AddLine(ImVec2(second_pos.x - kPaneHandleWidth * 0.5f, pos.y),
                        ImVec2(second_pos.x - kPaneHandleWidth * 0.5f, pos.y + size.y),
                        IM_COL32(100, 100, 100, 180), 2.0f);
            return;
        }

        float available = std::max(size.y - kPaneHandleWidth, kExplorerSplitMinSize * 2.0f);
        float min_ratio = kExplorerSplitMinSize / available;
        node.split_ratio = std::clamp(node.split_ratio, min_ratio, 1.0f - min_ratio);

        float first_h = available * node.split_ratio;
        float second_h = available - first_h;
        ImVec2 first_pos = pos;
        ImVec2 second_pos = ImVec2(pos.x, pos.y + first_h + kPaneHandleWidth);

        float handle_y0 = second_pos.y - kPaneHandleWidth;
        float handle_y1 = second_pos.y;
        bool split_hovered = io.MousePos.y >= handle_y0 && io.MousePos.y <= handle_y1 &&
                             io.MousePos.x >= pos.x && io.MousePos.x <= pos.x + size.x;
        if (split_hovered || resizing_split_node_id_ == node_id) {
            ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeNS);
        }
        if (split_hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
            resizing_split_node_id_ = node_id;
        }
        if (resizing_split_node_id_ == node_id) {
            if (ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
                float new_ratio = (io.MousePos.y - pos.y) / available;
                node.split_ratio = std::clamp(new_ratio, min_ratio, 1.0f - min_ratio);
                first_h = available * node.split_ratio;
                second_h = available - first_h;
                second_pos.y = pos.y + first_h + kPaneHandleWidth;
            } else {
                resizing_split_node_id_ = -1;
            }
        }

        render_pane_tree(node.first_child_id, first_pos, ImVec2(size.x, first_h));
        render_pane_tree(node.second_child_id, second_pos, ImVec2(size.x, second_h));
        fg->AddLine(ImVec2(pos.x, second_pos.y - kPaneHandleWidth * 0.5f),
                    ImVec2(pos.x + size.x, second_pos.y - kPaneHandleWidth * 0.5f),
                    IM_COL32(100, 100, 100, 180), 2.0f);
    }

    void FilesView::render_leaf_pane(int pane_id, const ImVec2& pos, const ImVec2& size) {
        ExplorerPane* pane = get_pane(pane_id);
        if (!pane) {
            return;
        }

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
        active_tab->explorer_panel->render();
        if (active_tab->explorer_panel->consume_activation_request()) {
            active_pane_id_ = pane_id;
            pane->active_tab_id = active_tab->tab_id;
        }

        if (active_pane_id_ == pane_id) {
            ImDrawList* fg = ImGui::GetForegroundDrawList();
            fg->AddRect(pos, ImVec2(pos.x + size.x, pos.y + size.y),
                        IM_COL32(255, 255, 255, 220), 0.0f, 0, 2.0f);
        }
    }

    void FilesView::render_tab_strip(int pane_id, const ImVec2& pos, const ImVec2& size, float& out_height) {
        ExplorerPane* pane = get_pane(pane_id);
        if (!pane) {
            return;
        }

        normalize_tab_order(*pane);
        out_height = std::min(kTabBarHeight, size.y);

        ImGui::SetNextWindowPos(pos);
        ImGui::SetNextWindowSize(ImVec2(size.x, out_height));
        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoSavedSettings;

        const std::string window_name = "##files_tabs_" + std::to_string(pane_id);
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
        bool create_tab = false;
        if (ImGui::Begin(window_name.c_str(), nullptr, flags)) {
            active_pane_id_ = (ImGui::IsWindowHovered(ImGuiHoveredFlags_ChildWindows) &&
                               ImGui::IsMouseClicked(ImGuiMouseButton_Left)) ? pane_id : active_pane_id_;

            const float controls_width = 36.0f;
            const float tab_max_x = pos.x + size.x - controls_width;
            ImGui::SetCursorPos(ImVec2(8.0f, 6.0f));

            for (size_t index = 0; index < pane->tab_order.size(); ++index) {
                ExplorerTab* tab = get_tab(pane->tab_order[index]);
                if (!tab) {
                    continue;
                }

                ImGui::PushID(tab->tab_id);
                if (index > 0) {
                    ImGui::SameLine(0.0f, 6.0f);
                }

                const bool is_active = pane->active_tab_id == tab->tab_id;
                const std::string button_label = make_tab_button_label(*tab);
                float button_width = std::clamp(ImGui::CalcTextSize(button_label.c_str()).x + 22.0f, 90.0f, 220.0f);
                if (ImGui::GetCursorScreenPos().x + button_width > tab_max_x) {
                    ImGui::PopID();
                    break;
                }

                ImGui::PushStyleColor(ImGuiCol_Button, is_active ? IM_COL32(64, 64, 64, 255) : IM_COL32(40, 40, 40, 255));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, IM_COL32(78, 78, 78, 255));
                ImGui::PushStyleColor(ImGuiCol_ButtonActive, IM_COL32(92, 92, 92, 255));
                if (ImGui::Button(button_label.c_str(), ImVec2(button_width, 26.0f))) {
                    activate_tab_id = tab->tab_id;
                }
                ImGui::PopStyleColor(3);

                if (ImGui::IsItemHovered() && ImGui::IsMouseReleased(ImGuiMouseButton_Middle) &&
                    pane->tab_order.size() > 1) {
                    close_tab_id = tab->tab_id;
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

                if (ImGui::BeginDragDropSource(ImGuiDragDropFlags_SourceNoDisableHover)) {
                    const int payload[2] = { pane_id, tab->tab_id };
                    ImGui::SetDragDropPayload("FILES_VIEW_TAB", payload, sizeof(payload));
                    ImGui::TextUnformatted(button_label.c_str());
                    ImGui::EndDragDropSource();
                }

                if (ImGui::BeginDragDropTarget()) {
                    if (const ImGuiPayload* payload = ImGui::AcceptDragDropPayload("FILES_VIEW_TAB")) {
                        if (payload->DataSize == sizeof(int) * 2) {
                            const int* data = static_cast<const int*>(payload->Data);
                            if (data[0] == pane_id && data[1] != tab->tab_id) {
                                drag_tab_id = data[1];
                                drag_target_tab_id = tab->tab_id;
                            }
                        }
                    }
                    ImGui::EndDragDropTarget();
                }

                ImGui::PopID();
            }

            if (!pane->tab_order.empty()) {
                ImGui::SameLine(0.0f, 6.0f);
            } else {
                ImGui::SetCursorPos(ImVec2(8.0f, 4.0f));
            }
            ImGui::PushStyleColor(ImGuiCol_Button, IM_COL32(36, 36, 36, 255));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, IM_COL32(62, 62, 62, 255));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, IM_COL32(74, 74, 74, 255));
            if (ImGui::Button("+", ImVec2(28.0f, 28.0f))) {
                create_tab = true;
            }
            if (ImGui::IsItemHovered()) {
                ImGui::SetTooltip("New Tab (%s)", core::CommandManager::get().label("explorer.new_tab").c_str());
            }
            ImGui::PopStyleColor(3);
        }
        ImGui::End();

        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(3);

        if (drag_tab_id >= 0 && drag_target_tab_id >= 0) {
            move_tab_before(pane_id, drag_tab_id, drag_target_tab_id);
        }
        if (toggle_pin_tab_id >= 0) {
            if (ExplorerTab* tab = get_tab(toggle_pin_tab_id)) {
                tab->pinned = !tab->pinned;
            }
            if (ExplorerPane* current_pane = get_pane(pane_id)) {
                normalize_tab_order(*current_pane);
            }
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

    bool FilesView::measure_leaf_pane(int node_id, int pane_id, const ImVec2& size, ImVec2& out_size) const {
        auto node_it = pane_nodes_.find(node_id);
        if (node_it == pane_nodes_.end()) {
            return false;
        }

        const PaneNode& node = node_it->second;
        if (node.is_leaf) {
            if (node.pane_id == pane_id) {
                out_size = size;
                return true;
            }
            return false;
        }

        constexpr float kPaneHandleWidth = 6.0f;
        if (node.orientation == SplitOrientation::Vertical) {
            float available = std::max(size.x - kPaneHandleWidth, kExplorerSplitMinSize * 2.0f);
            float min_ratio = kExplorerSplitMinSize / available;
            float split_ratio = std::clamp(node.split_ratio, min_ratio, 1.0f - min_ratio);
            float first_w = available * split_ratio;
            float second_w = available - first_w;
            return measure_leaf_pane(node.first_child_id, pane_id, ImVec2(first_w, size.y), out_size) ||
                   measure_leaf_pane(node.second_child_id, pane_id, ImVec2(second_w, size.y), out_size);
        }

        float available = std::max(size.y - kPaneHandleWidth, kExplorerSplitMinSize * 2.0f);
        float min_ratio = kExplorerSplitMinSize / available;
        float split_ratio = std::clamp(node.split_ratio, min_ratio, 1.0f - min_ratio);
        float first_h = available * split_ratio;
        float second_h = available - first_h;
        return measure_leaf_pane(node.first_child_id, pane_id, ImVec2(size.x, first_h), out_size) ||
               measure_leaf_pane(node.second_child_id, pane_id, ImVec2(size.x, second_h), out_size);
    }

    int FilesView::create_pane_instance(int preferred_pane_id) {
        const int pane_id = preferred_pane_id >= 0 ? preferred_pane_id : next_pane_id_++;
        next_pane_id_ = std::max(next_pane_id_, pane_id + 1);

        ExplorerPane pane;
        pane.pane_id = pane_id;
        explorer_panes_.emplace(pane_id, std::move(pane));
        return pane_id;
    }

    int FilesView::create_tab_instance(int pane_id,
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
        tab.explorer_panel = std::make_shared<panel::FileExplorerPanel>(
            ui_registry_,
            worker_pool_,
            client_,
            explorer_state_key,
            search_state_key,
            panel_id,
            restore_persistent_state,
            initial_path
        );
        tab.search_panel = std::make_shared<panel::SearchPanel>(
            ui_registry_, worker_pool_, explorer_state_key, search_state_key);
        tab.explorer_panel->set_search_panel(tab.search_panel.get());

        explorer_tabs_.emplace(tab_id, std::move(tab));
        pane->tab_order.push_back(tab_id);
        if (pane->active_tab_id < 0) {
            pane->active_tab_id = tab_id;
        }
        normalize_tab_order(*pane);
        return tab_id;
    }

    int FilesView::create_leaf_node(int pane_id, int parent_node_id) {
        const int node_id = next_node_id_++;
        PaneNode node;
        node.node_id = node_id;
        node.parent_node_id = parent_node_id;
        node.is_leaf = true;
        node.pane_id = pane_id;
        pane_nodes_.emplace(node_id, std::move(node));
        return node_id;
    }

    int FilesView::find_leaf_node_for_pane(int pane_id) const {
        for (const auto& [node_id, node] : pane_nodes_) {
            if (node.is_leaf && node.pane_id == pane_id) {
                return node_id;
            }
        }
        return -1;
    }

    int FilesView::count_visible_panes() const {
        int count = 0;
        for (const auto& [_, node] : pane_nodes_) {
            if (node.is_leaf) {
                ++count;
            }
        }
        return count;
    }

    void FilesView::split_active_pane(SplitOrientation orientation) {
        if (active_pane_id_ < 0) {
            return;
        }

        if (count_visible_panes() >= kMaxVisiblePanes) {
            notify_split_error("Pane Limit Reached", "Misty supports up to 3 visible panes.");
            return;
        }

        const int leaf_node_id = find_leaf_node_for_pane(active_pane_id_);
        if (leaf_node_id < 0) {
            return;
        }

        PaneNode& leaf_node = pane_nodes_.at(leaf_node_id);
        if (leaf_node.parent_node_id >= 0) {
            PaneNode& parent = pane_nodes_.at(leaf_node.parent_node_id);
            if (!parent.is_leaf &&
                parent.first_child_id == leaf_node_id &&
                parent.collapse_source_pane_id == active_pane_id_ &&
                parent.orientation == orientation) {
                collapse_split_node(parent.node_id);
                resizing_split_node_id_ = -1;
                active_pane_id_ = leaf_node.pane_id;
                return;
            }
        }

        ImVec2 active_pane_size{};
        if (!measure_leaf_pane(root_node_id_, active_pane_id_, current_explorer_area_size_, active_pane_size)) {
            return;
        }

        if (orientation == SplitOrientation::Vertical) {
            float child_width = (active_pane_size.x - kResizeHandleWidth) * 0.5f;
            if (child_width < kMinimumSplitPaneWidth || active_pane_size.y < kMinimumSplitPaneHeight) {
                notify_split_error("Pane Too Small", "Widen the pane before splitting it vertically.");
                return;
            }
        } else {
            float child_height = (active_pane_size.y - kResizeHandleWidth) * 0.5f;
            if (active_pane_size.x < kMinimumSplitPaneWidth || child_height < kMinimumSplitPaneHeight) {
                notify_split_error("Pane Too Small", "Make the pane taller before splitting it horizontally.");
                return;
            }
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

        const int original_parent_id = leaf_node.parent_node_id;
        const int split_node_id = next_node_id_++;
        const int second_leaf_node_id = create_leaf_node(new_pane_id, split_node_id);

        PaneNode split_node;
        split_node.node_id = split_node_id;
        split_node.parent_node_id = original_parent_id;
        split_node.is_leaf = false;
        split_node.orientation = orientation;
        split_node.split_ratio = 0.5f;
        split_node.first_child_id = leaf_node_id;
        split_node.second_child_id = second_leaf_node_id;
        split_node.collapse_source_pane_id = active_pane_id_;

        leaf_node.parent_node_id = split_node_id;
        pane_nodes_.emplace(split_node_id, std::move(split_node));

        if (original_parent_id >= 0) {
            PaneNode& parent = pane_nodes_.at(original_parent_id);
            if (parent.first_child_id == leaf_node_id) {
                parent.first_child_id = split_node_id;
            } else if (parent.second_child_id == leaf_node_id) {
                parent.second_child_id = split_node_id;
            }
        } else {
            root_node_id_ = split_node_id;
        }

        active_pane_id_ = new_pane_id;
    }

    void FilesView::collapse_split_node(int split_node_id) {
        auto split_it = pane_nodes_.find(split_node_id);
        if (split_it == pane_nodes_.end()) {
            return;
        }

        PaneNode split_node = split_it->second;
        if (split_node.is_leaf) {
            return;
        }

        auto first_it = pane_nodes_.find(split_node.first_child_id);
        if (first_it == pane_nodes_.end()) {
            return;
        }

        const int parent_id = split_node.parent_node_id;
        first_it->second.parent_node_id = parent_id;

        if (parent_id >= 0) {
            PaneNode& parent = pane_nodes_.at(parent_id);
            if (parent.first_child_id == split_node_id) {
                parent.first_child_id = split_node.first_child_id;
            } else if (parent.second_child_id == split_node_id) {
                parent.second_child_id = split_node.first_child_id;
            }
        } else {
            root_node_id_ = split_node.first_child_id;
        }

        ClosedPaneSnapshot snapshot;
        snapshot.orientation = split_node.orientation;
        snapshot.split_ratio = split_node.split_ratio;
        snapshot.root_node_index = snapshot_subtree(split_node.second_child_id, snapshot);
        snapshot.pane_count = static_cast<int>(snapshot.panes.size());
        if (snapshot.root_node_index >= 0 && snapshot.pane_count > 0) {
            closed_pane_snapshots_.push_back(std::move(snapshot));
            if (closed_pane_snapshots_.size() > kMaxClosedPaneSnapshots) {
                closed_pane_snapshots_.erase(closed_pane_snapshots_.begin());
            }
        }

        destroy_subtree(split_node.second_child_id);
        pane_nodes_.erase(split_node_id);
    }

    void FilesView::close_active_pane() {
        if (active_pane_id_ < 0 || count_visible_panes() <= 1) {
            return;
        }

        const int leaf_node_id = find_leaf_node_for_pane(active_pane_id_);
        if (leaf_node_id < 0) {
            return;
        }

        PaneNode& leaf_node = pane_nodes_.at(leaf_node_id);
        if (leaf_node.parent_node_id < 0) {
            return;
        }

        PaneNode split_node = pane_nodes_.at(leaf_node.parent_node_id);
        if (split_node.is_leaf) {
            return;
        }

        const bool active_is_first = split_node.first_child_id == leaf_node_id;
        const int removed_subtree_id = active_is_first ? split_node.first_child_id : split_node.second_child_id;
        const int kept_subtree_id = active_is_first ? split_node.second_child_id : split_node.first_child_id;

        ClosedPaneSnapshot snapshot;
        snapshot.orientation = split_node.orientation;
        snapshot.split_ratio = split_node.split_ratio;
        snapshot.root_node_index = snapshot_subtree(removed_subtree_id, snapshot);
        snapshot.pane_count = static_cast<int>(snapshot.panes.size());
        if (snapshot.root_node_index >= 0 && snapshot.pane_count > 0) {
            closed_pane_snapshots_.push_back(std::move(snapshot));
            if (closed_pane_snapshots_.size() > kMaxClosedPaneSnapshots) {
                closed_pane_snapshots_.erase(closed_pane_snapshots_.begin());
            }
        }

        const int parent_id = split_node.parent_node_id;
        pane_nodes_.at(kept_subtree_id).parent_node_id = parent_id;

        if (parent_id >= 0) {
            PaneNode& parent = pane_nodes_.at(parent_id);
            if (parent.first_child_id == split_node.node_id) {
                parent.first_child_id = kept_subtree_id;
            } else if (parent.second_child_id == split_node.node_id) {
                parent.second_child_id = kept_subtree_id;
            }
        } else {
            root_node_id_ = kept_subtree_id;
        }

        destroy_subtree(removed_subtree_id);
        pane_nodes_.erase(split_node.node_id);

        int focus_node_id = kept_subtree_id;
        while (true) {
            auto it = pane_nodes_.find(focus_node_id);
            if (it == pane_nodes_.end()) {
                break;
            }
            if (it->second.is_leaf) {
                active_pane_id_ = it->second.pane_id;
                break;
            }
            focus_node_id = it->second.first_child_id;
        }
    }

    void FilesView::destroy_subtree(int node_id) {
        auto it = pane_nodes_.find(node_id);
        if (it == pane_nodes_.end()) {
            return;
        }

        PaneNode node = it->second;
        if (!node.is_leaf) {
            destroy_subtree(node.first_child_id);
            destroy_subtree(node.second_child_id);
            pane_nodes_.erase(node_id);
            return;
        }

        if (ExplorerPane* pane = get_pane(node.pane_id)) {
            for (int tab_id : pane->tab_order) {
                explorer_tabs_.erase(tab_id);
            }
        }
        explorer_panes_.erase(node.pane_id);
        pane_nodes_.erase(node_id);
    }

    int FilesView::snapshot_subtree(int node_id, ClosedPaneSnapshot& snapshot) const {
        auto node_it = pane_nodes_.find(node_id);
        if (node_it == pane_nodes_.end()) {
            return -1;
        }

        const PaneNode& node = node_it->second;
        const int snapshot_node_index = static_cast<int>(snapshot.nodes.size());
        snapshot.nodes.push_back({});
        PaneSnapshotNode& snapshot_node = snapshot.nodes.back();
        snapshot_node.is_leaf = node.is_leaf;
        snapshot_node.orientation = node.orientation;
        snapshot_node.split_ratio = node.split_ratio;
        snapshot_node.collapse_source_pane_id = node.collapse_source_pane_id;

        if (node.is_leaf) {
            const ExplorerPane* pane = get_pane(node.pane_id);
            if (!pane) {
                snapshot.nodes.pop_back();
                return -1;
            }

            PaneSnapshot pane_snapshot;
            for (int tab_id : pane->tab_order) {
                const ExplorerTab* tab = get_tab(tab_id);
                if (!tab) {
                    continue;
                }
                pane_snapshot.tabs.push_back(capture_tab_snapshot(*tab));
            }
            if (pane_snapshot.tabs.empty()) {
                snapshot.nodes.pop_back();
                return -1;
            }

            auto active_it = std::find(pane->tab_order.begin(), pane->tab_order.end(), pane->active_tab_id);
            pane_snapshot.active_tab_index = active_it == pane->tab_order.end()
                ? 0
                : static_cast<int>(std::distance(pane->tab_order.begin(), active_it));
            pane_snapshot.closed_tabs = pane->closed_tabs;

            snapshot_node.pane_index = static_cast<int>(snapshot.panes.size());
            snapshot.panes.push_back(std::move(pane_snapshot));
            return snapshot_node_index;
        }

        snapshot_node.first_child_index = snapshot_subtree(node.first_child_id, snapshot);
        snapshot_node.second_child_index = snapshot_subtree(node.second_child_id, snapshot);
        if (snapshot_node.first_child_index < 0 || snapshot_node.second_child_index < 0) {
            snapshot.nodes.pop_back();
            return -1;
        }
        return snapshot_node_index;
    }

    int FilesView::restore_snapshot_subtree(const ClosedPaneSnapshot& snapshot, int snapshot_node_index, int parent_node_id) {
        if (snapshot_node_index < 0 || snapshot_node_index >= static_cast<int>(snapshot.nodes.size())) {
            return -1;
        }

        const PaneSnapshotNode& snapshot_node = snapshot.nodes[snapshot_node_index];
        if (snapshot_node.is_leaf) {
            if (snapshot_node.pane_index < 0 || snapshot_node.pane_index >= static_cast<int>(snapshot.panes.size())) {
                return -1;
            }

            const PaneSnapshot& pane_snapshot = snapshot.panes[snapshot_node.pane_index];
            const int pane_id = create_pane_instance();
            for (size_t index = 0; index < pane_snapshot.tabs.size(); ++index) {
                const TabSnapshot& tab_snapshot = pane_snapshot.tabs[index];
                const int tab_id = create_tab_instance(pane_id, false, tab_snapshot.current_path, tab_snapshot.pinned);
                if (ExplorerTab* tab = get_tab(tab_id)) {
                    apply_tab_snapshot(*tab, tab_snapshot);
                    tab->pinned = tab_snapshot.pinned;
                }
            }

            ExplorerPane* pane = get_pane(pane_id);
            if (pane) {
                pane->closed_tabs = pane_snapshot.closed_tabs;
                normalize_tab_order(*pane);
                if (!pane->tab_order.empty()) {
                    const int clamped_index = std::clamp(pane_snapshot.active_tab_index, 0, static_cast<int>(pane->tab_order.size()) - 1);
                    pane->active_tab_id = pane->tab_order[clamped_index];
                }
            }

            return create_leaf_node(pane_id, parent_node_id);
        }

        const int node_id = next_node_id_++;
        PaneNode node;
        node.node_id = node_id;
        node.parent_node_id = parent_node_id;
        node.is_leaf = false;
        node.orientation = snapshot_node.orientation;
        node.split_ratio = snapshot_node.split_ratio;
        node.collapse_source_pane_id = snapshot_node.collapse_source_pane_id;
        pane_nodes_.emplace(node_id, std::move(node));

        const int first_child_id = restore_snapshot_subtree(snapshot, snapshot_node.first_child_index, node_id);
        const int second_child_id = restore_snapshot_subtree(snapshot, snapshot_node.second_child_index, node_id);
        if (first_child_id < 0 || second_child_id < 0) {
            destroy_subtree(first_child_id);
            destroy_subtree(second_child_id);
            pane_nodes_.erase(node_id);
            return -1;
        }

        PaneNode& restored = pane_nodes_.at(node_id);
        restored.first_child_id = first_child_id;
        restored.second_child_id = second_child_id;
        return node_id;
    }

    void FilesView::restore_last_closed_pane() {
        if (active_pane_id_ < 0 || closed_pane_snapshots_.empty()) {
            return;
        }

        const ClosedPaneSnapshot snapshot = closed_pane_snapshots_.back();
        if (snapshot.pane_count <= 0) {
            closed_pane_snapshots_.pop_back();
            return;
        }

        if (count_visible_panes() + snapshot.pane_count > kMaxVisiblePanes) {
            notify_split_error("Pane Limit Reached", "Close another split before restoring this pane.");
            return;
        }

        const int leaf_node_id = find_leaf_node_for_pane(active_pane_id_);
        if (leaf_node_id < 0) {
            return;
        }

        ImVec2 active_pane_size{};
        if (!measure_leaf_pane(root_node_id_, active_pane_id_, current_explorer_area_size_, active_pane_size)) {
            return;
        }

        const float available_primary = snapshot.orientation == SplitOrientation::Vertical
            ? std::max(active_pane_size.x - kResizeHandleWidth, kExplorerSplitMinSize * 2.0f)
            : std::max(active_pane_size.y - kResizeHandleWidth, kExplorerSplitMinSize * 2.0f);
        const float first_size = available_primary * snapshot.split_ratio;
        const float second_size = available_primary - first_size;

        if (snapshot.orientation == SplitOrientation::Vertical) {
            if (first_size < kMinimumSplitPaneWidth || second_size < kMinimumSplitPaneWidth ||
                active_pane_size.y < kMinimumSplitPaneHeight) {
                notify_split_error("Pane Too Small", "Widen the pane before restoring a vertical split.");
                return;
            }
        } else {
            if (first_size < kMinimumSplitPaneHeight || second_size < kMinimumSplitPaneHeight ||
                active_pane_size.x < kMinimumSplitPaneWidth) {
                notify_split_error("Pane Too Small", "Make the pane taller before restoring a horizontal split.");
                return;
            }
        }

        PaneNode& leaf_node = pane_nodes_.at(leaf_node_id);
        const int original_parent_id = leaf_node.parent_node_id;
        const int split_node_id = next_node_id_++;

        PaneNode split_node;
        split_node.node_id = split_node_id;
        split_node.parent_node_id = original_parent_id;
        split_node.is_leaf = false;
        split_node.orientation = snapshot.orientation;
        split_node.split_ratio = snapshot.split_ratio;
        split_node.first_child_id = leaf_node_id;
        split_node.collapse_source_pane_id = active_pane_id_;

        leaf_node.parent_node_id = split_node_id;
        pane_nodes_.emplace(split_node_id, std::move(split_node));

        const int restored_subtree_root = restore_snapshot_subtree(snapshot, snapshot.root_node_index, split_node_id);
        if (restored_subtree_root < 0) {
            leaf_node.parent_node_id = original_parent_id;
            pane_nodes_.erase(split_node_id);
            notify_split_error("Restore Failed", "Misty could not restore the closed pane.");
            return;
        }

        PaneNode& inserted_split = pane_nodes_.at(split_node_id);
        inserted_split.second_child_id = restored_subtree_root;

        if (original_parent_id >= 0) {
            PaneNode& parent = pane_nodes_.at(original_parent_id);
            if (parent.first_child_id == leaf_node_id) {
                parent.first_child_id = split_node_id;
            } else if (parent.second_child_id == leaf_node_id) {
                parent.second_child_id = split_node_id;
            }
        } else {
            root_node_id_ = split_node_id;
        }

        closed_pane_snapshots_.pop_back();
    }

    void FilesView::activate_tab(int pane_id, int tab_id) {
        ExplorerPane* pane = get_pane(pane_id);
        if (!pane || !get_tab(tab_id)) {
            return;
        }
        pane->active_tab_id = tab_id;
        active_pane_id_ = pane_id;
    }

    void FilesView::create_tab_from_active_pane(int pane_id) {
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

    void FilesView::close_tab(int pane_id, int tab_id) {
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

    void FilesView::restore_last_closed_tab(int pane_id) {
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

    void FilesView::activate_tab_by_index(int pane_id, size_t tab_index) {
        ExplorerPane* pane = get_pane(pane_id);
        if (!pane || tab_index >= pane->tab_order.size()) {
            return;
        }
        activate_tab(pane_id, pane->tab_order[tab_index]);
    }

    void FilesView::move_tab_before(int pane_id, int dragged_tab_id, int target_tab_id) {
        ExplorerPane* pane = get_pane(pane_id);
        if (!pane || dragged_tab_id == target_tab_id) {
            return;
        }

        auto dragged_it = std::find(pane->tab_order.begin(), pane->tab_order.end(), dragged_tab_id);
        auto target_it = std::find(pane->tab_order.begin(), pane->tab_order.end(), target_tab_id);
        if (dragged_it == pane->tab_order.end() || target_it == pane->tab_order.end()) {
            return;
        }

        const int dragged = *dragged_it;
        pane->tab_order.erase(dragged_it);
        target_it = std::find(pane->tab_order.begin(), pane->tab_order.end(), target_tab_id);
        pane->tab_order.insert(target_it, dragged);
        normalize_tab_order(*pane);
        activate_tab(pane_id, dragged_tab_id);
    }

    void FilesView::normalize_tab_order(ExplorerPane& pane) {
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

    FilesView::ExplorerPane* FilesView::get_pane(int pane_id) {
        auto it = explorer_panes_.find(pane_id);
        return it == explorer_panes_.end() ? nullptr : &it->second;
    }

    const FilesView::ExplorerPane* FilesView::get_pane(int pane_id) const {
        auto it = explorer_panes_.find(pane_id);
        return it == explorer_panes_.end() ? nullptr : &it->second;
    }

    FilesView::ExplorerTab* FilesView::get_tab(int tab_id) {
        auto it = explorer_tabs_.find(tab_id);
        return it == explorer_tabs_.end() ? nullptr : &it->second;
    }

    const FilesView::ExplorerTab* FilesView::get_tab(int tab_id) const {
        auto it = explorer_tabs_.find(tab_id);
        return it == explorer_tabs_.end() ? nullptr : &it->second;
    }

    FilesView::ExplorerTab* FilesView::get_active_tab(int pane_id) {
        ExplorerPane* pane = get_pane(pane_id);
        return pane ? get_tab(pane->active_tab_id) : nullptr;
    }

    const FilesView::ExplorerTab* FilesView::get_active_tab(int pane_id) const {
        const ExplorerPane* pane = get_pane(pane_id);
        return pane ? get_tab(pane->active_tab_id) : nullptr;
    }

    std::string FilesView::current_tab_path(const ExplorerTab& tab) const {
        auto& state = ui_registry_.get_state<panel::FileExplorerState>(tab.explorer_state_key);
        std::lock_guard<std::mutex> lock(state.mu);
        if (!state.pending_navigation_path.empty()) {
            return state.pending_navigation_path;
        }
        return state.current_path;
    }

    std::string FilesView::make_tab_title(const ExplorerTab& tab) const {
        return title_for_path(current_tab_path(tab));
    }

    std::string FilesView::make_tab_button_label(const ExplorerTab& tab) const {
        return tab.pinned ? "[P] " + make_tab_title(tab) : make_tab_title(tab);
    }

    FilesView::TabSnapshot FilesView::capture_tab_snapshot(const ExplorerTab& tab) const {
        TabSnapshot snapshot;
        snapshot.pinned = tab.pinned;

        auto& state = ui_registry_.get_state<panel::FileExplorerState>(tab.explorer_state_key);
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

        auto& search_state = ui_registry_.get_state<panel::SearchState>(tab.search_state_key);
        {
            std::lock_guard<std::mutex> lock(search_state.mu);
            snapshot.search_open = search_state.is_open;
            snapshot.search_query = search_state.query_buf;
        }

        return snapshot;
    }

    void FilesView::apply_tab_snapshot(const ExplorerTab& tab, const TabSnapshot& snapshot) {
        auto& state = ui_registry_.get_state<panel::FileExplorerState>(tab.explorer_state_key);
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

        auto& search_state = ui_registry_.get_state<panel::SearchState>(tab.search_state_key);
        {
            std::lock_guard<std::mutex> lock(search_state.mu);
            search_state.is_open = snapshot.search_open;
            search_state.just_opened = snapshot.search_open;
            search_state.pending_submit = false;
            search_state.pending_navigate_index = -1;
            search_state.selected_index = 0;
            search_state.cache_results.clear();
            search_state.api_results.clear();
            search_state.seen_ids.clear();
            search_state.pending_api_tasks.store(0);
            search_state.api_search_done = true;
            search_state.last_submitted_query.clear();
            std::memset(search_state.query_buf, 0, sizeof(search_state.query_buf));
            std::strncpy(search_state.query_buf, snapshot.search_query.c_str(), sizeof(search_state.query_buf) - 1);
        }
    }

    bool FilesView::pane_has_restorable_tab(int pane_id) const {
        const ExplorerPane* pane = get_pane(pane_id);
        return pane && !pane->closed_tabs.empty();
    }

    bool FilesView::has_restorable_pane() const {
        return !closed_pane_snapshots_.empty();
    }

    std::string FilesView::active_explorer_state_key() const {
        const ExplorerTab* tab = get_active_tab(active_pane_id_);
        return tab ? tab->explorer_state_key : "Files";
    }

    panel::SearchPanel* FilesView::active_search_panel() const {
        const ExplorerTab* tab = get_active_tab(active_pane_id_);
        return tab ? tab->search_panel.get() : nullptr;
    }

    void FilesView::notify_split_error(const std::string& title, const std::string& message) {
        auto& notifications = ui_registry_.get_state<panel::NotificationState>("Notifications");
        notifications.add_notification(title, message, panel::NotificationType::INFO, 3.5f);
    }

    std::string FilesView::layout_state_file_path() const {
        const char* home = std::getenv("HOME");
        if (!home) {
            return "";
        }
        return std::string(home) + "/misty/.cache/files_view_state.json";
    }

    bool FilesView::restore_layout_state() {
        const std::string path = layout_state_file_path();
        if (path.empty() || !fs::exists(path)) {
            return false;
        }

        std::ifstream input(path);
        json j = json::parse(input, nullptr, false);
        if (j.is_discarded() || !j.contains("panes") || !j.contains("nodes")) {
            return false;
        }

        explorer_panes_.clear();
        explorer_tabs_.clear();
        pane_nodes_.clear();
        root_node_id_ = -1;
        active_pane_id_ = -1;
        next_pane_id_ = 1;
        next_tab_id_ = 1;
        next_node_id_ = 1;

        sidebar_width_ = std::clamp(j.value("sidebar_width", sidebar_width_), kSidebarMinWidth, kSidebarMaxWidth);
        closed_pane_snapshots_.clear();

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
            } else {
                for (const auto& [tab_id, _] : tabs_by_id) {
                    tab_order.push_back(tab_id);
                }
                std::sort(tab_order.begin(), tab_order.end());
            }

            for (int tab_id : tab_order) {
                auto tab_it = tabs_by_id.find(tab_id);
                if (tab_it == tabs_by_id.end()) {
                    continue;
                }

                const json& tab_json = tab_it->second;
                const std::string current_path = tab_json.value("current_path", "");
                const bool pinned = tab_json.value("pinned", false);
                const int created_tab_id = create_tab_instance(
                    pane_id,
                    false,
                    current_path,
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
                snapshot.current_path = current_path;
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

        for (const auto& node_json : j["nodes"]) {
            PaneNode node;
            node.node_id = node_json.value("node_id", -1);
            node.parent_node_id = node_json.value("parent_node_id", -1);
            node.is_leaf = node_json.value("is_leaf", true);
            node.pane_id = node_json.value("pane_id", -1);
            const std::string orientation = node_json.value("orientation", "none");
            if (orientation == "vertical") {
                node.orientation = SplitOrientation::Vertical;
            } else if (orientation == "horizontal") {
                node.orientation = SplitOrientation::Horizontal;
            } else {
                node.orientation = SplitOrientation::None;
            }
            node.split_ratio = node_json.value("split_ratio", 0.5f);
            node.first_child_id = node_json.value("first_child_id", -1);
            node.second_child_id = node_json.value("second_child_id", -1);
            node.collapse_source_pane_id = node_json.value("collapse_source_pane_id", -1);

            if (node.node_id >= 0) {
                pane_nodes_.emplace(node.node_id, std::move(node));
                next_node_id_ = std::max(next_node_id_, node.node_id + 1);
            }
        }

        root_node_id_ = j.value("root_node_id", -1);
        active_pane_id_ = j.value("active_pane_id", -1);
        if (active_pane_id_ < 0 || !get_pane(active_pane_id_)) {
            if (!explorer_panes_.empty()) {
                active_pane_id_ = explorer_panes_.begin()->first;
            }
        }

        if (j.contains("closed_panes")) {
            for (const auto& closed_pane_json : j["closed_panes"]) {
                ClosedPaneSnapshot snapshot;
                const std::string orientation = closed_pane_json.value("orientation", "none");
                if (orientation == "vertical") {
                    snapshot.orientation = SplitOrientation::Vertical;
                } else if (orientation == "horizontal") {
                    snapshot.orientation = SplitOrientation::Horizontal;
                }
                snapshot.split_ratio = closed_pane_json.value("split_ratio", 0.5f);
                snapshot.root_node_index = closed_pane_json.value("root_node_index", -1);
                snapshot.pane_count = closed_pane_json.value("pane_count", 0);

                if (closed_pane_json.contains("panes")) {
                    for (const auto& pane_json : closed_pane_json["panes"]) {
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

                if (closed_pane_json.contains("nodes")) {
                    for (const auto& node_json : closed_pane_json["nodes"]) {
                        PaneSnapshotNode node;
                        node.is_leaf = node_json.value("is_leaf", true);
                        node.pane_index = node_json.value("pane_index", -1);
                        const std::string node_orientation = node_json.value("orientation", "none");
                        if (node_orientation == "vertical") {
                            node.orientation = SplitOrientation::Vertical;
                        } else if (node_orientation == "horizontal") {
                            node.orientation = SplitOrientation::Horizontal;
                        }
                        node.split_ratio = node_json.value("split_ratio", 0.5f);
                        node.first_child_index = node_json.value("first_child_index", -1);
                        node.second_child_index = node_json.value("second_child_index", -1);
                        node.collapse_source_pane_id = node_json.value("collapse_source_pane_id", -1);
                        snapshot.nodes.push_back(std::move(node));
                    }
                }

                if (snapshot.root_node_index >= 0 && !snapshot.nodes.empty() && snapshot.pane_count > 0) {
                    closed_pane_snapshots_.push_back(std::move(snapshot));
                }
            }
        }

        if (root_node_id_ < 0 || pane_nodes_.find(root_node_id_) == pane_nodes_.end() ||
            explorer_panes_.empty()) {
            explorer_panes_.clear();
            explorer_tabs_.clear();
            pane_nodes_.clear();
            root_node_id_ = -1;
            active_pane_id_ = -1;
            next_pane_id_ = 1;
            next_tab_id_ = 1;
            next_node_id_ = 1;
            return false;
        }

        last_layout_snapshot_ = j.dump();
        return true;
    }

    void FilesView::maybe_persist_layout_state() {
        const double now = ImGui::GetTime();
        if (now - last_layout_save_time_ < kLayoutPersistIntervalSeconds) {
            return;
        }
        last_layout_save_time_ = now;
        save_layout_state();
    }

    void FilesView::save_layout_state() {
        const std::string path = layout_state_file_path();
        if (path.empty() || explorer_panes_.empty() || pane_nodes_.empty()) {
            return;
        }

        json j;
        j["sidebar_width"] = sidebar_width_;
        j["root_node_id"] = root_node_id_;
        j["active_pane_id"] = active_pane_id_;
        j["closed_panes"] = json::array();

        std::vector<int> pane_ids;
        pane_ids.reserve(explorer_panes_.size());
        for (const auto& [pane_id, _] : explorer_panes_) {
            pane_ids.push_back(pane_id);
        }
        std::sort(pane_ids.begin(), pane_ids.end());

        j["panes"] = json::array();
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
                json tab_json;
                tab_json["tab_id"] = tab->tab_id;
                tab_json["pinned"] = tab->pinned;
                tab_json["explorer_state_key"] = tab->explorer_state_key;
                tab_json["search_state_key"] = tab->search_state_key;
                tab_json["panel_id"] = tab->panel_id;
                tab_json["current_path"] = snapshot.current_path;
                tab_json["show_hidden"] = snapshot.show_hidden;
                tab_json["grid_view"] = snapshot.grid_view;
                tab_json["back_history"] = snapshot.back_history;
                tab_json["forward_history"] = snapshot.forward_history;
                tab_json["search_open"] = snapshot.search_open;
                tab_json["search_query"] = snapshot.search_query;
                pane_json["tabs"].push_back(std::move(tab_json));
            }

            for (const TabSnapshot& snapshot : pane->closed_tabs) {
                json closed_json;
                closed_json["pinned"] = snapshot.pinned;
                closed_json["current_path"] = snapshot.current_path;
                closed_json["show_hidden"] = snapshot.show_hidden;
                closed_json["grid_view"] = snapshot.grid_view;
                closed_json["back_history"] = snapshot.back_history;
                closed_json["forward_history"] = snapshot.forward_history;
                closed_json["search_open"] = snapshot.search_open;
                closed_json["search_query"] = snapshot.search_query;
                pane_json["closed_tabs"].push_back(std::move(closed_json));
            }

            j["panes"].push_back(std::move(pane_json));
        }

        std::vector<int> node_ids;
        node_ids.reserve(pane_nodes_.size());
        for (const auto& [node_id, _] : pane_nodes_) {
            node_ids.push_back(node_id);
        }
        std::sort(node_ids.begin(), node_ids.end());

        j["nodes"] = json::array();
        for (int node_id : node_ids) {
            const PaneNode& node = pane_nodes_.at(node_id);
            json node_json;
            node_json["node_id"] = node.node_id;
            node_json["parent_node_id"] = node.parent_node_id;
            node_json["is_leaf"] = node.is_leaf;
            node_json["pane_id"] = node.pane_id;
            node_json["orientation"] =
                node.orientation == SplitOrientation::Vertical ? "vertical" :
                node.orientation == SplitOrientation::Horizontal ? "horizontal" :
                "none";
            node_json["split_ratio"] = node.split_ratio;
            node_json["first_child_id"] = node.first_child_id;
            node_json["second_child_id"] = node.second_child_id;
            node_json["collapse_source_pane_id"] = node.collapse_source_pane_id;
            j["nodes"].push_back(std::move(node_json));
        }

        for (const ClosedPaneSnapshot& snapshot : closed_pane_snapshots_) {
            json closed_pane_json;
            closed_pane_json["orientation"] =
                snapshot.orientation == SplitOrientation::Vertical ? "vertical" :
                snapshot.orientation == SplitOrientation::Horizontal ? "horizontal" :
                "none";
            closed_pane_json["split_ratio"] = snapshot.split_ratio;
            closed_pane_json["root_node_index"] = snapshot.root_node_index;
            closed_pane_json["pane_count"] = snapshot.pane_count;
            closed_pane_json["panes"] = json::array();
            closed_pane_json["nodes"] = json::array();

            for (const PaneSnapshot& pane_snapshot : snapshot.panes) {
                json pane_json;
                pane_json["active_tab_index"] = pane_snapshot.active_tab_index;
                pane_json["tabs"] = json::array();
                pane_json["closed_tabs"] = json::array();

                for (const TabSnapshot& tab_snapshot : pane_snapshot.tabs) {
                    json tab_json;
                    tab_json["pinned"] = tab_snapshot.pinned;
                    tab_json["current_path"] = tab_snapshot.current_path;
                    tab_json["show_hidden"] = tab_snapshot.show_hidden;
                    tab_json["grid_view"] = tab_snapshot.grid_view;
                    tab_json["back_history"] = tab_snapshot.back_history;
                    tab_json["forward_history"] = tab_snapshot.forward_history;
                    tab_json["search_open"] = tab_snapshot.search_open;
                    tab_json["search_query"] = tab_snapshot.search_query;
                    pane_json["tabs"].push_back(std::move(tab_json));
                }

                for (const TabSnapshot& tab_snapshot : pane_snapshot.closed_tabs) {
                    json tab_json;
                    tab_json["pinned"] = tab_snapshot.pinned;
                    tab_json["current_path"] = tab_snapshot.current_path;
                    tab_json["show_hidden"] = tab_snapshot.show_hidden;
                    tab_json["grid_view"] = tab_snapshot.grid_view;
                    tab_json["back_history"] = tab_snapshot.back_history;
                    tab_json["forward_history"] = tab_snapshot.forward_history;
                    tab_json["search_open"] = tab_snapshot.search_open;
                    tab_json["search_query"] = tab_snapshot.search_query;
                    pane_json["closed_tabs"].push_back(std::move(tab_json));
                }

                closed_pane_json["panes"].push_back(std::move(pane_json));
            }

            for (const PaneSnapshotNode& node : snapshot.nodes) {
                json node_json;
                node_json["is_leaf"] = node.is_leaf;
                node_json["pane_index"] = node.pane_index;
                node_json["orientation"] =
                    node.orientation == SplitOrientation::Vertical ? "vertical" :
                    node.orientation == SplitOrientation::Horizontal ? "horizontal" :
                    "none";
                node_json["split_ratio"] = node.split_ratio;
                node_json["first_child_index"] = node.first_child_index;
                node_json["second_child_index"] = node.second_child_index;
                node_json["collapse_source_pane_id"] = node.collapse_source_pane_id;
                closed_pane_json["nodes"].push_back(std::move(node_json));
            }

            j["closed_panes"].push_back(std::move(closed_pane_json));
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

    void FilesView::schedule_proxy_probe() {
        bool expected = false;
        if (!proxy_probe_in_flight_.compare_exchange_strong(expected, true)) {
            return;
        }

        worker_pool_.add(
            []() {
                core::ProxyManager::get().ensure_running();
            },
            [this]() {
                proxy_probe_in_flight_.store(false);
            },
            [this](const std::string&) {
                core::SessionManager::get().mark_proxy_unavailable();
                proxy_probe_in_flight_.store(false);
            }
        );
    }

    float FilesView::render_proxy_status_banner(const ImVec2& pos, float width) {
        if (core::SessionManager::get().is_proxy_available()) {
            return 0.0f;
        }

        constexpr float kBannerHeight = 62.0f;
        constexpr float kButtonWidth = 112.0f;

        ImGui::SetNextWindowPos(pos);
        ImGui::SetNextWindowSize(ImVec2(width, kBannerHeight));
        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoSavedSettings;

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.20f, 0.13f, 0.09f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.48f, 0.31f, 0.15f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 12.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 1.0f);

        if (ImGui::Begin("##proxy_status_banner", nullptr, flags)) {
            ImGui::PushFont(core::AssetManager::get().get_font(core::FontID::DEFAULT));
            ImGui::TextUnformatted("Background Service Offline");
            ImGui::PopFont();

            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.90f, 0.84f, 0.76f, 1.0f));
            ImGui::TextWrapped("%s", core::SessionManager::get().get_proxy_status_message().c_str());
            ImGui::PopStyleColor();

            ImGui::SetCursorPos(ImVec2(
                ImGui::GetWindowWidth() - kButtonWidth - 16.0f,
                (kBannerHeight - 32.0f) * 0.5f
            ));
            if (proxy_probe_in_flight_.load()) {
                ImGui::BeginDisabled();
                ImGui::Button("Checking...", ImVec2(kButtonWidth, 32.0f));
                ImGui::EndDisabled();
            } else if (ImGui::Button("Retry", ImVec2(kButtonWidth, 32.0f))) {
                schedule_proxy_probe();
            }
        }
        ImGui::End();

        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor(2);
        return kBannerHeight;
    }

    void FilesView::show_session_expired_modal() {
        if (!core::SessionManager::get().is_session_expired()) return;

        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(vp->WorkPos);
        ImGui::SetNextWindowSize(vp->WorkSize);
        ImGui::SetNextWindowBgAlpha(0.0f);

        ImGuiWindowFlags host_flags =
            ImGuiWindowFlags_NoTitleBar      | ImGuiWindowFlags_NoResize    |
            ImGuiWindowFlags_NoMove          | ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoDecoration|
            ImGuiWindowFlags_NoNav;

        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
        if (ImGui::Begin("##session_host", nullptr, host_flags)) {
            ImGui::OpenPopup("##session_expired");

            ImGui::SetNextWindowPos(vp->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
            ImGui::SetNextWindowSize(ImVec2(360.0f, 0.0f), ImGuiCond_Always);

            ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.10f, 0.10f, 0.11f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_Border,  ImVec4(0.22f, 0.22f, 0.24f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,  ImVec2(28.0f, 28.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,    ImVec2(0.0f,  12.0f));

            if (ImGui::BeginPopupModal("##session_expired", nullptr,
                    ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                    ImGuiWindowFlags_NoMove     | ImGuiWindowFlags_AlwaysAutoResize)) {

                float w = ImGui::GetContentRegionAvail().x;

                auto& lock_icon = core::AssetManager::get().get_svg_texture("lock-24", 32);
                if (lock_icon.id) {
                    ImGui::SetCursorPosX((w - 32.0f) * 0.5f);
                    ImGui::Image(lock_icon.id, ImVec2(32.0f, 32.0f));
                    ImGui::Spacing();
                }

                ImGui::PushFont(core::AssetManager::get().get_font(core::FontID::ROBOTO_LARGE));
                const char* title = "Session Expired";
                ImGui::SetCursorPosX((w - ImGui::CalcTextSize(title).x) * 0.5f);
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.90f, 0.90f, 0.90f, 1.0f));
                ImGui::TextUnformatted(title);
                ImGui::PopStyleColor();
                ImGui::PopFont();

                ImGui::Spacing();

                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.58f, 0.58f, 0.58f, 1.0f));
                ImGui::TextWrapped(
                    "Your session has expired and could not be renewed. "
                    "Please log in again to continue.");
                ImGui::PopStyleColor();

                ImGui::Spacing();
                ImGui::Separator();
                ImGui::Spacing();

                if (core::StyledButton("Log In Again", ImVec2(w, 42.0f),
                                       core::ButtonTheme::Primary())) {
                    core::SessionManager::get().clear_token();
                    core::SessionManager::get().clear_session_expired();
                    ImGui::CloseCurrentPopup();
                    view::switch_view(view::ViewID::Login);
                }

                ImGui::EndPopup();
            }

            ImGui::PopStyleVar(3);
            ImGui::PopStyleColor(2);
        }
        ImGui::End();
        ImGui::PopStyleVar();
    }
}
