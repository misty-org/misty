#include "file_explorer_view.h"

namespace minidfs {
    FileExplorerView::FileExplorerView(UIRegistry& ui_registry,
        WorkerPool& worker_pool, std::shared_ptr<MiniDFSClient> client) : AppView(ViewID::FileExplorer), 
        ui_registry_(ui_registry), worker_pool_(worker_pool), client_(client) {

        init_layers();
    }
  

    void FileExplorerView::init_layers() {
        add_layer(std::make_shared<FileExplorerPanel>(ui_registry_, worker_pool_, client_));
        add_layer(std::make_shared<ToolMenuPanel>(ui_registry_, worker_pool_, client_));
        add_layer(std::make_shared<NavbarPanel>(ui_registry_));
    }

}