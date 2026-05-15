#pragma once

#include <memory>

#include "panels/explorer/explorer_transfer_panel.h"
#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/file_sidebar/file_sidebar_panel.h"

class MistyClient;

namespace misty::panel {

class ExplorerPanel {
public:
    ExplorerPanel(core::UIRegistry& registry,
                  core::WorkerPool& worker_pool,
                  std::shared_ptr<MistyClient> client);

    void render_sidebar();
    void render_content();
    void render_overlays();
    void handle_commands();
    std::string active_explorer_state_key() const;
    void drop_selected_items_to_path(const std::string& source_state_key,
                                     const std::string& dest_path,
                                     ClipboardOp op);
    void open_transfers();
    void toggle_transfers();

private:
    core::UIRegistry& registry_;
    std::shared_ptr<FileSidebarPanel> sidebar_panel_;
    std::shared_ptr<FileExplorerPanel> content_panel_;
    std::shared_ptr<ExplorerTransferPanel> transfer_panel_;
};

}  // namespace misty::panel
