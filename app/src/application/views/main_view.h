#pragma once

#include <memory>
#include <atomic>

#include "views/app_view.h"
#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/file_sidebar/file_sidebar_panel.h"
#include "panels/navbar/navbar_panel.h"
#include "panels/notification/notification_panel.h"
#include "panels/search/search_panel.h"
#include "core/ui/ui_registry.h"


namespace misty::view {
    class MainView : public view::AppView {
    public:
        MainView(UIRegistry& ui_registry, WorkerPool& worker_pool, std::shared_ptr<MistyClient> client);
        ~MainView() = default;

        void render() override;
        view::ViewID get_view_id() override;

    private:
        void init_panels();
        void schedule_proxy_probe();
        float render_proxy_status_banner(const ImVec2& pos, float width);
        void show_session_expired_modal();
    private:
        UIRegistry& ui_registry_;
        WorkerPool& worker_pool_;
        std::shared_ptr<MistyClient> client_;

        std::shared_ptr<panel::NavbarPanel> navbar_panel_;
        std::shared_ptr<panel::FileSidebarPanel> file_sidebar_panel_;
        std::shared_ptr<panel::FileExplorerPanel> file_explorer_panel_;
        std::shared_ptr<panel::NotificationPanel> notification_panel_;
        std::shared_ptr<panel::SearchPanel> search_panel_;

        // Resizable sidebar
        float sidebar_width_ = 260.0f;
        bool is_resizing_sidebar_ = false;
        std::atomic<bool> proxy_probe_in_flight_{false};

        static constexpr float kSidebarMinWidth = 180.0f;
        static constexpr float kSidebarMaxWidth = 400.0f;
        static constexpr float kResizeHandleWidth = 6.0f;

    };
}
