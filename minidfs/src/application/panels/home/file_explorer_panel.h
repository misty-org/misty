#pragma once

#include <memory>

#include "core/ui_registry.h"
#include "panels/panel.h"
#include "core/worker_pool.h"
#include "file_explorer_state.h"
#include "onedrive_state.h"
#include "workspace_state.h"
#include "panels/services/services_state.h"


namespace minidfs::panel {
    class FileExplorerPanel : public panel::Panel {
    public:
        FileExplorerPanel(core::UIRegistry& registry, core::WorkerPool& worker_pool, std::shared_ptr<MiniDFSClient> client);
        ~FileExplorerPanel() override = default;
        void render() override;

        // Unified navigation - routes to local or OneDrive based on path
        void navigate_to_path(const std::string& path, bool update_history = true);

    private:
        void show_nav_history(panel::FileExplorerState& state, float button_width, float spacing);
        void show_search_bar(panel::FileExplorerState& state);
        void show_directory_contents(panel::FileExplorerState& state);
        void show_file_item(panel::FileExplorerState& state, int i);

        // Sync account mappings from services state
        void sync_account_mappings();

        // OneDrive path navigation helpers
        void navigate_to_onedrive_mount_root(bool update_history);
        void navigate_to_onedrive_account(const std::string& folder_name, const std::string& relative_path, bool update_history);
        void fetch_onedrive_folder(const AccountMapping& account, const std::string& folder_id, const std::string& target_path);

        // Resolve relative path to folder ID using cache
        std::string resolve_folder_id_from_cache(const AccountMapping& account, const std::string& relative_path);

        // Handle async folder fetch response
        void handle_folder_fetch_response(const std::string& ms_user_id,
                                          const std::string& drive_id,
                                          const std::string& folder_id,
                                          const std::string& target_path,
                                          bool success,
                                          const std::string& body,
                                          const std::string& error);

    private:
        core::UIRegistry& registry_;
        core::WorkerPool& worker_pool_;
        std::shared_ptr<MiniDFSClient> client_;

    };
};
