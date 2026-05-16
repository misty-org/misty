#include "panels/file_explorer/file_explorer_panel.h"
#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstring>


namespace fs = std::filesystem;

using namespace misty::core;

namespace misty::panel {
    namespace {
        std::string file_explorer_tab_title_for_path(const std::string& path) {
            if (path.empty()) {
                return "Files";
            }

            if (path == FileExplorerState::VIRTUAL_PATH_RECENT) {
                return "Recent";
            }
            if (path == FileExplorerState::VIRTUAL_PATH_STARRED) {
                return "Starred";
            }
            if (path == FileExplorerState::VIRTUAL_PATH_TRASH) {
                return "Trash";
            }

            const fs::path normalized = fs::path(path).lexically_normal();
            const std::string leaf = normalized.filename().string();
            if (!leaf.empty() && leaf != ".") {
                return leaf;
            }

            const std::string normalized_path = normalized.string();
            return normalized_path.empty() ? path : normalized_path;
        }

        std::string default_local_start_path() {
            if (const char* home = std::getenv("HOME")) {
                return home;
            }
            return fs::current_path().string();
        }

    }

    std::string FileExplorerPanel::tab_title() const {
        const auto& state = registry_.get_state<FileExplorerState>(state_key_);
        if (state.current_path[0] != '\0') {
            return file_explorer_tab_title_for_path(state.current_path);
        }
        if (!state.pending_navigation_path.empty()) {
            return file_explorer_tab_title_for_path(state.pending_navigation_path);
        }
        return "Files";
    }

    TabController::Tab FileExplorerPanel::create_default_tab(std::int16_t tab_idx) const {
        FileExplorerPanelProps props;
        props.state_key = state_key_ + "_tab_" + std::to_string(tab_idx);
        props.panel_id = panel_id() + "_tab_" + std::to_string(tab_idx);
        props.restore_persistent_state = false;

        std::string initial_path = default_local_start_path();
        if (const auto* active_explorer = dynamic_cast<const FileExplorerPanel*>(active_panel())) {
            const auto& active_state = registry_.get_state<FileExplorerState>(active_explorer->state_key_);
            if (active_state.current_path[0] != '\0') {
                initial_path = active_state.current_path;
            } else if (!active_state.pending_navigation_path.empty()) {
                initial_path = active_state.pending_navigation_path;
            }
        } else {
            const auto& state = registry_.get_state<FileExplorerState>(state_key_);
            if (state.current_path[0] != '\0') {
                initial_path = state.current_path;
            } else if (!state.pending_navigation_path.empty()) {
                initial_path = state.pending_navigation_path;
            }
        }
        props.initial_path_override = initial_path;

        auto panel = std::make_shared<FileExplorerPanel>(registry_, worker_pool_, std::move(props));
        TabController::Tab tab;
        tab.context_key = panel->state_key_;
        tab.state_key = panel->state_key_;
        tab.title = "Files";
        tab.idx = tab_idx;
        tab.panel = std::move(panel);
        return tab;
    }

    std::string FileExplorerPanel::active_explorer_state_key() const {
        if (const auto* active_explorer = dynamic_cast<const FileExplorerPanel*>(active_panel())) {
            return active_explorer->state_key_;
        }
        return state_key_;
    }

    void FileExplorerPanel::drop_selected_items_to_path(const std::string& source_state_key,
                                                        const std::string& dest_path,
                                                        ClipboardOp op) {
        auto& source_state = registry_.get_state<FileExplorerState>(source_state_key);
        std::vector<UnifiedFileItem> items;
        items.reserve(source_state.selected_files.size());
        for (const auto& selected_id : source_state.selected_files) {
            auto it = std::find_if(source_state.files.begin(), source_state.files.end(),
                                   [&](const UnifiedFileItem& candidate) { return candidate.id == selected_id; });
            if (it != source_state.files.end()) {
                items.push_back(*it);
            }
        }

        if (items.empty()) {
            return;
        }

        auto& active_state = registry_.get_state<FileExplorerState>(active_explorer_state_key());
        perform_drop_items(active_state, items, dest_path, op);
    }


    void FileExplorerPanel::handle_pending_navigation(FileExplorerState& state) {
        if (state.pending_navigation_path.empty()) return;

        std::string path = state.pending_navigation_path;
        const bool notify_shared_refresh = state.pending_shared_refresh_path == path;
        printf("Explorer: Detected pending navigation to: %s\n", path.c_str());
        state.pending_navigation_path.clear();
        if (notify_shared_refresh) {
            state.pending_shared_refresh_path.clear();
        }
        navigate_to_path(path);
        (void)notify_shared_refresh;
    }

    void FileExplorerPanel::update_navigation_history(FileExplorerState& state,
                                                      const std::string& target_path,
                                                      bool update_history) {
        if (!update_history) return;

        std::string current_path_str(state.current_path);
        if (!current_path_str.empty() && !path_utils::same_history_path(current_path_str, target_path)) {
            state.back_history.push(current_path_str);
            while (!state.forward_history.empty()) {
                state.forward_history.pop();
            }
        }
    }

    void FileExplorerPanel::set_active_path(FileExplorerState& state, const std::string& path) {
        strncpy(state.current_path, path.c_str(), sizeof(state.current_path) - 1);
        state.current_path[sizeof(state.current_path) - 1] = '\0';
        strncpy(state.search_path, path.c_str(), sizeof(state.search_path) - 1);
        state.search_path[sizeof(state.search_path) - 1] = '\0';
    }

    void FileExplorerPanel::reset_selection(FileExplorerState& state) {
        state.selected_files.clear();
        state.last_selected_index = -1;
    }

    void FileExplorerPanel::update_periodic_save(FileExplorerState& state) {
        static double last_save_check = 0.0;
        const double now = ImGui::GetTime();
        if (now - last_save_check < 60.0) return;

        last_save_check = now;
        state.save_async(worker_pool_);
    }

    void FileExplorerPanel::update_periodic_watched_sync(FileExplorerState& state) {
        (void)state;
    }

    bool FileExplorerPanel::resolve_drop_destination_path(const std::string& path,
                                                          std::string& resolved_path,
                                                          std::string* error_message) const {
        resolved_path = path;
        (void)error_message;
        return true;
    }

    void FileExplorerPanel::request_manual_refresh(FileExplorerState& state) {
        const std::string current(state.current_path);
        if (current.empty()) {
            return;
        }

        navigate_to_path(current, false);
    }

    void FileExplorerPanel::toggle_chat_overlay() {
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        std::lock_guard<std::mutex> lock(state.mu);
        state.chat_overlay_open = !state.chat_overlay_open;
        state.chat_focus_input = state.chat_overlay_open;
        state.chat_resizing = false;
    }

    void FileExplorerPanel::render_chat_overlay(FileExplorerState& state,
                                                float overlay_width,
                                                float overlay_height,
                                                float min_overlay_height,
                                                float max_overlay_height,
                                                float overlay_bottom_y) {
        (void)state;
        (void)overlay_width;
        (void)overlay_height;
        (void)min_overlay_height;
        (void)max_overlay_height;
        (void)overlay_bottom_y;
    }

    void FileExplorerPanel::submit_chat_message(FileExplorerState& state) {
        (void)state;
    }

    std::string FileExplorerPanel::build_chat_context(const FileExplorerState& state) const {
        (void)state;
        return {};
    }

    void FileExplorerPanel::render_panel_contents() {
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        handle_pending_navigation(state);
        std::unique_lock<std::mutex> lock(state.mu);
        show_directory_contents(state);
        show_error_modal(state.error_msg, "FileExplorerError");

        lock.unlock();
        update_periodic_save(state);
    }

    void FileExplorerPanel::render() {
        MultiPanel::render();
    }

    void FileExplorerPanel::navigate_to_local_path_async(const std::string& path,
                                                         bool update_history,
                                                         uint64_t navigation_generation) {
        auto& state = registry_.get_state<FileExplorerState>(state_key_);

        // Local-volume scans can be slow, especially under /Volumes. Keep the
        // UI interactive and stream rows in batches instead of blocking until
        // the whole directory has been stat'ed.
        state.is_loading = true;
        state.show_loading_animation = false;
        state.error_msg  = "";
        reset_selection(state);
        state.files.clear();
        state.sort_dirty = true;

        fs::path normalized_path = fs::path(path).lexically_normal();
        std::string display_path = normalized_path.generic_string();
        if (display_path.empty()) {
            display_path = path;
        }
        strncpy(state.current_path, display_path.c_str(), sizeof(state.current_path) - 1);
        state.current_path[sizeof(state.current_path) - 1] = '\0';
        strncpy(state.search_path, display_path.c_str(), sizeof(state.search_path) - 1);
        state.search_path[sizeof(state.search_path) - 1] = '\0';

        // Snapshot volatile UI state before leaving the UI thread
        const bool show_hidden = state.show_hidden;

        // History update is fast (no I/O) — do it synchronously now so
        // back/forward buttons are correct even before the scan completes.
        update_navigation_history(state, path, update_history);

        worker_pool_.add(
            [registry = &registry_, state_key = state_key_, path, show_hidden, navigation_generation]() {
                auto& state = registry->get_state<FileExplorerState>(state_key);
                std::string new_path = path_utf8_generic_string(fs::path(path).lexically_normal());
                if (new_path.empty()) {
                    new_path = path;
                }

                constexpr std::size_t kLocalListBatchSize = 64;
                std::vector<UnifiedFileItem> batch;
                batch.reserve(kLocalListBatchSize);

                auto flush_batch = [&](bool final_flush) {
                    std::lock_guard<std::mutex> lk(state.mu);
                    if (state.navigation_generation.load(std::memory_order_relaxed) != navigation_generation) {
                        return false;
                    }
                    if (!batch.empty()) {
                        state.files.insert(state.files.end(),
                                           std::make_move_iterator(batch.begin()),
                                           std::make_move_iterator(batch.end()));
                        batch.clear();
                        state.sort_dirty = true;
                    }
                    if (final_flush) {
                        state.is_loading = false;
                        state.show_loading_animation = false;
                        state.sort_dirty = true;
                    }
                    return true;
                };

                try {
                    for (const auto& entry : fs::directory_iterator(
                             path, fs::directory_options::skip_permission_denied)) {
                        std::string fname = path_utf8_filename(entry.path());
                        if (!show_hidden && !fname.empty() && fname[0] == '.') continue;

                        UnifiedFileItem item;
                        item.path   = path_utf8_generic_string(entry.path());
                        item.id     = item.path;
                        item.name   = fname;
                        std::error_code ec;
                        item.is_dir = entry.is_directory(ec);
                        item.status = SyncStatus::LOCAL;

                        if (!item.is_dir) {
                            item.size = static_cast<int64_t>(entry.file_size(ec));
                            if (ec) {
                                ec.clear();
                                item.size = 0;
                            }
                        }
                        try {
                            auto ftime = entry.last_write_time(ec);
                            if (ec) {
                                ec.clear();
                            } else {
                            auto sctp  = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
                                ftime - fs::file_time_type::clock::now() + std::chrono::system_clock::now());
                            auto t = std::chrono::system_clock::to_time_t(sctp);
                            char buf[32];
                            std::strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M", std::localtime(&t));
                            item.last_modified = buf;
                            }
                        } catch (...) {}

                        batch.push_back(std::move(item));
                        if (batch.size() >= kLocalListBatchSize) {
                            if (!flush_batch(false)) {
                                return;
                            }
                        }
                    }
                } catch (const std::exception& e) {
                    std::lock_guard<std::mutex> lk(state.mu);
                    if (state.navigation_generation.load(std::memory_order_relaxed) != navigation_generation) {
                        return;
                    }
                    state.error_msg  = e.what();
                    state.is_loading = false;
                    state.show_loading_animation = false;
                    state.sort_dirty = true;
                    return;
                }

                (void)new_path;
                flush_batch(true);
            },
            []() {},
            [registry = &registry_, state_key = state_key_, navigation_generation](const std::string& err) {
                auto& state = registry->get_state<FileExplorerState>(state_key);
                if (state.navigation_generation.load(std::memory_order_relaxed) != navigation_generation) {
                    return;
                }
                state.error_msg  = err;
                state.is_loading = false;
                state.show_loading_animation = false;
                state.sort_dirty = true;
            }
        );
    }

    void FileExplorerPanel::navigate_to_path(const std::string& path, bool update_history, bool create_if_missing) {
        printf("Explorer: navigate_to_path called with: %s\n", path.c_str());
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        uint64_t navigation_generation = state.navigation_generation.fetch_add(1, std::memory_order_relaxed) + 1;

        // Virtual Paths Logic
        if (path.rfind("misty://", 0) == 0) {
            printf("Explorer: Handling virtual path: %s\n", path.c_str());
            std::vector<UnifiedFileItem> new_files;
            std::vector<UnifiedFileItem> new_trash_files;

            if (path == FileExplorerState::VIRTUAL_PATH_RECENT) {
                // Filter out deleted entries and local files that no longer exist on disk
                // (covers external deletions and stale entries from previous sessions).
                auto it = std::remove_if(state.recent_files.begin(), state.recent_files.end(),
                    [](const UnifiedFileItem& f) {
                        if (f.status == SyncStatus::DELETED) return true;
                        if (!fs::exists(f.path)) return true;
                        return false;
                    });
                if (it != state.recent_files.end()) {
                    state.recent_files.erase(it, state.recent_files.end());
                    state.dirty_ = true;
                }
                printf("Explorer: Loading Recent Files (count: %zu)\n", state.recent_files.size());
                new_files.assign(state.recent_files.begin(), state.recent_files.end());
            } else if (path == FileExplorerState::VIRTUAL_PATH_STARRED) {
                printf("Explorer: Loading Starred Files (count: %zu)\n", state.starred_files.size());
                new_files = state.starred_files;
            } else if (path == FileExplorerState::VIRTUAL_PATH_TRASH) {
                printf("Explorer: Loading Trash Files\n");
                // Read from disk to ensure persistence
                std::string trash_dir = std::string(std::getenv("HOME")) + "/misty/.cache/trash";
                if (fs::exists(trash_dir)) {
                    printf("Explorer: Reading trash dir: %s\n", trash_dir.c_str());
                    for (const auto& entry : fs::directory_iterator(trash_dir)) {
                        UnifiedFileItem item;
                        item.path = path_utf8_string(entry.path());
                        item.id = item.path;
                        item.name = path_utf8_filename(entry.path());
                        item.is_dir = entry.is_directory();
                        item.status = SyncStatus::DELETED;

                         try {
                            if (!item.is_dir) item.size = fs::file_size(entry.path());

                            auto ftime = fs::last_write_time(entry.path());
                            auto sctp = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
                                ftime - fs::file_time_type::clock::now() + std::chrono::system_clock::now()
                            );
                            auto time_t_val = std::chrono::system_clock::to_time_t(sctp);
                            char buf[32];
                            std::strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M", std::localtime(&time_t_val));
                            item.last_modified = buf;
                        } catch (...) {}

                        new_files.push_back(item);
                        new_trash_files.push_back(std::move(item));
                    }
                }
            }

            update_navigation_history(state, path, update_history);
            state.files = std::move(new_files);
            if (path == FileExplorerState::VIRTUAL_PATH_TRASH) {
                state.trash_files = std::move(new_trash_files);
            }
            set_active_path(state, path);
            reset_selection(state);
            state.is_loading = false;
            state.show_loading_animation = false;
            state.sort_dirty = true;
            printf("Explorer: Virtual path loaded. File count: %zu\n", state.files.size());
            return;
        }

        (void)create_if_missing;
        navigate_to_local_path_async(path, update_history, navigation_generation);

        state.dirty_ = true; // mark for next async save cycle
    }
}
