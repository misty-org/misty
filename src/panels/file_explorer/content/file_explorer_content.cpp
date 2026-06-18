#include "panels/file_explorer/file_explorer_panel.h"
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <iomanip>
#include <memory>
#include <mutex>
#include <optional>
#include <sstream>
#include <sys/stat.h>
#include <utility>

#include "core/file_master/file_master_util.h"
#include "core/file_sync/file_sync_compare.h"
#include "core/file_sync/file_sync_pair_store.h"
#include "core/file_sync/file_sync_store.h"
#include "panels/file_explorer/operations/operation_queue_state.h"
#include "core/manager/asset_manager.h"
#include "core/ui/ui_animate.h"
#include "core/ui/ui_layout.h"
#include "panels/file_explorer/content/file_explorer_content_util.h"
#include "panels/file_explorer/navigation/history_util.h"
#include "panels/file_explorer/selection/drag_and_drop.h"
#include "panels/file_explorer/state/file_sync_compare_state.h"
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
        constexpr float kToolbarRowGap = 12.0f;
        constexpr float kToolbarButtonHeight = 34.0f;
        constexpr float kToolbarHeight = kToolbarButtonHeight * 2.0f + kToolbarRowGap + kToolbarPadY * 2.0f;
        constexpr float kPanePathHeaderHeight = 28.0f;
        constexpr float kCompareStripHeight = 86.0f;
        constexpr int64_t kCompareWatchRefreshMs = 5000;

        std::string compare_state_key_for(const std::string& state_key) {
            return state_key + "_CompareSync";
        }

        int64_t epoch_ms_now() {
            return std::chrono::duration_cast<std::chrono::milliseconds>(
                       std::chrono::system_clock::now().time_since_epoch())
                .count();
        }

        FileSyncCompareState& compare_state_for(core::StateRegistry& registry, const std::string& state_key) {
            return registry.get_state<FileSyncCompareState>(compare_state_key_for(state_key));
        }

        core::FileSyncEndpoint compare_endpoint_from_path(const std::string& path) {
            core::FileSyncEndpoint endpoint;
            if (auto remote = remote_browse_target_for(path); remote.has_value()) {
                endpoint.kind = core::FileSyncEndpointKind::Remote;
                endpoint.remote_name = remote->remote_name;
                endpoint.remote_path = remote->remote_path.empty() ? "/" : remote->remote_path;
                endpoint.provider_type = remote->provider_folder;
                return endpoint;
            }
            endpoint.kind = core::FileSyncEndpointKind::Local;
            endpoint.local_path = path;
            return endpoint;
        }

        std::string compare_input_path_for_endpoint(const core::FileSyncEndpoint& endpoint) {
            if (endpoint.kind == core::FileSyncEndpointKind::Remote) {
                fs::path mount = fs::path(get_mount_root()) /
                                 endpoint.provider_type /
                                 endpoint.remote_name;
                const fs::path relative = fs::path(endpoint.remote_path).relative_path();
                if (!relative.empty() && relative != ".") {
                    mount /= relative;
                }
                return mount.lexically_normal().string();
            }
            return endpoint.local_path;
        }

        bool compare_endpoints_equal(const core::FileSyncEndpoint& lhs, const core::FileSyncEndpoint& rhs) {
            return lhs.kind == rhs.kind &&
                   lhs.local_path == rhs.local_path &&
                   lhs.remote_name == rhs.remote_name &&
                   lhs.remote_path == rhs.remote_path &&
                   lhs.provider_type == rhs.provider_type;
        }

        std::string side_summary_label(const core::FileSyncCompareSide& side) {
            auto format_compare_bytes = [](std::int64_t bytes) {
                if (bytes <= 0) {
                    return std::string("-");
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
            };
            if (!side.present) {
                return "--";
            }
            if (side.is_dir) {
                return side.last_modified.empty() ? "Folder" : "Folder • " + side.last_modified;
            }
            return format_compare_bytes(side.size) +
                   (side.last_modified.empty() ? std::string{} : " • " + side.last_modified);
        }

        FileItem compare_item_from_side(const core::FileSyncCompareSide& side, const std::string& relative_path) {
            FileItem item;
            item.is_dir = side.is_dir;
            item.size = side.size;
            item.last_modified = side.last_modified;
            item.path = side.absolute_path;
            item.id = item.path;
            item.name = fs::path(relative_path).filename().string();
            if (item.name.empty()) {
                item.name = fs::path(side.absolute_path).filename().string();
            }
            if (side.is_remote) {
                item.type = FileType::REMOTE;
                item.sync_remote_name = side.remote_name;
                item.sync_remote_path = side.remote_path;
            } else {
                item.type = FileType::LOCAL;
            }
            return item;
        }

        bool compare_rows_equal(const std::vector<core::FileSyncCompareRow>& lhs,
                                const std::vector<core::FileSyncCompareRow>& rhs) {
            if (lhs.size() != rhs.size()) {
                return false;
            }
            for (std::size_t i = 0; i < lhs.size(); ++i) {
                if (lhs[i].relative_path != rhs[i].relative_path ||
                    lhs[i].kind != rhs[i].kind ||
                    lhs[i].disposition != rhs[i].disposition ||
                    lhs[i].left.present != rhs[i].left.present ||
                    lhs[i].left.absolute_path != rhs[i].left.absolute_path ||
                    lhs[i].right.present != rhs[i].right.present ||
                    lhs[i].right.absolute_path != rhs[i].right.absolute_path) {
                    return false;
                }
            }
            return true;
        }

        std::string remote_sync_key(const std::string& remote_name, const std::string& remote_path) {
            return remote_name + ":" + remote_path;
        }

        std::string fit_tail_text_with_ellipsis(const std::string& text, float max_width) {
            if (text.empty() || ImGui::CalcTextSize(text.c_str()).x <= max_width) {
                return text;
            }

            constexpr const char* kEllipsis = "...";
            const float ellipsis_width = ImGui::CalcTextSize(kEllipsis).x;
            if (ellipsis_width >= max_width) {
                return kEllipsis;
            }

            std::string clipped = text;
            while (!clipped.empty() && ImGui::CalcTextSize((std::string(kEllipsis) + clipped).c_str()).x > max_width) {
                clipped.erase(clipped.begin());
            }
            return std::string(kEllipsis) + clipped;
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

        std::mutex& local_listing_worker_pool_mutex() {
            static std::mutex mutex;
            return mutex;
        }

        std::unique_ptr<core::WorkerPool>& local_listing_worker_pool_storage() {
            static std::unique_ptr<core::WorkerPool> pool;
            return pool;
        }

        core::WorkerPool& local_listing_worker_pool() {
            std::lock_guard<std::mutex> lock(local_listing_worker_pool_mutex());
            auto& pool = local_listing_worker_pool_storage();
            if (!pool) {
                pool = std::make_unique<core::WorkerPool>(2);
            }
            return *pool;
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

        std::string item_count_label(std::size_t count) {
            std::ostringstream out;
            out << count << (count == 1 ? " item" : " items");
            return out.str();
        }

        void store_selection_snapshot(FileExplorerState& state,
                                      const FileExplorerPanel::TransientUiState& ui,
                                      const std::string& path) {
            if (path.empty()) {
                return;
            }
            if (ui.selected_files.empty()) {
                state.selected_files_by_path.erase(path);
                state.last_selected_index_by_path.erase(path);
                return;
            }
            state.selected_files_by_path[path] = ui.selected_files;
            state.last_selected_index_by_path[path] = ui.last_selected_index;
        }

        void restore_selection_snapshot(FileExplorerState& state,
                                        FileExplorerPanel::TransientUiState& ui,
                                        const std::string& path) {
            ui.selected_files.clear();
            ui.last_selected_index = -1;
            state.selected_files.clear();
            if (path.empty()) {
                return;
            }

            const auto selected_it = state.selected_files_by_path.find(path);
            if (selected_it != state.selected_files_by_path.end()) {
                ui.selected_files = selected_it->second;
                state.selected_files = selected_it->second;
            }
            if (const auto last_it = state.last_selected_index_by_path.find(path);
                last_it != state.last_selected_index_by_path.end()) {
                ui.last_selected_index = last_it->second;
            }
        }

        std::string build_directory_status_text(const FileListing& listing,
                                                const FileExplorerPanel::TransientUiState& ui) {
            if (listing.is_loading) {
                return "Loading...";
            }

            if (!ui.selected_files.empty()) {
                std::ostringstream out;
                out << ui.selected_files.size() << (ui.selected_files.size() == 1 ? " item selected" : " items selected");
                return out.str();
            }

            const std::size_t total_count = listing.files.size() + (ui.show_hidden ? 0 : listing.hidden_item_count);
            std::string out = item_count_label(total_count);
            if (listing.hidden_item_count > 0) {
                std::ostringstream suffix;
                suffix << " (" << listing.hidden_item_count << " hidden)";
                out += suffix.str();
            }
            return out;
        }

        std::string build_directory_freshness_tooltip(const FileListing& listing,
                                                      const std::string& current_path) {
            const bool is_remote = remote_browse_target_for(current_path).has_value();
            const auto freshness = is_remote
                ? format_status_time(listing.last_synced_at)
                : format_status_time(listing.last_refreshed_at);
            if (freshness.empty()) {
                return {};
            }

            std::ostringstream out;
            out << "Last " << (is_remote ? "synced " : "fetched ") << freshness;
            return out.str();
        }

        void render_directory_info_status_slot(float width, float height, const std::string& tooltip) {
            constexpr float kIconSize = 16.0f;
            const ImVec2 cursor = ImGui::GetCursorScreenPos();
            const ImVec2 size(width, height);
            ImGui::InvisibleButton("##directory_info_status", size);
            const bool hovered = ImGui::IsItemHovered();

            const ImVec2 center(cursor.x + width * 0.5f, cursor.y + height * 0.5f);
            auto& icon = core::AssetManager::get().get_svg_texture_path(
                "assets/icons/info-circle-svgrepo-com.svg",
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
            if (hovered && !tooltip.empty()) {
                ImGui::SetTooltip("%s", tooltip.c_str());
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

    const std::string& FileExplorerPanel::compare_state_scope_key() const {
        return compare_owner_state_key_.empty() ? state_key_ : compare_owner_state_key_;
    }

    bool FileExplorerPanel::is_compare_context() const {
        return !compare_owner_state_key_.empty();
    }

    FileExplorerPanelMode FileExplorerPanel::mode() const {
        return mode_;
    }

    bool FileExplorerPanel::is_compare_mode() const {
        return mode_ == FileExplorerPanelMode::CompareSync;
    }

    bool FileExplorerPanel::compare_diff_tray_open() const {
        if (!is_compare_mode()) {
            return false;
        }
        const auto& compare_state = compare_state_for(registry_, compare_state_scope_key());
        std::lock_guard<std::mutex> lock(compare_state.mu);
        return compare_state.initialized ? compare_state.diff_tray_open : initial_compare_diff_tray_open_;
    }

    void FileExplorerPanel::set_compare_diff_tray_open(bool open) {
        auto& compare_state = compare_state_for(registry_, compare_state_scope_key());
        std::lock_guard<std::mutex> lock(compare_state.mu);
        compare_state.diff_tray_open = open;
    }

    std::int64_t FileExplorerPanel::compare_pair_id() const {
        if (!is_compare_mode()) {
            return 0;
        }
        const auto& compare_state = compare_state_for(registry_, compare_state_scope_key());
        std::lock_guard<std::mutex> lock(compare_state.mu);
        return compare_state.initialized ? compare_state.active_pair_id : initial_compare_pair_id_;
    }

    bool FileExplorerPanel::compare_watch_mode() const {
        if (!is_compare_mode()) {
            return false;
        }
        const auto& compare_state = compare_state_for(registry_, compare_state_scope_key());
        std::lock_guard<std::mutex> lock(compare_state.mu);
        return compare_state.initialized ? compare_state.watch_mode : initial_compare_watch_mode_;
    }

    std::string FileExplorerPanel::tab_title() const {
        if (is_compare_mode()) {
            return "Compare";
        }
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
        props.defer_initial_navigation = suppress_child_initial_navigation_;
        props.owns_state_cleanup = true;
        props.mode = FileExplorerPanelMode::Standard;
        props.compare_owner_state_key = is_compare_mode() ? compare_state_scope_key() : compare_owner_state_key_;

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
        panel->set_search_palette_state_provider(
            search_palette_open_provider_,
            search_palette_query_provider_,
            search_palette_open_handler_);
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

    std::vector<std::string> FileExplorerPanel::workspace_search_roots() const {
        std::vector<std::string> roots;
        std::unordered_set<std::string> seen;
        const auto add_root = [&](std::string path) {
            if (path.empty()) {
                return;
            }
            if (path.rfind("misty://", 0) != 0) {
                std::error_code ec;
                const auto normalized = fs::path(path).lexically_normal();
                if (!normalized.empty()) {
                    path = normalized.string();
                }
                if (const auto absolute = fs::absolute(path, ec); !ec) {
                    path = absolute.lexically_normal().string();
                }
            }
            if (seen.insert(path).second) {
                roots.push_back(std::move(path));
            }
        };

        for (const auto& [pane_id, pane] : panes) {
            (void)pane_id;
            const auto* tab = pane.tab_controller.current_active_tab();
            if (!tab || !tab->panel) {
                continue;
            }
            if (const auto* explorer = dynamic_cast<const FileExplorerPanel*>(tab->panel.get())) {
                const auto& state = registry_.get_state<FileExplorerState>(explorer->state_key_);
                if (state.current_path[0] != '\0') {
                    add_root(state.current_path);
                }
            }
        }

        if (roots.empty()) {
            const auto& state = registry_.get_state<FileExplorerState>(state_key_);
            if (state.current_path[0] != '\0') {
                add_root(state.current_path);
            }
        }

        return roots;
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
                                                        const std::vector<std::string>& selected_ids,
                                                        const std::string& dest_path,
                                                        ClipboardOp op) {
        if (source_state_key.empty()) {
            return;
        }
        if (!registry_.has_state(source_state_key)) {
            return;
        }

        auto& source_state = registry_.get_state<FileExplorerState>(source_state_key);
        FileListing* source_listing = registry_.get_state<FileListingsState>(kFileListingsStateKey).find(source_state_key);
        if (!source_listing) {
            return;
        }
        std::vector<std::string> ids;
        if (selected_ids.empty()) {
            ids.assign(source_state.selected_files.begin(), source_state.selected_files.end());
        } else {
            ids = selected_ids;
        }
        std::vector<FileItem> items;
        items.reserve(ids.size());
        for (const auto& selected_id : ids) {
            auto it = std::find_if(source_listing->files.begin(), source_listing->files.end(),
                                   [&](const FileItem& candidate) { return candidate.id == selected_id; });
            if (it != source_listing->files.end()) {
                items.push_back(*it);
            }
        }

        if (items.empty()) {
            return;
        }

        auto& active_state = registry_.get_state<FileExplorerState>(active_explorer_state_key());
        perform_drop_items(active_state, items, dest_path, op, source_state_key);
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
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        const std::string current_path(state.current_path);
        ui.selected_files.clear();
        ui.last_selected_index = -1;
        state.selected_files.clear();
        if (!current_path.empty()) {
            state.selected_files_by_path.erase(current_path);
            state.last_selected_index_by_path.erase(current_path);
        }
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
            if (library.last_opened_path != state.current_path) {
                library.last_opened_path = state.current_path;
                library.dirty = true;
            }
        }
    }

    void FileExplorerPanel::update_periodic_watched_sync(FileExplorerState& state) {
        const uint64_t pending_epoch = state.pending_transfer_refresh_epoch.load(std::memory_order_relaxed);
        if (pending_epoch == 0 || pending_epoch == state.handled_transfer_refresh_epoch) {
            return;
        }
        state.handled_transfer_refresh_epoch = pending_epoch;
        request_manual_refresh(state);
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

    void FileExplorerPanel::ensure_compare_state_initialized() {
        auto& compare_state = compare_state_for(registry_, compare_state_scope_key());
        std::lock_guard<std::mutex> lock(compare_state.mu);
        if (compare_state.initialized) {
            return;
        }

        std::string error;
        compare_state.saved_pairs = core::FileSyncPairStore::get().load_all(&error);
        compare_state.error_message = error;
        compare_state.initialized = true;
        compare_state.compare_mode = is_compare_mode();
        compare_state.active_pair_id = initial_compare_pair_id_;
        compare_state.watch_mode = initial_compare_watch_mode_;
        compare_state.diff_tray_open = initial_compare_diff_tray_open_;
    }

    std::vector<FileExplorerPanel*> FileExplorerPanel::compare_child_panels() const {
        std::vector<FileExplorerPanel*> children;
        if (!is_compare_mode()) {
            return children;
        }

        const auto snapshot = export_workspace_snapshot();
        for (const auto& lane : snapshot.grid_pane_ids) {
            for (const auto& pane_id : lane) {
                const Pane* pane = get_pane(pane_id);
                if (!pane) {
                    continue;
                }
                const TabController::Tab* active = pane->tab_controller.current_active_tab();
                auto* child = active ? dynamic_cast<FileExplorerPanel*>(active->panel.get()) : nullptr;
                if (!child || child == this) {
                    continue;
                }
                children.push_back(child);
                if (children.size() == 2) {
                    return children;
                }
            }
        }
        return children;
    }

    std::optional<std::pair<FileExplorerPanel*, FileExplorerPanel*>> FileExplorerPanel::compare_child_panel_pair() const {
        auto children = compare_child_panels();
        if (children.size() < 2) {
            return std::nullopt;
        }
        return std::make_pair(children[0], children[1]);
    }

    std::optional<std::pair<core::FileSyncEndpoint, core::FileSyncEndpoint>> FileExplorerPanel::compare_current_endpoints() const {
        const auto pair = compare_child_panel_pair();
        if (!pair.has_value()) {
            return std::nullopt;
        }
        const auto& left_state = registry_.get_state<FileExplorerState>((*pair).first->state_key_);
        const auto& right_state = registry_.get_state<FileExplorerState>((*pair).second->state_key_);
        return std::make_pair(compare_endpoint_from_path(left_state.current_path),
                              compare_endpoint_from_path(right_state.current_path));
    }

    std::pair<std::string, std::string> FileExplorerPanel::compare_display_paths() const {
        const auto pair = compare_child_panel_pair();
        if (!pair.has_value()) {
            return {};
        }
        const auto& left_state = registry_.get_state<FileExplorerState>((*pair).first->state_key_);
        const auto& right_state = registry_.get_state<FileExplorerState>((*pair).second->state_key_);
        return {left_state.current_path, right_state.current_path};
    }

    bool FileExplorerPanel::set_compare_roots(const core::FileSyncEndpoint& left, const core::FileSyncEndpoint& right) {
        const auto pair = compare_child_panel_pair();
        if (!pair.has_value()) {
            return false;
        }
        (*pair).first->navigate_to_path(compare_input_path_for_endpoint(left), false, false);
        (*pair).second->navigate_to_path(compare_input_path_for_endpoint(right), false, false);
        auto& compare_state = compare_state_for(registry_, compare_state_scope_key());
        std::lock_guard<std::mutex> lock(compare_state.mu);
        compare_state.stale = true;
        return true;
    }

    bool FileExplorerPanel::swap_compare_roots() {
        const auto endpoints = compare_current_endpoints();
        if (!endpoints.has_value()) {
            return false;
        }
        return set_compare_roots(endpoints->second, endpoints->first);
    }

    void FileExplorerPanel::sync_compare_state_from_panes() {
        if (!is_compare_mode()) {
            return;
        }
        const auto pair = compare_child_panel_pair();
        const auto endpoints = compare_current_endpoints();
        if (!endpoints.has_value() || !pair.has_value()) {
            return;
        }
        auto& compare_state = compare_state_for(registry_, compare_state_scope_key());
        std::lock_guard<std::mutex> lock(compare_state.mu);
        compare_state.compare_mode = true;
        compare_state.left_state_key = (*pair).first->state_key_;
        compare_state.right_state_key = (*pair).second->state_key_;
        if (compare_state.last_compared_at_ms == 0) {
            compare_state.stale = compare_state.stale || !compare_state.rows.empty();
            return;
        }
        if (!compare_endpoints_equal(compare_state.last_left, endpoints->first) ||
            !compare_endpoints_equal(compare_state.last_right, endpoints->second)) {
            compare_state.stale = true;
        }
    }

    void FileExplorerPanel::ensure_compare_dual_pane() {
        if (!is_compare_mode() || pane_count() >= 2) {
            return;
        }

        const auto snapshot = export_workspace_snapshot();
        if (snapshot.panes.empty()) {
            return;
        }

        auto active_or_first_tab = [](const core::WorkspacePaneSnapshot& pane) {
            core::WorkspaceTabSnapshot tab;
            if (pane.tabs.empty()) {
                return tab;
            }
            const auto it = std::find_if(pane.tabs.begin(), pane.tabs.end(), [&](const core::WorkspaceTabSnapshot& candidate) {
                return candidate.idx == pane.active_tab_idx;
            });
            return it != pane.tabs.end() ? *it : pane.tabs.front();
        };

        const core::WorkspacePaneSnapshot& existing_pane = snapshot.panes.front();
        core::WorkspaceTabSnapshot cloned_tab = active_or_first_tab(existing_pane);
        const std::int16_t new_tab_idx = snapshot.next_tab_idx > 0 ? snapshot.next_tab_idx : 2;
        const std::int16_t new_pane_idx = snapshot.next_pane_idx > 0 ? snapshot.next_pane_idx : 2;
        cloned_tab.idx = new_tab_idx;
        cloned_tab.context_key = state_key_ + "_tab_" + std::to_string(new_tab_idx);
        cloned_tab.state_key = cloned_tab.context_key;

        core::WorkspacePaneSnapshot new_pane;
        new_pane.pane_id = panel_id() + "_pane_" + std::to_string(new_pane_idx);
        new_pane.active_tab_idx = new_tab_idx;
        new_pane.tabs.push_back(cloned_tab);

        core::WorkspaceExplorerSnapshot rebuilt = snapshot;
        rebuilt.active_pane_id = existing_pane.pane_id;
        rebuilt.next_tab_idx = new_tab_idx + 1;
        rebuilt.next_pane_idx = new_pane_idx + 1;
        rebuilt.grid_pane_ids = {{existing_pane.pane_id}, {new_pane.pane_id}};
        rebuilt.grid_split_ratio = 0.5f;
        rebuilt.lane_split_ratios = {0.5f, 0.5f};
        rebuilt.panes.clear();
        rebuilt.panes.push_back(existing_pane);
        rebuilt.panes.push_back(new_pane);

        suppress_child_initial_navigation_ = true;
        MultiPanel::restore_workspace_snapshot(rebuilt);
        suppress_child_initial_navigation_ = false;
    }

    bool FileExplorerPanel::compare_row_snapshot_for_file(const FileExplorerState& state,
                                                          const FileItem& file,
                                                          core::FileSyncCompareRow* out,
                                                          bool* is_left_side) const {
        if (!is_compare_context() || out == nullptr) {
            return false;
        }

        const auto& compare_state = compare_state_for(registry_, compare_state_scope_key());
        std::lock_guard<std::mutex> lock(compare_state.mu);
        const bool on_left = compare_state.left_state_key == state_key_;
        const bool on_right = compare_state.right_state_key == state_key_;
        if (!on_left && !on_right) {
            return false;
        }

        std::error_code ec;
        std::string relative = fs::path(file.path).lexically_relative(state.current_path).generic_string();
        if (relative.empty() || relative == ".") {
            relative = file.name;
        }

        const auto it = std::find_if(compare_state.rows.begin(),
                                     compare_state.rows.end(),
                                     [&](const core::FileSyncCompareRow& row) {
                                         if (row.relative_path != relative) {
                                             return false;
                                         }
                                         return on_left ? row.left.present : row.right.present;
                                     });
        if (it == compare_state.rows.end()) {
            return false;
        }

        *out = *it;
        if (is_left_side != nullptr) {
            *is_left_side = on_left;
        }
        return true;
    }

    void FileExplorerPanel::set_compare_row_action(const std::string& relative_path,
                                                   core::FileSyncPlannedAction action) {
        if (!is_compare_context()) {
            return;
        }
        auto& compare_state = compare_state_for(registry_, compare_state_scope_key());
        std::lock_guard<std::mutex> lock(compare_state.mu);
        for (auto& row : compare_state.rows) {
            if (row.relative_path == relative_path) {
                row.action = action;
                compare_state.stale = true;
                break;
            }
        }
    }

    void FileExplorerPanel::apply_compare_row_action(const FileExplorerState& state,
                                                     const core::FileSyncCompareRow& row,
                                                     core::FileSyncPlannedAction action) {
        if (!is_compare_context() || action == core::FileSyncPlannedAction::Skip) {
            set_compare_row_action(row.relative_path, core::FileSyncPlannedAction::Skip);
            return;
        }

        set_compare_row_action(row.relative_path, action);

        std::vector<FileItem> delete_items;
        struct CopyPlan {
            FileItem item;
            std::string dest_dir;
        };
        std::optional<CopyPlan> copy_plan;

        const auto endpoints = compare_current_endpoints();
        const std::string left_root = endpoints.has_value() ? compare_input_path_for_endpoint(endpoints->first) : std::string();
        const std::string right_root = endpoints.has_value() ? compare_input_path_for_endpoint(endpoints->second) : std::string();

        switch (action) {
            case core::FileSyncPlannedAction::CopyLeftToRight:
                if (row.left.present) {
                    FileItem item = compare_item_from_side(row.left, row.relative_path);
                    const std::string dest_dir = row.right.present
                        ? fs::path(row.right.absolute_path).parent_path().string()
                        : (fs::path(right_root) / fs::path(row.relative_path).parent_path()).string();
                    copy_plan = CopyPlan{std::move(item), dest_dir};
                }
                break;
            case core::FileSyncPlannedAction::CopyRightToLeft:
                if (row.right.present) {
                    FileItem item = compare_item_from_side(row.right, row.relative_path);
                    const std::string dest_dir = row.left.present
                        ? fs::path(row.left.absolute_path).parent_path().string()
                        : (fs::path(left_root) / fs::path(row.relative_path).parent_path()).string();
                    copy_plan = CopyPlan{std::move(item), dest_dir};
                }
                break;
            case core::FileSyncPlannedAction::DeleteLeft:
                if (row.left.present) {
                    delete_items.push_back(compare_item_from_side(row.left, row.relative_path));
                }
                break;
            case core::FileSyncPlannedAction::DeleteRight:
                if (row.right.present) {
                    delete_items.push_back(compare_item_from_side(row.right, row.relative_path));
                }
                break;
            case core::FileSyncPlannedAction::Skip:
                break;
        }

        auto stale_callback = [this](const core::FileMasterResult&) {
            auto& compare_state = compare_state_for(registry_, compare_state_scope_key());
            std::lock_guard<std::mutex> lock(compare_state.mu);
            compare_state.stale = true;
        };

        if (copy_plan.has_value()) {
            enqueue_clipboard_operation_batch(registry_,
                                             worker_pool_,
                                             state_key_,
                                             {copy_plan->item},
                                             copy_plan->dest_dir,
                                             ClipboardOp::COPY,
                                             state_key_,
                                             stale_callback);
        } else if (!delete_items.empty()) {
            enqueue_delete_operation_batch(registry_, worker_pool_, state_key_, delete_items, stale_callback);
        }
    }

    void FileExplorerPanel::run_compare_session_async(const core::FileSyncEndpoint& left,
                                                      const core::FileSyncEndpoint& right,
                                                      int64_t pair_id,
                                                      bool watch_mode) {
        auto& compare_state = compare_state_for(registry_, compare_state_scope_key());
        {
            std::lock_guard<std::mutex> lock(compare_state.mu);
            compare_state.compare_in_flight = true;
            compare_state.error_message.clear();
            compare_state.last_compare_started_ms = epoch_ms_now();
        }

        worker_pool_.add(
            [this, left, right, pair_id, watch_mode]() {
                auto result = core::compare_file_sync_endpoints(left, right);
                auto& compare_state = compare_state_for(registry_, compare_state_scope_key());
                std::lock_guard<std::mutex> lock(compare_state.mu);
                compare_state.compare_in_flight = false;
                compare_state.error_message = result.error_message;
                if (result.success) {
                    const bool had_prior_rows = !compare_state.rows.empty();
                    const bool changed = had_prior_rows && !compare_rows_equal(compare_state.rows, result.rows);
                    compare_state.rows = std::move(result.rows);
                    compare_state.compare_mode = true;
                    compare_state.diff_tray_open = false;
                    compare_state.last_compared_at_ms = result.compared_at_ms;
                    compare_state.last_left = left;
                    compare_state.last_right = right;
                    compare_state.watch_mode = watch_mode;
                    compare_state.active_pair_id = pair_id;
                    compare_state.stale = watch_mode && changed;
                    compare_state.compare_revision.fetch_add(1, std::memory_order_relaxed);

                    if (pair_id != 0) {
                        for (auto& pair : compare_state.saved_pairs) {
                            if (pair.id == pair_id) {
                                pair.last_compared_at_ms = result.compared_at_ms;
                                pair.last_scan_at_ms = result.compared_at_ms;
                                pair.watch_mode = watch_mode;
                                pair.stale = compare_state.stale;
                                std::string save_error;
                                core::FileSyncPairStore::get().save(pair, &save_error);
                                if (!save_error.empty()) {
                                    compare_state.error_message = save_error;
                                }
                                break;
                            }
                        }
                    }
                }
            },
            {},
            [this](const std::string& error) {
                auto& compare_state = compare_state_for(registry_, compare_state_scope_key());
                std::lock_guard<std::mutex> lock(compare_state.mu);
                compare_state.compare_in_flight = false;
                compare_state.error_message = error;
            });
    }

    void FileExplorerPanel::maybe_refresh_watched_compare() {
        auto& compare_state = compare_state_for(registry_, compare_state_scope_key());
        core::FileSyncPair pair;
        bool should_refresh = false;
        {
            std::lock_guard<std::mutex> lock(compare_state.mu);
            if (!compare_state.watch_mode ||
                compare_state.active_pair_id == 0 ||
                compare_state.compare_in_flight) {
                return;
            }
            const int64_t now = epoch_ms_now();
            if (now - compare_state.last_watch_refresh_ms < kCompareWatchRefreshMs) {
                return;
            }
            const auto it = std::find_if(compare_state.saved_pairs.begin(),
                                         compare_state.saved_pairs.end(),
                                         [&](const core::FileSyncPair& candidate) {
                                             return candidate.id == compare_state.active_pair_id;
                                         });
            if (it == compare_state.saved_pairs.end()) {
                return;
            }
            pair = *it;
            compare_state.last_watch_refresh_ms = now;
            should_refresh = true;
        }
        if (should_refresh) {
            run_compare_session_async(pair.left, pair.right, pair.id, pair.watch_mode);
        }
    }

    void FileExplorerPanel::render_compare_header() {
        auto& compare_state = compare_state_for(registry_, compare_state_scope_key());
        ensure_compare_state_initialized();
        ensure_compare_dual_pane();
        sync_compare_state_from_panes();
        maybe_refresh_watched_compare();
        const auto display_paths = compare_display_paths();
        const auto endpoints = compare_current_endpoints();

        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.092f, 0.098f, 0.112f, 1.0f));
        if (ImGui::BeginChild(("##compare_sync_header_" + state_key_).c_str(),
                              ImVec2(0.0f, compare_header_height()),
                              false,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
            std::string compare_error;
            int left_only = 0;
            int right_only = 0;
            int different = 0;
            int conflict = 0;
            bool compare_in_flight = false;
            bool stale = false;
            bool watch_mode_value = false;
            std::string active_name = "Saved pairs";
            {
                std::lock_guard<std::mutex> lock(compare_state.mu);
                compare_error = compare_state.error_message;
                compare_in_flight = compare_state.compare_in_flight;
                stale = compare_state.stale;
                watch_mode_value = compare_state.watch_mode;
                for (const auto& row : compare_state.rows) {
                    switch (row.disposition) {
                        case core::FileSyncCompareDisposition::LeftOnly: ++left_only; break;
                        case core::FileSyncCompareDisposition::RightOnly: ++right_only; break;
                        case core::FileSyncCompareDisposition::Different: ++different; break;
                        case core::FileSyncCompareDisposition::Conflict: ++conflict; break;
                        case core::FileSyncCompareDisposition::Same: break;
                    }
                }
                for (const auto& pair : compare_state.saved_pairs) {
                    if (pair.id == compare_state.active_pair_id) {
                        active_name = pair.name;
                        break;
                    }
                }
            }

            ImGui::AlignTextToFramePadding();
            ImGui::TextUnformatted("Compare");
            ImGui::SameLine();
            if (compare_in_flight) {
                ImGui::TextDisabled("Comparing...");
            } else if (stale) {
                ImGui::TextColored(ImVec4(0.97f, 0.77f, 0.42f, 1.0f), "Needs review");
            } else {
                ImGui::TextColored(ImVec4(0.47f, 0.85f, 0.60f, 1.0f), "Ready");
            }
            ImGui::SameLine();
            ImGui::TextDisabled("Left: %s", display_paths.first.empty() ? "--" : display_paths.first.c_str());
            ImGui::SameLine();
            ImGui::TextDisabled("Right: %s", display_paths.second.empty() ? "--" : display_paths.second.c_str());

            ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 6.0f);
            ImGui::PushItemWidth(220.0f);
            if (ImGui::BeginCombo("##compare_pair_combo", active_name.c_str())) {
                std::vector<core::FileSyncPair> pairs;
                {
                    std::lock_guard<std::mutex> lock(compare_state.mu);
                    pairs = compare_state.saved_pairs;
                }
                for (const auto& pair : pairs) {
                    const bool selected = pair.id == compare_pair_id();
                    if (ImGui::Selectable(pair.name.c_str(), selected)) {
                        {
                            std::lock_guard<std::mutex> lock(compare_state.mu);
                            compare_state.active_pair_id = pair.id;
                            compare_state.watch_mode = pair.watch_mode;
                            compare_state.stale = true;
                            std::snprintf(ui_.compare_pair_name_buffer,
                                          sizeof(ui_.compare_pair_name_buffer),
                                          "%s",
                                          pair.name.c_str());
                        }
                        set_compare_roots(pair.left, pair.right);
                    }
                }
                ImGui::EndCombo();
            }
            ImGui::PopItemWidth();
            ImGui::SameLine();
            ImGui::PushItemWidth(220.0f);
            ImGui::InputTextWithHint("##compare_pair_name", "Saved pair name", ui_.compare_pair_name_buffer, sizeof(ui_.compare_pair_name_buffer));
            ImGui::PopItemWidth();
            ImGui::SameLine();
            if (ImGui::Button("Save / Update Pair") && endpoints.has_value()) {
                core::FileSyncPair pair;
                {
                    std::lock_guard<std::mutex> lock(compare_state.mu);
                    pair.id = compare_state.active_pair_id;
                    pair.name = ui_.compare_pair_name_buffer[0] != '\0'
                        ? ui_.compare_pair_name_buffer
                        : (std::string("Pair: ") + file_explorer_tab_title_for_path(display_paths.first) + " <-> " +
                           file_explorer_tab_title_for_path(display_paths.second));
                    pair.left = endpoints->first;
                    pair.right = endpoints->second;
                    pair.watch_mode = compare_state.watch_mode;
                    pair.stale = compare_state.stale;
                    pair.last_compared_at_ms = compare_state.last_compared_at_ms;
                    pair.last_scan_at_ms = compare_state.last_compared_at_ms;
                }
                std::string error;
                if (core::FileSyncPairStore::get().save(pair, &error)) {
                    std::lock_guard<std::mutex> lock(compare_state.mu);
                    compare_state.active_pair_id = pair.id;
                    auto it = std::find_if(compare_state.saved_pairs.begin(), compare_state.saved_pairs.end(),
                                           [&](const core::FileSyncPair& candidate) { return candidate.id == pair.id; });
                    if (it == compare_state.saved_pairs.end()) {
                        compare_state.saved_pairs.push_back(pair);
                    } else {
                        *it = pair;
                    }
                } else {
                    std::lock_guard<std::mutex> lock(compare_state.mu);
                    compare_state.error_message = error;
                }
            }
            ImGui::SameLine();
            if (ImGui::Checkbox("Watch mode", &watch_mode_value)) {
                std::lock_guard<std::mutex> lock(compare_state.mu);
                compare_state.watch_mode = watch_mode_value;
                if (compare_state.active_pair_id != 0) {
                    for (auto& pair : compare_state.saved_pairs) {
                        if (pair.id == compare_state.active_pair_id) {
                            pair.watch_mode = watch_mode_value;
                            std::string error;
                            core::FileSyncPairStore::get().save(pair, &error);
                            if (!error.empty()) {
                                compare_state.error_message = error;
                            }
                            break;
                        }
                    }
                }
            }
            ImGui::SameLine();
            if (ImGui::Button("Swap")) {
                swap_compare_roots();
            }
            ImGui::SameLine();
            if (ImGui::Button("Compare") && endpoints.has_value()) {
                run_compare_session_async(endpoints->first, endpoints->second, compare_pair_id(), watch_mode_value);
            }

            ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 4.0f);
            ImGui::TextDisabled("Left only: %d", left_only);
            ImGui::SameLine();
            ImGui::TextDisabled("Right only: %d", right_only);
            ImGui::SameLine();
            ImGui::TextDisabled("Different: %d", different);
            ImGui::SameLine();
            ImGui::TextDisabled("Conflict: %d", conflict);
            if (!compare_error.empty()) {
                ImGui::SameLine();
                ImGui::TextColored(ImVec4(0.96f, 0.45f, 0.45f, 1.0f), "%s", compare_error.c_str());
            }
        }
        ImGui::EndChild();
        ImGui::PopStyleColor();
    }

    void FileExplorerPanel::render_compare_diff_tray() {
        (void)state_key_;
    }

    void FileExplorerPanel::render_compare_results(FileSyncCompareState& compare_state) {
        std::vector<core::FileSyncCompareRow> rows;
        {
            std::lock_guard<std::mutex> lock(compare_state.mu);
            rows = compare_state.rows;
        }

        static ImGuiTableFlags compare_flags = ImGuiTableFlags_ScrollX |
                                               ImGuiTableFlags_SizingStretchProp |
                                               ImGuiTableFlags_RowBg |
                                               ImGuiTableFlags_BordersOuter |
                                               ImGuiTableFlags_BordersH;
        const std::string table_id = "CompareSyncTable_" + state_key_;
        UI::table(table_id.c_str(), {
            .columns = {
                {"Path", 1.5f, ImGuiTableColumnFlags_WidthStretch, 12.0f},
                {"Type", 110.0f, ImGuiTableColumnFlags_WidthFixed, 12.0f},
                {"State", 120.0f, ImGuiTableColumnFlags_WidthFixed, 12.0f},
                {"Left", 220.0f, ImGuiTableColumnFlags_WidthFixed, 12.0f},
                {"Right", 220.0f, ImGuiTableColumnFlags_WidthFixed, 12.0f},
                {"Action", 170.0f, ImGuiTableColumnFlags_WidthFixed, 12.0f},
            },
            .width = UI::Size::pct(100.0f),
            .cell_padding = ImVec2(10.0f, 6.0f),
            .freeze_rows = 1,
            .flags = compare_flags,
        }, [&](ImGuiTableSortSpecs*) {
            for (std::size_t i = 0; i < rows.size(); ++i) {
                auto& row = rows[i];
                ImGui::TableNextRow();
                ImGui::TableSetColumnIndex(0);
                ImGui::TextUnformatted(row.relative_path.c_str());
                ImGui::TableSetColumnIndex(1);
                ImGui::TextUnformatted(core::file_sync_compare_kind_label(row.kind));
                ImGui::TableSetColumnIndex(2);
                ImGui::TextUnformatted(core::file_sync_compare_disposition_label(row.disposition));
                ImGui::TableSetColumnIndex(3);
                ImGui::TextUnformatted(side_summary_label(row.left).c_str());
                ImGui::TableSetColumnIndex(4);
                ImGui::TextUnformatted(side_summary_label(row.right).c_str());
                ImGui::TableSetColumnIndex(5);
                const std::string combo_id = "##compare_action_" + std::to_string(i);
                const char* preview = core::file_sync_planned_action_label(row.action);
                if (ImGui::BeginCombo(combo_id.c_str(), preview)) {
                    for (const auto action : {core::FileSyncPlannedAction::Skip,
                                              core::FileSyncPlannedAction::CopyLeftToRight,
                                              core::FileSyncPlannedAction::CopyRightToLeft,
                                              core::FileSyncPlannedAction::DeleteLeft,
                                              core::FileSyncPlannedAction::DeleteRight}) {
                        const bool selected = row.action == action;
                        if (ImGui::Selectable(core::file_sync_planned_action_label(action), selected)) {
                            row.action = action;
                            std::lock_guard<std::mutex> lock(compare_state.mu);
                            if (i < compare_state.rows.size()) {
                                compare_state.rows[i].action = action;
                            }
                        }
                    }
                    ImGui::EndCombo();
                }
            }
        });
    }

    void FileExplorerPanel::apply_compare_rows(FileSyncCompareState& compare_state) {
        std::vector<core::FileSyncCompareRow> current_rows;
        {
            std::lock_guard<std::mutex> lock(compare_state.mu);
            current_rows = compare_state.rows;
        }
        const auto planned_rows = core::planned_rows_for_apply(current_rows);
        if (planned_rows.empty()) {
            return;
        }

        std::vector<FileItem> delete_items;
        struct CopyPlan {
            FileItem item;
            std::string dest_dir;
        };
        std::vector<CopyPlan> copy_plans;
        copy_plans.reserve(planned_rows.size());
        const auto endpoints = compare_current_endpoints();
        const std::string left_root = endpoints.has_value() ? compare_input_path_for_endpoint(endpoints->first) : std::string();
        const std::string right_root = endpoints.has_value() ? compare_input_path_for_endpoint(endpoints->second) : std::string();

        for (const auto& row : planned_rows) {
            switch (row.action) {
                case core::FileSyncPlannedAction::CopyLeftToRight: {
                    if (row.left.present) {
                        FileItem item = compare_item_from_side(row.left, row.relative_path);
                        const std::string dest_dir = row.right.present
                            ? fs::path(row.right.absolute_path).parent_path().string()
                            : (fs::path(right_root) / fs::path(row.relative_path).parent_path()).string();
                        copy_plans.push_back({std::move(item), dest_dir});
                    }
                    break;
                }
                case core::FileSyncPlannedAction::CopyRightToLeft: {
                    if (row.right.present) {
                        FileItem item = compare_item_from_side(row.right, row.relative_path);
                        const std::string dest_dir = row.left.present
                            ? fs::path(row.left.absolute_path).parent_path().string()
                            : (fs::path(left_root) / fs::path(row.relative_path).parent_path()).string();
                        copy_plans.push_back({std::move(item), dest_dir});
                    }
                    break;
                }
                case core::FileSyncPlannedAction::DeleteLeft:
                    if (row.left.present) {
                        delete_items.push_back(compare_item_from_side(row.left, row.relative_path));
                    }
                    break;
                case core::FileSyncPlannedAction::DeleteRight:
                    if (row.right.present) {
                        delete_items.push_back(compare_item_from_side(row.right, row.relative_path));
                    }
                    break;
                case core::FileSyncPlannedAction::Skip:
                    break;
            }
        }

        for (const auto& plan : copy_plans) {
            enqueue_clipboard_operation_batch(registry_,
                                             worker_pool_,
                                             state_key_,
                                             {plan.item},
                                             plan.dest_dir,
                                             ClipboardOp::COPY,
                                             state_key_,
                                             {});
        }
        if (!delete_items.empty()) {
            enqueue_delete_operation_batch(registry_, worker_pool_, state_key_, delete_items, {});
        }

        {
            std::lock_guard<std::mutex> lock(compare_state.mu);
            compare_state.stale = false;
            if (compare_state.active_pair_id != 0) {
                for (auto& pair : compare_state.saved_pairs) {
                    if (pair.id == compare_state.active_pair_id) {
                        pair.stale = false;
                        pair.last_scan_at_ms = epoch_ms_now();
                        std::string error;
                        core::FileSyncPairStore::get().save(pair, &error);
                        if (!error.empty()) {
                            compare_state.error_message = error;
                        }
                        break;
                    }
                }
            }
        }
    }

    void FileExplorerPanel::render_panel_contents() {
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        auto& listing = active_listing();
        std::unique_lock<std::recursive_mutex> lock(state.mu);
        ui_.selected_files = state.selected_files;
        update_periodic_watched_sync(state);

        const float available_h = ImGui::GetContentRegionAvail().y;
        const float status_bar_height = 30.0f;
        const float content_height = std::max(0.0f, available_h - status_bar_height);
        const std::string content_region_id = "##explorer_content_region_" + state_key_;
        const std::string explorer_list_id = "##explorer_list_" + state_key_;
        const std::string bottom_status_bar_id = "BottomStatusBar_" + state_key_;
        const std::string status_left_id = "##status_left_" + state_key_;
        const std::string status_right_id = "##status_right_" + state_key_;

        ImGui::PushStyleColor(ImGuiCol_ChildBg, kInspectorBg);
        ImGui::PushStyleColor(ImGuiCol_WindowBg, kInspectorBg);
        ImGui::PushStyleColor(ImGuiCol_TableRowBg, kInspectorBg);
        ImGui::PushStyleColor(ImGuiCol_TableRowBgAlt, kInspectorBg);
        ImGui::PushStyleColor(ImGuiCol_TableHeaderBg, kInspectorBg);
        if (ImGui::BeginChild(content_region_id.c_str(), ImVec2(0.0f, content_height), false,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
            ImGui::PushStyleVar(ImGuiStyleVar_ScrollbarSize, 8.0f);
            if (ImGui::BeginChild(explorer_list_id.c_str(), ImVec2(0.0f, ImGui::GetContentRegionAvail().y), false,
                                  ImGuiWindowFlags_NoScrollWithMouse)) {
                ImGuiIO& io = ImGui::GetIO();
                if (ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup) && io.MouseWheel != 0.0f) {
                    constexpr float kExplorerWheelStep = 22.0f;
                    ImGui::SetScrollY(ImGui::GetScrollY() - io.MouseWheel * kExplorerWheelStep);
                }

                ImVec2 list_start = ImGui::GetCursorPos();
                float list_height = ImGui::GetContentRegionAvail().y;

                show_directory_contents(state, listing, ui_);
                if (!listing.error_message.empty()) {
                    show_error_modal(listing.error_message, "FileExplorerError");
                } else {
                    show_error_modal(ui_.error_msg, "FileExplorerError");
                }
                ImGui::SetCursorPos(list_start);
            }
            ImGui::EndChild();
            ImGui::PopStyleVar();
        }
        ImGui::EndChild();
        {
            const ImVec2 content_min = ImGui::GetItemRectMin();
            const ImVec2 content_max = ImGui::GetItemRectMax();
            ImGui::GetWindowDrawList()->AddLine(ImVec2(content_min.x, content_max.y - 1.0f),
                                                ImVec2(content_max.x, content_max.y - 1.0f),
                                                IM_COL32(56, 58, 64, 210),
                                                1.0f);
        }

        ImGui::SetCursorPosY(ImGui::GetCursorPosY() - ImGui::GetStyle().ItemSpacing.y);
        const std::string status_text = build_directory_status_text(listing, ui_);
        const std::string freshness_tooltip = build_directory_freshness_tooltip(listing, state.current_path);
        if (ImGui::BeginChild(bottom_status_bar_id.c_str(), ImVec2(0.0f, status_bar_height), false, ImGuiWindowFlags_NoScrollbar)) {
            const ImVec2 status_min = ImGui::GetWindowPos();
            const ImVec2 status_max(status_min.x + ImGui::GetWindowWidth(), status_min.y + status_bar_height);
            constexpr float kStatusPadX = 10.0f;
            constexpr float kStatusPadY = 5.0f;
            constexpr float kRightActionWidth = 34.0f;
            const ImVec2 avail = ImGui::GetContentRegionAvail();
            const float zone_width = std::max(0.0f, avail.x - kStatusPadX * 2.0f);
            const float left_width = std::max(0.0f, zone_width * 0.5f);
            const float right_width = std::max(0.0f, zone_width - left_width);
            const float content_height = std::max(0.0f, avail.y - kStatusPadY * 2.0f);

            ImGui::SetCursorPos(ImVec2(kStatusPadX, kStatusPadY));
            ImGui::BeginChild(status_left_id.c_str(), ImVec2(left_width, content_height), false,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
            ImGui::PushStyleColor(ImGuiCol_Text, kInspectorMuted);
            ImGui::AlignTextToFramePadding();
            ImGui::TextUnformatted(status_text.c_str());
            ImGui::PopStyleColor();
            ImGui::EndChild();

            ImGui::SameLine(0.0f, 0.0f);
            ImGui::BeginChild(status_right_id.c_str(), ImVec2(right_width, content_height), false,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
            ImGui::SetCursorPosX(std::max(0.0f, right_width - kRightActionWidth));
            render_directory_info_status_slot(kRightActionWidth, content_height, freshness_tooltip);
            ImGui::EndChild();

            handle_file_drop_target(state, state.current_path, status_min, status_max, false, false, true);
        }
        ImGui::EndChild();
        ImGui::PopStyleColor(5);

        lock.unlock();
        if (!pending_drag_navigation_path_.empty()) {
            std::string path = std::move(pending_drag_navigation_path_);
            pending_drag_navigation_path_.clear();
            navigate_to_path(path);
        }
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
            std::lock_guard<std::recursive_mutex> lock(state.mu);
            current_path = state.current_path;
        }

        const std::string path_label = current_path.empty() ? "Files" : current_path;
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.070f, 0.078f, 0.092f, 1.0f));
        const std::string pane_path_header_id = "##explorer_pane_path_header_" + explorer->state_key_;
        if (ImGui::BeginChild(pane_path_header_id.c_str(),
                              ImVec2(0.0f, kPanePathHeaderHeight),
                              false,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
            ImDrawList* dl = ImGui::GetWindowDrawList();
            const ImVec2 min = ImGui::GetWindowPos();
            const ImVec2 max(min.x + ImGui::GetWindowWidth(), min.y + kPanePathHeaderHeight);
            const ImU32 border = IM_COL32(46, 50, 60, 180);
            const ImU32 path_col = is_active ? IM_COL32(176, 184, 198, 255) : IM_COL32(95, 100, 112, 255);
            dl->AddLine(ImVec2(min.x, max.y - 1.0f), ImVec2(max.x, max.y - 1.0f), border, 1.0f);

            constexpr float kPadX = 10.0f;
            const float text_y = min.y + (kPanePathHeaderHeight - ImGui::GetTextLineHeight()) * 0.5f;
            const float path_x = min.x + kPadX;
            const float path_width = std::max(0.0f, max.x - path_x - kPadX);
            if (path_width > 24.0f) {
                const std::string visible_path = fit_tail_text_with_ellipsis(path_label, path_width);
                ImGui::PushClipRect(ImVec2(path_x, min.y), ImVec2(max.x - kPadX, max.y), true);
                dl->AddText(ImVec2(path_x, text_y), path_col, visible_path.c_str());
                ImGui::PopClipRect();
            }

            if (ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup)) {
                ImGui::SetTooltip("%s", path_label.c_str());
            }

            if (!current_path.empty()) {
                auto& state = registry_.get_state<FileExplorerState>(explorer->state_key_);
                explorer->handle_file_drop_target(state, current_path, min, max, false, false, true);
            }
        }
        ImGui::EndChild();
        ImGui::PopStyleColor();
    }

    void FileExplorerPanel::render_pane_drop_zone(Panel& panel,
                                                  bool is_active,
                                                  bool has_multiple_panes,
                                                  const ImVec2& min,
                                                  const ImVec2& max) {
        (void)panel;
        (void)is_active;
        (void)has_multiple_panes;
        (void)min;
        (void)max;
    }

    void FileExplorerPanel::render() {
        MultiPanel::render();
        if (auto* active_explorer = dynamic_cast<FileExplorerPanel*>(active_panel())) {
            if (active_explorer != this) {
                active_explorer->show_rename_review_modal();
                render_operation_conflict_modal(registry_, worker_pool_);
                return;
            }
        }
        show_rename_review_modal();
        render_operation_conflict_modal(registry_, worker_pool_);
    }

    float FileExplorerPanel::toolbar_height() const {
        return kToolbarHeight;
    }

    float FileExplorerPanel::compare_header_height() const {
        return is_compare_mode() ? 74.0f : 0.0f;
    }

    float FileExplorerPanel::compare_diff_tray_height() const {
        return 0.0f;
    }

    bool FileExplorerPanel::notification_anchor_bounds(ImVec2& min, ImVec2& max) const {
        if (auto* active_explorer = dynamic_cast<FileExplorerPanel*>(active_panel())) {
            if (active_explorer != this) {
                return active_explorer->notification_anchor_bounds(min, max);
            }
        }
        if (rename_mode_active()) {
            return false;
        }
        if (!notification_anchor_valid_) {
            return false;
        }
        min = notification_anchor_min_;
        max = notification_anchor_max_;
        return true;
    }

    void FileExplorerPanel::render_active_toolbar() {
        notification_anchor_valid_ = false;
        if (auto* active_explorer = dynamic_cast<FileExplorerPanel*>(active_panel())) {
            if (active_explorer != this) {
                active_explorer->render_active_toolbar();
                return;
            }
        }

        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        std::unique_lock<std::recursive_mutex> lock(state.mu);

        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.075f, 0.085f, 0.10f, 1.0f));
        if (ImGui::BeginChild("TopBar", ImVec2(0.0f, kToolbarHeight), false, ImGuiWindowFlags_NoScrollbar)) {
            ImGui::SetCursorPos(ImVec2(kToolbarPadX, kToolbarPadY));
            show_command_toolbar(state);
            ImGui::SetCursorPos(ImVec2(kToolbarPadX, kToolbarPadY + kToolbarButtonHeight + kToolbarRowGap));
            notification_anchor_min_ = ImGui::GetCursorScreenPos();
            notification_anchor_max_ = ImVec2(
                ImGui::GetWindowPos().x + ImGui::GetWindowWidth() - kToolbarPadX,
                notification_anchor_min_.y + kToolbarButtonHeight);
            notification_anchor_valid_ = true;
            show_file_action_toolbar(state);
        }
        ImGui::EndChild();
        ImGui::PopStyleColor();
    }

    bool FileExplorerPanel::execute_palette_command(const std::string& command_id) {
        if (auto* active_explorer = dynamic_cast<FileExplorerPanel*>(active_panel())) {
            if (active_explorer != this) {
                return active_explorer->execute_palette_command(command_id);
            }
        }
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        if (command_id == "explorer.refresh") {
            request_manual_refresh(state);
            return true;
        }
        if (command_id == "explorer.rename") {
            initiate_rename(ui_);
            return true;
        }
        if (command_id == "explorer.delete") {
            perform_delete_selected(state);
            return true;
        }
        if (command_id == "explorer.copy") {
            perform_copy(state);
            return true;
        }
        if (command_id == "explorer.cut") {
            perform_cut(state);
            return true;
        }
        if (command_id == "explorer.paste") {
            perform_paste(state);
            return true;
        }
        if (command_id == "explorer.toggle_chat") {
            toggle_chat_overlay();
            return true;
        }
        return false;
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
            std::lock_guard<std::recursive_mutex> lock(state.mu);
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

        fs::path normalized_path = fs::path(path).lexically_normal();
        std::string display_path = normalized_path.generic_string();
        if (display_path.empty()) {
            display_path = path;
        }
        {
            std::lock_guard<std::recursive_mutex> lock(state.mu);
            const std::string previous_path(state.current_path);
            store_selection_snapshot(state, ui_, previous_path);
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
            listing.files.clear();
            listing.hidden_item_count = 0;
            listing.error_message.clear();
            listing.sort_dirty = true;

            // History update is fast (no I/O) — do it synchronously now so
            // back/forward buttons are correct even before the scan completes.
            update_navigation_history(state, display_path, update_history);

            strncpy(state.current_path, display_path.c_str(), sizeof(state.current_path) - 1);
            state.current_path[sizeof(state.current_path) - 1] = '\0';
            strncpy(state.search_path, display_path.c_str(), sizeof(state.search_path) - 1);
            state.search_path[sizeof(state.search_path) - 1] = '\0';
            restore_selection_snapshot(state, ui_, display_path);
        }

        // Snapshot volatile UI state before leaving the UI thread
        const bool show_hidden = ui_.show_hidden;

        core::WorkerPool& listing_pool = is_remote_listing ? worker_pool_ : local_listing_worker_pool();
        listing_pool.add(
            [registry = &registry_,
             state_key = state_key_,
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
                std::size_t hidden_item_count = 0;

                auto flush_batch = [&](bool final_flush) {
                    std::lock_guard<std::recursive_mutex> lk(state.mu);
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
                    listing.hidden_item_count = hidden_item_count;
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
                            std::lock_guard<std::recursive_mutex> lk(state.mu);
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
                        std::lock_guard<std::recursive_mutex> lk(state.mu);
                        if (listing.load_generation.load(std::memory_order_relaxed) != load_generation) {
                            return;
                        }
                        listing.error_message = remote_result.error_message;
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
                        std::lock_guard<std::recursive_mutex> lk(state.mu);
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
                        const std::string file_name = entry.path().filename().string();
                        const bool is_hidden_entry = !file_name.empty() && file_name.front() == '.';
                        if (is_hidden_entry) {
                            ++hidden_item_count;
                        }
                        if (!show_hidden && is_hidden_entry) continue;
                        batch.push_back(make_local_file_item(entry));
                        if (batch.size() >= kLocalListBatchSize) {
                            if (!flush_batch(false)) {
                                return;
                            }
                        }
                    }
                } catch (const std::exception& e) {
                    std::lock_guard<std::recursive_mutex> lk(state.mu);
                    if (listing.load_generation.load(std::memory_order_relaxed) != load_generation) {
                        return;
                    }
                    listing.error_message = e.what();
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
             load_generation,
             is_remote_listing](const std::string& err) {
                auto& state = registry->get_state<FileExplorerState>(state_key);
                auto& listing = registry->get_state<FileListingsState>(kFileListingsStateKey).get_or_create(state_key);
                if (listing.load_generation.load(std::memory_order_relaxed) != load_generation) {
                    return;
                }
                std::lock_guard<std::recursive_mutex> lk(state.mu);
                if (listing.load_generation.load(std::memory_order_relaxed) != load_generation) {
                    return;
                }
                listing.error_message = err;
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
        if (auto* active_explorer = dynamic_cast<FileExplorerPanel*>(active_panel())) {
            if (active_explorer != this) {
                active_explorer->navigate_to_path(path, update_history, create_if_missing);
                return;
            }
        }

        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        auto& listing = active_listing();
        auto& library = library_state();

        std::string normalized_request = fs::path(path).lexically_normal().generic_string();
        if (normalized_request.empty()) {
            normalized_request = path;
        }
        uint64_t load_generation = 0;
        {
            std::lock_guard<std::recursive_mutex> lock(state.mu);
            const std::string current_path(state.current_path);
            const bool has_active_load_animation = listing.loading.phase != LoadingAnimationPhase::Idle;
            if (listing.is_loading && has_active_load_animation && !current_path.empty() && current_path == normalized_request) {
                return;
            }
            load_generation = listing.load_generation.fetch_add(1, std::memory_order_relaxed) + 1;
        }

        // Virtual Paths Logic
        VirtualListingResult virtual_listing;
        if (populate_virtual_listing(library, path, virtual_listing)) {
            printf("Explorer: Handling virtual path: %s\n", path.c_str());
            std::lock_guard<std::recursive_mutex> lock(state.mu);
            const std::string previous_path(state.current_path);
            store_selection_snapshot(state, ui_, previous_path);
            update_navigation_history(state, path, update_history);
            listing.files = std::move(virtual_listing.files);
            if (path == FileExplorerState::VIRTUAL_PATH_TRASH) {
                listing.trash_files = std::move(virtual_listing.trash_files);
            }
            set_active_path(state, path);
            restore_selection_snapshot(state, ui_, path);
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
