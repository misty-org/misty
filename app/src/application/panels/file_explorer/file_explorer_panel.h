#pragma once

#include <memory>

#include "core/ui_registry.h"
#include "panels/panel.h"
#include "core/worker_pool.h"
#include "panels/file_explorer/file_explorer_state.h"
#include "panels/workspace/workspace_state.h"


namespace minidfs::panel {
    class FileExplorerPanel : public panel::Panel {
    public:
        FileExplorerPanel(core::UIRegistry& registry, core::WorkerPool& worker_pool, std::shared_ptr<MiniDFSClient> client);
        ~FileExplorerPanel() override = default;
        void render() override;

        // Unified navigation - routes to local or OneDrive based on path
        // create_if_missing: if true, creates OneDrive directories locally when navigating
        //                    set to false when user types path manually (should show error instead)
        void navigate_to_path(const std::string& path, bool update_history = true, bool create_if_missing = true);

    private:
        void show_nav_history(panel::FileExplorerState& state, float button_width, float spacing);
        void show_search_bar(panel::FileExplorerState& state);
        void show_directory_contents(panel::FileExplorerState& state);
        void show_file_item(panel::FileExplorerState& state, int i);

        // Sync account mappings from services state
        void sync_account_mappings();

        // OneDrive path navigation helpers
        void navigate_to_onedrive_mount_root(bool update_history);
        void navigate_to_onedrive_account(const std::string& folder_name, const std::string& relative_path, bool update_history, bool create_if_missing);
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

        // Download OneDrive file and open it when complete
        void download_and_open_file(const UnifiedFileItem& file);

        // Sync Google Drive account mappings from services state
        void sync_gd_account_mappings();

        // Google Drive path navigation helpers
        void navigate_to_gdrive_mount_root(bool update_history);
        void navigate_to_gdrive_account(const std::string& folder_name, const std::string& relative_path, bool update_history, bool create_if_missing);
        void fetch_gdrive_folder(const GDAccountMapping& account, const std::string& folder_id, const std::string& target_path);

        // Resolve relative path to folder ID using Google Drive cache
        std::string resolve_gd_folder_id_from_cache(const GDAccountMapping& account, const std::string& relative_path);

        // Handle async Google Drive folder fetch response
        void handle_gd_folder_fetch_response(const std::string& gd_user_id,
                                              const std::string& folder_id,
                                              const std::string& target_path,
                                              bool success,
                                              const std::string& body,
                                              const std::string& error);

        // Download Google Drive file and open it when complete
        void download_and_open_gd_file(const UnifiedFileItem& file);

    private:
        core::UIRegistry& registry_;
        core::WorkerPool& worker_pool_;
        std::shared_ptr<MiniDFSClient> client_;

        std::string initial_start_path_;
        bool workspace_mount_applied_ = false;

    };
};
