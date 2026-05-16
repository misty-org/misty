#pragma once

#include <atomic>
#include <memory>
#include <string>

#include "views/app_view.h"
#include "core/ui/ui_registry.h"
#include "core/threading/worker_pool.h"
#include "panels/claude/claude_panel.h"
#include "panels/context_menu/context_menu_panel.h"
#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/navbar/navbar_panel.h"
#include "panels/notification/notification_panel.h"

namespace misty::view {
    class FilesView : public view::AppView {
    public:
        FilesView(core::UIRegistry& ui_registry,
                  core::WorkerPool& worker_pool);
        ~FilesView() override;

        void render() override;
        view::ViewID get_view_id() override;
        std::string active_explorer_state_key() const override;
        bool invoke_command(const std::string& command_id) override;
        ViewCapabilities capabilities() const override;
        PluginOpenResult open_plugin_panel(const std::string& panel_id, PluginOpenMode mode) override;

    private:
        void init_panels();
        void schedule_proxy_probe(bool force = false);
        float render_proxy_status_banner(const ImVec2& pos, float width);

    private:
        core::UIRegistry& ui_registry_;
        core::WorkerPool& worker_pool_;

        std::shared_ptr<panel::NavbarPanel> navbar_panel_;
        std::shared_ptr<panel::NotificationPanel> notification_panel_;
        std::shared_ptr<panel::ContextMenuPanel> context_menu_panel_;
        std::shared_ptr<panel::ClaudePanel> claude_panel_;
        std::shared_ptr<panel::FileExplorerPanel> explorer_panel_;

        float sidebar_width_ = 260.0f;
        bool is_resizing_sidebar_ = false;
        float claude_panel_width_ = 380.0f;
        bool is_resizing_claude_panel_ = false;
        std::shared_ptr<std::atomic_bool> proxy_probe_in_flight_ =
            std::make_shared<std::atomic_bool>(false);

        static constexpr float kSidebarMinWidth = 180.0f;
        static constexpr float kSidebarMaxWidth = 400.0f;
        static constexpr float kResizeHandleWidth = 6.0f;
        static constexpr float kClaudePanelMinWidth = 280.0f;
        static constexpr float kClaudePanelMaxWidth = 600.0f;
    };
}
