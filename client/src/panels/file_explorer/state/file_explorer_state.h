#pragma once

#include <vector>
#include <string>
#include <stack>
#include <unordered_set>
#include <mutex>
#include <atomic>
#include <chrono>
#include <filesystem>
#include <cstring>
#include <cstdint>
#include "core/ui/ui_registry.h"
#include "core/threading/worker_pool.h"

namespace fs = std::filesystem;

namespace misty::panel {

    inline std::string path_utf8_string(const fs::path& path) {
#if defined(__cpp_char8_t)
        const auto value = path.u8string();
        return std::string(reinterpret_cast<const char*>(value.data()), value.size());
#else
        return path.u8string();
#endif
    }

    inline std::string path_utf8_generic_string(const fs::path& path) {
#if defined(__cpp_char8_t)
        const auto value = path.generic_u8string();
        return std::string(reinterpret_cast<const char*>(value.data()), value.size());
#else
        return path.generic_u8string();
#endif
    }

    inline std::string path_utf8_filename(const fs::path& path) {
        return path_utf8_string(path.filename());
    }

    struct ChatMessage {
        std::string role;
        std::string content;
    };

    // Explorer-local lifecycle state.
    enum class SyncStatus {
        LOCAL,
        DELETED
    };

    struct UnifiedFileItem {
        std::string name;
        std::string path;
        std::string id;                // Selection key; local files use their path.
        bool is_dir = false;
        int64_t size = 0;
        std::string last_modified;
        std::string mime_type;
        SyncStatus status = SyncStatus::LOCAL;
    };

    // Path utilities for file explorer navigation
    namespace path_utils {
        inline std::string strip_trailing_separators(std::string path) {
            while (path.size() > 1 && (path.back() == '/' || path.back() == '\\')) {
                if (path.size() == 3 && path[1] == ':') {
                    break;
                }
                path.pop_back();
            }
            return path;
        }

        inline std::string normalize_for_history(const std::string& path) {
            if (path.empty() || path.rfind("misty://", 0) == 0) {
                return strip_trailing_separators(path);
            }

            std::error_code ec;
            fs::path normalized = fs::weakly_canonical(fs::path(path), ec);
            if (ec) {
                normalized = fs::path(path).lexically_normal();
            }
            return strip_trailing_separators(normalized.generic_string());
        }

        inline bool same_history_path(const std::string& lhs, const std::string& rhs) {
            return normalize_for_history(lhs) == normalize_for_history(rhs);
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

    // Shared across all file-explorer panes and tabs. Registered once under
    // "Clipboard" in UIRegistry so copying in pane A / tab 1 is pasteable from
    // pane B / tab 2.
    struct ClipboardState : public core::UIState {
        ClipboardOp op = ClipboardOp::NONE;
        std::vector<std::string> paths;
        std::vector<UnifiedFileItem> items;

        bool has_content() const {
            return op != ClipboardOp::NONE && !items.empty();
        }

        void clear() {
            op = ClipboardOp::NONE;
            paths.clear();
            items.clear();
        }
    };

    struct FileExplorerState : public core::UIState {
        FileExplorerState() {
            std::memset(current_path, 0, sizeof(current_path));
            std::memset(search_path, 0, sizeof(search_path));
            std::memset(rename_buffer, 0, sizeof(rename_buffer));
            std::memset(new_entry_name_buffer, 0, sizeof(new_entry_name_buffer));
            std::memset(chat_input_buffer, 0, sizeof(chat_input_buffer));
        }

        char current_path[512] = "";
        std::string last_opened_path = "";
        char search_path[512] = "";
        std::vector<UnifiedFileItem> files;
        std::unordered_set<std::string> selected_files; // keyed by UnifiedFileItem::id

        std::string path_for_selection(const std::string& sel_id) const {
            for (const auto& f : files) {
                if (f.id == sel_id) return f.path;
            }
            return sel_id;
        }
        int last_selected_index = -1;
        bool is_loading = false;
        bool show_loading_animation = false;
        std::chrono::steady_clock::time_point loading_animation_ready_at{};
        bool sort_dirty = true;
        bool is_hidden = false;
        bool show_hidden = false;  // toggle dotfiles/hidden entries
        bool grid_view = false;    // toggle grid vs list layout
        std::string error_msg = "";
        std::stack<std::string> back_history;
        std::stack<std::string> forward_history;
        std::mutex mu;
        std::atomic<uint64_t> navigation_generation{0};
        std::atomic<uint64_t> listing_revision{0};

        // Pending navigation - set by external code, processed by panel
        std::string pending_navigation_path;
        std::string pending_shared_refresh_path;

        // Delete tracking keeps rows visually stable while destructive work completes.
        std::unordered_set<std::string> deleting_files;

        bool is_deleting(const std::string& path) const {
            return deleting_files.count(path) > 0;
        }

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

        // Permission retry modal for local deletes that need elevated approval
        bool show_permission_delete_modal = false;
        bool permission_delete_permanent = false;
        std::vector<std::string> permission_delete_paths;

        // Permanent delete confirmation for items already in the virtual trash
        bool show_permanent_delete_modal = false;
        std::vector<std::string> permanent_delete_paths;

        // Ephemeral AI chat overlay state. Intentionally not persisted.
        bool chat_overlay_open = false;
        bool chat_request_in_flight = false;
        bool chat_focus_input = false;
        bool chat_resizing = false;
        bool chat_resize_just_finished = false;
        float chat_overlay_height = 0.0f;
        char chat_input_buffer[2048] = "";
        std::vector<ChatMessage> chat_messages;
        std::string chat_error_msg;

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
        void note_listing_changed();
        void clear_transient_ui_state();
        void clear_for_state_release();

    private:
        // Prevents queuing more than one concurrent background write.
        std::atomic<bool> save_in_flight_{false};
    };

    // Navigate to local filesystem path
    inline void navigate_to_local_path(FileExplorerState& state, const std::string& path, bool update_history = true) {
        state.is_loading = true;
        state.show_loading_animation = false;

        try {
            std::string new_path = path_utf8_generic_string(fs::canonical(fs::path(path)));
            if (new_path == state.current_path) {
                update_history = false;
            }

            std::vector<UnifiedFileItem> new_files;
            for (const auto& entry : fs::directory_iterator(path)) {
                std::string fname = path_utf8_filename(entry.path());
                if (!state.show_hidden && !fname.empty() && fname[0] == '.') continue;

                UnifiedFileItem item;
                item.path = path_utf8_generic_string(entry.path());
                item.id = item.path;
                item.name = fname;
                item.is_dir = entry.is_directory();
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
            state.show_loading_animation = false;
            state.sort_dirty = true;
            state.selected_files.clear();
            state.last_selected_index = -1;
            state.error_msg = "";
        }
        catch (const std::exception& e) {
            state.error_msg = e.what();
            state.is_loading = false;
            state.show_loading_animation = false;
            state.sort_dirty = true;
        }
    }

}
