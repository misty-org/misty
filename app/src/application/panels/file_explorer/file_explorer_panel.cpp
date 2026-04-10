#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/workspace/workspace_state.h"
#include "panels/services/services_state.h"
#include "panels/services/remote/remote_state.h"
#include "panels/activity/download_state.h"
#include "panels/activity/upload_state.h"
#include "panels/notification/notification_state.h"
#include "panels/file_sidebar/file_sidebar_state.h"
#include "panels/search/search_state.h"
#include "panels/search/search_panel.h"
#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"
#include <nlohmann/json.hpp>
#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <unordered_set>


namespace fs = std::filesystem;

using namespace misty::core;

namespace misty::panel {

    namespace {
        std::string trim_copy(std::string value) {
            auto not_space = [](unsigned char c) { return !std::isspace(c); };
            value.erase(value.begin(), std::find_if(value.begin(), value.end(), not_space));
            value.erase(std::find_if(value.rbegin(), value.rend(), not_space).base(), value.end());
            return value;
        }

        std::string sanitize_remote_folder_name(const std::string& preferred, const std::string& fallback) {
            std::string name = trim_copy(preferred);
            if (name.empty()) name = fallback;

            for (char& c : name) {
                switch (c) {
                    case '<':
                    case '>':
                    case ':':
                    case '"':
                    case '/':
                    case '\\':
                    case '|':
                    case '?':
                    case '*':
                        c = '-';
                        break;
                    default:
                        break;
                }
            }

            name = trim_copy(name);
            return name.empty() ? fallback : name;
        }
    } // namespace

    FileExplorerPanel::FileExplorerPanel(UIRegistry& registry, WorkerPool& worker_pool, std::shared_ptr<MistyClient> client)
        : registry_(registry), worker_pool_(worker_pool), client_(std::move(client)) {

        auto& workspace_state = registry_.get_state<WorkspaceState>("Workspace");
        auto& file_explorer_state = registry_.get_state<FileExplorerState>("Files");

        // Ensure mount directories exist (~/misty/mnt and ~/misty/mnt/OneDrive)
        workspace_state.ensure_directories();

        // Load persistent state (Recent, Starred)
        file_explorer_state.load_state();

        // Initialize services state with worker pool
        auto& services_state = registry_.get_state<ServicesState>("Services");
        services_state.init(worker_pool_);

        // Sync remote account mappings
        sync_account_mappings();

        // Fetch workspaces if not already done
        if (!workspace_state.has_fetched) {
            workspace_state.fetch_workspaces_async(worker_pool_);
        }

        // Use workspace mount path if available, otherwise fall back to client mount path
        std::string start_path = workspace_state.get_current_mount_path();
        if (start_path.empty() && client_) {
            start_path = client_->GetClientMountPath();
        }

        // Restore last opened path if valid
        if (!file_explorer_state.last_opened_path.empty()) {
            std::string saved_path = file_explorer_state.last_opened_path;
            
            printf("DEBUG: Constructor - Found last_opened_path: %s\n", saved_path.c_str());

            bool is_valid = true;
            
            // Check if it's a virtual path
            if (saved_path.rfind("misty://", 0) == 0) {
                 // Always valid
            } else if (path_utils::is_remote_path(saved_path)) {
                 // Assume valid for remote paths (will show error or reconnect if not)
            } else {
                 // Check local existence
                 if (!fs::exists(saved_path) || !fs::is_directory(saved_path)) {
                     is_valid = false;
                 }
            }
            
            if (is_valid) {
                start_path = saved_path;
                printf("DEBUG: Constructor - Using saved path: %s\n", start_path.c_str());
            } else {
                printf("DEBUG: Constructor - Saved path was invalid\n");
            }
        } else {
             printf("DEBUG: Constructor - No last_opened_path found\n");
        }

        initial_start_path_ = start_path;

        // Create directory if it doesn't exist. Skip remote paths — those
        // are managed by sync_account_mappings() under the provider folder
        // layout (~/misty/mnt/<Provider>/<remote_name>/), and a stale
        // last_opened_path from the pre-migration layout would otherwise
        // recreate a phantom ~/misty/mnt/<remote_name>/ directory here.
        if (!start_path.empty() && !path_utils::is_remote_path(start_path)) {
            std::error_code ec;
            fs::create_directories(start_path, ec);
        }

        // Set as pending navigation - will be processed in render()
        file_explorer_state.pending_navigation_path = start_path;
    }

    void FileExplorerPanel::apply_workspace_mount_if_ready(FileExplorerState& state, WorkspaceState& workspace_state) {
        if (workspace_mount_applied_) return;
        if (!workspace_state.has_fetched || workspace_state.is_fetching) return;

        std::string workspace_path = workspace_state.get_current_mount_path();
        if (workspace_path.empty()) {
            workspace_mount_applied_ = true;
            return;
        }

        printf("DEBUG: render - workspace_path=%s, last_opened_path=%s, initial_start_path_=%s\n",
            workspace_path.c_str(), state.last_opened_path.c_str(), initial_start_path_.c_str());

        if (!state.last_opened_path.empty() && initial_start_path_ == state.last_opened_path) {
            workspace_mount_applied_ = true;
            return;
        }

        std::string current_path = state.current_path;
        bool no_history = state.back_history.empty() && state.forward_history.empty();
        bool is_at_initial = current_path.empty() || current_path == initial_start_path_;
        if (no_history && is_at_initial && state.pending_navigation_path.empty()) {
            state.pending_navigation_path = workspace_path;
        }

        workspace_mount_applied_ = true;
    }

    void FileExplorerPanel::handle_pending_navigation(FileExplorerState& state) {
        if (state.pending_navigation_path.empty()) return;

        std::string path = state.pending_navigation_path;
        printf("Explorer: Detected pending navigation to: %s\n", path.c_str());
        state.pending_navigation_path.clear();
        navigate_to_path(path);
    }

    void FileExplorerPanel::render_search_overlay(SearchState& search_state, const ImVec2& list_start, float list_height) {
        if (!search_state.is_open) return;

        float overlay_h = std::min(350.0f, list_height);
        ImGui::SetCursorPos(list_start);
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.14f, 0.14f, 0.14f, 0.97f));
        if (ImGui::BeginChild("##search_overlay", {0, overlay_h}, false, ImGuiWindowFlags_NoScrollbar)) {
            bool has_results = false;
            {
                std::lock_guard<std::mutex> lk(search_state.mu);
                has_results = !search_state.cache_results.empty() || !search_state.api_results.empty();
            }

            int pending = search_state.pending_api_tasks.load();
            if (has_results) {
                if (pending > 0) {
                    float t = static_cast<float>(ImGui::GetTime());
                    const char* frames[] = { "|", "/", "-", "\\" };
                    ImGui::TextDisabled("Searching... %s", frames[static_cast<int>(t * 8.0f) % 4]);
                }
                if (search_panel_) search_panel_->render_results(search_state);
            } else if (!search_state.last_submitted_query.empty()) {
                if (pending > 0) {
                    float t = static_cast<float>(ImGui::GetTime());
                    const char* frames[] = { "|", "/", "-", "\\" };
                    ImGui::TextDisabled("Searching... %s", frames[static_cast<int>(t * 8.0f) % 4]);
                } else {
                    ImGui::TextDisabled("No files found");
                }
            }
        }
        ImGui::EndChild();
        ImGui::PopStyleColor();
    }

    void FileExplorerPanel::process_deferred_search_actions(SearchState& search_state) {
        if (search_state.pending_submit && search_panel_) {
            search_state.pending_submit = false;
            std::string q(search_state.query_buf);
            if (q.size() >= 2) search_panel_->submit_search(q);
        }

        if (search_state.pending_navigate_index < 0 || !search_panel_) return;

        int idx = search_state.pending_navigate_index;
        search_state.pending_navigate_index = -1;
        std::lock_guard<std::mutex> lk(search_state.mu);
        std::vector<const SearchResult*> all;
        for (auto& r : search_state.cache_results) all.push_back(&r);
        for (auto& r : search_state.api_results) all.push_back(&r);
        if (idx < static_cast<int>(all.size())) {
            search_panel_->navigate_to_result(*all[idx]);
            search_state.is_open = false;
        }
    }

    void FileExplorerPanel::update_periodic_save(FileExplorerState& state) {
        static double last_save_check = 0.0;
        double now = ImGui::GetTime();
        if (now - last_save_check < 60.0) return;

        last_save_check = now;
        state.save_async(worker_pool_);
    }

    void FileExplorerPanel::update_navigation_history(FileExplorerState& state,
                                                      const std::string& target_path,
                                                      bool update_history) {
        if (!update_history) return;

        std::string current_path_str(state.current_path);
        if (!current_path_str.empty() && current_path_str != target_path) {
            state.back_history.push(current_path_str);
        }
        while (!state.forward_history.empty()) {
            state.forward_history.pop();
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

    // No-op placeholder - RemoteState upload context is managed in navigate_to_remote
    // and automatically cleared when navigating to local paths

    void FileExplorerPanel::render() {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& workspace_state = registry_.get_state<WorkspaceState>("Workspace");
        auto& services_state = registry_.get_state<ServicesState>("Services");
        apply_workspace_mount_if_ready(state, workspace_state);

        // If services connections changed (new remote added, one disconnected),
        // resync mappings + materialize provider/remote mount directories now,
        // so the user doesn't have to navigate before the new layout appears.
        if (services_state.mappings_dirty.exchange(false)) {
            sync_account_mappings();
        }

        handle_pending_navigation(state);

        ImGuiWindowFlags file_explorer_flags = ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoResize;

        auto& search_state = registry_.get_state<SearchState>("Search");

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

        if (ImGui::Begin("File Explorer", nullptr, file_explorer_flags)) {
            std::unique_lock<std::mutex> lock(state.mu);

            // TopBar
            if (ImGui::BeginChild("TopBar", ImVec2(0, 50), false, ImGuiWindowFlags_NoScrollbar)) {
                ImGui::SetCursorPosY(8.0f);
                show_nav_history(state, 30.0f, 8.0f);
                ImGui::SameLine(0, 8.0f);
                ImGui::SetCursorPosY(7.0f);
                show_search_bar(state);
            }
            ImGui::EndChild();

            ImGui::Separator();
            if (search_state.is_open) {
                show_inline_search(state, search_state);  // input bar only; no locks inside
            }

            // Save window-relative position of the list area before rendering it.
            // We'll reuse this to position the overlay child on top.
            ImVec2 list_start   = ImGui::GetCursorPos();
            float  list_height  = ImGui::GetContentRegionAvail().y;

            show_directory_contents(state);
            show_error_modal(state.error_msg, "FileExplorerError");
            render_search_overlay(search_state, list_start, list_height);

            lock.unlock();
            process_deferred_search_actions(search_state);
            update_periodic_save(state);
        }
        ImGui::End();
        ImGui::PopStyleColor();
    }

    void FileExplorerPanel::navigate_to_local_path_async(const std::string& path,
                                                         bool update_history,
                                                         uint64_t navigation_generation) {
        auto& state = registry_.get_state<FileExplorerState>("Files");

        // Immediately signal loading — UI stays responsive while worker scans
        state.is_loading = true;
        state.show_loading_animation = false;
        state.error_msg  = "";

        // Snapshot volatile UI state before leaving the UI thread
        const bool show_hidden = state.show_hidden;

        // History update is fast (no I/O) — do it synchronously now so
        // back/forward buttons are correct even before the scan completes.
        update_navigation_history(state, path, update_history);

        worker_pool_.add(
            [this, &state, path, show_hidden, navigation_generation]() {
                std::vector<UnifiedFileItem> new_files;
                std::string new_path;

                try {
                    new_path = fs::canonical(fs::path(path)).generic_string();
                } catch (...) {
                    new_path = path;
                }

                try {
                    for (const auto& entry : fs::directory_iterator(path)) {
                        std::string fname = entry.path().filename().generic_string();
                        if (!show_hidden && !fname.empty() && fname[0] == '.') continue;

                        UnifiedFileItem item;
                        item.path   = entry.path().generic_string();
                        item.name   = fname;
                        item.is_dir = entry.is_directory();
                        item.source = FileSource::LOCAL;
                        item.status = SyncStatus::LOCAL;

                        if (!item.is_dir) {
                            try { item.size = fs::file_size(entry.path()); } catch (...) {}
                        }
                        try {
                            auto ftime = fs::last_write_time(entry.path());
                            auto sctp  = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
                                ftime - fs::file_time_type::clock::now() + std::chrono::system_clock::now());
                            auto t = std::chrono::system_clock::to_time_t(sctp);
                            char buf[32];
                            std::strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M", std::localtime(&t));
                            item.last_modified = buf;
                        } catch (...) {}

                        new_files.push_back(std::move(item));
                    }
                } catch (const std::exception& e) {
                    std::lock_guard<std::mutex> lk(state.mu);
                    if (state.navigation_generation.load(std::memory_order_relaxed) != navigation_generation) {
                        return;
                    }
                    state.error_msg  = e.what();
                    state.is_loading = false;
                    state.show_loading_animation = false;
                    return;
                }

                // Apply results under lock
                std::lock_guard<std::mutex> lk(state.mu);
                if (state.navigation_generation.load(std::memory_order_relaxed) != navigation_generation) {
                    return;
                }
                state.files = std::move(new_files);
                set_active_path(state, new_path);
                reset_selection(state);
                state.is_loading = false;
                state.show_loading_animation = false;
            },
            []() {},
            [&state, navigation_generation](const std::string& err) {
                if (state.navigation_generation.load(std::memory_order_relaxed) != navigation_generation) {
                    return;
                }
                state.error_msg  = err;
                state.is_loading = false;
                state.show_loading_animation = false;
            }
        );
    }

    void FileExplorerPanel::navigate_to_path(const std::string& path, bool update_history, bool create_if_missing) {
        printf("Explorer: navigate_to_path called with: %s\n", path.c_str());
        auto& state = registry_.get_state<FileExplorerState>("Files");
        uint64_t navigation_generation = state.navigation_generation.fetch_add(1, std::memory_order_relaxed) + 1;

        // Virtual Paths Logic
        if (path.rfind("misty://", 0) == 0) {
            printf("Explorer: Handling virtual path: %s\n", path.c_str());
            state.is_loading = true;
            state.show_loading_animation = false;
            state.files.clear();
            
            if (path == FileExplorerState::VIRTUAL_PATH_RECENT) {
                // Filter out deleted entries and local files that no longer exist on disk
                // (covers external deletions and stale entries from previous sessions).
                auto it = std::remove_if(state.recent_files.begin(), state.recent_files.end(),
                    [](const UnifiedFileItem& f) {
                        if (f.status == SyncStatus::DELETED) return true;
                        if (f.source == FileSource::LOCAL && !fs::exists(f.path)) return true;
                        return false;
                    });
                if (it != state.recent_files.end()) {
                    state.recent_files.erase(it, state.recent_files.end());
                    state.dirty_ = true;
                }
                printf("Explorer: Loading Recent Files (count: %zu)\n", state.recent_files.size());
                state.files.assign(state.recent_files.begin(), state.recent_files.end());
            } else if (path == FileExplorerState::VIRTUAL_PATH_STARRED) {
                printf("Explorer: Loading Starred Files (count: %zu)\n", state.starred_files.size());
                state.files = state.starred_files;
            } else if (path == FileExplorerState::VIRTUAL_PATH_TRASH) {
                printf("Explorer: Loading Trash Files\n");
                // Read from disk to ensure persistence
                state.files.clear();
                state.trash_files.clear(); // Re-sync cache
                
                std::string trash_dir = std::string(std::getenv("HOME")) + "/misty/.cache/trash";
                if (fs::exists(trash_dir)) {
                    printf("Explorer: Reading trash dir: %s\n", trash_dir.c_str());
                    for (const auto& entry : fs::directory_iterator(trash_dir)) {
                        UnifiedFileItem item;
                        item.path = entry.path().string();
                        item.name = entry.path().filename().string();
                        item.is_dir = entry.is_directory();
                        item.source = FileSource::LOCAL; // It's local now
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

                        state.files.push_back(item);
                        state.trash_files.push_back(item);
                    }
                }
            }
            
            update_navigation_history(state, path, update_history);
            set_active_path(state, path);
            reset_selection(state);
            state.is_loading = false;
            state.show_loading_animation = false;
            printf("Explorer: Virtual path loaded. File count: %zu\n", state.files.size());
            return;
        }

        if (path_utils::is_remote_path(path)) {
            auto info = path_utils::parse_remote_path(path);

            if (info.provider_folder.empty()) {
                // At mount root - show all provider folders
                navigate_to_remote_mount_root(update_history);
            } else if (info.remote_name.empty()) {
                // At provider folder - show remotes of this type
                navigate_to_provider_folder(info.provider_folder, update_history);
            } else {
                // Navigate into specific remote
                navigate_to_remote(info.remote_name, info.relative_path, update_history, create_if_missing, navigation_generation);
            }
        } else if (path == path_utils::get_mount_root() || path == path_utils::get_mount_root() + "/") {
            // At mount root itself
            navigate_to_remote_mount_root(update_history);
        } else {
            // Local path - clear remote upload context and notification tracking
            auto& remote_state = registry_.get_state<RemoteState>("Remote");
            remote_state.clear_upload_context();
            state.last_disconnected_notification_folder.clear();
            navigate_to_local_path_async(path, update_history, navigation_generation);
        }
        
        state.dirty_ = true; // mark for next async save cycle
    }

    void FileExplorerPanel::sync_account_mappings() {
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");
        auto& services = registry_.get_state<ServicesState>("Services");

        workspace.ensure_directories();

        std::unordered_map<std::string, std::string> old_folder_names;
        for (const auto& mapping : workspace.remote_mappings) {
            old_folder_names[mapping.remote_name] = mapping.folder_name;
        }

        std::lock_guard<std::mutex> svc_lock(services.mu);

        workspace.remote_mappings.clear();
        std::unordered_set<std::string> used_folder_names;
        for (const auto& conn : services.connections) {
            if (!conn.connected) continue;

            RemoteAccountMapping mapping;
            mapping.folder_name = sanitize_remote_folder_name(conn.alias, conn.name);
            if (!used_folder_names.insert(mapping.folder_name).second) {
                std::string base = mapping.folder_name;
                int suffix = 2;
                while (!used_folder_names.insert(base + " (" + std::to_string(suffix) + ")").second) {
                    ++suffix;
                }
                mapping.folder_name = base + " (" + std::to_string(suffix) + ")";
            }
            mapping.remote_name = conn.name;
            mapping.remote_type = conn.type;
            mapping.display_name = conn.display_name;
            mapping.provider_folder = conn.display_name;  // "OneDrive", "Google Drive", etc.

            mount_utils::ensure_provider_directory(mapping.provider_folder);
            auto old_it = old_folder_names.find(mapping.remote_name);
            if (old_it != old_folder_names.end() && old_it->second != mapping.folder_name) {
                fs::path old_path = fs::path(mount_utils::get_mount_root()) / mapping.provider_folder / old_it->second;
                fs::path new_path = fs::path(mount_utils::get_mount_root()) / mapping.provider_folder / mapping.folder_name;
                std::error_code ec;
                if (fs::exists(old_path, ec) && !fs::exists(new_path, ec)) {
                    fs::rename(old_path, new_path, ec);
                }
            }
            mount_utils::ensure_remote_directory(mapping.provider_folder, mapping.folder_name);

            workspace.remote_mappings.push_back(mapping);
        }
    }

}
