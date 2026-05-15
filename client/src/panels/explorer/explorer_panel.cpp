#include "panels/explorer/explorer_panel.h"

#include <cstdlib>
#include <utility>

#include "panels/explorer/explorer_transfer_ui_state.h"

namespace misty::panel {

ExplorerPanel::ExplorerPanel(core::UIRegistry& registry,
                             core::WorkerPool& worker_pool,
                             std::shared_ptr<MistyClient> client)
    : registry_(registry) {
    sidebar_panel_ = std::make_shared<FileSidebarPanel>(registry, worker_pool, std::move(client));
    sidebar_panel_->set_mount_path_provider([]() -> std::string {
        if (const char* home = std::getenv("HOME")) {
            return home;
        }
        return {};
    });
    sidebar_panel_->set_active_explorer_state_key_provider([this]() -> std::string {
        return active_explorer_state_key();
    });
    sidebar_panel_->set_file_drop_handler(
        [this](const std::string& source_state_key, const std::string& dest_path, ClipboardOp op) {
            drop_selected_items_to_path(source_state_key, dest_path, op);
        });
    content_panel_ = std::make_shared<FileExplorerPanel>(registry, worker_pool);
    transfer_panel_ = std::make_shared<ExplorerTransferPanel>(registry);
}

void ExplorerPanel::render_sidebar() {
    sidebar_panel_->render();
}

void ExplorerPanel::render_content() {
    content_panel_->render();
}

void ExplorerPanel::render_overlays() {
    transfer_panel_->render();
}

void ExplorerPanel::handle_commands() {
    content_panel_->handle_commands();
}

std::string ExplorerPanel::active_explorer_state_key() const {
    return content_panel_->active_explorer_state_key();
}

void ExplorerPanel::drop_selected_items_to_path(const std::string& source_state_key,
                                                const std::string& dest_path,
                                                ClipboardOp op) {
    content_panel_->drop_selected_items_to_path(source_state_key, dest_path, op);
}

void ExplorerPanel::open_transfers() {
    registry_.get_state<ExplorerTransferUiState>(kExplorerTransferUiStateKey).open();
}

void ExplorerPanel::toggle_transfers() {
    registry_.get_state<ExplorerTransferUiState>(kExplorerTransferUiStateKey).toggle();
}

}  // namespace misty::panel
