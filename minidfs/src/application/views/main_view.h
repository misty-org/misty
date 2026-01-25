#pragma once

#include <memory>

#include "views/app_view.h"
#include "panels/home/file_explorer_panel.h"
#include "panels/home/file_sidebar_panel.h"
#include "panels/navbar/navbar_panel.h"
#include "core/ui_registry.h"


namespace minidfs::view {
    class MainView : public view::AppView {
    public:
        MainView(UIRegistry& ui_registry, WorkerPool& worker_pool, std::shared_ptr<MiniDFSClient> client);
        ~MainView() = default;

        void render() override;
        view::ViewID get_view_id() override;

    private:
        void init_panels();
    private:
        UIRegistry& ui_registry_;
        WorkerPool& worker_pool_;
        std::shared_ptr<MiniDFSClient> client_;

        std::shared_ptr<panel::NavbarPanel> navbar_panel_;
        std::shared_ptr<panel::FileSidebarPanel> file_sidebar_panel_;
        std::shared_ptr<panel::FileExplorerPanel> file_explorer_panel_;
        
    };
}