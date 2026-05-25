#include "panels/file_explorer/file_explorer_panel.h"
#include <algorithm>
#include <chrono>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <iomanip>
#include <optional>
#include <sstream>
#include <sys/stat.h>

#include "core/file_master/file_master_util.h"
#include "core/file_sync/file_sync_store.h"
#include "core/manager/asset_manager.h"
#include "core/ui/ui_animate.h"
#include "panels/file_explorer/content/file_explorer_content_util.h"
#include "panels/file_explorer/navigation/history_util.h"
#include "panels/file_explorer/state/remote_mount_state.h"
#include "panels/providers/state/providers_state.h"

namespace fs = std::filesystem;

using namespace misty::core;

namespace misty::panel {
    std::string type_label_for_item(const FileItem& file);
    std::string icon_name_for_file(const FileListing& listing, const FileItem& file);
    ImU32 grid_item_icon_color(const FileListing& listing, const FileItem& file);

    namespace {
        constexpr ImVec4 kInspectorBg = ImVec4(0.075f, 0.085f, 0.10f, 1.0f);
        constexpr ImVec4 kInspectorCardBg = ImVec4(0.105f, 0.115f, 0.135f, 0.96f);
        constexpr ImVec4 kInspectorBorder = ImVec4(0.22f, 0.25f, 0.31f, 1.0f);
        constexpr ImVec4 kInspectorMuted = ImVec4(0.58f, 0.61f, 0.68f, 1.0f);
        constexpr ImVec4 kMistyAccent = ImVec4(0.36f, 0.58f, 0.95f, 1.0f);
        constexpr float kToolbarPadX = 8.0f;
        constexpr float kToolbarPadY = 4.0f;
        constexpr float kToolbarButtonHeight = 34.0f;
        constexpr float kToolbarHeight = kToolbarButtonHeight + kToolbarPadY * 2.0f;
        constexpr float kPanePathHeaderHeight = 28.0f;

        std::string remote_sync_key(const std::string& remote_name, const std::string& remote_path) {
            return remote_name + ":" + remote_path;
        }

        std::string fit_text_with_ellipsis(const std::string& text, float max_width) {
            if (text.empty() || ImGui::CalcTextSize(text.c_str()).x <= max_width) {
                return text;
            }

            constexpr const char* kEllipsis = "...";
            const float ellipsis_width = ImGui::CalcTextSize(kEllipsis).x;
            if (ellipsis_width >= max_width) {
                return kEllipsis;
            }

            std::string clipped = text;
            while (!clipped.empty() && ImGui::CalcTextSize((clipped + kEllipsis).c_str()).x > max_width) {
                clipped.pop_back();
            }
            return clipped + kEllipsis;
        }

        void hydrate_local_sync_states(std::vector<FileItem>& items) {
            std::vector<std::string> paths;
            paths.reserve(items.size());
            for (const auto& item : items) {
                if (item.type == FileType::LOCAL && !item.path.empty()) {
                    paths.push_back(item.path);
                }
            }
            if (paths.empty()) {
                return;
            }

            core::FileSyncEntryStore store;
            const auto states = store.local_states(paths);
            for (auto& item : items) {
                if (auto it = states.find(item.path); it != states.end()) {
                    item.sync_state = it->second;
                }
            }
        }

        void hydrate_remote_sync_states(std::vector<FileItem>& items) {
            std::vector<core::FileSyncRemotePathRef> refs;
            refs.reserve(items.size());
            for (const auto& item : items) {
                if (item.type == FileType::REMOTE && !item.sync_remote_name.empty() && !item.sync_remote_path.empty()) {
                    refs.push_back({item.sync_remote_name, item.sync_remote_path});
                }
            }
            if (refs.empty()) {
                return;
            }

            core::FileSyncEntryStore store;
            const auto states = store.remote_states(refs);
            for (auto& item : items) {
                const auto it = states.find(remote_sync_key(item.sync_remote_name, item.sync_remote_path));
                if (it != states.end()) {
                    item.sync_state = it->second;
                }
            }
        }

        std::string format_bytes(std::int64_t bytes) {
            if (bytes <= 0) {
                return "-";
            }
            const char* units[] = {"B", "KB", "MB", "GB", "TB"};
            double value = static_cast<double>(bytes);
            int unit = 0;
            while (value >= 1024.0 && unit < 4) {
                value /= 1024.0;
                ++unit;
            }
            std::ostringstream out;
            if (unit == 0) {
                out << static_cast<std::int64_t>(value) << " " << units[unit];
            } else {
                out << std::fixed << std::setprecision(value >= 10.0 ? 1 : 2) << value << " " << units[unit];
            }
            return out.str();
        }

        std::uintmax_t available_space_for_path(const std::string& path) {
            if (path.empty() || path.rfind("misty://", 0) == 0) {
                return 0;
            }
            std::error_code ec;
            const auto info = fs::space(fs::path(path), ec);
            return ec ? 0 : info.available;
        }

        std::string display_name_for_path(const std::string& path) {
            if (path.empty()) {
                return "Current Folder";
            }
            const fs::path normalized = fs::path(path).lexically_normal();
            const std::string leaf = normalized.filename().string();
            if (!leaf.empty() && leaf != ".") {
                return leaf;
            }
            return normalized.root_path().empty() ? path : normalized.root_path().string();
        }

        std::string format_inspector_time(std::time_t value) {
            char buffer[64];
            if (std::strftime(buffer, sizeof(buffer), "%b %d, %Y at %I:%M %p", std::localtime(&value)) == 0) {
                return {};
            }
            std::string out(buffer);
            const std::size_t day_zero = out.find(" 0");
            if (day_zero != std::string::npos) {
                out.erase(day_zero + 1, 1);
            }
            const std::size_t hour_zero = out.find(" at 0");
            if (hour_zero != std::string::npos) {
                out.erase(hour_zero + 4, 1);
            }
            return out;
        }

        std::string format_status_time(std::chrono::system_clock::time_point value) {
            if (value.time_since_epoch().count() == 0) {
                return {};
            }
            const std::time_t raw = std::chrono::system_clock::to_time_t(value);
            std::tm local {};
#if defined(_WIN32)
            localtime_s(&local, &raw);
#else
            localtime_r(&raw, &local);
#endif
            char buffer[32];
            if (std::strftime(buffer, sizeof(buffer), "%I:%M %p", &local) == 0) {
                return {};
            }
            std::string out(buffer);
            if (!out.empty() && out.front() == '0') {
                out.erase(out.begin());
            }
            return out;
        }

        bool is_hidden_listing_item(const FileItem& item) {
            const std::string name = item.name.empty() ? fs::path(item.path).filename().string() : item.name;
            return !name.empty() && name.front() == '.';
        }

        std::string item_count_label(std::size_t count) {
            std::ostringstream out;
            out << count << (count == 1 ? " item" : " items");
            return out.str();
        }

        std::string build_directory_status_text(const FileListing& listing,
                                                const FileExplorerPanel::TransientUiState& ui,
                                                const std::string& current_path) {
            const bool is_remote = remote_browse_target_for(current_path).has_value();
            if (listing.is_loading) {
                return is_remote ? "Syncing..." : "Loading...";
            }

            std::ostringstream out;
            if (!ui.selected_files.empty()) {
                out << ui.selected_files.size() << " selected";
            } else {
                out << item_count_label(listing.files.size());
                if (ui.show_hidden) {
                    const auto hidden_count = std::count_if(listing.files.begin(), listing.files.end(), is_hidden_listing_item);
                    if (hidden_count > 0) {
                        out << " (" << hidden_count << " hidden)";
                    }
                }
            }

            const auto freshness = is_remote
                ? format_status_time(listing.last_synced_at)
                : format_status_time(listing.last_refreshed_at);
            if (!freshness.empty()) {
                out << " - Last " << (is_remote ? "synced " : "refreshed ") << freshness;
            }
            return out.str();
        }

        void render_misty_ai_status_slot(float width, float height) {
            constexpr float kIconSize = 16.0f;
            const ImVec2 cursor = ImGui::GetCursorScreenPos();
            const ImVec2 size(width, height);
            ImGui::InvisibleButton("##misty_ai_status_placeholder", size);
            const bool hovered = ImGui::IsItemHovered();

            const ImVec2 center(cursor.x + width * 0.5f, cursor.y + height * 0.5f);
            auto& icon = core::AssetManager::get().get_svg_texture_path(
                "assets/icons/cloud-24.svg",
                static_cast<int>(kIconSize * 2.0f));
            if (icon.id != 0) {
                const ImVec2 icon_min(center.x - kIconSize * 0.5f, center.y - kIconSize * 0.5f);
                const ImU32 tint = hovered ? IM_COL32(150, 176, 220, 165) : IM_COL32(118, 130, 154, 130);
                ImGui::GetWindowDrawList()->AddImage(icon.id,
                                                     icon_min,
                                                     ImVec2(icon_min.x + kIconSize, icon_min.y + kIconSize),
                                                     ImVec2(0, 0),
                                                     ImVec2(1, 1),
                                                     tint);
            }
            if (hovered) {
                ImGui::SetTooltip("Ask MistyAI about this folder");
            }
        }

        std::string modified_time_for_path(const std::string& path) {
            if (path.empty() || path.rfind("misty://", 0) == 0) {
                return {};
            }
            std::error_code ec;
            const auto ftime = fs::last_write_time(fs::path(path), ec);
            if (ec) {
                return {};
            }
            const auto sctp = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
                ftime - fs::file_time_type::clock::now() + std::chrono::system_clock::now());
            return format_inspector_time(std::chrono::system_clock::to_time_t(sctp));
        }

        std::string created_time_for_path(const std::string& path) {
            if (path.empty() || path.rfind("misty://", 0) == 0) {
                return {};
            }
            struct stat info {};
            if (stat(path.c_str(), &info) != 0) {
                return {};
            }
#if defined(__APPLE__)
            return format_inspector_time(info.st_birthtimespec.tv_sec);
#else
            return format_inspector_time(info.st_ctime);
#endif
        }

        std::string kind_label_for_item(const FileItem& item) {
            if (item.is_dir) {
                return "Folder";
            }
            std::string type = type_label_for_item(item);
            if (type.empty() || type == ".") {
                return "File";
            }
            if (type[0] == '.') {
                type.erase(type.begin());
                std::transform(type.begin(), type.end(), type.begin(), [](unsigned char ch) {
                    return static_cast<char>(std::toupper(ch));
                });
                return type + " File";
            }
            return type;
        }

        void inspector_label_value(const char* label, const std::string& value) {
            ImGui::PushStyleColor(ImGuiCol_Text, kInspectorMuted);
            ImGui::TextUnformatted(label);
            ImGui::PopStyleColor();
            ImGui::TextWrapped("%s", value.empty() ? "-" : value.c_str());
            ImGui::Spacing();
        }

        void begin_inspector_card(const char* id, float height = 0.0f) {
            ImGui::PushStyleColor(ImGuiCol_ChildBg, kInspectorCardBg);
            ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 7.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, 0.0f);
            ImGui::BeginChild(id, ImVec2(0.0f, height), false, ImGuiWindowFlags_NoScrollbar);
        }

        void end_inspector_card() {
            ImGui::EndChild();
            ImGui::PopStyleVar(2);
            ImGui::PopStyleColor();
        }

        bool inspector_action_tile(const char* id,
                                   const char* icon_name,
                                   const char* label,
                                   float width,
                                   bool enabled = true) {
            constexpr float kTileHeight = 42.0f;
            constexpr float kIconSize = 20.0f;
            constexpr float kIconLabelGap = 3.0f;
            auto& icon = core::AssetManager::get().get_svg_texture(icon_name, 20);
            ImGui::PushID(id);
            if (!enabled) {
                ImGui::BeginDisabled();
            }
            const bool pressed = ImGui::InvisibleButton("##tile", ImVec2(width, kTileHeight));
            const bool hovered = enabled && ImGui::IsItemHovered();
            if (!enabled) {
                ImGui::EndDisabled();
            }

            const ImVec2 min = ImGui::GetItemRectMin();
            const ImVec2 max = ImGui::GetItemRectMax();
            ImDrawList* dl = ImGui::GetWindowDrawList();
            if (hovered || ImGui::IsItemActive()) {
                dl->AddRectFilled(min,
                                  max,
                                  ImGui::IsItemActive() ? IM_COL32(255, 255, 255, 26)
                                                        : IM_COL32(255, 255, 255, 17),
                                  6.0f);
            }

            const ImVec2 label_size = ImGui::CalcTextSize(label);
            const float group_h = kIconSize + kIconLabelGap + label_size.y;
            const float group_y = min.y + std::max(0.0f, (kTileHeight - group_h) * 0.5f);
            const float center_x = min.x + width * 0.5f;
            const ImU32 icon_tint = enabled ? IM_COL32(222, 228, 238, 235) : IM_COL32(112, 122, 142, 170);
            const ImU32 text_tint = enabled ? IM_COL32(204, 211, 224, 235) : IM_COL32(112, 122, 142, 170);

            if (icon.id != 0) {
                const ImVec2 icon_min(center_x - kIconSize * 0.5f, group_y);
                dl->AddImage(icon.id,
                             icon_min,
                             ImVec2(icon_min.x + kIconSize, icon_min.y + kIconSize),
                             ImVec2(0, 0),
                             ImVec2(1, 1),
                             icon_tint);
            }
            dl->AddText(ImVec2(center_x - label_size.x * 0.5f, group_y + kIconSize + kIconLabelGap),
                        text_tint,
                        label);
            ImGui::PopID();
            return enabled && pressed;
        }
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
        path_bar_editing = false;
        path_bar_focus = false;
        path_bar_scroll_x = 0.0f;
        path_bar_scroll_to_end = false;
    }

    std::string FileExplorerPanel::tab_title() const {
        if (const auto* active_explorer = dynamic_cast<const FileExplorerPanel*>(active_panel())) {
            if (active_explorer != this) {
                return active_explorer->tab_title();
            }
        }
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
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        state.selected_files.clear();
    }

    const FileItem* FileExplorerPanel::primary_selected_item(const FileListing& listing) const {
        if (ui_.selected_files.size() != 1) {
            return nullptr;
        }
        const std::string& selected_id = *ui_.selected_files.begin();
        const auto it = std::find_if(listing.files.begin(), listing.files.end(), [&](const FileItem& item) {
            return item.id == selected_id;
        });
        return it == listing.files.end() ? nullptr : &*it;
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

        auto& listing = active_listing();
        const uint64_t load_generation = listing.load_generation.fetch_add(1, std::memory_order_relaxed) + 1;
        navigate_to_local_path_async(current, false, load_generation, true);
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
        std::unique_lock<std::mutex> lock(state.mu);

        const float available_h = ImGui::GetContentRegionAvail().y;
        const float status_bar_height = 30.0f;
        const float content_height = std::max(0.0f, available_h - status_bar_height - 4.0f);

        ImGui::PushStyleColor(ImGuiCol_ChildBg, kInspectorBg);
        ImGui::PushStyleColor(ImGuiCol_WindowBg, kInspectorBg);
        ImGui::PushStyleColor(ImGuiCol_TableRowBg, kInspectorBg);
        ImGui::PushStyleColor(ImGuiCol_TableRowBgAlt, kInspectorBg);
        ImGui::PushStyleColor(ImGuiCol_TableHeaderBg, kInspectorBg);
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
        const std::string status_text = build_directory_status_text(listing, ui_, state.current_path);
        if (ImGui::BeginChild("BottomStatusBar", ImVec2(0.0f, status_bar_height), false, ImGuiWindowFlags_NoScrollbar)) {
            constexpr float kStatusPadX = 10.0f;
            constexpr float kStatusPadY = 5.0f;
            constexpr float kRightActionWidth = 34.0f;
            const ImVec2 avail = ImGui::GetContentRegionAvail();
            const float zone_width = std::max(0.0f, avail.x - kStatusPadX * 2.0f);
            const float left_width = std::max(0.0f, zone_width * 0.5f);
            const float right_width = std::max(0.0f, zone_width - left_width);
            const float content_height = std::max(0.0f, avail.y - kStatusPadY * 2.0f);

            ImGui::SetCursorPos(ImVec2(kStatusPadX, kStatusPadY));
            ImGui::BeginChild("##status_left", ImVec2(left_width, content_height), false,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
            ImGui::PushStyleColor(ImGuiCol_Text, kInspectorMuted);
            ImGui::AlignTextToFramePadding();
            ImGui::TextUnformatted(status_text.c_str());
            ImGui::PopStyleColor();
            ImGui::EndChild();

            ImGui::SameLine(0.0f, 0.0f);
            ImGui::BeginChild("##status_right", ImVec2(right_width, content_height), false,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
            ImGui::SetCursorPosX(std::max(0.0f, right_width - kRightActionWidth));
            render_misty_ai_status_slot(kRightActionWidth, content_height);
            ImGui::EndChild();
        }
        ImGui::EndChild();
        ImGui::PopStyleColor(5);

        lock.unlock();
        update_periodic_save(state);
    }

    float FileExplorerPanel::pane_header_height(const Panel& panel, bool is_active, bool has_multiple_panes) const {
        (void)panel;
        (void)is_active;
        return has_multiple_panes ? kPanePathHeaderHeight : 0.0f;
    }

    void FileExplorerPanel::render_pane_header(Panel& panel, bool is_active, bool has_multiple_panes) {
        if (!has_multiple_panes) {
            return;
        }

        auto* explorer = dynamic_cast<FileExplorerPanel*>(&panel);
        if (!explorer) {
            return;
        }

        std::string current_path;
        {
            auto& state = registry_.get_state<FileExplorerState>(explorer->state_key_);
            std::lock_guard<std::mutex> lock(state.mu);
            current_path = state.current_path;
        }

        const std::string title = current_path.empty() ? "Files" : file_explorer_tab_title_for_path(current_path);
        ImGui::PushStyleColor(ImGuiCol_ChildBg,
                              is_active ? ImVec4(0.088f, 0.102f, 0.126f, 1.0f)
                                        : ImVec4(0.070f, 0.078f, 0.092f, 1.0f));
        if (ImGui::BeginChild("##explorer_pane_path_header",
                              ImVec2(0.0f, kPanePathHeaderHeight),
                              false,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
            ImDrawList* dl = ImGui::GetWindowDrawList();
            const ImVec2 min = ImGui::GetWindowPos();
            const ImVec2 max(min.x + ImGui::GetWindowWidth(), min.y + kPanePathHeaderHeight);
            const ImU32 border = is_active ? IM_COL32(76, 122, 202, 210) : IM_COL32(46, 50, 60, 180);
            const ImU32 title_col = is_active ? IM_COL32(238, 242, 249, 255) : IM_COL32(178, 185, 198, 255);
            const ImU32 path_col = is_active ? IM_COL32(154, 164, 184, 255) : IM_COL32(112, 120, 136, 255);
            dl->AddRectFilled(ImVec2(min.x, min.y), ImVec2(min.x + 3.0f, max.y),
                              is_active ? ImGui::ColorConvertFloat4ToU32(kMistyAccent) : IM_COL32(70, 76, 90, 180));
            dl->AddLine(ImVec2(min.x, max.y - 1.0f), ImVec2(max.x, max.y - 1.0f), border, 1.0f);

            constexpr float kPadX = 10.0f;
            const float text_y = min.y + (kPanePathHeaderHeight - ImGui::GetTextLineHeight()) * 0.5f;
            const float title_width = std::min(ImGui::CalcTextSize(title.c_str()).x, std::max(52.0f, ImGui::GetWindowWidth() * 0.34f));
            const std::string visible_title = fit_text_with_ellipsis(title, title_width);
            dl->AddText(ImVec2(min.x + kPadX, text_y), title_col, visible_title.c_str());

            const float path_x = min.x + kPadX + title_width + 12.0f;
            const float path_width = std::max(0.0f, max.x - path_x - kPadX);
            if (path_width > 24.0f && !current_path.empty()) {
                const std::string visible_path = fit_text_with_ellipsis(current_path, path_width);
                ImGui::PushClipRect(ImVec2(path_x, min.y), ImVec2(max.x - kPadX, max.y), true);
                dl->AddText(ImVec2(path_x, text_y), path_col, visible_path.c_str());
                ImGui::PopClipRect();
            }

            if (ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup)) {
                ImGui::SetTooltip("%s", current_path.empty() ? title.c_str() : current_path.c_str());
            }
        }
        ImGui::EndChild();
        ImGui::PopStyleColor();
    }

    void FileExplorerPanel::render() {
        MultiPanel::render();
    }

    float FileExplorerPanel::toolbar_height() const {
        return kToolbarHeight;
    }

    void FileExplorerPanel::render_active_toolbar() {
        if (auto* active_explorer = dynamic_cast<FileExplorerPanel*>(active_panel())) {
            if (active_explorer != this) {
                active_explorer->render_active_toolbar();
                return;
            }
        }

        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        auto& search_state = registry_.get_state<SearchState>(search_state_key_);
        std::unique_lock<std::mutex> lock(state.mu);

        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.075f, 0.085f, 0.10f, 1.0f));
        if (ImGui::BeginChild("TopBar", ImVec2(0.0f, kToolbarHeight), false, ImGuiWindowFlags_NoScrollbar)) {
            ImGui::SetCursorPos(ImVec2(kToolbarPadX, kToolbarPadY));
            show_command_toolbar(state, search_state);
        }
        ImGui::EndChild();
        ImGui::PopStyleColor();
    }

    void FileExplorerPanel::render_inspector() {
        if (auto* active_explorer = dynamic_cast<FileExplorerPanel*>(active_panel())) {
            if (active_explorer != this) {
                active_explorer->render_inspector();
                return;
            }
        }

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoSavedSettings;

        if (ImGuiViewport* main_viewport = ImGui::GetMainViewport()) {
            ImGui::SetNextWindowViewport(main_viewport->ID);
        }

        ImGui::PushStyleColor(ImGuiCol_WindowBg, kInspectorBg);
        ImGui::PushStyleColor(ImGuiCol_Separator, kInspectorBorder);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 18.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(8.0f, 10.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
        if (ImGui::Begin("FileInspector", nullptr, flags)) {
            render_inspector_contents();
        }
        ImGui::End();
        ImGui::PopStyleVar(3);
        ImGui::PopStyleColor(2);
    }

    void FileExplorerPanel::render_inspector_contents() {
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        auto& listing = active_listing();

        std::optional<FileItem> selected_item;
        bool multiple = false;
        std::string current_path;
        std::size_t item_count = 0;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            if (const FileItem* item = primary_selected_item(listing)) {
                selected_item = *item;
            }
            multiple = ui_.selected_files.size() > 1;
            current_path = state.current_path;
            item_count = listing.files.size();
        }
        const FileItem* selected = selected_item ? &*selected_item : nullptr;
        const std::string title = selected ? selected->name : (multiple ? "Multiple Items" : display_name_for_path(current_path));
        const std::string kind = selected ? kind_label_for_item(*selected) : (multiple ? "Selection" : "Folder");
        const std::string detail_path = selected ? selected->path : current_path;
        const std::string modified = selected && !selected->last_modified.empty()
            ? selected->last_modified
            : modified_time_for_path(detail_path);
        const std::string created = created_time_for_path(detail_path);

        const bool can_preview = selected && preview_panel_ && preview_panel_->supports(*selected);
        const float icon_size = can_preview ? 148.0f : 92.0f;
        if (selected && can_preview) {
            begin_inspector_card("##preview_panel_card", 180.0f);
            preview_panel_->render(*selected, ImGui::GetContentRegionAvail());
            end_inspector_card();
        } else {
            const float avail = ImGui::GetContentRegionAvail().x;
            auto& icon = core::AssetManager::get().get_svg_texture(
                selected ? icon_name_for_file(listing, *selected) : "file-directory-open-fill-24",
                static_cast<int>(icon_size));
            ImGui::SetCursorPosX(ImGui::GetCursorPosX() + std::max(0.0f, (avail - icon_size) * 0.5f));
            if (icon.id != 0) {
                const ImU32 tint = selected ? grid_item_icon_color(listing, *selected) : IM_COL32(230, 191, 76, 255);
                ImGui::Image(icon.id,
                             ImVec2(icon_size, icon_size),
                             ImVec2(0, 0),
                             ImVec2(1, 1),
                             ImGui::ColorConvertU32ToFloat4(tint),
                             ImVec4(0, 0, 0, 0));
            } else {
                ImGui::Dummy(ImVec2(icon_size, icon_size));
            }
        }

        ImGui::Spacing();
        const float title_w = ImGui::CalcTextSize(title.c_str()).x;
        ImGui::SetCursorPosX(ImGui::GetCursorPosX() + std::max(0.0f, (ImGui::GetContentRegionAvail().x - title_w) * 0.5f));
        ImGui::TextWrapped("%s", title.c_str());
        const float kind_w = ImGui::CalcTextSize(kind.c_str()).x;
        ImGui::PushStyleColor(ImGuiCol_Text, kInspectorMuted);
        ImGui::SetCursorPosX(ImGui::GetCursorPosX() + std::max(0.0f, (ImGui::GetContentRegionAvail().x - kind_w) * 0.5f));
        ImGui::TextUnformatted(kind.c_str());
        ImGui::PopStyleColor();

        begin_inspector_card("##inspector_actions", 62.0f);
        const float action_width = (ImGui::GetContentRegionAvail().x - 8.0f) / 2.0f;
        const float tile_y = ImGui::GetCursorPosY() + std::max(0.0f, (ImGui::GetContentRegionAvail().y - 42.0f) * 0.5f);
        ImGui::SetCursorPosY(tile_y);
        if (inspector_action_tile("open", "file-directory-24", "Open", action_width, selected != nullptr) && selected) {
            if (selected->is_dir) {
                navigate_to_path(selected->path, true, false);
            }
        }
        ImGui::SameLine(0.0f, 8.0f);
        ImGui::SetCursorPosY(tile_y);
        if (inspector_action_tile("more", "kebab-horizontal-24", "More", action_width)) {
            ui_.context_menu_target_path = selected ? selected->path : "";
            if (selected) {
                open_context_menu(state, ui_);
            } else {
                open_background_context_menu(state, ui_);
            }
        }
        end_inspector_card();

        begin_inspector_card("##inspector_details", 0.0f);
        ImGui::TextUnformatted("Details");
        ImGui::Separator();
        if (selected) {
            inspector_label_value("Path", selected->path);
            inspector_label_value("Modified", modified);
            inspector_label_value("Created", created);
            inspector_label_value("Size", selected->is_dir ? "-" : format_bytes(selected->size));
            inspector_label_value("Kind", kind);
        } else {
            inspector_label_value("Path", current_path);
            inspector_label_value("Modified", modified);
            inspector_label_value("Created", created);
            inspector_label_value("Items", std::to_string(item_count));
            inspector_label_value("Available", current_path.empty() ? "-" : format_bytes(static_cast<std::int64_t>(available_space_for_path(current_path))));
        }
        ImGui::Spacing();
        ImGui::TextUnformatted("Tags");
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.11f, 0.14f, 0.20f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.16f, 0.21f, 0.30f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Text, kMistyAccent);
        ImGui::Button("+ Add Tag", ImVec2(92.0f, 28.0f));
        ImGui::PopStyleColor(3);
        end_inspector_card();
    }

    void FileExplorerPanel::navigate_to_local_path_async(const std::string& path,
                                                         bool update_history,
                                                         uint64_t load_generation,
                                                         bool force_remote_refresh) {
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        auto& listing = active_listing();
        const auto remote_target = remote_browse_target_for(path);
        const bool is_remote_listing = remote_target.has_value();
        bool use_cached_remote_listing = false;
        if (remote_target.has_value() && !force_remote_refresh) {
            std::vector<FileMasterListItem> cached_items;
            use_cached_remote_listing = load_cached_remote_path(remote_list_props_for(*remote_target), cached_items);
        }
        const auto now = std::chrono::steady_clock::now();
        const auto minimum_animation_duration = std::chrono::duration_cast<std::chrono::steady_clock::duration>(
            std::chrono::duration<float>(misty::UI::MistyLoadingAnimationLoopSeconds()));

        // Local-volume scans can be slow, especially under /Volumes. Keep the
        // UI interactive and stream rows in batches instead of blocking until
        // the whole directory has been stat'ed.
        listing.is_loading = true;
        if (is_remote_listing && !use_cached_remote_listing) {
            listing.loading.begin(load_generation, now, minimum_animation_duration);
        } else {
            listing.loading.cancel();
        }
        ui_.error_msg  = "";
        ui_.clear_transient();
        state.selected_files.clear();
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
             is_remote_listing,
             use_cached_remote_listing,
             force_remote_refresh]() {
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
                        const auto status_time = std::chrono::system_clock::now();
                        if (!is_remote_listing) {
                            listing.last_refreshed_at = status_time;
                        }
                        if (is_remote_listing && !use_cached_remote_listing) {
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
                    const FileMasterProps remote_props = remote_list_props_for(*remote_target);
                    if (!force_remote_refresh &&
                        load_cached_remote_path(remote_props, remote_items)) {
                        {
                            std::error_code ec;
                            fs::create_directories(path, ec);
                        }
                        batch = remote_mount_items_for(*remote_target, remote_items);
                        hydrate_remote_sync_states(batch);
                        if (auto cached_time = cached_remote_path_time(remote_props)) {
                            std::lock_guard<std::mutex> lk(state.mu);
                            if (listing.load_generation.load(std::memory_order_relaxed) != load_generation) {
                                return;
                            }
                            listing.last_synced_at = *cached_time;
                        }
                        flush_batch(true);
                        return;
                    }

                    FileMasterResult remote_result = list_remote_path(remote_props, remote_items);
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

                    {
                        std::error_code ec;
                        fs::create_directories(path, ec);
                    }
                    batch = remote_mount_items_for(*remote_target, remote_items);
                    hydrate_remote_sync_states(batch);
                    const auto fetched_time = cached_remote_path_time(remote_props).value_or(std::chrono::system_clock::now());
                    {
                        std::lock_guard<std::mutex> lk(state.mu);
                        if (listing.load_generation.load(std::memory_order_relaxed) != load_generation) {
                            return;
                        }
                        listing.last_synced_at = fetched_time;
                    }

                    flush_batch(true);
                    return;
                }

                try {
                    for (const auto& entry : fs::directory_iterator(
                             path, fs::directory_options::skip_permission_denied)) {
                        if (should_skip_local_entry(entry, show_hidden)) continue;
                        batch.push_back(make_local_file_item(entry));
                        if (batch.size() >= kLocalListBatchSize) {
                            hydrate_local_sync_states(batch);
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

                hydrate_local_sync_states(batch);
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
            listing.last_refreshed_at = std::chrono::system_clock::now();
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
