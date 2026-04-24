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
#include "core/extensions/extension_manager.h"
#include <glad/glad.h>
#include <nlohmann/json.hpp>
#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <unordered_set>

#include "stb_image.h"


namespace fs = std::filesystem;

using namespace misty::core;

namespace misty::panel {

    namespace {
        constexpr const char* kPreviewPaneChildId = "##file_preview_panel";
        constexpr float kPreviewMinWidth = 280.0f;
        constexpr float kPreviewFixedWidth = 360.0f;
        constexpr float kPreviewZoomStep = 0.1f;
        constexpr float kPreviewZoomMin = 0.1f;
        constexpr float kPreviewZoomMax = 3.0f;
        constexpr float kPreviewSplitterWidth = 8.0f;
        std::string trim_copy(std::string value) {
            auto not_space = [](unsigned char c) { return !std::isspace(c); };
            value.erase(value.begin(), std::find_if(value.begin(), value.end(), not_space));
            value.erase(std::find_if(value.rbegin(), value.rend(), not_space).base(), value.end());
            return value;
        }

        bool str_iequal(const char* a, const char* b) {
            for (; *a && *b; ++a, ++b) {
                if (std::tolower(static_cast<unsigned char>(*a)) !=
                    std::tolower(static_cast<unsigned char>(*b))) {
                    return false;
                }
            }
            return *a == *b;
        }

        enum class PreviewFormat { Unknown, Image, Pdf };

        PreviewFormat detect_preview_format(const char* path) {
            const char* dot = std::strrchr(path, '.');
            if (!dot) return PreviewFormat::Unknown;

            const char* ext = dot + 1;
            if (str_iequal(ext, "png") || str_iequal(ext, "jpg") ||
                str_iequal(ext, "jpeg") || str_iequal(ext, "bmp") ||
                str_iequal(ext, "gif") || str_iequal(ext, "psd") ||
                str_iequal(ext, "tga") || str_iequal(ext, "hdr") ||
                str_iequal(ext, "pic") || str_iequal(ext, "pnm") ||
                str_iequal(ext, "pgm") || str_iequal(ext, "ppm")) {
                return PreviewFormat::Image;
            }
            if (str_iequal(ext, "pdf")) {
                return PreviewFormat::Pdf;
            }
            return PreviewFormat::Unknown;
        }

        const char* filename_from_path(const char* path) {
            const char* slash = std::strrchr(path, '/');
#ifdef _WIN32
            const char* bslash = std::strrchr(path, '\\');
            if (bslash && (!slash || bslash > slash)) slash = bslash;
#endif
            return slash ? slash + 1 : path;
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

        float clamp_preview_zoom(float zoom) {
            return std::clamp(zoom, kPreviewZoomMin, kPreviewZoomMax);
        }
    } // namespace

    FileExplorerPanel::~FileExplorerPanel() {
        auto& services_state = registry_.get_state<ServicesState>("Services");
        services_state.register_dirty_indicator_callback(state_key_, {});
        clear_preview_texture();
    }

    FileExplorerPanel::FileExplorerPanel(UIRegistry& registry,
                                         WorkerPool& worker_pool,
                                         std::shared_ptr<MistyClient> client,
                                         std::string state_key,
                                         std::string search_state_key,
                                         std::string panel_id,
                                         bool restore_persistent_state,
                                         std::string initial_path_override)
        : registry_(registry),
          worker_pool_(worker_pool),
          client_(std::move(client)),
          state_key_(std::move(state_key)),
          search_state_key_(std::move(search_state_key)),
          window_name_("File Explorer##" + panel_id) {

        auto& workspace_state = registry_.get_state<WorkspaceState>("Workspace");
        auto& file_explorer_state = registry_.get_state<FileExplorerState>(state_key_);

        // Ensure mount directories exist (~/misty/mnt and ~/misty/mnt/OneDrive)
        workspace_state.ensure_directories();

        // Load persistent state (Recent, Starred)
        if (restore_persistent_state) {
            file_explorer_state.load_state();
        }

        // Initialize services state with worker pool
        auto& services_state = registry_.get_state<ServicesState>("Services");
        services_state.init(worker_pool_);
        services_state.register_dirty_indicator_callback(
            state_key_,
            [registry = &registry_, state_key = state_key_](const std::string& remote_name,
                                                            const std::string& rel_path,
                                                            bool local_exists,
                                                            bool is_dir,
                                                            const std::string& mtime,
                                                            int64_t size) {
                std::vector<std::string> acceptable_remote_names{remote_name};
                {
                    auto& workspace = registry->get_state<WorkspaceState>("Workspace");
                    for (const auto& mapping : workspace.remote_mappings) {
                        if (mapping.remote_name != remote_name) {
                            continue;
                        }
                        if (!mapping.folder_name.empty()) {
                            acceptable_remote_names.push_back(mapping.folder_name);
                        }
                    }
                }

                const std::string parent_rel_path = [&rel_path]() {
                    std::string parent = fs::path(rel_path).parent_path().string();
                    return parent == "." ? std::string() : parent;
                }();

                registry->update_state<FileExplorerState>(state_key, [&](FileExplorerState& state) {
                    const auto info = path_utils::parse_remote_path(state.current_path);
                    if (info.provider_folder.empty() || info.remote_name.empty()) {
                        return;
                    }
                    const bool remote_matches = std::find(acceptable_remote_names.begin(),
                                                          acceptable_remote_names.end(),
                                                          info.remote_name) != acceptable_remote_names.end();
                    if (!remote_matches || info.relative_path != parent_rel_path) {
                        return;
                    }

                    for (auto& file : state.files) {
                        if (file.source != FileSource::REMOTE || file.remote_path != rel_path) {
                            continue;
                        }

                        file.sync_dirty = true;
                        file.sync_direction = "push";
                        file.state_code = "MOD";
                        file.status = SyncStatus::MODIFIED;
                        if (local_exists) {
                            if (!is_dir && size >= 0) {
                                file.size = size;
                            }
                            if (!mtime.empty() && mtime.size() >= 16) {
                                file.last_modified = mtime.substr(0, 10) + " " + mtime.substr(11, 5);
                            }
                        }
                        break;
                    }
                });
            });

        // Sync remote account mappings
        sync_account_mappings();

        // Extension discovery is cheap and lets the explorer surface matching
        // actions immediately on first render.
        core::ExtensionManager::get().reload();

        // Fetch workspaces if not already done
        if (!workspace_state.has_fetched) {
            workspace_state.fetch_workspaces_async(worker_pool_);
        }

        // Use workspace mount path if available, otherwise fall back to client mount path
        std::string start_path = workspace_state.get_current_mount_path();
        if (start_path.empty() && client_) {
            start_path = client_->GetClientMountPath();
        }

        if (!initial_path_override.empty()) {
            start_path = std::move(initial_path_override);
        } else if (restore_persistent_state && !file_explorer_state.last_opened_path.empty()) {
        // Restore last opened path if valid
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
        } else if (restore_persistent_state) {
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
        const bool notify_shared_refresh = state.pending_shared_refresh_path == path;
        printf("Explorer: Detected pending navigation to: %s\n", path.c_str());
        state.pending_navigation_path.clear();
        if (notify_shared_refresh) {
            state.pending_shared_refresh_path.clear();
        }
        navigate_to_path(path);
        if (notify_shared_refresh) {
            notify_shared_path_refresh(path);
        }
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
            if ((!q.empty() && q[0] == ':' && q.size() > 1) || q.size() >= 2) {
                search_panel_->submit_search(q);
            }
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

    void FileExplorerPanel::update_periodic_watched_sync(FileExplorerState& state) {
        using namespace std::chrono_literals;

        if (!state.current_dir_watched ||
            state.watched_refresh_in_flight ||
            state.sync_request_in_flight ||
            state.sync_watch_request_in_flight ||
            state.is_loading) {
            return;
        }

        const std::string current(state.current_path);
        if (current.empty() || !path_utils::is_remote_path(current)) {
            return;
        }

        const auto now = std::chrono::steady_clock::now();
        if (state.next_watched_refresh_at.time_since_epoch().count() != 0 &&
            now < state.next_watched_refresh_at) {
            return;
        }

        std::string remote_name;
        std::string remote_path;
        if (!resolve_remote_path_context(current, remote_name, remote_path) || remote_name.empty()) {
            state.next_watched_refresh_at = now + 5s;
            return;
        }

        state.watched_refresh_in_flight = true;
        state.next_watched_refresh_at = now + 5s;
        const uint64_t navigation_generation = state.navigation_generation.load(std::memory_order_relaxed);

        auto& services = registry_.get_state<ServicesState>("Services");
        services.fetch_sync_items(
            remote_name, remote_path,
            [registry = &registry_, state_key = state_key_, remote_name, current, navigation_generation]
            (bool success, const std::string& body, const std::string& error) {
                auto& state = registry->get_state<FileExplorerState>(state_key);
                {
                    std::lock_guard<std::mutex> lock(state.mu);
                    if (state.navigation_generation.load(std::memory_order_relaxed) != navigation_generation ||
                        std::string(state.current_path) != current) {
                        return;
                    }
                    state.watched_refresh_in_flight = false;
                }

                if (!success) {
                    return;
                }
                FileExplorerPanel::apply_remote_folder_fetch(
                    *registry, state_key, remote_name, current, navigation_generation, true, body, error, true);
            });
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
        state.current_dir_watched = false;
        state.sync_watch_request_in_flight = false;
        state.watched_refresh_in_flight = false;
        state.next_watched_refresh_at = {};
    }

    void FileExplorerPanel::reset_selection(FileExplorerState& state) {
        state.selected_files.clear();
        state.last_selected_index = -1;
    }

    bool FileExplorerPanel::resolve_remote_path_context(const std::string& path,
                                                        std::string& remote_name,
                                                        std::string& remote_path) const {
        remote_name.clear();
        remote_path.clear();

        const auto info = path_utils::parse_remote_path(path);
        if (info.provider_folder.empty() || info.remote_name.empty()) {
            return false;
        }

        remote_path = info.relative_path;
        remote_name = info.remote_name;

        const auto& workspace = registry_.get_state<WorkspaceState>("Workspace");
        for (const auto& mapping : workspace.remote_mappings) {
            if (mapping.provider_folder == info.provider_folder &&
                (mapping.folder_name == info.remote_name || mapping.remote_name == info.remote_name)) {
                remote_name = mapping.remote_name;
                return true;
            }
        }

        return true;
    }

    void FileExplorerPanel::notify_shared_path_refresh(const std::string& path) {
        if (!shared_path_refresh_callback_ || path.empty()) {
            return;
        }
        shared_path_refresh_callback_(path);
    }

    void FileExplorerPanel::request_manual_refresh(FileExplorerState& state) {
        std::string current(state.current_path);
        if (current.empty()) {
            return;
        }

        if (state.sync_request_in_flight) {
            return;
        }

        if (!path_utils::is_remote_path(current)) {
            navigate_to_path(current, false);
            notify_shared_path_refresh(current);
            return;
        }

        std::string remote_name;
        std::string remote_path;
        if (!resolve_remote_path_context(current, remote_name, remote_path) || remote_name.empty()) {
            navigate_to_path(current, false);
            notify_shared_path_refresh(current);
            return;
        }

        state.sync_request_in_flight = true;
        const uint64_t request_generation = ++state.sync_request_generation;
        auto& services = registry_.get_state<ServicesState>("Services");
        services.refetch_sync_items(remote_name, remote_path,
            [registry = &registry_, state_key = state_key_, current, request_generation]
            (bool success, const std::string&, const std::string& error) {
                auto& state = registry->get_state<FileExplorerState>(state_key);
                std::lock_guard<std::mutex> lock(state.mu);
                if (request_generation != state.sync_request_generation) {
                    return;
                }

                state.sync_request_in_flight = false;

                const std::string effective_path = !state.pending_navigation_path.empty()
                    ? state.pending_navigation_path
                    : std::string(state.current_path);
                if (effective_path != current) {
                    return;
                }

                if (success) {
                    state.pending_navigation_path = current;
                    state.pending_shared_refresh_path = current;
                } else {
                    state.error_msg = error.empty() ? "Sync failed." : error;
                }
            });
    }

    void FileExplorerPanel::toggle_current_sync_watch(FileExplorerState& state) {
        const std::string current(state.current_path);
        if (current.empty() || state.sync_watch_request_in_flight || !path_utils::is_remote_path(current)) {
            return;
        }

        std::string remote_name;
        std::string remote_path;
        if (!resolve_remote_path_context(current, remote_name, remote_path) || remote_name.empty()) {
            return;
        }

        state.sync_watch_request_in_flight = true;
        const bool should_watch = !state.current_dir_watched;
        auto& services = registry_.get_state<ServicesState>("Services");
        auto callback = [registry = &registry_, state_key = state_key_, current, should_watch]
                        (bool success, const std::string&, const std::string& error) {
            auto& state = registry->get_state<FileExplorerState>(state_key);
            std::lock_guard<std::mutex> lock(state.mu);
            if (std::string(state.current_path) != current) {
                return;
            }
            state.sync_watch_request_in_flight = false;
            if (success) {
                state.current_dir_watched = should_watch;
            } else {
                state.error_msg = error.empty() ? "Failed to update watched sync directory." : error;
            }
        };

        if (should_watch) {
            services.watch_sync_dir(remote_name, remote_path, callback);
        } else {
            services.unwatch_sync_dir(remote_name, remote_path, callback);
        }
    }

    std::string FileExplorerPanel::selected_preview_path(FileExplorerState& state) const {
        if (state.selected_files.size() != 1) {
            return {};
        }
        return state.path_for_selection(*state.selected_files.begin());
    }

    void FileExplorerPanel::clear_preview_texture() {
        if (preview_texture_id_ != 0) {
            GLuint texture = preview_texture_id_;
            glDeleteTextures(1, &texture);
            preview_texture_id_ = 0;
        }
        preview_texture_width_ = 0;
        preview_texture_height_ = 0;
    }

    bool FileExplorerPanel::load_preview_texture(const std::string& path, std::string* error_message) {
        clear_preview_texture();

        int width = 0;
        int height = 0;
        int channels = 0;
        unsigned char* pixels = stbi_load(path.c_str(), &width, &height, &channels, 4);
        if (!pixels) {
            if (error_message) {
                const char* reason = stbi_failure_reason();
                *error_message = reason && *reason ? reason : "Failed to decode image.";
            }
            return false;
        }

        GLuint texture = 0;
        glGenTextures(1, &texture);
        if (texture == 0) {
            stbi_image_free(pixels);
            if (error_message) {
                *error_message = "Failed to create preview texture.";
            }
            return false;
        }

        glBindTexture(GL_TEXTURE_2D, texture);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0,
                     GL_RGBA, GL_UNSIGNED_BYTE, pixels);

        stbi_image_free(pixels);

        preview_texture_id_ = texture;
        preview_texture_width_ = width;
        preview_texture_height_ = height;
        preview_source_path_ = path;
        preview_zoom_ = 1.0f;
        preview_error_.clear();
        return true;
    }

    void FileExplorerPanel::render_preview_pane(const std::string& selected_path, float preview_width) {
        if (ImGui::BeginChild(kPreviewPaneChildId, ImVec2(preview_width, 0), true,
                               ImGuiWindowFlags_HorizontalScrollbar)) {
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
            if (ImGui::Button("Hide Preview")) {
                preview_pane_open_ = false;
            }
            ImGui::PopStyleVar();

            ImGui::SameLine();
            if (ImGui::Button("-", ImVec2(28.0f, 0))) {
                zoom_preview_out();
            }
            ImGui::SameLine();
            char zoom_label[32];
            std::snprintf(zoom_label, sizeof(zoom_label), "%d%%",
                          static_cast<int>(preview_zoom_ * 100.0f));
            ImGui::TextUnformatted(zoom_label);
            ImGui::SameLine();
            if (ImGui::Button("+", ImVec2(28.0f, 0))) {
                zoom_preview_in();
            }
            ImGui::SameLine();
            if (ImGui::Button("100%", ImVec2(44.0f, 0))) {
                reset_preview_zoom();
            }

            ImGui::Separator();

            if (selected_path.empty()) {
                clear_preview_texture();
                preview_source_path_.clear();
                preview_error_ = "Select a single file to preview.";
            } else if (fs::is_directory(selected_path)) {
                clear_preview_texture();
                preview_source_path_.clear();
                preview_error_ = "Folders do not have a preview.";
            } else {
                const PreviewFormat format = detect_preview_format(selected_path.c_str());
                if (format == PreviewFormat::Image) {
                    std::string error;
                    const bool needs_load =
                        preview_source_path_ != selected_path ||
                        (preview_texture_id_ == 0 && preview_error_.empty());
                    if (needs_load) {
                        preview_source_path_ = selected_path;
                        if (!load_preview_texture(selected_path, &error)) {
                            preview_error_ = error.empty() ? "Failed to load preview." : error;
                        }
                    }
                } else if (format == PreviewFormat::Pdf) {
                    clear_preview_texture();
                    preview_source_path_.clear();
                    preview_error_ = "PDF preview is not linked yet.";
                } else {
                    clear_preview_texture();
                    preview_source_path_.clear();
                    preview_error_ = "Preview supports PNG, JPG, BMP, GIF, PSD, TGA, HDR.";
                }
            }

            if (preview_texture_id_ != 0) {
                preview_error_.clear();
                const char* name = filename_from_path(preview_source_path_.c_str());
                ImGui::TextUnformatted(name);
                ImGui::Separator();

                float avail_w = ImGui::GetContentRegionAvail().x;
                float avail_h = ImGui::GetContentRegionAvail().y;
                if (avail_w > 1.0f && avail_h > 1.0f &&
                    preview_texture_width_ > 0 && preview_texture_height_ > 0) {
                    float scale = preview_zoom_;
                    float draw_w = preview_texture_width_ * scale;
                    float draw_h = preview_texture_height_ * scale;

                    ImGui::Image(
                        static_cast<ImTextureID>(static_cast<intptr_t>(preview_texture_id_)),
                        ImVec2(draw_w, draw_h));
                }
            } else {
                if (!preview_error_.empty()) {
                    ImGui::TextWrapped("%s", preview_error_.c_str());
                } else {
                    ImGui::TextDisabled("Select a file to preview.");
                }
            }
        }
        ImGui::EndChild();
    }

    // No-op placeholder - RemoteState upload context is managed in navigate_to_remote
    // and automatically cleared when navigating to local paths

    void FileExplorerPanel::render() {
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
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

        auto& search_state = registry_.get_state<SearchState>(search_state_key_);

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

        if (ImGui::Begin(window_name_.c_str(), nullptr, file_explorer_flags)) {
            std::unique_lock<std::mutex> lock(state.mu);

            // TopBar
            if (ImGui::BeginChild("TopBar", ImVec2(0, 42), false, ImGuiWindowFlags_NoScrollbar)) {
                ImGui::SetCursorPosY(6.0f);
                show_nav_history(state, 30.0f, 8.0f);
                ImGui::SameLine(0, 8.0f);
                ImGui::SetCursorPosY(6.0f);
                show_search_bar(state, search_state);
            }
            ImGui::EndChild();

            ImGui::Separator();

            const float available_h = ImGui::GetContentRegionAvail().y;
            const float breadcrumb_bar_height = 26.0f;
            const float content_height = std::max(0.0f, available_h - breadcrumb_bar_height - 4.0f);
            const float default_chat_h = std::clamp(available_h * 0.38f, 220.0f, 360.0f);
            if (state.chat_overlay_open && state.chat_overlay_height <= 0.0f) {
                state.chat_overlay_height = default_chat_h;
            }

            const float min_chat_h = 220.0f;
            const float max_chat_h = std::max(min_chat_h, available_h);
            float chat_h = state.chat_overlay_open
                ? std::clamp(state.chat_overlay_height > 0.0f ? state.chat_overlay_height : default_chat_h, min_chat_h, max_chat_h)
                : 0.0f;
            state.chat_overlay_height = chat_h;

            if (ImGui::BeginChild("##explorer_content_region", ImVec2(0.0f, content_height), false)) {
                ImVec2 content_avail = ImGui::GetContentRegionAvail();
                const bool show_preview = preview_pane_open_;
                const float max_preview_width = std::max(0.0f, content_avail.x - kPreviewSplitterWidth);
                const float min_preview_width = std::min(kPreviewMinWidth, max_preview_width);
                float preview_width = 0.0f;
                if (show_preview && max_preview_width > 0.0f) {
                    preview_width = preview_pane_resizing_
                        ? std::clamp(preview_pane_drag_start_width_ +
                                     (preview_pane_drag_start_mouse_x_ - ImGui::GetIO().MousePos.x),
                                     min_preview_width, max_preview_width)
                        : std::clamp(preview_pane_width_, min_preview_width, max_preview_width);
                }
                const float list_width = show_preview
                    ? std::max(0.0f, content_avail.x - preview_width - kPreviewSplitterWidth)
                    : content_avail.x;

                std::string preview_path = selected_preview_path(state);
                if (preview_path != preview_selected_path_) {
                    preview_selected_path_ = preview_path;
                }

                ImGui::PushStyleVar(ImGuiStyleVar_ScrollbarSize, 8.0f);
                if (ImGui::BeginChild("##explorer_list", ImVec2(list_width, content_avail.y), false)) {
                    // Save window-relative position of the list area before rendering it.
                    // We'll reuse this to position the overlay child on top.
                    ImVec2 list_start = ImGui::GetCursorPos();
                    ImVec2 list_screen_min = ImGui::GetCursorScreenPos();
                    ImVec2 list_region_size = ImGui::GetContentRegionAvail();
                    float list_height = ImGui::GetContentRegionAvail().y;

                    show_directory_contents(state);
                    show_error_modal(state.error_msg, "FileExplorerError");
                    render_search_overlay(search_state, list_start, list_height);

                    if (state.chat_overlay_open && list_region_size.x > 0.0f && list_region_size.y > 0.0f) {
                        const float overlay_top_y = list_screen_min.y + list_region_size.y - chat_h;
                        ImGui::SetCursorScreenPos(ImVec2(list_screen_min.x, overlay_top_y));
                        ImGui::InvisibleButton("##chat_overlay_blocker", ImVec2(list_region_size.x, chat_h));
                        ImGui::SetCursorScreenPos(ImVec2(list_screen_min.x, overlay_top_y));
                        render_chat_overlay(state,
                                            list_region_size.x,
                                            chat_h,
                                            min_chat_h,
                                            max_chat_h,
                                            list_screen_min.y + list_region_size.y);
                    }
                }
                ImGui::EndChild();
                ImGui::PopStyleVar();

                if (show_preview) {
                    ImGui::SameLine(0.0f, 0.0f);

                    const ImVec2 splitter_pos = ImGui::GetCursorScreenPos();
                    const ImVec2 splitter_size(kPreviewSplitterWidth, content_avail.y);
                    ImGui::InvisibleButton("##preview_splitter", splitter_size);

                    const bool splitter_hovered = ImGui::IsItemHovered();
                    if (splitter_hovered || preview_pane_resizing_) {
                        ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeEW);
                    }
                    if (splitter_hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
                        preview_pane_resizing_ = true;
                        preview_pane_drag_start_width_ = preview_width;
                        preview_pane_drag_start_mouse_x_ = ImGui::GetIO().MousePos.x;
                    }
                    if (preview_pane_resizing_) {
                        const ImGuiIO& io = ImGui::GetIO();
                        const float max_width = std::max(min_preview_width, max_preview_width);
                        const float live_width = std::clamp(preview_pane_drag_start_width_ +
                                                            (preview_pane_drag_start_mouse_x_ - io.MousePos.x),
                                                            min_preview_width, max_width);
                        if (!ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
                            preview_pane_resizing_ = false;
                            preview_pane_width_ = live_width;
                        }
                    }

                    ImDrawList* splitter_dl = ImGui::GetWindowDrawList();
                    const ImU32 splitter_color = splitter_hovered || preview_pane_resizing_
                        ? IM_COL32(180, 180, 180, 180)
                        : IM_COL32(110, 110, 110, 120);
                    splitter_dl->AddRectFilled(splitter_pos,
                                               ImVec2(splitter_pos.x + splitter_size.x, splitter_pos.y + splitter_size.y),
                                               splitter_color);

                    ImGui::SameLine(0.0f, 0.0f);
                    lock.unlock();
                    render_preview_pane(preview_path, preview_width);
                    lock.lock();
                }

                const bool can_begin_pane_drag =
                    body_drag_source_callback_ &&
                    ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup) &&
                    ImGui::IsMouseDragging(ImGuiMouseButton_Left) &&
                    !ImGui::IsAnyItemHovered() &&
                    !ImGui::IsAnyItemActive() &&
                    !preview_pane_resizing_ &&
                    !state.chat_resizing;
                if (can_begin_pane_drag) {
                    body_drag_source_callback_();
                }
            }
            ImGui::EndChild();

            ImGui::Separator();
            if (ImGui::BeginChild("BottomBreadcrumbBar", ImVec2(0.0f, breadcrumb_bar_height), false, ImGuiWindowFlags_NoScrollbar)) {
                show_breadcrumb_bar(state);
            }
            ImGui::EndChild();
            activation_requested_ = ImGui::IsWindowFocused(ImGuiFocusedFlags_RootAndChildWindows) ||
                                    (ImGui::IsWindowHovered(ImGuiHoveredFlags_RootAndChildWindows) &&
                                     ImGui::IsMouseClicked(ImGuiMouseButton_Left));

            lock.unlock();
            process_deferred_search_actions(search_state);
            update_periodic_watched_sync(state);
            update_periodic_save(state);
        }
        ImGui::End();
        ImGui::PopStyleColor();
    }

    void FileExplorerPanel::navigate_to_local_path_async(const std::string& path,
                                                         bool update_history,
                                                         uint64_t navigation_generation) {
        auto& state = registry_.get_state<FileExplorerState>(state_key_);

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
            [registry = &registry_, state_key = state_key_, path, show_hidden, navigation_generation]() {
                auto& state = registry->get_state<FileExplorerState>(state_key);
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
                        item.id     = item.path;
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
                    state.sort_dirty = true;
                    return;
                }

                // Apply results under lock
                std::lock_guard<std::mutex> lk(state.mu);
                if (state.navigation_generation.load(std::memory_order_relaxed) != navigation_generation) {
                    return;
                }
                state.files = std::move(new_files);
                strncpy(state.current_path, new_path.c_str(), sizeof(state.current_path) - 1);
                state.current_path[sizeof(state.current_path) - 1] = '\0';
                strncpy(state.search_path, new_path.c_str(), sizeof(state.search_path) - 1);
                state.search_path[sizeof(state.search_path) - 1] = '\0';
                state.current_dir_watched = false;
                state.sync_watch_request_in_flight = false;
                state.watched_refresh_in_flight = false;
                state.next_watched_refresh_at = {};
                state.selected_files.clear();
                state.last_selected_index = -1;
                state.is_loading = false;
                state.show_loading_animation = false;
                state.sort_dirty = true;
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
                        if (f.source == FileSource::LOCAL && !fs::exists(f.path)) return true;
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
                        item.path = entry.path().string();
                        item.id = item.path;
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

    bool FileExplorerPanel::consume_activation_request() {
        bool requested = activation_requested_;
        activation_requested_ = false;
        return requested;
    }

    void FileExplorerPanel::toggle_chat_overlay() {
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        std::lock_guard<std::mutex> lock(state.mu);
        state.chat_overlay_open = !state.chat_overlay_open;
        state.chat_focus_input = state.chat_overlay_open;
        state.chat_resizing = false;
        if (!state.chat_overlay_open) {
            state.chat_error_msg.clear();
        }
    }

    bool FileExplorerPanel::toggle_preview_pane() {
        preview_pane_open_ = !preview_pane_open_;
        if (!preview_pane_open_) {
            preview_pane_resizing_ = false;
        }
        return true;
    }

    bool FileExplorerPanel::zoom_preview_in() {
        preview_zoom_ = clamp_preview_zoom(preview_zoom_ + kPreviewZoomStep);
        return true;
    }

    bool FileExplorerPanel::zoom_preview_out() {
        preview_zoom_ = clamp_preview_zoom(preview_zoom_ - kPreviewZoomStep);
        return true;
    }

    bool FileExplorerPanel::reset_preview_zoom() {
        preview_zoom_ = 1.0f;
        return true;
    }

    void FileExplorerPanel::sync_account_mappings() {
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");
        auto& services = registry_.get_state<ServicesState>("Services");

        workspace.ensure_directories();

        std::unordered_map<std::string, std::string> old_folder_names;
        for (const auto& mapping : workspace.remote_mappings) {
            old_folder_names[mapping.remote_name] = mapping.folder_name;
        }

        std::vector<ServicesState::RemoteWatchInfo> watch_infos;
        {
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

            ServicesState::RemoteWatchInfo watch;
            watch.remote_name = mapping.remote_name;
            watch.mount_path = mount_utils::get_mount_root() + "/" + mapping.provider_folder + "/" + mapping.folder_name;
            watch_infos.push_back(std::move(watch));

            workspace.remote_mappings.push_back(mapping);
        }
        }

        services.reconcile_fs_watchers(watch_infos);
    }

}
