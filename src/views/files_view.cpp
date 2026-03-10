#include "views/files_view.h"

#include <algorithm>
#include <cstdlib>
#include <limits>
#include <optional>
#include <string_view>

#include "core/commands/command_manager.h"
#include "core/manager/plugin_manager.h"
#include "core/manager/asset_manager.h"
#include "core/manager/font_manager.h"
#include "core/manager/proxy_manager.h"
#include "core/manager/session_manager.h"
#include "core/ui/ui_style.h"
#include "panels/activity/activity_state.h"
#include "panels/file_explorer/state/file_explorer_state.h"
#include "panels/notification/notification_state.h"

namespace misty::view {
    namespace {
        constexpr float kPanelToggleSize = 22.0f;
        constexpr float kFilesBottomBarHeight = 22.0f;

        bool bottom_bar_toggle_button(ImDrawList* dl, ImVec2 min, const char* icon_name, const char* tooltip) {
            const ImVec2 max(min.x + kPanelToggleSize, min.y + kPanelToggleSize);
            const bool hovered = ImGui::IsMouseHoveringRect(min, max, false);
            const bool active = hovered && ImGui::IsMouseDown(ImGuiMouseButton_Left);
            const bool clicked = hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left);
            if (hovered || active) {
                const ImU32 hover_bg = active ? IM_COL32(42, 48, 60, 150)
                                              : IM_COL32(42, 48, 60, 95);
                dl->AddRectFilled(min, max, hover_bg, 5.0f);
            }

            auto& icon = core::AssetManager::get().get_svg_texture(icon_name, 16);
            if (icon.id != 0) {
                const ImVec2 icon_min(min.x + 3.0f, min.y + 3.0f);
                dl->AddImage(icon.id,
                             icon_min,
                             ImVec2(icon_min.x + 16.0f, icon_min.y + 16.0f),
                             ImVec2(0, 0),
                             ImVec2(1, 1),
                             hovered ? IM_COL32(220, 228, 242, 245)
                                     : IM_COL32(152, 161, 178, 220));
            }
            if (hovered) {
                ImGui::SetTooltip("%s", tooltip);
                ImGui::SetMouseCursor(ImGuiMouseCursor_Hand);
            }
            return clicked;
        }

        void render_files_bottom_bar(ImVec2 pos,
                                     float width,
                                     bool& sidebar_visible,
                                     bool& inspector_visible) {
            if (width <= 0.0f) {
                return;
            }

            ImDrawList* dl = ImGui::GetForegroundDrawList(ImGui::GetMainViewport());
            const ImVec2 max(pos.x + width, pos.y + kFilesBottomBarHeight);
            dl->AddRectFilled(pos, max, IM_COL32(18, 21, 26, 238));

            const float button_y = pos.y + (kFilesBottomBarHeight - kPanelToggleSize) * 0.5f;
            if (bottom_bar_toggle_button(dl,
                                         ImVec2(pos.x + 8.0f, button_y),
                                         "file-sidebar-toggle-24",
                                         sidebar_visible ? "Hide files sidebar" : "Show files sidebar")) {
                sidebar_visible = !sidebar_visible;
            }

            if (bottom_bar_toggle_button(dl,
                                         ImVec2(max.x - kPanelToggleSize - 8.0f, button_y),
                                         "preview-panel-toggle-24",
                                         inspector_visible ? "Hide preview panel" : "Show preview panel")) {
                inspector_visible = !inspector_visible;
            }
        }

        void render_shell_divider(float x, float y0, float y1) {
            ImGui::GetForegroundDrawList(ImGui::GetMainViewport())->AddLine(
                ImVec2(x, y0),
                ImVec2(x, y1),
                IM_COL32(64, 70, 82, 150),
                1.0f);
        }

    }

    FilesView::FilesView(core::StateRegistry& state_registry,
                         core::WorkerPool& worker_pool)
        : state_registry_(state_registry)
        , worker_pool_(worker_pool) {
        init_panels();
    }

    FilesView::~FilesView() {
        save_workspaces();
    }

    void FilesView::init_panels() {
        navbar_panel_ = std::make_shared<panel::NavbarPanel>(state_registry_);
        notification_panel_ = std::make_shared<panel::NotificationPanel>(state_registry_);
        context_menu_panel_ = std::make_shared<panel::ContextMenuPanel>(state_registry_);
        claude_panel_ = std::make_shared<panel::ClaudePanel>(state_registry_, worker_pool_);
        load_workspaces();
    }

    void FilesView::create_workspace(std::string title) {
        const std::int16_t workspace_idx = next_workspace_idx_++;
        FileWorkspace workspace;
        workspace.idx = workspace_idx;
        workspace.title = title.empty() ? "Workspace " + std::to_string(workspace_idx + 1) : std::move(title);
        core::WorkspaceFileTabSnapshot tab_snapshot;
        tab_snapshot.idx = 0;
        create_tab_from_snapshot(workspace, tab_snapshot);
        workspaces_.push_back(std::move(workspace));
        active_workspace_idx_ = workspace_idx;
        explorer_panel_ = workspaces_.back().tabs.empty() ? nullptr : workspaces_.back().tabs.back().explorer_panel;
        save_workspaces();
    }

    void FilesView::create_workspace_from_snapshot(const core::Workspace& snapshot) {
        std::int16_t workspace_idx = workspace_idx_from_id(snapshot.id());
        if (workspace_idx < 0) {
            workspace_idx = next_workspace_idx_++;
        } else {
            next_workspace_idx_ = std::max<std::int16_t>(next_workspace_idx_, workspace_idx + 1);
        }

        FileWorkspace workspace;
        workspace.idx = workspace_idx;
        workspace.title = snapshot.title().empty()
            ? "Workspace " + std::to_string(workspace_idx + 1)
            : snapshot.title();
        workspace.active_tab_idx = snapshot.active_tab_idx;
        workspace.pending_tab_select_idx = snapshot.active_tab_idx;
        workspace.next_tab_idx = snapshot.next_tab_idx;
        workspace.sidebar_width = std::clamp(snapshot.sidebar_width, kSidebarMinWidth, kSidebarMaxWidth);
        workspace.sidebar_visible = snapshot.sidebar_visible;
        workspace.inspector_width = std::clamp(snapshot.inspector_width, kInspectorMinWidth, kInspectorMaxWidth);
        workspace.inspector_visible = snapshot.inspector_visible;

        if (!snapshot.tabs.empty()) {
            for (const auto& tab_snapshot : snapshot.tabs) {
                create_tab_from_snapshot(workspace, tab_snapshot);
            }
        } else {
            core::WorkspaceFileTabSnapshot tab_snapshot;
            tab_snapshot.idx = 0;
            tab_snapshot.title = snapshot.title();
            tab_snapshot.explorer = snapshot.explorer;
            create_tab_from_snapshot(workspace, tab_snapshot);
        }

        if (std::none_of(workspace.tabs.begin(), workspace.tabs.end(), [&](const FileTab& tab) {
                return tab.idx == workspace.active_tab_idx;
            })) {
            workspace.active_tab_idx = workspace.tabs.empty() ? -1 : workspace.tabs.front().idx;
        }
        workspace.pending_tab_select_idx = workspace.active_tab_idx;
        workspace.next_tab_idx = std::max<std::int16_t>(workspace.next_tab_idx, 0);
        for (const auto& tab : workspace.tabs) {
            workspace.next_tab_idx = std::max<std::int16_t>(workspace.next_tab_idx, tab.idx + 1);
        }
        workspaces_.push_back(std::move(workspace));
    }

    void FilesView::create_tab_from_snapshot(FileWorkspace& workspace, const core::WorkspaceFileTabSnapshot& snapshot) {
        std::int16_t tab_idx = snapshot.idx >= 0 ? snapshot.idx : workspace.next_tab_idx++;
        workspace.next_tab_idx = std::max<std::int16_t>(workspace.next_tab_idx, tab_idx + 1);

        panel::FileExplorerPanelProps props;
        props.panel_id = "files_workspace_" + std::to_string(workspace.idx) + "_tab_" + std::to_string(tab_idx);
        props.state_key = workspace.idx == 0 && tab_idx == 0
            ? "Files"
            : "Files_workspace_" + std::to_string(workspace.idx) + "_tab_" + std::to_string(tab_idx);
        props.restore_persistent_state = workspace.idx == 0 && tab_idx == 0;
        props.owns_state_cleanup = !(workspace.idx == 0 && tab_idx == 0);

        FileTab tab;
        tab.idx = tab_idx;
        tab.explorer_panel = std::make_shared<panel::FileExplorerPanel>(
            state_registry_,
            worker_pool_,
            std::move(props));
        tab.explorer_panel->restore_workspace_snapshot(snapshot.explorer);
        configure_workspace_sidebar(tab.explorer_panel);
        workspace.tabs.push_back(std::move(tab));
        if (workspace.active_tab_idx < 0) {
            workspace.active_tab_idx = tab_idx;
            workspace.pending_tab_select_idx = tab_idx;
        }
    }

    void FilesView::configure_workspace_sidebar(const std::shared_ptr<panel::FileExplorerPanel>& explorer_panel) {
        if (!explorer_panel) {
            return;
        }

        explorer_panel->set_workspace_controls(
            [this]() {
                return workspace_sidebar_entries();
            },
            [this](std::int16_t workspace_idx) {
                pending_sidebar_workspace_select_idx_ = workspace_idx;
            },
            [this](std::string title) {
                pending_workspace_create_title_ = std::move(title);
                pending_sidebar_workspace_create_ = true;
            },
            [this](std::int16_t workspace_idx, std::string title) {
                pending_workspace_rename_idx_ = workspace_idx;
                pending_workspace_rename_title_ = std::move(title);
            },
            [this](std::int16_t workspace_idx) {
                pending_workspace_delete_idx_ = workspace_idx;
            });
    }

    void FilesView::close_workspace(std::int16_t workspace_idx) {
        if (workspaces_.size() <= 1) {
            return;
        }

        const auto it = std::find_if(workspaces_.begin(), workspaces_.end(), [&](const FileWorkspace& workspace) {
            return workspace.idx == workspace_idx;
        });
        if (it == workspaces_.end()) {
            return;
        }

        for (auto& tab : it->tabs) {
            if (tab.explorer_panel) {
                tab.explorer_panel->release_state();
            }
        }
        const bool closing_active = active_workspace_idx_ == workspace_idx;
        const std::size_t erased_index = static_cast<std::size_t>(std::distance(workspaces_.begin(), it));
        workspaces_.erase(it);
        if (closing_active) {
            const std::size_t fallback_index = std::min(erased_index, workspaces_.size() - 1);
            active_workspace_idx_ = workspaces_[fallback_index].idx;
        }
        if (FileWorkspace* workspace = active_workspace()) {
            if (FileTab* tab = active_tab()) {
                explorer_panel_ = tab->explorer_panel;
            } else {
                explorer_panel_.reset();
            }
        }
        save_workspaces();
    }

    void FilesView::select_workspace(std::int16_t workspace_idx) {
        const auto it = std::find_if(workspaces_.begin(), workspaces_.end(), [&](const FileWorkspace& workspace) {
            return workspace.idx == workspace_idx;
        });
        if (it == workspaces_.end()) {
            return;
        }

        active_workspace_idx_ = workspace_idx;
        if (FileTab* tab = active_tab()) {
            explorer_panel_ = tab->explorer_panel;
        }
        save_workspaces();
    }

    void FilesView::select_next_workspace() {
        if (workspaces_.size() <= 1) {
            return;
        }

        const auto it = std::find_if(workspaces_.begin(), workspaces_.end(), [&](const FileWorkspace& workspace) {
            return workspace.idx == active_workspace_idx_;
        });
        const std::size_t current_index = it == workspaces_.end()
            ? workspaces_.size() - 1
            : static_cast<std::size_t>(std::distance(workspaces_.begin(), it));
        const std::size_t next_index = (current_index + 1) % workspaces_.size();
        select_workspace(workspaces_[next_index].idx);
    }

    void FilesView::rename_workspace(std::int16_t workspace_idx, std::string title) {
        const auto it = std::find_if(workspaces_.begin(), workspaces_.end(), [&](const FileWorkspace& workspace) {
            return workspace.idx == workspace_idx;
        });
        if (it == workspaces_.end() || title.empty()) {
            return;
        }
        it->title = std::move(title);
        save_workspaces();
    }

    void FilesView::create_tab() {
        FileWorkspace* workspace = active_workspace();
        if (!workspace) {
            return;
        }

        core::WorkspaceFileTabSnapshot snapshot;
        snapshot.idx = workspace->next_tab_idx++;
        create_tab_from_snapshot(*workspace, snapshot);
        workspace->active_tab_idx = snapshot.idx;
        workspace->pending_tab_select_idx = snapshot.idx;
        explorer_panel_ = workspace->tabs.back().explorer_panel;
        save_workspaces();
    }

    void FilesView::close_tab(std::int16_t tab_idx) {
        FileWorkspace* workspace = active_workspace();
        if (!workspace || workspace->tabs.size() <= 1) {
            return;
        }

        const auto it = std::find_if(workspace->tabs.begin(), workspace->tabs.end(), [&](const FileTab& tab) {
            return tab.idx == tab_idx;
        });
        if (it == workspace->tabs.end()) {
            return;
        }

        if (it->explorer_panel) {
            it->explorer_panel->release_state();
        }
        const bool closing_active = workspace->active_tab_idx == tab_idx;
        const std::size_t erased_index = static_cast<std::size_t>(std::distance(workspace->tabs.begin(), it));
        workspace->tabs.erase(it);
        if (closing_active) {
            const std::size_t fallback_index = std::min(erased_index, workspace->tabs.size() - 1);
            workspace->active_tab_idx = workspace->tabs[fallback_index].idx;
            workspace->pending_tab_select_idx = workspace->active_tab_idx;
            explorer_panel_ = workspace->tabs[fallback_index].explorer_panel;
        }
        save_workspaces();
    }

    void FilesView::select_tab(std::int16_t tab_idx) {
        FileWorkspace* workspace = active_workspace();
        if (!workspace) {
            return;
        }
        const auto it = std::find_if(workspace->tabs.begin(), workspace->tabs.end(), [&](const FileTab& tab) {
            return tab.idx == tab_idx;
        });
        if (it == workspace->tabs.end()) {
            return;
        }
        workspace->active_tab_idx = tab_idx;
        workspace->pending_tab_select_idx = tab_idx;
        explorer_panel_ = it->explorer_panel;
        save_workspaces();
    }

    std::vector<panel::FileSidebarPanel::WorkspaceEntry> FilesView::workspace_sidebar_entries() const {
        std::vector<panel::FileSidebarPanel::WorkspaceEntry> entries;
        entries.reserve(workspaces_.size());
        for (const auto& workspace : workspaces_) {
            std::string title = workspace.title.empty()
                ? "Workspace " + std::to_string(workspace.idx + 1)
                : workspace.title;
            entries.push_back(panel::FileSidebarPanel::WorkspaceEntry{
                .idx = workspace.idx,
                .title = std::move(title),
                .active = workspace.idx == active_workspace_idx_,
            });
        }
        return entries;
    }

    void FilesView::load_workspaces() {
        const core::WorkspaceDocument document = core::load_workspace_document();
        workspaces_.clear();
        active_workspace_idx_ = -1;
        next_workspace_idx_ = std::max<std::int16_t>(0, document.next_workspace_idx);

        for (const auto& workspace_snapshot : document.workspaces) {
            create_workspace_from_snapshot(workspace_snapshot);
        }

        if (workspaces_.empty()) {
            create_workspace();
            return;
        }

        const std::int16_t restored_active_idx = workspace_idx_from_id(document.active_workspace_id);
        const auto active_it = std::find_if(workspaces_.begin(), workspaces_.end(), [&](const FileWorkspace& workspace) {
            return workspace.idx == restored_active_idx;
        });
        if (active_it != workspaces_.end()) {
            active_workspace_idx_ = active_it->idx;
        } else {
            active_workspace_idx_ = workspaces_.front().idx;
        }
        if (FileTab* tab = active_tab()) {
            explorer_panel_ = tab->explorer_panel;
        }
    }

    void FilesView::save_workspaces() const {
        if (workspaces_.empty()) {
            return;
        }

        core::WorkspaceDocument document;
        document.active_workspace_id = workspace_id(active_workspace_idx_);
        document.next_workspace_idx = next_workspace_idx_;
        document.workspaces.reserve(workspaces_.size());

        for (const auto& file_workspace : workspaces_) {
            core::Workspace workspace(workspace_id(file_workspace.idx));
            workspace.set_title(file_workspace.title);
            workspace.sidebar_width = file_workspace.sidebar_width;
            workspace.sidebar_visible = file_workspace.sidebar_visible;
            workspace.inspector_width = file_workspace.inspector_width;
            workspace.inspector_visible = file_workspace.inspector_visible;
            workspace.active_tab_idx = file_workspace.active_tab_idx;
            workspace.next_tab_idx = file_workspace.next_tab_idx;
            workspace.tabs.reserve(file_workspace.tabs.size());

            for (const auto& file_tab : file_workspace.tabs) {
                core::WorkspaceFileTabSnapshot tab_snapshot;
                tab_snapshot.idx = file_tab.idx;
                if (file_tab.explorer_panel) {
                    tab_snapshot.title = file_tab.explorer_panel->tab_title();
                    tab_snapshot.explorer = file_tab.explorer_panel->export_workspace_snapshot();
                }
                if (file_tab.idx == file_workspace.active_tab_idx) {
                    workspace.explorer = tab_snapshot.explorer;
                }
                workspace.tabs.push_back(std::move(tab_snapshot));
            }
            document.workspaces.push_back(std::move(workspace));
        }

        std::string error;
        core::save_workspace_document(document, &error);
    }

    std::string FilesView::workspace_id(std::int16_t workspace_idx) const {
        if (workspace_idx < 0) {
            return {};
        }
        return "workspace_" + std::to_string(workspace_idx);
    }

    std::int16_t FilesView::workspace_idx_from_id(const std::string& id) const {
        constexpr std::string_view prefix = "workspace_";
        if (id.rfind(prefix, 0) != 0) {
            return -1;
        }
        try {
            const int value = std::stoi(id.substr(prefix.size()));
            if (value < 0 || value > std::numeric_limits<std::int16_t>::max()) {
                return -1;
            }
            return static_cast<std::int16_t>(value);
        } catch (...) {
            return -1;
        }
    }

    FilesView::FileWorkspace* FilesView::active_workspace() {
        const auto it = std::find_if(workspaces_.begin(), workspaces_.end(), [&](const FileWorkspace& workspace) {
            return workspace.idx == active_workspace_idx_;
        });
        return it == workspaces_.end() ? nullptr : &*it;
    }

    const FilesView::FileWorkspace* FilesView::active_workspace() const {
        const auto it = std::find_if(workspaces_.begin(), workspaces_.end(), [&](const FileWorkspace& workspace) {
            return workspace.idx == active_workspace_idx_;
        });
        return it == workspaces_.end() ? nullptr : &*it;
    }

    FilesView::FileTab* FilesView::active_tab() {
        FileWorkspace* workspace = active_workspace();
        if (!workspace) {
            return nullptr;
        }
        const auto it = std::find_if(workspace->tabs.begin(), workspace->tabs.end(), [&](const FileTab& tab) {
            return tab.idx == workspace->active_tab_idx;
        });
        return it == workspace->tabs.end() ? nullptr : &*it;
    }

    const FilesView::FileTab* FilesView::active_tab() const {
        const FileWorkspace* workspace = active_workspace();
        if (!workspace) {
            return nullptr;
        }
        const auto it = std::find_if(workspace->tabs.begin(), workspace->tabs.end(), [&](const FileTab& tab) {
            return tab.idx == workspace->active_tab_idx;
        });
        return it == workspace->tabs.end() ? nullptr : &*it;
    }

    void FilesView::render_workspace_tabs(const ImVec2& pos, float width) {
        if (width <= 0.0f) {
            return;
        }

        ImGui::SetNextWindowPos(pos);
        ImGui::SetNextWindowSize(ImVec2(width, kWorkspaceTabBarHeight));
        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoSavedSettings |
            ImGuiWindowFlags_NoScrollbar;
        if (ImGuiViewport* main_viewport = ImGui::GetMainViewport()) {
            ImGui::SetNextWindowViewport(main_viewport->ID);
        }

        FileWorkspace* workspace = active_workspace();
        if (!workspace) {
            return;
        }

        std::optional<std::int16_t> close_idx;
        bool create_requested = false;
        bool consumed_pending_selection = false;
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
        if (ImGui::Begin("##files_workspace_tabs", nullptr, flags)) {
            if (ImGui::BeginTabBar("##files_workspace_tab_bar")) {
                for (auto& tab : workspace->tabs) {
                    std::string title = "Files";
                    if (tab.explorer_panel) {
                        title = tab.explorer_panel->tab_title();
                        if (title.empty()) {
                            title = "Files";
                        }
                    }
                    const std::string label = title + "###files_workspace_tab_" + std::to_string(tab.idx);
                    bool open = true;
                    const ImGuiTabItemFlags tab_flags =
                        tab.idx == workspace->pending_tab_select_idx ? ImGuiTabItemFlags_SetSelected : ImGuiTabItemFlags_None;
                    if (ImGui::BeginTabItem(label.c_str(), workspace->tabs.size() > 1 ? &open : nullptr, tab_flags)) {
                        workspace->active_tab_idx = tab.idx;
                        explorer_panel_ = tab.explorer_panel;
                        if (tab.idx == workspace->pending_tab_select_idx) {
                            consumed_pending_selection = true;
                        }
                        ImGui::EndTabItem();
                    }
                    if (!open) {
                        close_idx = tab.idx;
                    }
                }
                if (ImGui::TabItemButton("+", ImGuiTabItemFlags_Trailing | ImGuiTabItemFlags_NoTooltip)) {
                    create_requested = true;
                }
                ImGui::EndTabBar();
            }
        }
        ImGui::End();
        ImGui::PopStyleVar(2);

        if (close_idx.has_value()) {
            close_tab(*close_idx);
        }
        if (create_requested) {
            create_tab();
        }
        if (consumed_pending_selection) {
            workspace->pending_tab_select_idx = -1;
        }
    }

    view::ViewID FilesView::get_view_id() {
        return view::ViewID::Files;
    }

    std::string FilesView::active_explorer_state_key() const {
        const FileTab* tab = active_tab();
        return tab && tab->explorer_panel ? tab->explorer_panel->active_explorer_state_key() : "Files";
    }

    bool FilesView::invoke_command(const std::string& command_id) {
        if (command_id == "explorer.preview.toggle" ||
            command_id == "explorer.preview.zoom_in" ||
            command_id == "explorer.preview.zoom_out" ||
            command_id == "explorer.preview.zoom_reset") {
            return true;
        }
        if (command_id == "explorer.next_workspace") {
            select_next_workspace();
            return true;
        }
        return false;
    }

    ViewCapabilities FilesView::capabilities() const {
        return ViewCapabilities{
            .tabs = true,
            .split = true,
        };
    }

    PluginOpenResult FilesView::open_plugin_panel(const std::string& panel_id, PluginOpenMode mode) {
        if (!explorer_panel_ || panel_id.empty()) {
            return PluginOpenResult::Failed;
        }

        if (mode == PluginOpenMode::Inline) {
            return PluginOpenResult::Unsupported;
        }

        const auto plugins = core::PluginManager::get().loaded_plugins();
        const auto plugin_it = std::find_if(plugins.begin(), plugins.end(), [&](const core::PluginInfo& plugin) {
            return std::any_of(plugin.panels.begin(), plugin.panels.end(), [&](const core::PluginPanelInfo& panel) {
                return panel.id == panel_id;
            });
        });
        if (plugin_it == plugins.end()) {
            return PluginOpenResult::Failed;
        }

        const auto panel_it = std::find_if(plugin_it->panels.begin(), plugin_it->panels.end(),
            [&](const core::PluginPanelInfo& panel) { return panel.id == panel_id; });
        if (panel_it == plugin_it->panels.end()) {
            return PluginOpenResult::Failed;
        }

        (void)plugin_it;
        (void)panel_it;
        return PluginOpenResult::Unsupported;
    }

    void FilesView::render() {
        ImGuiViewport* viewport = ImGui::GetMainViewport();
        const float navbar_width = 77.0f;
        const float content_x = viewport->WorkPos.x + navbar_width;
        const float content_width = viewport->WorkSize.x - navbar_width;
        const float proxy_banner_height = render_proxy_status_banner(
            ImVec2(content_x, viewport->WorkPos.y),
            content_width
        );

        const ImVec2 navbar_pos = viewport->WorkPos;
        const ImVec2 navbar_size(navbar_width, viewport->WorkSize.y);

        ImGuiIO& io = ImGui::GetIO();
        if (core::CommandManager::get().matches("app.open_settings")) {
            view::switch_view(view::ViewID::Settings);
        }
        if (core::CommandManager::get().matches("explorer.toggle_claude")) {
            claude_panel_->toggle();
        }
        if (core::CommandManager::get().matches("explorer.next_workspace")) {
            select_next_workspace();
        }
        if (core::CommandManager::get().matches("explorer.new_tab")) {
            create_tab();
        }

        render_workspace_tabs(
            ImVec2(content_x, viewport->WorkPos.y + proxy_banner_height),
            content_width);

        FileWorkspace* workspace = active_workspace();
        FileTab* tab = active_tab();
        if (!workspace || !tab || !tab->explorer_panel) {
            return;
        }
        explorer_panel_ = tab->explorer_panel;

        float claude_w = claude_panel_->is_open() ? claude_panel_width_ : 0.0f;
        const float shell_w = viewport->WorkSize.x - navbar_width;
        const float workspace_tabs_y = viewport->WorkPos.y + proxy_banner_height;
        const float toolbar_h = explorer_panel_->toolbar_height();
        const float toolbar_y = workspace_tabs_y + kWorkspaceTabBarHeight;
        const float toolbar_w = std::max(0.0f, shell_w - claude_w);
        const float shell_content_y = toolbar_y + toolbar_h;
        const float shell_content_h = std::max(0.0f,
                                               viewport->WorkSize.y -
                                                   proxy_banner_height -
                                                   kWorkspaceTabBarHeight -
                                                   toolbar_h -
                                                   kFilesBottomBarHeight);
        const float bottom_bar_y = shell_content_y + shell_content_h;
        float sidebar_w = workspace->sidebar_visible ? workspace->sidebar_width : 0.0f;
        const float sidebar_h = shell_content_h;
        const ImVec2 sidebar_pos(content_x, shell_content_y);

        const float inspector_max_for_window =
            std::max(220.0f, shell_w - sidebar_w - claude_w - kExplorerMinWidth);
        float inspector_w = workspace->inspector_visible
            ? std::min(std::clamp(workspace->inspector_width, kInspectorMinWidth, kInspectorMaxWidth),
                       inspector_max_for_window)
            : 0.0f;
        float explorer_w = std::max(kExplorerMinWidth, shell_w - sidebar_w - inspector_w - claude_w);
        const float explorer_h = shell_content_h;
        ImVec2 explorer_pos(sidebar_pos.x + sidebar_w, shell_content_y);
        ImVec2 inspector_pos(explorer_pos.x + explorer_w, shell_content_y);

        const float sidebar_handle_x = explorer_pos.x;
        const float sidebar_handle_x0 = sidebar_handle_x - kResizeHandleWidth * 0.5f;
        const float sidebar_handle_x1 = sidebar_handle_x0 + kResizeHandleWidth;
        const float handle_y0 = sidebar_pos.y;
        const float handle_y1 = bottom_bar_y;
        const bool activity_popup_open = state_registry_.get_state<panel::ActivityState>("Activity").is_open;
        if (activity_popup_open) {
            is_resizing_sidebar_ = false;
            is_resizing_inspector_ = false;
            is_resizing_claude_panel_ = false;
        }

        if (core::CommandManager::get().matches("explorer.preview.toggle")) {
            workspace->inspector_visible = !workspace->inspector_visible;
        }
        if (explorer_panel_) {
            explorer_panel_->handle_commands();
        }

        if (claude_panel_->is_open()) {
            const std::string key = active_explorer_state_key();
            if (!key.empty()) {
                auto& explorer_state = state_registry_.get_state<panel::FileExplorerState>(key);
                const std::string path(explorer_state.current_path);
                if (!path.empty()) {
                    claude_panel_->set_working_dir(path);
                }
            }
        }

        const bool sidebar_hovered = !activity_popup_open && workspace->sidebar_visible &&
                                     io.MousePos.x >= sidebar_handle_x0 && io.MousePos.x <= sidebar_handle_x1 &&
                                     io.MousePos.y >= handle_y0 && io.MousePos.y <= handle_y1;

        if (sidebar_hovered || is_resizing_sidebar_) {
            ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeEW);
        }
        if (sidebar_hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
            is_resizing_sidebar_ = true;
        }
        if (is_resizing_sidebar_) {
            if (ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
                const float new_width = io.MousePos.x - sidebar_pos.x;
                workspace->sidebar_width = std::clamp(new_width, kSidebarMinWidth, kSidebarMaxWidth);
                sidebar_w = workspace->sidebar_width;
                const float inspector_max =
                    std::max(kInspectorMinWidth, shell_w - sidebar_w - claude_w - kExplorerMinWidth);
                inspector_w = workspace->inspector_visible
                    ? std::min(std::clamp(workspace->inspector_width, kInspectorMinWidth, kInspectorMaxWidth),
                               inspector_max)
                    : 0.0f;
                explorer_w = std::max(kExplorerMinWidth, shell_w - sidebar_w - inspector_w - claude_w);
                explorer_pos.x = sidebar_pos.x + sidebar_w;
                inspector_pos.x = explorer_pos.x + explorer_w;
            } else {
                is_resizing_sidebar_ = false;
            }
        }

        const float inspector_handle_x = inspector_pos.x;
        const float inspector_handle_x0 = inspector_handle_x - kResizeHandleWidth * 0.5f;
        const float inspector_handle_x1 = inspector_handle_x0 + kResizeHandleWidth;
        const bool inspector_hovered = !activity_popup_open && workspace->inspector_visible &&
                                       io.MousePos.x >= inspector_handle_x0 && io.MousePos.x <= inspector_handle_x1 &&
                                       io.MousePos.y >= handle_y0 && io.MousePos.y <= handle_y1;

        if (inspector_hovered || is_resizing_inspector_) {
            ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeEW);
        }
        if (inspector_hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
            is_resizing_inspector_ = true;
        }
        if (is_resizing_inspector_) {
            if (ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
                const float inspector_right_edge = viewport->WorkPos.x + viewport->WorkSize.x - claude_w;
                const float max_for_current_window =
                    std::max(kInspectorMinWidth, inspector_right_edge - explorer_pos.x - kExplorerMinWidth);
                workspace->inspector_width = std::clamp(inspector_right_edge - io.MousePos.x,
                                                        kInspectorMinWidth,
                                                        std::min(kInspectorMaxWidth, max_for_current_window));
                inspector_w = workspace->inspector_visible ? workspace->inspector_width : 0.0f;
                explorer_w = std::max(kExplorerMinWidth, shell_w - sidebar_w - inspector_w - claude_w);
                inspector_pos.x = explorer_pos.x + explorer_w;
            } else {
                is_resizing_inspector_ = false;
            }
        }

        if (claude_panel_->is_open()) {
            const float claude_handle_x = inspector_pos.x + inspector_w;
            const float ch_x0 = claude_handle_x - kResizeHandleWidth * 0.5f;
            const float ch_x1 = ch_x0 + kResizeHandleWidth;

            const bool ch_hovered =
                                    !activity_popup_open &&
                                    io.MousePos.x >= ch_x0 && io.MousePos.x <= ch_x1 &&
                                    io.MousePos.y >= handle_y0 && io.MousePos.y <= handle_y1;

            if (ch_hovered || is_resizing_claude_panel_) {
                ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeEW);
            }
            if (ch_hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
                is_resizing_claude_panel_ = true;
            }
            if (is_resizing_claude_panel_) {
                if (ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
                    const float right_edge = viewport->WorkPos.x + viewport->WorkSize.x;
                    const float new_w = right_edge - io.MousePos.x;
                    claude_panel_width_ = std::clamp(new_w, kClaudePanelMinWidth, kClaudePanelMaxWidth);
                    claude_w = claude_panel_width_;
                    explorer_w = std::max(kExplorerMinWidth, shell_w - sidebar_w - inspector_w - claude_w);
                    inspector_pos.x = explorer_pos.x + explorer_w;
                } else {
                    is_resizing_claude_panel_ = false;
                }
            }
        }

        if (!activity_popup_open && workspace->inspector_visible) {
            render_shell_divider(inspector_pos.x, handle_y0, handle_y1);
        }
        if (!activity_popup_open && claude_panel_->is_open()) {
            render_shell_divider(inspector_pos.x + inspector_w, handle_y0, handle_y1);
        }

        ImGui::SetNextWindowPos(navbar_pos);
        ImGui::SetNextWindowSize(navbar_size);
        navbar_panel_->render();

        if (toolbar_h > 0.0f && toolbar_w > 0.0f) {
            ImGui::SetNextWindowPos(ImVec2(content_x, toolbar_y));
            ImGui::SetNextWindowSize(ImVec2(toolbar_w, toolbar_h));
            ImGuiWindowFlags toolbar_flags =
                ImGuiWindowFlags_NoTitleBar |
                ImGuiWindowFlags_NoMove |
                ImGuiWindowFlags_NoResize |
                ImGuiWindowFlags_NoCollapse |
                ImGuiWindowFlags_NoSavedSettings |
                ImGuiWindowFlags_NoScrollbar;
            ImGui::SetNextWindowViewport(viewport->ID);
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
            ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
            if (ImGui::Begin("##files_shell_toolbar", nullptr, toolbar_flags)) {
                explorer_panel_->render_active_toolbar();
            }
            ImGui::End();
            ImGui::PopStyleVar(2);
        }

        if (workspace->sidebar_visible) {
            ImGui::SetNextWindowPos(sidebar_pos);
            ImGui::SetNextWindowSize(ImVec2(sidebar_w, sidebar_h));
            explorer_panel_->render_sidebar();
            if (!activity_popup_open && !explorer_panel_->workspace_dropdown_open()) {
                render_shell_divider(explorer_pos.x, handle_y0, handle_y1);
            }
        }

        ImGui::SetNextWindowPos(explorer_pos);
        ImGui::SetNextWindowSize(ImVec2(explorer_w, explorer_h));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
        explorer_panel_->render_content();
        ImGui::PopStyleVar();

        if (workspace->inspector_visible) {
            ImGui::SetNextWindowPos(inspector_pos);
            ImGui::SetNextWindowSize(ImVec2(inspector_w, explorer_h));
            explorer_panel_->render_inspector();
        }

        if (claude_panel_->is_open()) {
            const float claude_x = inspector_pos.x + inspector_w;
            const float claude_y = shell_content_y;
            const float claude_h = shell_content_h;

            ImGui::SetNextWindowPos(ImVec2(claude_x, claude_y));
            ImGui::SetNextWindowSize(ImVec2(claude_w, claude_h));
            ImGuiWindowFlags claude_flags =
                ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoMove |
                ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoCollapse |
                ImGuiWindowFlags_NoSavedSettings;
            ImGui::SetNextWindowViewport(viewport->ID);
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
            if (ImGui::Begin("##claude_window", nullptr, claude_flags)) {
                claude_panel_->render();
            }
            ImGui::End();
            ImGui::PopStyleVar();
        }

        const float bottom_bar_width = viewport->WorkSize.x - navbar_width - claude_w;
        render_files_bottom_bar(
            ImVec2(content_x, bottom_bar_y),
            bottom_bar_width,
            workspace->sidebar_visible,
            workspace->inspector_visible);

        navbar_panel_->render_activity_popup();
        context_menu_panel_->render();
        notification_panel_->render();

        if (pending_sidebar_workspace_create_) {
            pending_sidebar_workspace_create_ = false;
            create_workspace(std::move(pending_workspace_create_title_));
            pending_workspace_create_title_.clear();
        }
        if (pending_workspace_rename_idx_ >= 0) {
            const std::int16_t workspace_idx = pending_workspace_rename_idx_;
            pending_workspace_rename_idx_ = -1;
            rename_workspace(workspace_idx, std::move(pending_workspace_rename_title_));
            pending_workspace_rename_title_.clear();
        }
        if (pending_workspace_delete_idx_ >= 0) {
            const std::int16_t workspace_idx = pending_workspace_delete_idx_;
            pending_workspace_delete_idx_ = -1;
            close_workspace(workspace_idx);
        }
        if (pending_sidebar_workspace_select_idx_ >= 0) {
            const std::int16_t workspace_idx = pending_sidebar_workspace_select_idx_;
            pending_sidebar_workspace_select_idx_ = -1;
            select_workspace(workspace_idx);
        }
    }

    void FilesView::schedule_proxy_probe(bool force) {
        bool expected = false;
        if (!proxy_probe_in_flight_->compare_exchange_strong(expected, true)) {
            return;
        }

        auto probe_state = proxy_probe_in_flight_;
        worker_pool_.add(
            [force]() {
                core::ProxyManager::get().ensure_running(force);
            },
            [probe_state]() {
                probe_state->store(false);
            },
            [probe_state](const std::string&) {
                core::SessionManager::get().mark_proxy_unavailable();
                probe_state->store(false);
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

        if (ImGuiViewport* main_viewport = ImGui::GetMainViewport()) {
            ImGui::SetNextWindowViewport(main_viewport->ID);
        }

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.20f, 0.13f, 0.09f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.48f, 0.31f, 0.15f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 12.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 1.0f);

        if (ImGui::Begin("##proxy_status_banner", nullptr, flags)) {
            ImGui::PushFont(core::FontManager::get().get_font(core::FontID::DEFAULT));
            ImGui::TextUnformatted("Background Service Offline");
            ImGui::PopFont();

            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.90f, 0.84f, 0.76f, 1.0f));
            ImGui::TextWrapped("%s", core::SessionManager::get().get_proxy_status_message().c_str());
            ImGui::PopStyleColor();

            ImGui::SetCursorPos(ImVec2(
                ImGui::GetWindowWidth() - kButtonWidth - 16.0f,
                (kBannerHeight - 32.0f) * 0.5f
            ));
            if (proxy_probe_in_flight_->load()) {
                ImGui::BeginDisabled();
                ImGui::Button("Checking...", ImVec2(kButtonWidth, 32.0f));
                ImGui::EndDisabled();
            } else if (ImGui::Button("Retry", ImVec2(kButtonWidth, 32.0f))) {
                schedule_proxy_probe(true);
            }
        }
        ImGui::End();

        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor(2);
        return kBannerHeight;
    }

}
