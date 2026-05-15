#include "panels/filetree/filetree_panel.h"

namespace misty::panel {
    FileTreePanel::FileTreePanel(core::UIRegistry& registry,
                                 core::WorkerPool& worker_pool,
                                 std::shared_ptr<MistyClient> client)
        : registry_(registry),
          worker_pool_(worker_pool),
          client_(std::move(client)) {
        explorer_panel_ = std::make_shared<FileExplorerPanel>(registry_, worker_pool_);
    }

    void FileTreePanel::render(const ImVec2& pos, const ImVec2& size) {
        ImGui::SetNextWindowPos(pos);
        ImGui::SetNextWindowSize(size);
        if (explorer_panel_) {
            explorer_panel_->render();
        }
    }

    std::string FileTreePanel::active_explorer_state_key() const {
        return explorer_panel_ ? explorer_panel_->active_explorer_state_key() : "Files";
    }

    bool FileTreePanel::invoke_command(const std::string& command_id) {
        (void)command_id;
        return false;
    }

    bool FileTreePanel::ensure_preview_open_for_active_context() {
        return false;
    }

    bool FileTreePanel::open_hosted_tab(const std::string& panel_id,
                                        const std::string& title,
                                        std::function<void()> render_fn,
                                        const std::string& source_state_key,
                                        bool prefer_split,
                                        bool* opened_in_split) {
        (void)panel_id;
        (void)title;
        (void)render_fn;
        (void)source_state_key;
        (void)prefer_split;
        if (opened_in_split) {
            *opened_in_split = false;
        }
        return false;
    }

    void FileTreePanel::toggle_active_search() {}

    void FileTreePanel::handle_commands() {
        if (explorer_panel_) {
            explorer_panel_->handle_commands();
        }
    }

    void FileTreePanel::drop_selected_items_to_path(const std::string& source_state_key,
                                                    const std::string& dest_path,
                                                    ClipboardOp op) {
        if (explorer_panel_) {
            explorer_panel_->drop_selected_items_to_path(source_state_key, dest_path, op);
        }
    }
}
