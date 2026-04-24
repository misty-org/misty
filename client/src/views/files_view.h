#pragma once

#include <atomic>
#include <memory>
#include <string>

#include "views/app_view.h"
#include "core/ui/ui_registry.h"
#include "dfs/client/misty_client.h"
#include "core/threading/worker_pool.h"
#include "panels/claude/claude_panel.h"
#include "panels/file_sidebar/file_sidebar_panel.h"
#include "panels/filetree/filetree_panel.h"
#include "panels/navbar/navbar_panel.h"
#include "panels/notification/notification_panel.h"

namespace misty::view {
    class FilesView : public view::AppView {
    public:
        FilesView(core::UIRegistry& ui_registry,
                  core::WorkerPool& worker_pool,
                  std::shared_ptr<MistyClient> client);
        ~FilesView() override;

        void render() override;
        view::ViewID get_view_id() override;
        std::string active_explorer_state_key() const override;
        bool invoke_command(const std::string& command_id) override;

    private:
        void init_panels();
        void schedule_proxy_probe();
        float render_proxy_status_banner(const ImVec2& pos, float width);

    private:
        core::UIRegistry& ui_registry_;
        core::WorkerPool& worker_pool_;
        std::shared_ptr<MistyClient> client_;

        std::shared_ptr<panel::NavbarPanel> navbar_panel_;
        std::shared_ptr<panel::FileSidebarPanel> file_sidebar_panel_;
        std::shared_ptr<panel::NotificationPanel> notification_panel_;
        std::shared_ptr<panel::ClaudePanel> claude_panel_;
        std::shared_ptr<panel::FileTreePanel> filetree_panel_;

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
