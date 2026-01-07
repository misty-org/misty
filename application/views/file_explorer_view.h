#pragma once


#include <vector>
#include <memory>

#include "app_view.h"
#include "panel.h"
#include "file_explorer_panel.h"
#include "tool_menu_panel.h"
#include "navbar_panel.h"
#include "app_view_registry.h"
#include "ui_registry.h"

namespace minidfs {
    class FileExplorerView : public AppView {
    public:
        FileExplorerView(UIRegistry& ui_registry, WorkerPool& worker_pool, std::shared_ptr<MiniDFSClient> client);
        ~FileExplorerView() = default;

    private:
        void init_layers();
    private:
        UIRegistry& ui_registry_;
        WorkerPool& worker_pool_;
        std::shared_ptr<MiniDFSClient> client_;
        
    };
}