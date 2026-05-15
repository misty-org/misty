#pragma once

#include <functional>
#include <memory>
#include <string>

#include "core/threading/worker_pool.h"
#include "core/ui/ui_registry.h"
#include "panels/file_explorer/file_explorer_panel.h"
#include "imgui.h"

class MistyClient;

namespace misty::panel {
    class FileTreePanel {
    public:
        FileTreePanel(core::UIRegistry& registry,
                      core::WorkerPool& worker_pool,
                      std::shared_ptr<MistyClient> client);
        ~FileTreePanel() = default;

        void render(const ImVec2& pos, const ImVec2& size);

        std::string active_explorer_state_key() const;
        bool invoke_command(const std::string& command_id);
        bool ensure_preview_open_for_active_context();
        bool open_hosted_tab(const std::string& panel_id,
                             const std::string& title,
                             std::function<void()> render_fn,
                             const std::string& source_state_key,
                             bool prefer_split,
                             bool* opened_in_split);
        void toggle_active_search();
        void handle_commands();
        void drop_selected_items_to_path(const std::string& source_state_key,
                                         const std::string& dest_path,
                                         ClipboardOp op);

    private:
        core::UIRegistry& registry_;
        core::WorkerPool& worker_pool_;
        std::shared_ptr<MistyClient> client_;
        std::shared_ptr<FileExplorerPanel> explorer_panel_;
    };
}
