#pragma once

#include <memory>

#include "core/ui_registry.h"
#include "panels/panel.h"
#include "core/worker_pool.h"
#include "panels/file_explorer/file_explorer_state.h"
#include "panels/workspace/workspace_state.h"
#include "panels/activity/upload_state.h"


namespace misty::panel {
    class FileExplorerPanel : public panel::Panel {
    public:
        FileExplorerPanel(core::UIRegistry& registry, core::WorkerPool& worker_pool, std::shared_ptr<MistyClient> client);
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

        // Context menu + file operations
        void show_context_menu(panel::FileExplorerState& state);
        void show_background_context_menu(panel::FileExplorerState& state);
        void show_new_entry_modal(panel::FileExplorerState& state);
        void show_rename_modal(panel::FileExplorerState& state);
        
        // File operation helpers
        void perform_copy(panel::FileExplorerState& state);
        void perform_cut(panel::FileExplorerState& state);
        void perform_paste(panel::FileExplorerState& state);
        void perform_paste_local_to_local(panel::FileExplorerState& state, const panel::UnifiedFileItem& item, const std::string& dest_dir);
        void perform_paste_to_cloud(panel::FileExplorerState& state, const panel::UnifiedFileItem& item, const std::string& dest_dir);
        void perform_paste_cloud_to_local(panel::FileExplorerState& state, const panel::UnifiedFileItem& item, const std::string& dest_dir);
        void trigger_upload(const std::string& local_path, const std::string& dest_dir);
        void perform_delete_selected(panel::FileExplorerState& state);
        void perform_delete(panel::FileExplorerState& state, const std::string& path);
        void initiate_rename(panel::FileExplorerState& state);

        // Sync account mappings from services state
        void sync_account_mappings();

        // OneDrive path navigation helpers
        void navigate_to_onedrive_mount_root(bool update_history);
        void navigate_to_onedrive_account(const std::string& folder_name, const std::string& relative_path, bool update_history, bool create_if_missing);
        void fetch_onedrive_folder(const AccountMapping& account, const std::string& folder_id, const std::string& target_path);

        // Resolve relative path to folder ID using cache
        std::string resolve_folder_id_from_cache(const AccountMapping& account, const std::string& relative_path);

        // Handle async cloud folder fetch response (OneDrive, GDrive, Dropbox)
        void handle_folder_fetch(const CloudFolderContext& ctx,
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



        // Download Google Drive file and open it when complete
        void download_and_open_gd_file(const UnifiedFileItem& file);

        // Sync Dropbox account mappings from services state
        void sync_dbx_account_mappings();

        // Dropbox path navigation helpers
        void navigate_to_dropbox_mount_root(bool update_history);
        void navigate_to_dropbox_account(const std::string& folder_name, const std::string& relative_path, bool update_history, bool create_if_missing);
        void fetch_dropbox_folder(const DBXAccountMapping& account, const std::string& folder_path, const std::string& target_path);



        // Download Dropbox file and open it when complete
        void download_and_open_dbx_file(const UnifiedFileItem& file);

    private:
        core::UIRegistry& registry_;
        core::WorkerPool& worker_pool_;
        std::shared_ptr<MistyClient> client_;

        std::string initial_start_path_;
        bool workspace_mount_applied_ = false;

    };
};
