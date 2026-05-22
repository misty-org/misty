#include "panels/file_explorer/file_explorer_panel.h"
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>

#include "core/file_master/file_master_util.h"
#include "core/ui/ui_animate.h"
#include "panels/file_explorer/content/file_explorer_content_util.h"
#include "panels/file_explorer/navigation/history_util.h"
#include "panels/file_explorer/state/remote_mount_state.h"
#include "panels/providers/state/providers_state.h"

namespace fs = std::filesystem;

using namespace misty::core;

namespace misty::panel {
    namespace {
        constexpr float kExplorerLeftInset = 8.0f;
    }

    void FileExplorerPanel::TransientUiState::clear_transient() {
        selected_files.clear();
        last_selected_index = -1;
        error_msg.clear();
        context_menu_target_path.clear();
        rename_target_path.clear();
        show_rename_modal = false;
        rename_buffer[0] = '\0';
        show_new_entry_modal = false;
        new_entry_is_dir = false;
        new_entry_name_buffer[0] = '\0';
        show_permission_delete_modal = false;
        permission_delete_permanent = false;
        permission_delete_paths.clear();
        show_permanent_delete_modal = false;
        permanent_delete_paths.clear();
        chat_overlay_open = false;
        chat_request_in_flight = false;
        chat_focus_input = false;
        chat_resizing = false;
        chat_resize_just_finished = false;
        chat_overlay_height = 0.0f;
        chat_input_buffer[0] = '\0';
        chat_messages.clear();
        chat_error_msg.clear();
    }

    std::string FileExplorerPanel::tab_title() const {
        const auto& state = registry_.get_state<FileExplorerState>(state_key_);
        if (state.current_path[0] != '\0') {
            return file_explorer_tab_title_for_path(state.current_path);
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
            }
        } else {
            const auto& state = registry_.get_state<FileExplorerState>(state_key_);
            if (state.current_path[0] != '\0') {
                initial_path = state.current_path;
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

    FileListingsState& FileExplorerPanel::file_listings_state() {
        return registry_.get_state<FileListingsState>(kFileListingsStateKey);
    }

    FileListing& FileExplorerPanel::active_listing() {
        return listing_for_key(state_key_);
    }

    FileListing& FileExplorerPanel::listing_for_key(const std::string& state_key) {
        return file_listings_state().get_or_create(state_key);
    }

    LibraryState& FileExplorerPanel::library_state() {
        return registry_.get_state<LibraryState>(kLibraryStateKey);
    }

    void FileExplorerPanel::drop_selected_items_to_path(const std::string& source_state_key,
                                                        const std::string& dest_path,
                                                        ClipboardOp op) {
        auto& source_state = registry_.get_state<FileExplorerState>(source_state_key);
        auto& source_listing = registry_.get_state<FileListingsState>(kFileListingsStateKey).get_or_create(source_state_key);
        if (source_state_key != state_key_) {
            return;
        }
        std::vector<FileItem> items;
        items.reserve(ui_.selected_files.size());
        for (const auto& selected_id : ui_.selected_files) {
            auto it = std::find_if(source_listing.files.begin(), source_listing.files.end(),
                                   [&](const FileItem& candidate) { return candidate.id == selected_id; });
            if (it != source_listing.files.end()) {
                items.push_back(*it);
            }
        }

        if (items.empty()) {
            return;
        }

        auto& active_state = registry_.get_state<FileExplorerState>(active_explorer_state_key());
        perform_drop_items(active_state, items, dest_path, op);
    }


    void FileExplorerPanel::update_navigation_history(FileExplorerState& state,
                                                      const std::string& target_path,
                                                      bool update_history) {
        if (!update_history) return;

        std::string current_path_str(state.current_path);
        if (!current_path_str.empty() && !same_history_path(current_path_str, target_path)) {
            push_history_path(state.back_history, current_path_str);
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

    void FileExplorerPanel::reset_selection(TransientUiState& ui) {
        ui.selected_files.clear();
        ui.last_selected_index = -1;
    }

    void FileExplorerPanel::update_periodic_save(FileExplorerState& state) {
        static double last_save_check = 0.0;
        const double now = ImGui::GetTime();
        if (now - last_save_check < 60.0) return;

        last_save_check = now;
        auto& library = library_state();
        {
            std::lock_guard<std::mutex> lock(library.mu);
            library.last_opened_path = state.current_path;
            library.dirty = true;
        }
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
        std::lock_guard<std::mutex> lock(ui_.mu);
        ui_.chat_overlay_open = !ui_.chat_overlay_open;
        ui_.chat_focus_input = ui_.chat_overlay_open;
        ui_.chat_resizing = false;
        if (!ui_.chat_overlay_open) {
            ui_.chat_input_buffer[0] = '\0';
            ui_.chat_messages.clear();
            ui_.chat_error_msg.clear();
        }
    }

    void FileExplorerPanel::render_chat_overlay(TransientUiState& ui,
                                                float overlay_width,
                                                float overlay_height,
                                                float min_overlay_height,
                                                float max_overlay_height,
                                                float overlay_bottom_y) {
        (void)ui;
        (void)overlay_width;
        (void)overlay_height;
        (void)min_overlay_height;
        (void)max_overlay_height;
        (void)overlay_bottom_y;
    }

    void FileExplorerPanel::submit_chat_message(TransientUiState& ui) {
        (void)ui;
    }

    std::string FileExplorerPanel::build_chat_context(const TransientUiState& ui) const {
        (void)ui;
        return {};
    }

    void FileExplorerPanel::render_panel_contents() {
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        auto& listing = active_listing();
        auto& search_state = registry_.get_state<SearchState>(search_state_key_);
        std::unique_lock<std::mutex> lock(state.mu);

        if (ImGui::BeginChild("TopBar", ImVec2(0.0f, 42.0f), false, ImGuiWindowFlags_NoScrollbar)) {
            ImGui::SetCursorPosX(ImGui::GetCursorPosX() + kExplorerLeftInset);
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

                show_directory_contents(state, listing, ui_);
                show_error_modal(ui_.error_msg, "FileExplorerError");
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
                                                         uint64_t load_generation) {
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        auto& listing = active_listing();
        const bool is_remote_listing = remote_browse_target_for(path).has_value();
        const auto now = std::chrono::steady_clock::now();
        const auto minimum_animation_duration = std::chrono::duration_cast<std::chrono::steady_clock::duration>(
            std::chrono::duration<float>(misty::UI::MistyLoadingAnimationLoopSeconds()));

        // Local-volume scans can be slow, especially under /Volumes. Keep the
        // UI interactive and stream rows in batches instead of blocking until
        // the whole directory has been stat'ed.
        listing.is_loading = true;
        if (is_remote_listing) {
            listing.loading.begin(load_generation, now, minimum_animation_duration);
        } else {
            listing.loading.cancel();
        }
        ui_.error_msg  = "";
        ui_.clear_transient();
        listing.files.clear();
        listing.sort_dirty = true;

        fs::path normalized_path = fs::path(path).lexically_normal();
        std::string display_path = normalized_path.generic_string();
        if (display_path.empty()) {
            display_path = path;
        }
        // History update is fast (no I/O) — do it synchronously now so
        // back/forward buttons are correct even before the scan completes.
        update_navigation_history(state, display_path, update_history);

        strncpy(state.current_path, display_path.c_str(), sizeof(state.current_path) - 1);
        state.current_path[sizeof(state.current_path) - 1] = '\0';
        strncpy(state.search_path, display_path.c_str(), sizeof(state.search_path) - 1);
        state.search_path[sizeof(state.search_path) - 1] = '\0';

        // Snapshot volatile UI state before leaving the UI thread
        const bool show_hidden = ui_.show_hidden;

        worker_pool_.add(
            [registry = &registry_,
             state_key = state_key_,
             ui = &ui_,
             path,
             show_hidden,
             load_generation,
             is_remote_listing]() {
                auto& state = registry->get_state<FileExplorerState>(state_key);
                auto& listing = registry->get_state<FileListingsState>(kFileListingsStateKey).get_or_create(state_key);
                constexpr std::size_t kLocalListBatchSize = 64;
                std::vector<FileItem> batch;
                batch.reserve(kLocalListBatchSize);

                auto flush_batch = [&](bool final_flush) {
                    std::lock_guard<std::mutex> lk(state.mu);
                    if (listing.load_generation.load(std::memory_order_relaxed) != load_generation) {
                        return false;
                    }
                    if (!batch.empty()) {
                        listing.files.insert(listing.files.end(),
                                           std::make_move_iterator(batch.begin()),
                                           std::make_move_iterator(batch.end()));
                        batch.clear();
                        listing.sort_dirty = true;
                    }
                    if (final_flush) {
                        listing.is_loading = false;
                        if (is_remote_listing) {
                            listing.loading.complete(
                                load_generation,
                                std::chrono::steady_clock::now());
                        } else {
                            listing.loading.cancel();
                        }
                        listing.sort_dirty = true;
                        listing.note_listing_changed();
                    }
                    return true;
                };

                if (is_provider_mount_root(path)) {
                    const fs::path relative = fs::path(path).lexically_relative(get_mount_root());
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
                        if (listing.load_generation.load(std::memory_order_relaxed) != load_generation) {
                            return;
                        }
                        ui->error_msg = remote_result.error_message;
                        listing.is_loading = false;
                        listing.loading.complete(
                            load_generation,
                            std::chrono::steady_clock::now());
                        listing.sort_dirty = true;
                        listing.note_listing_changed();
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
                    if (listing.load_generation.load(std::memory_order_relaxed) != load_generation) {
                        return;
                    }
                    ui->error_msg  = e.what();
                    listing.is_loading = false;
                    listing.loading.cancel();
                    listing.sort_dirty = true;
                    listing.note_listing_changed();
                    return;
                }

                flush_batch(true);
            },
            []() {},
            [registry = &registry_,
             state_key = state_key_,
             ui = &ui_,
             load_generation,
             is_remote_listing](const std::string& err) {
                auto& state = registry->get_state<FileExplorerState>(state_key);
                auto& listing = registry->get_state<FileListingsState>(kFileListingsStateKey).get_or_create(state_key);
                if (listing.load_generation.load(std::memory_order_relaxed) != load_generation) {
                    return;
                }
                ui->error_msg  = err;
                listing.is_loading = false;
                if (is_remote_listing) {
                    listing.loading.complete(
                        load_generation,
                        std::chrono::steady_clock::now());
                } else {
                    listing.loading.cancel();
                }
                listing.sort_dirty = true;
                listing.note_listing_changed();
            }
        );
    }

    void FileExplorerPanel::navigate_to_path(const std::string& path, bool update_history, bool create_if_missing) {
        printf("Explorer: navigate_to_path called with: %s\n", path.c_str());
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        auto& listing = active_listing();
        auto& library = library_state();
        uint64_t load_generation = listing.load_generation.fetch_add(1, std::memory_order_relaxed) + 1;

        // Virtual Paths Logic
        VirtualListingResult virtual_listing;
        if (populate_virtual_listing(library, path, virtual_listing)) {
            printf("Explorer: Handling virtual path: %s\n", path.c_str());
            update_navigation_history(state, path, update_history);
            listing.files = std::move(virtual_listing.files);
            if (path == FileExplorerState::VIRTUAL_PATH_TRASH) {
                listing.trash_files = std::move(virtual_listing.trash_files);
            }
            set_active_path(state, path);
            reset_selection(ui_);
            listing.is_loading = false;
            listing.loading.cancel();
            listing.sort_dirty = true;
            listing.note_listing_changed();
            {
                std::lock_guard<std::mutex> lock(library.mu);
                library.last_opened_path = path;
                library.dirty = true;
            }
            printf("Explorer: Virtual path loaded. File count: %zu\n", listing.files.size());
            return;
        }

        (void)create_if_missing;
        navigate_to_local_path_async(path, update_history, load_generation);

        {
            std::lock_guard<std::mutex> lock(library.mu);
            library.last_opened_path = path;
            library.dirty = true;
        }
    }
}
