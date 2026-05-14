#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/search/search_state.h"
#include "panels/search/search_panel.h"
#include "panels/transfers/transfer_window_state.h"
#include "core/manager/asset_manager.h"
#include <glad/glad.h>
#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>

#include "stb_image.h"


namespace fs = std::filesystem;

using namespace misty::core;

namespace misty::panel {

    namespace {
        constexpr const char* kPreviewPaneChildId = "##file_preview_panel";
        constexpr float kPreviewMinWidth = 280.0f;
        constexpr float kPreviewZoomStep = 0.1f;
        constexpr float kPreviewZoomMin = 0.1f;
        constexpr float kPreviewZoomMax = 3.0f;
        constexpr float kPreviewSplitterWidth = 8.0f;

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

        float clamp_preview_zoom(float zoom) {
            return std::clamp(zoom, kPreviewZoomMin, kPreviewZoomMax);
        }
    } // namespace

    FileExplorerPanel::~FileExplorerPanel() {
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

        auto& file_explorer_state = registry_.get_state<FileExplorerState>(state_key_);

        // Load persistent state (Recent, Starred)
        if (restore_persistent_state) {
            file_explorer_state.load_state();
        }

        std::string start_path = path_utils::get_mount_root();

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

        // Create directory if it doesn't exist.
        if (!start_path.empty()) {
            std::error_code ec;
            fs::create_directories(start_path, ec);
        }

        // Set as pending navigation - will be processed in render()
        file_explorer_state.pending_navigation_path = start_path;
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

    void FileExplorerPanel::update_periodic_save(FileExplorerState& state) {
        static double last_save_check = 0.0;
        double now = ImGui::GetTime();
        if (now - last_save_check < 60.0) return;

        last_save_check = now;
        state.save_async(worker_pool_);
    }

    void FileExplorerPanel::update_periodic_watched_sync(FileExplorerState& state) {
        (void)state;
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
        state.current_dir_watched = false;
        state.sync_watch_request_in_flight = false;
        state.watched_refresh_in_flight = false;
        state.next_watched_refresh_at = {};
    }

    void FileExplorerPanel::reset_selection(FileExplorerState& state) {
        state.selected_files.clear();
        state.last_selected_index = -1;
    }

    bool FileExplorerPanel::resolve_drop_destination_path(const std::string& path,
                                                          std::string& resolved_path,
                                                          std::string* error_message) const {
        resolved_path = path;
        (void)error_message;
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

        navigate_to_path(current, false);
        notify_shared_path_refresh(current);
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

    void FileExplorerPanel::render() {
        const bool transfer_modal_open =
            registry_.get_state<TransferWindowState>(kTransferWindowStateKey).is_open();

        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        handle_pending_navigation(state);

        ImGuiWindowFlags file_explorer_flags = ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoScrollWithMouse |
            ImGuiWindowFlags_NoSavedSettings;

        auto& search_state = registry_.get_state<SearchState>(search_state_key_);

        if (ImGuiViewport* main_viewport = ImGui::GetMainViewport()) {
            ImGui::SetNextWindowViewport(main_viewport->ID);
        }

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.12f, 0.12f, 0.13f, 1.0f));

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

            if (ImGui::BeginChild("##explorer_content_region", ImVec2(0.0f, content_height), false,
                                  ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
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
                if (ImGui::BeginChild("##explorer_list", ImVec2(list_width, content_avail.y), false,
                                      ImGuiWindowFlags_NoScrollWithMouse)) {
                    ImGuiIO& io = ImGui::GetIO();
                    if (ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup) && io.MouseWheel != 0.0f) {
                        constexpr float kExplorerWheelStep = 22.0f;
                        ImGui::SetScrollY(ImGui::GetScrollY() - io.MouseWheel * kExplorerWheelStep);
                    }

                    // Save window-relative position of the list area before rendering it.
                    // We'll reuse this to position the overlay child on top.
                    ImVec2 list_start = ImGui::GetCursorPos();
                    ImVec2 list_screen_min = ImGui::GetCursorScreenPos();
                    ImVec2 list_region_size = ImGui::GetContentRegionAvail();
                    float list_height = ImGui::GetContentRegionAvail().y;

                    show_directory_contents(state);
                    show_error_modal(state.error_msg, "FileExplorerError");
                    ImGui::SetCursorPos(list_start);
                    if (search_panel_) {
                        search_panel_->render(state.current_path, list_height);
                    }

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

                    const bool splitter_hovered = !transfer_modal_open && ImGui::IsItemHovered();
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
                        if (transfer_modal_open) {
                            preview_pane_resizing_ = false;
                        } else if (!ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
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
                    !transfer_modal_open &&
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

        // Local-volume scans can be slow, especially under /Volumes. Keep the
        // UI interactive and stream rows in batches instead of blocking until
        // the whole directory has been stat'ed.
        state.is_loading = true;
        state.show_loading_animation = false;
        state.error_msg  = "";
        reset_selection(state);
        state.files.clear();
        state.sort_dirty = true;
        state.current_dir_watched = false;
        state.sync_watch_request_in_flight = false;
        state.watched_refresh_in_flight = false;
        state.next_watched_refresh_at = {};

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
                        item.source = FileSource::LOCAL;
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
                        item.path = path_utf8_string(entry.path());
                        item.id = item.path;
                        item.name = path_utf8_filename(entry.path());
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

        (void)create_if_missing;
        navigate_to_local_path_async(path, update_history, navigation_generation);

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

    bool FileExplorerPanel::toggle_preview_pane() {
        preview_pane_open_ = !preview_pane_open_;
        if (!preview_pane_open_) {
            preview_pane_resizing_ = false;
        }
        return true;
    }

    bool FileExplorerPanel::ensure_preview_pane_open() {
        if (!preview_pane_open_) {
            preview_pane_open_ = true;
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

}
