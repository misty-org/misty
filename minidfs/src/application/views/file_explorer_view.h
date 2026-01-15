#pragma once


#include <vector>
#include <memory>

#include "app_view.h"
#include "panel.h"
#include "file_explorer_panel.h"
#include "file_sidebar_panel.h"
#include "navbar_panel.h"
#include "app_view_registry.h"
#include "ui_registry.h"

namespace minidfs::FileExplorer {
    class FileExplorerView : public AppView {
    public:
        FileExplorerView(UIRegistry& ui_registry, WorkerPool& worker_pool, std::shared_ptr<MiniDFSClient> client);
        ~FileExplorerView() = default;

        void render() override;
        ViewID get_view_id() override;

    private:
        void init_panels();
    private:
        UIRegistry& ui_registry_;
        WorkerPool& worker_pool_;
        std::shared_ptr<MiniDFSClient> client_;

        std::shared_ptr<NavbarPanel> navbar_panel_;
        std::shared_ptr<FileSidebarPanel> file_sidebar_panel_;
        std::shared_ptr<FileExplorerPanel> file_explorer_panel_;
        
    };
}