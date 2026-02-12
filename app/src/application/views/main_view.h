#pragma once

#include <memory>

#include "views/app_view.h"
#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/file_sidebar/file_sidebar_panel.h"
#include "panels/navbar/navbar_panel.h"
#include "panels/notification/notification_panel.h"
#include "core/ui_registry.h"


namespace misty::view {
    class MainView : public view::AppView {
    public:
        MainView(UIRegistry& ui_registry, WorkerPool& worker_pool, std::shared_ptr<MistyClient> client);
        ~MainView() = default;

        void render() override;
        view::ViewID get_view_id() override;

    private:
        void init_panels();
    private:
        UIRegistry& ui_registry_;
        WorkerPool& worker_pool_;
        std::shared_ptr<MistyClient> client_;

        std::shared_ptr<panel::NavbarPanel> navbar_panel_;
        std::shared_ptr<panel::FileSidebarPanel> file_sidebar_panel_;
        std::shared_ptr<panel::FileExplorerPanel> file_explorer_panel_;
        std::shared_ptr<panel::NotificationPanel> notification_panel_;

    };
}