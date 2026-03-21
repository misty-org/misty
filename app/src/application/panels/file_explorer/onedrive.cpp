#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/workspace/workspace_state.h"
#include "panels/services/onedrive/onedrive_state.h"
#include "panels/services/gdrive/gdrive_state.h"
#include "panels/services/dropbox/dropbox_state.h"
#include "panels/services/icloud/icloud_state.h"
#include "panels/services/services_state.h"
#include "panels/notification/notification_state.h"
#include <nlohmann/json.hpp>
#include <algorithm>

namespace fs = std::filesystem;

namespace misty::panel {
    void FileExplorerPanel::navigate_to_onedrive_mount_root(bool update_history) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");
        auto& services = registry_.get_state<ServicesState>("Services");

        // Clear disconnected notification tracking since we're at the account list level
        state.last_disconnected_notification_folder.clear();

        // Clear OneDrive upload context since we're at account list level
        {
            auto& onedrive_state = registry_.get_state<OneDriveState>("OneDrive");
            std::lock_guard<std::mutex> od_lock(onedrive_state.mu);
            onedrive_state.current_ms_user_id.clear();
            onedrive_state.current_drive_id.clear();
            onedrive_state.current_folder_id.clear();
        }

        // Sync account mappings from services state
        sync_account_mappings();

        std::string new_path = path_utils::get_onedrive_root();

        update_navigation_history(state, new_path, update_history);

        // Build files list from both connected accounts and local folders
        std::vector<UnifiedFileItem> files;
        std::unordered_set<std::string> added_folders;

        // First add connected accounts from mappings
        for (const auto& mapping : workspace.account_mappings) {
            UnifiedFileItem item;
            item.name = mapping.folder_name;
            item.path = new_path + "/" + mapping.folder_name;
            item.is_dir = true;
            item.source = FileSource::ONEDRIVE;
            item.od_ms_user_id = mapping.ms_user_id;
            item.od_drive_id = mapping.drive_id;
            files.push_back(item);
            added_folders.insert(mapping.folder_name);
        }

        // Then scan the local OneDrive directory for folders without connected accounts
        std::error_code ec;
        if (fs::exists(new_path, ec) && fs::is_directory(new_path, ec)) {
            for (const auto& entry : fs::directory_iterator(new_path, ec)) {
                if (entry.is_directory()) {
                    std::string folder_name = entry.path().filename().string();
                    // Skip if already added from mappings or hidden folders
                    if (added_folders.count(folder_name) > 0 || folder_name[0] == '.') {
                        continue;
                    }

                    // This is a local folder without a connected account
                    UnifiedFileItem item;
                    item.name = folder_name;
                    item.path = new_path + "/" + folder_name;
                    item.is_dir = true;
                    item.source = FileSource::LOCAL;  // Mark as local since not connected
                    files.push_back(item);
                }
            }
        }

        state.files = std::move(files);
        set_active_path(state, new_path);
        state.is_loading = false;
        reset_selection(state);
        state.error_msg = "";
    }

    void FileExplorerPanel::navigate_to_onedrive_account(const std::string& folder_name,
                                                          const std::string& relative_path,
                                                          bool update_history,
                                                          bool create_if_missing) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");
        auto& services = registry_.get_state<ServicesState>("Services");

        // Check if this account is connected
        bool is_connected = services.is_account_folder_connected(folder_name);

        // Find account mapping in workspace state
        AccountMapping* mapping = workspace.find_account_by_folder(folder_name);
        if (!mapping) {
            // Try syncing account mappings and retry
            sync_account_mappings();
            mapping = workspace.find_account_by_folder(folder_name);
        }

        std::string target_path = path_utils::get_onedrive_root() + "/" + folder_name;
        if (!relative_path.empty()) {
            target_path += "/" + relative_path;
        }

        // If account not connected, show notification and fall through to local file browsing
        if (!is_connected) {
            // Only show notification if we haven't shown one for this folder already
            if (state.last_disconnected_notification_folder != folder_name) {
                auto& notifications = registry_.get_state<NotificationState>("Notifications");
                notifications.add_notification(
                    "Account Not Connected",
                    "The OneDrive account '" + folder_name + "' is not connected. Showing local files only.",
                    NotificationType::INFO,
                    8.0f  // Show for 8 seconds
                );
                state.last_disconnected_notification_folder = folder_name;
            }

            // Fall through to show local files even without mapping
            if (!mapping) {
                // No mapping exists - just show local filesystem
                if (!fs::exists(target_path)) {
                    state.error_msg = "Path does not exist: " + target_path;
                    return;
                }
                if (!fs::is_directory(target_path)) {
                    state.error_msg = "Path is not a directory: " + target_path;
                    return;
                }

                // Navigate as local path
                navigate_to_local_path(state, target_path, update_history);
                return;
            }
        } else {
            // Account is connected - clear notification tracking
            state.last_disconnected_notification_folder.clear();
        }

        if (!mapping) {
            state.error_msg = "Account not found: " + folder_name;
            return;
        }

        if (create_if_missing) {
            // Create the directory locally so the path is always valid on disk
            std::error_code ec;
            fs::create_directories(target_path, ec);
            if (ec) {
                state.error_msg = "Failed to create directory: " + target_path;
                return;
            }
        } else {
            // Check if path exists - if not, show error (user typed invalid path)
            if (!fs::exists(target_path)) {
                state.error_msg = "Path does not exist: " + target_path;
                return;
            }
            if (!fs::is_directory(target_path)) {
                state.error_msg = "Path is not a directory: " + target_path;
                return;
            }
        }

        // Resolve folder ID from cache
        std::string folder_id = resolve_folder_id_from_cache(*mapping, relative_path);

        update_navigation_history(state, target_path, update_history);
        set_active_path(state, target_path);
        reset_selection(state);
        state.error_msg = "";

        // Try to load from cache first
        std::vector<OneDriveItem> cached_items;
        if (load_items_from_cache(mapping->ms_user_id, folder_id, cached_items)) {
            // Convert to UnifiedFileItem
            std::vector<UnifiedFileItem> files;
            for (const auto& od_item : cached_items) {
                UnifiedFileItem item;
                item.name = od_item.name;
                item.path = target_path + "/" + od_item.name;
                item.is_dir = od_item.is_folder;
                item.size = od_item.size;
                item.last_modified = od_item.last_modified_date_time.substr(0, 10);
                item.source = FileSource::ONEDRIVE;
                item.od_item_id = od_item.id;
                item.od_drive_id = od_item.drive_id;
                item.od_ms_user_id = od_item.ms_user_id;
                item.od_web_url = od_item.web_url;
                files.push_back(item);
            }
            state.files = std::move(files);
            state.is_loading = false;
        } else {
            state.files.clear();
            state.is_loading = true;
        }

        // Fetch in background
        fetch_onedrive_folder(*mapping, folder_id, target_path);
    }

    std::string FileExplorerPanel::resolve_folder_id_from_cache(const AccountMapping& account,
                                                                  const std::string& relative_path) {
        if (relative_path.empty()) {
            return "root";
        }

        auto components = path_utils::split_path(relative_path);
        std::string folder_id = "root";

        for (const auto& name : components) {
            std::vector<OneDriveItem> items;
            if (!load_items_from_cache(account.ms_user_id, folder_id, items)) {
                // Cache miss - return current folder_id, fetch will handle the rest
                return folder_id;
            }

            bool found = false;
            for (const auto& item : items) {
                if (item.is_folder && item.name == name) {
                    folder_id = item.id;
                    found = true;
                    break;
                }
            }

            if (!found) {
                // Path component not found in cache
                return folder_id;
            }
        }

        return folder_id;
    }

    void FileExplorerPanel::fetch_onedrive_folder(const AccountMapping& account,
                                                   const std::string& folder_id,
                                                   const std::string& target_path) {
        auto& services = registry_.get_state<ServicesState>("Services");
        std::string ms_user_id = account.ms_user_id;
        std::string drive_id = account.drive_id;

        // If we don't have drive_id, fetch it first
        if (drive_id.empty()) {
            services.fetch_drive(ms_user_id,
                [this, ms_user_id, folder_id, target_path](const std::string& user_id,
                                                           const std::string& fetched_drive_id,
                                                           bool success,
                                                           const std::string& error) {
                    if (!success) {
                        auto& state = registry_.get_state<FileExplorerState>("Files");
                        std::lock_guard<std::mutex> lock(state.mu);
                        state.is_loading = false;
                        if (state.files.empty()) {
                            state.error_msg = error;
                        }
                        return;
                    }

                    // Update account mapping with drive_id
                    {
                        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");
                        for (auto& mapping : workspace.account_mappings) {
                            if (mapping.ms_user_id == user_id) {
                                mapping.drive_id = fetched_drive_id;
                                save_drive_info_to_cache(user_id, fetched_drive_id,
                                                        mapping.display_name, mapping.email);
                                break;
                            }
                        }
                    }

                    // Now fetch the folder
                    auto& svc = registry_.get_state<ServicesState>("Services");
                    svc.fetch_onedrive_files(user_id, fetched_drive_id, folder_id,
                        [this, user_id, fetched_drive_id, folder_id, target_path](bool success,
                                                                                   const std::string& body,
                                                                                   const std::string& error) {
                            handle_folder_fetch({FileSource::ONEDRIVE, user_id, folder_id, fetched_drive_id}, target_path, success, body, error);
                        });
                });
        } else {
            // We have drive_id, fetch files directly
            services.fetch_onedrive_files(ms_user_id, drive_id, folder_id,
                [this, ms_user_id, drive_id, folder_id, target_path](bool success,
                                                                      const std::string& body,
                                                                      const std::string& error) {
                    handle_folder_fetch({FileSource::ONEDRIVE, ms_user_id, folder_id, drive_id}, target_path, success, body, error);
                });
        }
    }

    void FileExplorerPanel::handle_folder_fetch(const CloudFolderContext& ctx,
                                                  const std::string& target_path,
                                                  bool success,
                                                  const std::string& body,
                                                  const std::string& error) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        std::lock_guard<std::mutex> lock(state.mu);

        state.is_loading = false;

        // Only update if we're still at this path
        if (std::string(state.current_path) != target_path) {
            return;
        }

        // Update upload context for the active service, clear others
        switch (ctx.service) {
            case FileSource::ONEDRIVE: {
                auto& onedrive_state = registry_.get_state<OneDriveState>("OneDrive");
                std::lock_guard<std::mutex> od_lock(onedrive_state.mu);
                onedrive_state.current_ms_user_id = ctx.user_id;
                onedrive_state.current_drive_id = ctx.drive_id;
                onedrive_state.current_folder_id = ctx.folder_id;
                break;
            }
            case FileSource::GDRIVE: {
                auto& gdrive_state = registry_.get_state<GDriveState>("GDrive");
                std::lock_guard<std::mutex> gd_lock(gdrive_state.mu);
                gdrive_state.current_gd_user_id = ctx.user_id;
                gdrive_state.current_folder_id = ctx.folder_id;
                break;
            }
            case FileSource::DROPBOX: {
                auto& dropbox_state = registry_.get_state<DropboxState>("Dropbox");
                std::lock_guard<std::mutex> dbx_lock(dropbox_state.mu);
                dropbox_state.current_dbx_user_id = ctx.user_id;
                dropbox_state.current_folder_path = ctx.folder_id;
                break;
            }
            case FileSource::ICLOUD: {
                auto& icloud_state = registry_.get_state<ICloudState>("iCloud");
                std::lock_guard<std::mutex> icl_lock(icloud_state.mu);
                icloud_state.current_email = ctx.user_id;
                icloud_state.current_folder_path = ctx.folder_id;
                break;
            }
            default: break;
        }
        // Clear inactive services' upload contexts
        if (ctx.service != FileSource::ONEDRIVE) {
            auto& onedrive_state = registry_.get_state<OneDriveState>("OneDrive");
            std::lock_guard<std::mutex> od_lock(onedrive_state.mu);
            onedrive_state.current_ms_user_id.clear();
            onedrive_state.current_drive_id.clear();
            onedrive_state.current_folder_id.clear();
        }
        if (ctx.service != FileSource::GDRIVE) {
            auto& gdrive_state = registry_.get_state<GDriveState>("GDrive");
            std::lock_guard<std::mutex> gd_lock(gdrive_state.mu);
            gdrive_state.current_gd_user_id.clear();
            gdrive_state.current_folder_id.clear();
        }
        if (ctx.service != FileSource::DROPBOX) {
            auto& dropbox_state = registry_.get_state<DropboxState>("Dropbox");
            std::lock_guard<std::mutex> dbx_lock(dropbox_state.mu);
            dropbox_state.current_dbx_user_id.clear();
            dropbox_state.current_folder_path.clear();
        }
        if (ctx.service != FileSource::ICLOUD) {
            auto& icloud_state = registry_.get_state<ICloudState>("iCloud");
            std::lock_guard<std::mutex> icl_lock(icloud_state.mu);
            icloud_state.current_email.clear();
            icloud_state.current_folder_path.clear();
        }

        if (success) {
            std::vector<UnifiedFileItem> files;

            try {
                auto json = nlohmann::json::parse(body);

                switch (ctx.service) {
                    case FileSource::ONEDRIVE: {
                        std::vector<OneDriveItem> od_items;
                        auto values = json.value("value", nlohmann::json::array());

                        for (const auto& item : values) {
                            OneDriveItem odi;
                            odi.id = item.value("id", std::string(""));
                            odi.name = item.value("name", std::string(""));
                            odi.size = item.value("size", int64_t(0));
                            odi.web_url = item.value("webUrl", std::string(""));
                            odi.last_modified_date_time = item.value("lastModifiedDateTime", std::string(""));
                            odi.is_folder = item.contains("folder");
                            if (odi.is_folder && item["folder"].contains("childCount")) {
                                odi.folder_child_count = item["folder"]["childCount"].get<int>();
                            }
                            odi.drive_id = ctx.drive_id;
                            odi.ms_user_id = ctx.user_id;
                            od_items.push_back(odi);

                            UnifiedFileItem ufi;
                            ufi.name = odi.name;
                            ufi.path = target_path + "/" + odi.name;
                            ufi.is_dir = odi.is_folder;
                            ufi.size = odi.size;
                            ufi.last_modified = odi.last_modified_date_time.length() >= 10
                                                ? odi.last_modified_date_time.substr(0, 10) : "";
                            ufi.source = FileSource::ONEDRIVE;
                            ufi.od_item_id = odi.id;
                            ufi.od_drive_id = ctx.drive_id;
                            ufi.od_ms_user_id = ctx.user_id;
                            ufi.od_web_url = odi.web_url;
                            files.push_back(ufi);
                        }

                        state.files = std::move(files);
                        save_items_to_cache(ctx.user_id, ctx.folder_id, od_items);
                        break;
                    }
                    case FileSource::GDRIVE: {
                        std::vector<GDriveItem> gd_items;
                        auto values = json.value("files", nlohmann::json::array());

                        for (const auto& item : values) {
                            GDriveItem gdi;
                            gdi.id = item.value("id", std::string(""));
                            gdi.name = item.value("name", std::string(""));
                            if (item.contains("size")) {
                                if (item["size"].is_string()) {
                                    try { gdi.size = std::stoll(item["size"].get<std::string>()); } catch (...) { gdi.size = 0; }
                                } else {
                                    gdi.size = item["size"].get<int64_t>();
                                }
                            }
                            gdi.web_url = item.value("webViewLink", std::string(""));
                            gdi.created_time = item.value("createdTime", std::string(""));
                            gdi.modified_time = item.value("modifiedTime", std::string(""));
                            gdi.mime_type = item.value("mimeType", std::string(""));
                            gdi.is_folder = (gdi.mime_type == "application/vnd.google-apps.folder");
                            gdi.gd_user_id = ctx.user_id;
                            gd_items.push_back(gdi);

                            UnifiedFileItem ufi;
                            ufi.name = gdi.name;
                            ufi.path = target_path + "/" + gdi.name;
                            ufi.is_dir = gdi.is_folder;
                            ufi.size = gdi.size;
                            ufi.last_modified = gdi.modified_time.length() >= 10
                                                ? gdi.modified_time.substr(0, 10) : "";
                            ufi.source = FileSource::GDRIVE;
                            ufi.gd_item_id = gdi.id;
                            ufi.gd_user_id = ctx.user_id;
                            ufi.gd_mime_type = gdi.mime_type;
                            ufi.gd_web_url = gdi.web_url;
                            files.push_back(ufi);
                        }

                        state.files = std::move(files);
                        save_gd_items_to_cache(ctx.user_id, ctx.folder_id, gd_items);
                        break;
                    }
                    case FileSource::DROPBOX: {
                        std::vector<DropboxItem> dbx_items;
                        auto entries = json.value("entries", nlohmann::json::array());

                        for (const auto& entry : entries) {
                            DropboxItem dbi;
                            std::string tag = entry.value(".tag", std::string(""));
                            dbi.id = entry.value("id", std::string(""));
                            dbi.name = entry.value("name", std::string(""));
                            dbi.path_display = entry.value("path_display", std::string(""));
                            dbi.path_lower = entry.value("path_lower", std::string(""));
                            dbi.is_folder = (tag == "folder");
                            if (!dbi.is_folder) {
                                dbi.size = entry.value("size", int64_t(0));
                                dbi.server_modified = entry.value("server_modified", std::string(""));
                            }
                            dbi.dbx_user_id = ctx.user_id;
                            dbx_items.push_back(dbi);

                            UnifiedFileItem ufi;
                            ufi.name = dbi.name;
                            ufi.path = target_path + "/" + dbi.name;
                            ufi.is_dir = dbi.is_folder;
                            ufi.size = dbi.size;
                            ufi.last_modified = dbi.server_modified.length() >= 10
                                                ? dbi.server_modified.substr(0, 10) : "";
                            ufi.source = FileSource::DROPBOX;
                            ufi.dbx_item_id = dbi.id;
                            ufi.dbx_user_id = ctx.user_id;
                            ufi.dbx_path_display = dbi.path_display;
                            files.push_back(ufi);
                        }

                        state.files = std::move(files);
                        save_dbx_items_to_cache(ctx.user_id, ctx.folder_id, dbx_items);
                        break;
                    }
                    case FileSource::ICLOUD: {
                        std::vector<ICloudItem> icl_items;
                        auto items_arr = json.value("items", nlohmann::json::array());
                        // Build folder path prefix for iCloud Drive path tracking
                        std::string icl_parent_path = ctx.folder_id; // e.g., "" or "Documents"

                        for (const auto& item : items_arr) {
                            std::string name = item.value("name", std::string(""));
                            bool is_folder = item.value("is_folder", false);
                            if (name.empty()) continue;

                            // Security: reject path traversal attempts in names
                            if (name.find('/') != std::string::npos || name.find("..") != std::string::npos) {
                                continue;
                            }

                            ICloudItem icl_item;
                            icl_item.name = name;
                            icl_item.path = icl_parent_path.empty() ? name : icl_parent_path + "/" + name;
                            icl_item.is_folder = is_folder;
                            icl_item.email = ctx.user_id;
                            icl_items.push_back(icl_item);

                            UnifiedFileItem ufi;
                            ufi.name = name;
                            ufi.path = target_path + "/" + name;
                            ufi.is_dir = is_folder;
                            ufi.source = FileSource::ICLOUD;
                            ufi.icl_email = ctx.user_id;
                            ufi.icl_path_display = icl_item.path;
                            files.push_back(ufi);
                        }

                        state.files = std::move(files);
                        save_icl_items_to_cache(ctx.user_id, ctx.folder_id, icl_items);
                        break;
                    }
                    default: break;
                }

                // Determine sync status for all items
                for (auto& ufi : state.files) {
                    if (ufi.is_dir) {
                        ufi.status = SyncStatus::LOCAL;
                    } else {
                        std::error_code ec;
                        if (fs::exists(ufi.path, ec)) {
                            // GDrive special case: online docs with size 0
                            if (ufi.source == FileSource::GDRIVE && ufi.size == 0 &&
                                ufi.gd_mime_type.rfind("application/vnd.google-apps.", 0) == 0) {
                                ufi.status = SyncStatus::SYNCED;
                            } else {
                                uintmax_t local_size = fs::file_size(ufi.path, ec);
                                if (!ec && local_size == (uintmax_t)ufi.size) {
                                    ufi.status = SyncStatus::SYNCED;
                                } else {
                                    ufi.status = SyncStatus::MODIFIED;
                                }
                            }
                        } else {
                            ufi.status = SyncStatus::NOT_SYNCED;
                        }
                    }
                }

            } catch (const std::exception& e) {
                if (state.files.empty()) {
                    state.error_msg = std::string("Parse error: ") + e.what();
                }
            }
        } else if (state.files.empty()) {
            state.error_msg = error;
        }
    }

}
