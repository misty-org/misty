#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "views/app_view.h"
#include "core/ui/state_registry.h"
#include "core/threading/worker_pool.h"
#include "core/workspaces/workspace.h"
#include "panels/claude/claude_panel.h"
#include "panels/context_menu/context_menu_panel.h"
#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/navbar/navbar_panel.h"
#include "panels/notification/notification_panel.h"
#include "panels/panel/tab_bar.h"

namespace misty::view {
    class FilesView : public view::AppView {
    public:
        FilesView(core::StateRegistry& state_registry,
                  core::WorkerPool& worker_pool);
        ~FilesView() override;

        void render() override;
        view::ViewID get_view_id() override;
        std::string active_explorer_state_key() const override;
        bool invoke_command(const std::string& command_id) override;
        ViewCapabilities capabilities() const override;
        PluginOpenResult open_plugin_panel(const std::string& panel_id, PluginOpenMode mode) override;

    private:
        struct FileWorkspace;
        struct FileTab;

        void init_panels();
        void create_workspace(std::string title = {});
        void create_workspace_from_snapshot(const core::Workspace& snapshot);
        void configure_workspace_sidebar(const std::shared_ptr<panel::FileExplorerPanel>& explorer_panel);
        void close_workspace(std::int16_t workspace_idx);
        void select_workspace(std::int16_t workspace_idx);
        void select_next_workspace();
        void rename_workspace(std::int16_t workspace_idx, std::string title);
        void create_tab();
        void create_tab_from_snapshot(FileWorkspace& workspace, const core::WorkspaceFileTabSnapshot& snapshot);
        void close_tab(std::int16_t tab_idx);
        void select_tab(std::int16_t tab_idx);
        std::vector<panel::FileSidebarPanel::WorkspaceEntry> workspace_sidebar_entries() const;
        void load_workspaces();
        void save_workspaces() const;
        void autosave_workspaces_if_due();
        void render_workspace_tabs(const ImVec2& pos, float width);
        std::string workspace_id(std::int16_t workspace_idx) const;
        std::int16_t workspace_idx_from_id(const std::string& id) const;
        FileWorkspace* active_workspace();
        const FileWorkspace* active_workspace() const;
        FileTab* active_tab();
        const FileTab* active_tab() const;
        void schedule_proxy_probe(bool force = false);
        float render_proxy_status_banner(const ImVec2& pos, float width);

    private:
        core::StateRegistry& state_registry_;
        core::WorkerPool& worker_pool_;

        std::shared_ptr<panel::NavbarPanel> navbar_panel_;
        std::shared_ptr<panel::NotificationPanel> notification_panel_;
        std::shared_ptr<panel::ContextMenuPanel> context_menu_panel_;
        std::shared_ptr<panel::ClaudePanel> claude_panel_;
        std::shared_ptr<panel::FileExplorerPanel> explorer_panel_;

        struct FileTab {
            std::int16_t idx = -1;
            std::shared_ptr<panel::FileExplorerPanel> explorer_panel;
        };

        struct FileWorkspace {
            std::int16_t idx = -1;
            std::string title;
            std::vector<FileTab> tabs;
            std::int16_t active_tab_idx = -1;
            std::int16_t pending_tab_select_idx = -1;
            std::int16_t next_tab_idx = 0;
            float sidebar_width = 260.0f;
            bool sidebar_visible = true;
            float inspector_width = 300.0f;
            bool inspector_visible = true;
        };

        std::vector<FileWorkspace> workspaces_;
        std::int16_t active_workspace_idx_ = -1;
        std::int16_t pending_sidebar_workspace_select_idx_ = -1;
        std::int16_t pending_workspace_delete_idx_ = -1;
        std::int16_t pending_workspace_rename_idx_ = -1;
        std::int16_t next_workspace_idx_ = 0;
        bool pending_sidebar_workspace_create_ = false;
        std::string pending_workspace_create_title_;
        std::string pending_workspace_rename_title_;
        bool is_resizing_sidebar_ = false;
        bool is_resizing_inspector_ = false;
        float claude_panel_width_ = 380.0f;
        bool is_resizing_claude_panel_ = false;
        double last_workspace_autosave_at_ = 0.0;
        std::shared_ptr<std::atomic_bool> proxy_probe_in_flight_ =
            std::make_shared<std::atomic_bool>(false);

        static constexpr float kSidebarMinWidth = 180.0f;
        static constexpr float kSidebarMaxWidth = 400.0f;
        static constexpr float kWorkspaceTabBarHeight = panel::kTabBarHeight;
        static constexpr float kInspectorMinWidth = 240.0f;
        static constexpr float kInspectorMaxWidth = 430.0f;
        static constexpr float kExplorerMinWidth = 360.0f;
        static constexpr float kResizeHandleWidth = 6.0f;
        static constexpr float kClaudePanelMinWidth = 280.0f;
        static constexpr float kClaudePanelMaxWidth = 600.0f;
    };
}
