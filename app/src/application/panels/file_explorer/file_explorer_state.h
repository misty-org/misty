#pragma once

#include <vector>
#include <string>
#include <stack>
#include <unordered_set>
#include <mutex>
#include <atomic>
#include <filesystem>
#include <cstring>
#include "core/system/util.h"
#include "core/ui/ui_registry.h"
#include "core/threading/worker_pool.h"
#include "panels/workspace/workspace_state.h"  // For AccountMapping and mount_utils

namespace fs = std::filesystem;

namespace misty::panel {

    // File source type - local filesystem or cloud remote
    enum class FileSource {
        LOCAL,
        REMOTE
    };

    // Context for cloud folder fetch - carries remote parameters
    struct CloudFolderContext {
        std::string remote_name;   // rclone remote name, e.g. "onedrive-john"
        std::string remote_path;   // path within the remote
    };

    // File synchronization status
    enum class SyncStatus {
        LOCAL,      // Not a cloud file (Gray)
        SYNCED,     // Cloud file, fully downloaded and matches cloud (Green)
        MODIFIED,   // Cloud file, downloaded but modified locally (Yellow)
        NOT_SYNCED,  // Cloud file, not downloaded (Red)
        DELETED     // Soft deleted (Black)
    };

    // Unified file item that works for both local and cloud remotes
    struct UnifiedFileItem {
        std::string name;              // Display name
        std::string path;              // Full virtual path
        bool is_dir = false;
        int64_t size = 0;
        std::string last_modified;
        std::string mime_type;
        FileSource source = FileSource::LOCAL;
        SyncStatus status = SyncStatus::LOCAL;  // Default to local (Gray)

        // Remote metadata (empty for local files)
        std::string remote_name;       // rclone remote name, e.g. "onedrive-john"
        std::string remote_path;       // path within the remote, e.g. "/Documents/report.pdf"
    };

    // Path utilities for file explorer navigation
    namespace path_utils {
        inline std::string get_mount_root() {
            return mount_utils::get_mount_root();
        }

        // Check if path is under the remote mount root (~/misty/mnt/*)
        inline bool is_remote_path(const std::string& path) {
            std::string root = get_mount_root();
            if (path.rfind(root, 0) != 0) return false;
            // Must have content beyond the mount root itself
            std::string after = path.substr(root.length());
            return !after.empty() && after != "/";
        }

        // Structure: ~/misty/mnt/{ProviderFolder}/{remote_name}/{relative_path}
        //
        // Returns (provider_folder, remote_name, relative_path).
        // Examples:
        //   ~/misty/mnt/OneDrive                     → ("OneDrive", "", "")
        //   ~/misty/mnt/OneDrive/onedrive-123         → ("OneDrive", "onedrive-123", "")
        //   ~/misty/mnt/OneDrive/onedrive-123/Docs    → ("OneDrive", "onedrive-123", "Docs")
        struct RemotePathInfo {
            std::string provider_folder;  // "OneDrive", "Google Drive", etc.
            std::string remote_name;      // rclone remote name
            std::string relative_path;    // path within the remote
        };

        inline RemotePathInfo parse_remote_path(const std::string& path) {
            std::string root = get_mount_root();
            if (path.rfind(root, 0) != 0) return {};

            std::string relative = path.substr(root.length());
            if (relative.empty() || relative == "/") return {};

            if (!relative.empty() && relative[0] == '/')
                relative = relative.substr(1);

            // First component: provider folder
            size_t slash1 = relative.find('/');
            if (slash1 == std::string::npos) {
                return { relative, "", "" };  // Just provider folder
            }

            std::string provider = relative.substr(0, slash1);
            std::string rest = relative.substr(slash1 + 1);

            // Second component: remote name
            size_t slash2 = rest.find('/');
            if (slash2 == std::string::npos) {
                return { provider, rest, "" };  // Provider + remote, no subpath
            }

            return { provider, rest.substr(0, slash2), rest.substr(slash2 + 1) };
        }

        // Legacy 2-arg variant for code that just needs (remote_name, relative_path)
        // and doesn't care about the provider folder.
        inline std::pair<std::string, std::string> parse_remote_name_and_path(const std::string& path) {
            auto info = parse_remote_path(path);
            return { info.remote_name, info.relative_path };
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
        bool show_hidden = false;  // toggle dotfiles/hidden entries
        bool grid_view = false;    // toggle grid vs list layout
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
        void save_state();   // synchronous — use only at shutdown or for explicit user actions

        // Non-blocking write-behind save. Snapshots state under mu, then
        // dispatches the file write to a worker thread. Safe to call every frame —
        // returns immediately if nothing has changed or a write is already in flight.
        void save_async(core::WorkerPool& pool);

        // Set whenever in-memory state diverges from what is on disk.
        std::atomic<bool> dirty_{false};

    private:
        // Prevents queuing more than one concurrent background write.
        std::atomic<bool> save_in_flight_{false};
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
                std::string fname = entry.path().filename().generic_string();
                if (!state.show_hidden && !fname.empty() && fname[0] == '.') continue;

                UnifiedFileItem item;
                item.path = entry.path().generic_string();
                item.name = fname;
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

    inline void open_file(const std::string& path) {
        core::open_path_default(path);
    }
}
