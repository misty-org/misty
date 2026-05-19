#include "panels/file_explorer/file_explorer_panel.h"
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>

#include "core/file_master/file_master_util.h"
#include "core/ui/ui_animate.h"
#include "panels/file_explorer/content/file_explorer_content_util.h"
#include "panels/file_explorer/state/remote_mount_state.h"
#include "panels/providers/state/providers_state.h"

namespace fs = std::filesystem;

using namespace misty::core;

namespace misty::panel {
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
        props.owns_state_cleanup = true;

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
        if (!state.chat_overlay_open) {
            state.chat_input_buffer[0] = '\0';
            state.chat_messages.clear();
            state.chat_error_msg.clear();
        }
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
        auto& search_state = registry_.get_state<SearchState>(search_state_key_);
        handle_pending_navigation(state);
        std::unique_lock<std::mutex> lock(state.mu);

        if (ImGui::BeginChild("TopBar", ImVec2(0.0f, 42.0f), false, ImGuiWindowFlags_NoScrollbar)) {
            ImGui::SetCursorPosY(6.0f);
            show_nav_history(state, 30.0f, 8.0f);
            ImGui::SameLine(0.0f, 8.0f);
            ImGui::SetCursorPosY(6.0f);
            show_search_bar(state, search_state);
        }
        ImGui::EndChild();

        ImGui::Separator();

        const float available_h = ImGui::GetContentRegionAvail().y;
        const float breadcrumb_bar_height = 26.0f;
        const float content_height = std::max(0.0f, available_h - breadcrumb_bar_height - 4.0f);

        if (ImGui::BeginChild("##explorer_content_region", ImVec2(0.0f, content_height), false,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
            ImGui::PushStyleVar(ImGuiStyleVar_ScrollbarSize, 8.0f);
            if (ImGui::BeginChild("##explorer_list", ImVec2(0.0f, ImGui::GetContentRegionAvail().y), false,
                                  ImGuiWindowFlags_NoScrollWithMouse)) {
                ImGuiIO& io = ImGui::GetIO();
                if (ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup) && io.MouseWheel != 0.0f) {
                    constexpr float kExplorerWheelStep = 22.0f;
                    ImGui::SetScrollY(ImGui::GetScrollY() - io.MouseWheel * kExplorerWheelStep);
                }

                ImVec2 list_start = ImGui::GetCursorPos();
                float list_height = ImGui::GetContentRegionAvail().y;

                show_directory_contents(state);
                show_error_modal(state.error_msg, "FileExplorerError");
                ImGui::SetCursorPos(list_start);
                if (search_panel_) {
                    search_panel_->render(state.current_path, list_height);
                }
            }
            ImGui::EndChild();
            ImGui::PopStyleVar();
        }
        ImGui::EndChild();

        ImGui::Separator();
        if (ImGui::BeginChild("BottomBreadcrumbBar", ImVec2(0.0f, breadcrumb_bar_height), false, ImGuiWindowFlags_NoScrollbar)) {
            show_breadcrumb_bar(state);
        }
        ImGui::EndChild();

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
        const bool is_remote_listing = remote_browse_target_for(path).has_value();
        const auto now = std::chrono::steady_clock::now();
        const auto minimum_animation_duration = std::chrono::duration_cast<std::chrono::steady_clock::duration>(
            std::chrono::duration<float>(misty::UI::MistyLoadingAnimationLoopSeconds()));

        // Local-volume scans can be slow, especially under /Volumes. Keep the
        // UI interactive and stream rows in batches instead of blocking until
        // the whole directory has been stat'ed.
        state.is_loading = true;
        if (is_remote_listing) {
            state.begin_loading_animation_cycle(navigation_generation, now, minimum_animation_duration);
        } else {
            state.cancel_loading_animation_cycle();
        }
        state.error_msg  = "";
        state.clear_transient_ui_state();
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
            [registry = &registry_,
             state_key = state_key_,
             path,
             show_hidden,
             navigation_generation,
             is_remote_listing]() {
                auto& state = registry->get_state<FileExplorerState>(state_key);
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
                        if (is_remote_listing) {
                            state.complete_loading_animation_cycle(
                                navigation_generation,
                                std::chrono::steady_clock::now());
                        } else {
                            state.cancel_loading_animation_cycle();
                        }
                        state.sort_dirty = true;
                        state.note_listing_changed();
                    }
                    return true;
                };

                if (is_provider_mount_root(path)) {
                    const fs::path relative = fs::path(path).lexically_relative(mount_utils::get_mount_root());
                    const std::string provider_folder = relative.filename().string();
                    const auto cards = registry->get_state<ProvidersState>("Providers").provider_cards_snapshot();
                    batch = provider_mount_items_for(provider_folder, cards);

                    flush_batch(true);
                    return;
                }

                if (auto remote_target = remote_browse_target_for(path); remote_target.has_value()) {
                    std::vector<FileMasterListItem> remote_items;
                    FileMasterResult remote_result = list_remote_path(remote_list_props_for(*remote_target), remote_items);
                    if (!remote_result.success) {
                        std::lock_guard<std::mutex> lk(state.mu);
                        if (state.navigation_generation.load(std::memory_order_relaxed) != navigation_generation) {
                            return;
                        }
                        state.error_msg = remote_result.error_message;
                        state.is_loading = false;
                        state.complete_loading_animation_cycle(
                            navigation_generation,
                            std::chrono::steady_clock::now());
                        state.sort_dirty = true;
                        state.note_listing_changed();
                        return;
                    }

                    batch = remote_mount_items_for(*remote_target, remote_items);

                    flush_batch(true);
                    return;
                }

                try {
                    for (const auto& entry : fs::directory_iterator(
                             path, fs::directory_options::skip_permission_denied)) {
                        if (should_skip_local_entry(entry, show_hidden)) continue;
                        batch.push_back(make_local_file_item(entry));
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
                    state.cancel_loading_animation_cycle();
                    state.sort_dirty = true;
                    state.note_listing_changed();
                    return;
                }

                flush_batch(true);
            },
            []() {},
            [registry = &registry_,
             state_key = state_key_,
             navigation_generation,
             is_remote_listing](const std::string& err) {
                auto& state = registry->get_state<FileExplorerState>(state_key);
                if (state.navigation_generation.load(std::memory_order_relaxed) != navigation_generation) {
                    return;
                }
                state.error_msg  = err;
                state.is_loading = false;
                if (is_remote_listing) {
                    state.complete_loading_animation_cycle(
                        navigation_generation,
                        std::chrono::steady_clock::now());
                } else {
                    state.cancel_loading_animation_cycle();
                }
                state.sort_dirty = true;
                state.note_listing_changed();
            }
        );
    }

    void FileExplorerPanel::navigate_to_path(const std::string& path, bool update_history, bool create_if_missing) {
        printf("Explorer: navigate_to_path called with: %s\n", path.c_str());
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        uint64_t navigation_generation = state.navigation_generation.fetch_add(1, std::memory_order_relaxed) + 1;

        // Virtual Paths Logic
        VirtualListingResult virtual_listing;
        if (populate_virtual_listing(state, path, virtual_listing)) {
            printf("Explorer: Handling virtual path: %s\n", path.c_str());
            update_navigation_history(state, path, update_history);
            state.files = std::move(virtual_listing.files);
            if (path == FileExplorerState::VIRTUAL_PATH_TRASH) {
                state.trash_files = std::move(virtual_listing.trash_files);
            }
            set_active_path(state, path);
            reset_selection(state);
            state.is_loading = false;
            state.cancel_loading_animation_cycle();
            state.sort_dirty = true;
            state.note_listing_changed();
            printf("Explorer: Virtual path loaded. File count: %zu\n", state.files.size());
            return;
        }

        (void)create_if_missing;
        navigate_to_local_path_async(path, update_history, navigation_generation);

        state.dirty_ = true; // mark for next async save cycle
    }
}
