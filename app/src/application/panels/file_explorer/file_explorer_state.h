#pragma once

#include <vector>
#include <string>
#include <stack>
#include <unordered_set>
#include <mutex>
#include <filesystem>
#include <cstring>
#include "core/ui_registry.h"
#include "panels/workspace/workspace_state.h"  // For AccountMapping and mount_utils

namespace fs = std::filesystem;

namespace misty::panel {

    // File source type - local filesystem or cloud service
    enum class FileSource {
        LOCAL,
        ONEDRIVE,
        GDRIVE,
        DROPBOX
    };

    // Context for cloud folder fetch - carries service-specific parameters
    struct CloudFolderContext {
        FileSource service;
        std::string user_id;     // ms_user_id / gd_user_id / dbx_user_id
        std::string folder_id;   // folder_id (OD/GD) or folder_path (DBX)
        std::string drive_id;    // OneDrive only, empty for others
    };

    // File synchronization status
    enum class SyncStatus {
        LOCAL,      // Not a cloud file (Gray)
        SYNCED,     // Cloud file, fully downloaded and matches cloud (Green)
        MODIFIED,   // Cloud file, downloaded but modified locally (Yellow)
        NOT_SYNCED,  // Cloud file, not downloaded (Red)
        DELETED     // Soft deleted (Black)
    };

    // Unified file item that works for both local and OneDrive
    struct UnifiedFileItem {
        std::string name;              // Display name
        std::string path;              // Full virtual path
        bool is_dir = false;
        int64_t size = 0;
        std::string last_modified;
        FileSource source = FileSource::LOCAL;
        SyncStatus status = SyncStatus::LOCAL;  // Default to local (Gray)

        // OneDrive metadata (empty for local files)
        std::string od_item_id;
        std::string od_drive_id;
        std::string od_ms_user_id;
        std::string od_web_url;

        // Google Drive metadata (empty for local/OneDrive files)
        std::string gd_item_id;
        std::string gd_user_id;
        std::string gd_mime_type;
        std::string gd_web_url;

        // Dropbox metadata (empty for non-Dropbox files)
        std::string dbx_item_id;
        std::string dbx_user_id;
        std::string dbx_path_display;
    };

    // Path utilities for file explorer navigation
    // Note: Directory management (ensure_*) is in workspace_state.h mount_utils
    namespace path_utils {
        // Convenience aliases to mount_utils
        inline std::string get_mount_root() {
            return mount_utils::get_mount_root();
        }

        inline std::string get_onedrive_root() {
            return mount_utils::get_onedrive_root();
        }

        inline std::string get_gdrive_root() {
            return mount_utils::get_gdrive_root();
        }

        inline std::string get_dropbox_root() {
            return mount_utils::get_dropbox_root();
        }

        inline bool is_dropbox_path(const std::string& path) {
            std::string root = get_dropbox_root();
            return path.rfind(root, 0) == 0;
        }

        // Parse Dropbox path into (account_folder_name, relative_path)
        // e.g., "~/misty/mnt/Dropbox/matthew/Documents"
        //       -> ("matthew", "Documents")
        inline std::pair<std::string, std::string> parse_dropbox_path(const std::string& path) {
            std::string root = get_dropbox_root();
            if (path.rfind(root, 0) != 0) {
                return {"", ""};
            }

            std::string relative = path.substr(root.length());
            if (relative.empty() || relative == "/") {
                return {"", ""};  // At mount root, show accounts
            }

            // Remove leading slash
            if (!relative.empty() && relative[0] == '/') {
                relative = relative.substr(1);
            }

            size_t slash_pos = relative.find('/');
            if (slash_pos == std::string::npos) {
                // Just account name, at account root
                return {relative, ""};
            }

            return {
                relative.substr(0, slash_pos),
                relative.substr(slash_pos + 1)
            };
        }

        inline bool is_gdrive_path(const std::string& path) {
            std::string root = get_gdrive_root();
            return path.rfind(root, 0) == 0;
        }

        // Parse Google Drive path into (account_folder_name, relative_path)
        // e.g., "~/misty/mnt/GoogleDrive/matthew/Documents"
        //       → ("matthew", "Documents")
        inline std::pair<std::string, std::string> parse_gdrive_path(const std::string& path) {
            std::string root = get_gdrive_root();
            if (path.rfind(root, 0) != 0) {
                return {"", ""};
            }

            std::string relative = path.substr(root.length());
            if (relative.empty() || relative == "/") {
                return {"", ""};  // At mount root, show accounts
            }

            // Remove leading slash
            if (!relative.empty() && relative[0] == '/') {
                relative = relative.substr(1);
            }

            size_t slash_pos = relative.find('/');
            if (slash_pos == std::string::npos) {
                // Just account name, at account root
                return {relative, ""};
            }

            return {
                relative.substr(0, slash_pos),
                relative.substr(slash_pos + 1)
            };
        }

        inline bool is_onedrive_path(const std::string& path) {
            std::string root = get_onedrive_root();
            return path.rfind(root, 0) == 0;
        }

        // Parse OneDrive path into (account_folder_name, relative_path)
        // e.g., "~/misty/mnt/OneDrive/matthew/Documents"
        //       → ("matthew", "Documents")
        inline std::pair<std::string, std::string> parse_onedrive_path(const std::string& path) {
            std::string root = get_onedrive_root();
            if (path.rfind(root, 0) != 0) {
                return {"", ""};
            }

            std::string relative = path.substr(root.length());
            if (relative.empty() || relative == "/") {
                return {"", ""};  // At mount root, show accounts
            }

            // Remove leading slash
            if (!relative.empty() && relative[0] == '/') {
                relative = relative.substr(1);
            }

            size_t slash_pos = relative.find('/');
            if (slash_pos == std::string::npos) {
                // Just account name, at account root
                return {relative, ""};
            }

            return {
                relative.substr(0, slash_pos),
                relative.substr(slash_pos + 1)
            };
        }

        // Split a path into components
        inline std::vector<std::string> split_path(const std::string& path) {
            std::vector<std::string> components;
            std::string current;
            for (char c : path) {
                if (c == '/') {
                    if (!current.empty()) {
                        components.push_back(current);
                        current.clear();
                    }
                } else {
                    current += c;
                }
            }
            if (!current.empty()) {
                components.push_back(current);
            }
            return components;
        }
    }

    // Clipboard operation type for copy/cut
    enum class ClipboardOp { NONE, COPY, CUT };

    struct FileExplorerState : public core::UIState {
        FileExplorerState() {
            std::memset(current_path, 0, sizeof(current_path));
            std::memset(search_path, 0, sizeof(search_path));
            std::memset(rename_buffer, 0, sizeof(rename_buffer));
            std::memset(new_entry_name_buffer, 0, sizeof(new_entry_name_buffer));
        }

        char current_path[512] = "";
        std::string last_opened_path = "";
        char search_path[512] = "";
        std::vector<UnifiedFileItem> files;
        std::unordered_set<std::string> selected_files;
        int last_selected_index = -1;
        bool is_loading = false;
        bool is_hidden = false;
        std::string error_msg = "";
        std::stack<std::string> back_history;
        std::stack<std::string> forward_history;
        std::mutex mu;

        // Pending navigation - set by external code, processed by panel
        std::string pending_navigation_path;

        // Download tracking - paths currently being downloaded
        std::unordered_set<std::string> downloading_files;

        bool is_downloading(const std::string& path) const {
            return downloading_files.count(path) > 0;
        }

        // Track last disconnected account notification to prevent spam
        std::string last_disconnected_notification_folder;

        // Clipboard state for copy/cut/paste
        ClipboardOp clipboard_op = ClipboardOp::NONE;
        std::vector<std::string> clipboard_paths;
        std::vector<UnifiedFileItem> clipboard_items;  // Full metadata for cross-source paste

        // Rename state
        bool show_rename_modal = false;
        char rename_buffer[256] = "";
        std::string rename_target_path;

        // Context menu target
        std::string context_menu_target_path;

        // New entry modal (from background context menu)
        bool show_new_entry_modal = false;
        bool new_entry_is_dir = false;
        char new_entry_name_buffer[256] = {};

        // Virtual Folders Data
        static constexpr const char* VIRTUAL_PATH_RECENT = "misty://recent";
        static constexpr const char* VIRTUAL_PATH_STARRED = "misty://starred";
        static constexpr const char* VIRTUAL_PATH_TRASH = "misty://trash";

        std::deque<UnifiedFileItem> recent_files;
        std::vector<UnifiedFileItem> starred_files;
        std::vector<UnifiedFileItem> trash_files;
        
        // Helper to check if a file is starred
        bool is_starred(const std::string& path) const;

        // Helper to toggle star status
        void toggle_star(const UnifiedFileItem& item);

        // Helper to add recent file
        void add_recent(const UnifiedFileItem& item);
        
        // Helper to move to trash
        void move_to_trash(const UnifiedFileItem& item);

        // Helper to track file moves/renames/deletions in virtual lists
        void track_move(const std::string& old_path, const UnifiedFileItem& new_item);

        // State persistence
        void load_state();
        void save_state();
    };

    // Navigate to local filesystem path
    inline void navigate_to_local_path(FileExplorerState& state, const std::string& path, bool update_history = true) {
        state.is_loading = true;

        try {
            std::string new_path = fs::canonical(fs::path(path)).generic_string();
            if (new_path == state.current_path) {
                update_history = false;
            }

            std::vector<UnifiedFileItem> new_files;
            for (const auto& entry : fs::directory_iterator(path)) {
                UnifiedFileItem item;
                item.path = entry.path().generic_string();
                item.name = entry.path().filename().generic_string();
                item.is_dir = entry.is_directory();
                item.source = FileSource::LOCAL;
                item.status = SyncStatus::LOCAL;

                if (!item.is_dir) {
                    try {
                        item.size = fs::file_size(entry.path());
                    } catch (...) {
                        item.size = 0;
                    }
                }

                try {
                    auto ftime = fs::last_write_time(entry.path());
                    auto sctp = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
                        ftime - fs::file_time_type::clock::now() + std::chrono::system_clock::now()
                    );
                    auto time_t_val = std::chrono::system_clock::to_time_t(sctp);
                    char buf[32];
                    std::strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M", std::localtime(&time_t_val));
                    item.last_modified = buf;
                } catch (...) {
                    item.last_modified = "";
                }

                new_files.push_back(item);
            }

            if (update_history) {
                std::string current_path_str(state.current_path);
                if (!current_path_str.empty() && current_path_str != new_path) {
                    state.back_history.push(current_path_str);
                }
                while (!state.forward_history.empty()) {
                    state.forward_history.pop();
                }
            }

            state.files = std::move(new_files);
            strncpy(state.current_path, new_path.c_str(), sizeof(state.current_path) - 1);
            state.current_path[sizeof(state.current_path) - 1] = '\0';
            strncpy(state.search_path, new_path.c_str(), sizeof(state.search_path) - 1);

            state.is_loading = false;
            state.selected_files.clear();
            state.last_selected_index = -1;
            state.error_msg = "";
        }
        catch (const std::exception& e) {
            state.error_msg = e.what();
            state.is_loading = false;
        }
    }

    // Legacy function for compatibility - calls navigate_to_local_path
    inline void get_files(FileExplorerState& state, std::string path, bool update_history = true) {
        navigate_to_local_path(state, path, update_history);
    }

    inline bool can_go_back(FileExplorerState& state) { return !state.back_history.empty(); }
    inline bool can_go_forward(FileExplorerState& state) { return !state.forward_history.empty(); }

#ifdef _WIN32
#include <windows.h>
#include <shellapi.h>

    inline void open_file(const std::string& path) {
        ShellExecuteA(NULL, "open", path.c_str(), NULL, NULL, SW_SHOWNORMAL);
    }
#elif __APPLE__
    inline void open_file(const std::string& path) {
        std::string cmd = "open \"" + path + "\"";
        system(cmd.c_str());
    }
#elif __linux__
    inline void open_file(const std::string& path) {
        std::string cmd = "xdg-open \"" + path + "\"";
        system(cmd.c_str());
    }
#endif
}
