#include "panels/file_explorer/file_explorer_panel.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>

#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"
#include "core/ui/ui.h"
#include "panels/notification/notification_state.h"
#include "panels/search/search_state.h"
#include "panels/services/services_state.h"

namespace fs = std::filesystem;

using namespace misty::core;

namespace misty::panel {
namespace {

constexpr float kNameColumnWidth = 320.0f;
constexpr float kSizeColumnWidth = 96.0f;
constexpr float kTypeColumnWidth = 120.0f;
constexpr float kModifiedColumnWidth = 180.0f;
constexpr float kStateColumnWidth = 72.0f;
constexpr float kSyncColumnWidth = 56.0f;
constexpr float kTableMinInnerWidth =
    kNameColumnWidth +
    kSizeColumnWidth +
    kTypeColumnWidth +
    kModifiedColumnWidth +
    kStateColumnWidth +
    kSyncColumnWidth;

enum class FileTableColumn : int {
    Name = 0,
    Size = 1,
    Type = 2,
    LastModified = 3,
    State = 4,
    Sync = 5,
};

constexpr const char* kFileDragPayloadType = "MISTY_FILE_ITEMS";
constexpr auto kDragHoverNavigateDelay = std::chrono::milliseconds(750);

struct ActiveFileDrag {
    std::string source_state_key;
    std::vector<UnifiedFileItem> items;
    std::string hover_path;
    std::chrono::steady_clock::time_point hover_started_at{};
    std::string auto_navigated_path;
    int last_source_frame = -100;
    int last_mouse_down_frame = -100;
    int preview_drawn_frame = -100;
    int last_prominent_target_hover_frame = -100;
    bool drop_consumed = false;
};

ActiveFileDrag g_active_file_drag;

std::string icon_name_for_file(const FileExplorerState& state, const UnifiedFileItem& file);

bool has_active_file_drag() {
    const int frame = ImGui::GetFrameCount();
    if (!g_active_file_drag.items.empty() && !g_active_file_drag.drop_consumed &&
        ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
        g_active_file_drag.last_mouse_down_frame = frame;
    }
    return !g_active_file_drag.items.empty() &&
           !g_active_file_drag.drop_consumed &&
           (ImGui::IsMouseDown(ImGuiMouseButton_Left) ||
            g_active_file_drag.last_source_frame >= frame - 1 ||
            g_active_file_drag.last_mouse_down_frame >= frame - 1);
}

bool has_imgui_file_drag_payload() {
    const ImGuiPayload* payload = ImGui::GetDragDropPayload();
    return payload != nullptr && payload->IsDataType(kFileDragPayloadType);
}

bool has_file_drag_context() {
    return has_active_file_drag() || has_imgui_file_drag_payload();
}

const ImGuiPayload* accept_file_drag_payload_for_current_item() {
    const ImGuiPayload* payload = ImGui::GetDragDropPayload();
    if (payload == nullptr || !payload->IsDataType(kFileDragPayloadType)) {
        return nullptr;
    }

    const ImGuiPayload* accepted_payload = nullptr;
    if (ImGui::BeginDragDropTarget()) {
        accepted_payload = ImGui::AcceptDragDropPayload(
            kFileDragPayloadType,
            ImGuiDragDropFlags_AcceptBeforeDelivery |
                ImGuiDragDropFlags_AcceptNoDrawDefaultRect |
                ImGuiDragDropFlags_AcceptNoPreviewTooltip);
        ImGui::EndDragDropTarget();
    }
    return accepted_payload;
}

bool prominent_drag_target_hovered_this_frame() {
    return g_active_file_drag.last_prominent_target_hover_frame == ImGui::GetFrameCount();
}

void draw_drag_navigation_hover_feedback(const ImVec2& min, const ImVec2& max) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    const float pulse = 0.5f + 0.5f * std::sin(static_cast<float>(ImGui::GetTime() * 9.0));
    const int fill_alpha = static_cast<int>(14.0f + 18.0f * pulse);
    const int stroke_alpha = static_cast<int>(105.0f + 95.0f * pulse);
    const float rounding = 4.0f;
    dl->AddRectFilled(min, max, IM_COL32(255, 255, 255, fill_alpha), rounding);
    dl->AddRect(min, max, IM_COL32(255, 255, 255, stroke_alpha), rounding, 0, 1.5f);
}

std::vector<UnifiedFileItem> selected_drag_items(const FileExplorerState& state) {
    std::vector<UnifiedFileItem> items;
    items.reserve(state.selected_files.size());
    for (const auto& selected_id : state.selected_files) {
        auto it = std::find_if(state.files.begin(), state.files.end(),
            [&](const UnifiedFileItem& candidate) { return candidate.id == selected_id; });
        if (it != state.files.end()) {
            items.push_back(*it);
        }
    }
    return items;
}

bool same_drag_items(const std::vector<UnifiedFileItem>& lhs, const std::vector<UnifiedFileItem>& rhs) {
    if (lhs.size() != rhs.size()) {
        return false;
    }
    std::vector<std::string> lhs_ids;
    std::vector<std::string> rhs_ids;
    lhs_ids.reserve(lhs.size());
    rhs_ids.reserve(rhs.size());
    for (const auto& item : lhs) lhs_ids.push_back(item.id);
    for (const auto& item : rhs) rhs_ids.push_back(item.id);
    std::sort(lhs_ids.begin(), lhs_ids.end());
    std::sort(rhs_ids.begin(), rhs_ids.end());
    return lhs_ids == rhs_ids;
}

bool active_drag_contains_path(const std::string& path) {
    return std::any_of(g_active_file_drag.items.begin(), g_active_file_drag.items.end(),
        [&](const UnifiedFileItem& item) { return item.path == path; });
}

bool mouse_in_rect(const ImVec2& min, const ImVec2& max) {
    const ImVec2 mouse = ImGui::GetIO().MousePos;
    return mouse.x >= min.x && mouse.x <= max.x && mouse.y >= min.y && mouse.y <= max.y;
}

bool show_open_folder_for_drag_hover(const UnifiedFileItem& file, const ImVec2& min, const ImVec2& max) {
    return file.is_dir &&
           has_file_drag_context() &&
           mouse_in_rect(min, max) &&
           !active_drag_contains_path(file.path);
}

void draw_file_drag_preview(const FileExplorerState& state) {
    if (!has_active_file_drag()) {
        return;
    }

    const int frame = ImGui::GetFrameCount();
    if (g_active_file_drag.preview_drawn_frame == frame) {
        return;
    }
    g_active_file_drag.preview_drawn_frame = frame;

    const size_t count = g_active_file_drag.items.size();
    if (count == 0) {
        return;
    }

    const bool includes_dir = std::any_of(g_active_file_drag.items.begin(), g_active_file_drag.items.end(),
        [](const UnifiedFileItem& item) { return item.is_dir; });
    const std::string icon_name = includes_dir
        ? "file-directory-fill-16"
        : icon_name_for_file(state, g_active_file_drag.items.front());
    auto& icon = AssetManager::get().get_svg_texture(icon_name, 32);

    const ImVec2 mouse = ImGui::GetIO().MousePos;
    const ImVec2 start(mouse.x + 14.0f, mouse.y + 12.0f);
    ImDrawList* dl = ImGui::GetForegroundDrawList();
    const ImU32 shadow = IM_COL32(0, 0, 0, 95);
    const ImU32 stack_back = IM_COL32(56, 56, 62, 238);
    const ImU32 stack_front = IM_COL32(82, 82, 92, 248);
    const ImU32 icon_col = includes_dir ? IM_COL32(230, 191, 76, 255) : IM_COL32(100, 170, 230, 255);

    dl->AddRectFilled(ImVec2(start.x + 8.0f, start.y + 6.0f),
                      ImVec2(start.x + 38.0f, start.y + 34.0f),
                      shadow, 4.0f);
    if (count > 1) {
        dl->AddRectFilled(ImVec2(start.x + 10.0f, start.y + 2.0f),
                          ImVec2(start.x + 36.0f, start.y + 28.0f),
                          stack_back, 4.0f);
    }
    dl->AddRectFilled(ImVec2(start.x + 4.0f, start.y + 8.0f),
                      ImVec2(start.x + 34.0f, start.y + 38.0f),
                      stack_front, 5.0f);
    if (icon.id != 0) {
        dl->AddImage(icon.id,
                     ImVec2(start.x + 11.0f, start.y + 15.0f),
                     ImVec2(start.x + 27.0f, start.y + 31.0f),
                     ImVec2(0, 0),
                     ImVec2(1, 1),
                     icon_col);
    }

    const std::string count_label = count > 99 ? "99+" : std::to_string(count);
    const ImVec2 text_size = ImGui::CalcTextSize(count_label.c_str());
    const ImVec2 badge_center(start.x + 36.0f, start.y + 10.0f);
    const float badge_radius = std::max(9.0f, text_size.x * 0.5f + 5.0f);
    dl->AddCircleFilled(badge_center, badge_radius, IM_COL32(59, 130, 246, 255), 24);
    dl->AddText(ImVec2(badge_center.x - text_size.x * 0.5f,
                       badge_center.y - text_size.y * 0.5f),
                IM_COL32(255, 255, 255, 255),
                count_label.c_str());
}

std::string lowercase_copy(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return value;
}

std::string type_label_for_item(const UnifiedFileItem& file) {
    if (file.is_dir) return "folder";
    if (!file.mime_type.empty()) return lowercase_copy(file.mime_type);
    const std::string ext = fs::path(file.name).extension().string();
    return lowercase_copy(ext);
}

std::string state_label_for_item(const FileExplorerState& state, const UnifiedFileItem& file) {
    if (state.is_deleting(file.path)) return "DEL";
    if (!file.state_code.empty()) return file.state_code;
    return file.source == FileSource::REMOTE ? "REM" : "LOC";
}

int compare_strings(const std::string& lhs, const std::string& rhs) {
    const std::string a = lowercase_copy(lhs);
    const std::string b = lowercase_copy(rhs);
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

std::string icon_name_for_file(const FileExplorerState& state, const UnifiedFileItem& file, bool open_directory) {
    if (state.is_deleting(file.path)) return "trash-16";
    if (state.is_downloading(file.path)) return "download-16";
    if (file.is_dir) return open_directory ? "file-directory-open-fill-24" : "file-directory-fill-16";

    std::string ext = fs::path(file.name).extension().string();
    if (ext == ".cpp" || ext == ".h" || ext == ".hpp" || ext == ".c" || ext == ".cc" ||
        ext == ".js" || ext == ".ts" || ext == ".html" || ext == ".css" || ext == ".json" ||
        ext == ".py" || ext == ".go" || ext == ".rs" || ext == ".java") {
        return "file-code-16";
    }
    if (ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".gif" || ext == ".svg" || ext == ".webp") {
        return "file-media-16";
    }
    if (ext == ".mp4" || ext == ".mov" || ext == ".avi" || ext == ".mkv") {
        return "video-16";
    }
    if (ext == ".zip" || ext == ".tar" || ext == ".gz" || ext == ".7z" || ext == ".rar") {
        return "file-zip-16";
    }
    return "file-16";
}

std::string icon_name_for_file(const FileExplorerState& state, const UnifiedFileItem& file) {
    return icon_name_for_file(state, file, false);
}

const char* sync_icon_name_for_item(const UnifiedFileItem& file) {
    if (file.source != FileSource::REMOTE) return nullptr;
    return file.sync_dirty ? "x-circle-fill-16" : "cloud-24";
}

ImVec4 sync_icon_tint_for_item(const UnifiedFileItem& file) {
    return file.sync_dirty
        ? ImVec4(0.91f, 0.30f, 0.24f, 1.0f)
        : ImVec4(0.18f, 0.80f, 0.44f, 1.0f);
}

const char* sync_icon_name_for_item(const FileExplorerState& state, const UnifiedFileItem& file) {
    if (file.source != FileSource::REMOTE) return nullptr;
    const bool sync_in_progress = state.sync_request_in_flight && file.sync_dirty;
    if (sync_in_progress) return "sync-16";
    return sync_icon_name_for_item(file);
}

ImVec4 sync_icon_tint_for_item(const FileExplorerState& state, const UnifiedFileItem& file) {
    const bool sync_in_progress = state.sync_request_in_flight && file.sync_dirty;
    if (sync_in_progress) {
        return ImVec4(0.34f, 0.76f, 0.96f, 1.0f);
    }
    return sync_icon_tint_for_item(file);
}

void show_sync_tooltip_for_item(const UnifiedFileItem& file) {
    if (file.source != FileSource::REMOTE) return;
    if (!ImGui::BeginTooltip()) return;
    if (file.sync_dirty) {
        if (!file.sync_direction.empty()) ImGui::Text("Dirty (%s)", file.sync_direction.c_str());
        else ImGui::TextUnformatted("Dirty");
        if (!file.dirty_reason.empty()) {
            ImGui::Separator();
            ImGui::PushTextWrapPos(ImGui::GetFontSize() * 28.0f);
            ImGui::TextUnformatted(file.dirty_reason.c_str());
            ImGui::PopTextWrapPos();
        }
    } else {
        ImGui::TextUnformatted("In Sync");
        if (!file.dirty_reason.empty()) {
            ImGui::Separator();
            ImGui::PushTextWrapPos(ImGui::GetFontSize() * 28.0f);
            ImGui::TextUnformatted(file.dirty_reason.c_str());
            ImGui::PopTextWrapPos();
        }
    }
    ImGui::EndTooltip();
}

void render_empty_state(float icon_size) {
    float avail_h = ImGui::GetContentRegionAvail().y;
    float avail_w = ImGui::GetContentRegionAvail().x;
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + avail_h * 0.3f);
    auto& folder_icon = AssetManager::get().get_svg_texture("file-directory-open-fill-24", static_cast<int>(icon_size));
    if (folder_icon.id) {
        ImGui::SetCursorPosX((avail_w - icon_size) * 0.5f);
        ImGui::Image(folder_icon.id, ImVec2(icon_size, icon_size));
        ImGui::Spacing();
    }
    const char* empty_label = "This folder is empty";
    float label_w = ImGui::CalcTextSize(empty_label).x;
    ImGui::SetCursorPosX((avail_w - label_w) * 0.5f);
    ImGui::TextDisabled("%s", empty_label);
}

void select_item(FileExplorerState& state, const UnifiedFileItem& file, int index, bool is_selected, const ImGuiIO& io) {
    if (io.KeyCtrl) {
        if (is_selected) state.selected_files.erase(file.id);
        else state.selected_files.insert(file.id);
    } else if (io.KeyShift && state.last_selected_index != -1) {
        state.selected_files.clear();
        int start = std::min(state.last_selected_index, index);
        int end = std::max(state.last_selected_index, index);
        for (int j = start; j <= end; ++j) state.selected_files.insert(state.files[j].id);
    } else {
        state.selected_files.clear();
        state.selected_files.insert(file.id);
    }
    state.last_selected_index = index;
}

} // namespace

void FileExplorerPanel::begin_file_drag_source(FileExplorerState& state,
                                               const UnifiedFileItem& file,
                                               int index,
                                               bool is_selected) {
    if (file.path.empty()) {
        return;
    }

    if (ImGui::BeginDragDropSource(ImGuiDragDropFlags_SourceAllowNullID |
                                   ImGuiDragDropFlags_SourceNoPreviewTooltip)) {
        if (!is_selected) {
            state.selected_files.clear();
            state.selected_files.insert(file.id);
            state.last_selected_index = index;
        }

        ImGui::SetDragDropPayload(kFileDragPayloadType, state_key_.c_str(), state_key_.size() + 1);
        std::vector<UnifiedFileItem> drag_items = selected_drag_items(state);
        const bool new_drag =
            g_active_file_drag.drop_consumed ||
            g_active_file_drag.source_state_key != state_key_ ||
            !same_drag_items(g_active_file_drag.items, drag_items) ||
            g_active_file_drag.last_source_frame < ImGui::GetFrameCount() - 1;
        g_active_file_drag.source_state_key = state_key_;
        g_active_file_drag.items = std::move(drag_items);
        if (new_drag) {
            g_active_file_drag.hover_path.clear();
            g_active_file_drag.auto_navigated_path.clear();
            g_active_file_drag.hover_started_at = std::chrono::steady_clock::now();
            g_active_file_drag.last_mouse_down_frame = ImGui::GetFrameCount();
            g_active_file_drag.drop_consumed = false;
        }
        g_active_file_drag.last_source_frame = ImGui::GetFrameCount();
        ImGui::EndDragDropSource();
    }
}

void FileExplorerPanel::handle_file_drop_target(FileExplorerState& state,
                                                const std::string& dest_dir,
                                                const ImVec2& min,
                                                const ImVec2& max,
                                                bool prominent,
                                                bool auto_navigate,
                                                bool draw_hover_feedback) {
    if (dest_dir.empty() || max.x <= min.x || max.y <= min.y || !has_file_drag_context()) {
        return;
    }

    if (!mouse_in_rect(min, max)) {
        return;
    }

    const ImGuiPayload* accepted_payload = accept_file_drag_payload_for_current_item();
    if (prominent) {
        g_active_file_drag.last_prominent_target_hover_frame = ImGui::GetFrameCount();
    }
    if (prominent && draw_hover_feedback) {
        draw_drag_navigation_hover_feedback(min, max);
    }

    const auto now = std::chrono::steady_clock::now();
    if (g_active_file_drag.hover_path != dest_dir) {
        g_active_file_drag.hover_path = dest_dir;
        g_active_file_drag.hover_started_at = now;
    }

    if (auto_navigate &&
        !active_drag_contains_path(dest_dir) &&
        g_active_file_drag.auto_navigated_path != dest_dir &&
        now - g_active_file_drag.hover_started_at >= kDragHoverNavigateDelay) {
        g_active_file_drag.auto_navigated_path = dest_dir;
        navigate_to_path(dest_dir);
        return;
    }

    const bool payload_delivered = accepted_payload != nullptr && accepted_payload->IsDelivery();
    if (!payload_delivered && !ImGui::IsMouseReleased(ImGuiMouseButton_Left)) {
        return;
    }

    std::vector<UnifiedFileItem> items = g_active_file_drag.items;
    if (!items.empty()) {
        perform_drop_items(state, items, dest_dir, ClipboardOp::CUT);
    }

    if (!g_active_file_drag.source_state_key.empty()) {
        auto& source_state = registry_.get_state<FileExplorerState>(g_active_file_drag.source_state_key);
        source_state.selected_files.clear();
        source_state.last_selected_index = -1;
    }

    g_active_file_drag.drop_consumed = true;
    g_active_file_drag.items.clear();
}

void FileExplorerPanel::handle_drag_navigation_target(FileExplorerState& state,
                                                      const std::string& target_path,
                                                      const ImVec2& min,
                                                      const ImVec2& max,
                                                      bool prominent,
                                                      std::function<void()> navigate_callback) {
    (void)state;
    if (target_path.empty() || max.x <= min.x || max.y <= min.y || !has_file_drag_context()) {
        return;
    }

    if (!mouse_in_rect(min, max)) {
        return;
    }

    accept_file_drag_payload_for_current_item();
    if (prominent) {
        g_active_file_drag.last_prominent_target_hover_frame = ImGui::GetFrameCount();
    }
    if (prominent) {
        draw_drag_navigation_hover_feedback(min, max);
    }

    const auto now = std::chrono::steady_clock::now();
    if (g_active_file_drag.hover_path != target_path) {
        g_active_file_drag.hover_path = target_path;
        g_active_file_drag.hover_started_at = now;
    }

    if (g_active_file_drag.auto_navigated_path == target_path ||
        now - g_active_file_drag.hover_started_at < kDragHoverNavigateDelay) {
        return;
    }

    g_active_file_drag.auto_navigated_path = target_path;
    if (navigate_callback) {
        navigate_callback();
    } else {
        navigate_to_path(target_path, true, false);
    }
}

void FileExplorerPanel::show_directory_contents(FileExplorerState& state) {
    static ImGuiTableFlags flags = ImGuiTableFlags_Reorderable | ImGuiTableFlags_Sortable |
        ImGuiTableFlags_Hideable | ImGuiTableFlags_Resizable |
        ImGuiTableFlags_ScrollX | ImGuiTableFlags_ScrollY |
        ImGuiTableFlags_SizingFixedFit;

    const bool loading = state.is_loading;
    const bool show_loading_animation = loading && state.show_loading_animation &&
        std::chrono::steady_clock::now() >= state.loading_animation_ready_at;
    const ImVec2 overlay_min = ImGui::GetCursorScreenPos();
    const ImVec2 overlay_size = ImGui::GetContentRegionAvail();
    const ImVec2 overlay_max(overlay_min.x + overlay_size.x, overlay_min.y + overlay_size.y);

    ImGuiIO& io = ImGui::GetIO();
    if (!loading && ImGui::IsWindowFocused(ImGuiFocusedFlags_RootAndChildWindows) && !io.WantTextInput) {
        if (CommandManager::get().matches("explorer.copy")) perform_copy(state);
        if (CommandManager::get().matches("explorer.cut")) perform_cut(state);
        if (CommandManager::get().matches("explorer.paste")) {
            auto& clipboard = registry_.get_state<ClipboardState>("Clipboard");
            if (clipboard.has_content()) perform_paste(state);
        }
        if (CommandManager::get().matches("explorer.undo")) perform_undo(state);
        if (CommandManager::get().matches("explorer.redo")) perform_redo(state);
        if (CommandManager::get().matches("explorer.delete") && !state.selected_files.empty()) perform_delete_selected(state);
        if (CommandManager::get().matches("explorer.rename") && !state.selected_files.empty()) initiate_rename(state);
        if (CommandManager::get().matches("explorer.refresh")) {
            std::string current(state.current_path);
            if (!current.empty()) {
                request_manual_refresh(state);
            }
        }
    }

    ImGui::PushStyleColor(ImGuiCol_Header, ImVec4(0.45f, 0.45f, 0.45f, 0.35f));
    ImGui::PushStyleColor(ImGuiCol_HeaderHovered, ImVec4(0.45f, 0.45f, 0.45f, 0.35f));
    ImGui::PushStyleColor(ImGuiCol_HeaderActive, ImVec4(0.45f, 0.45f, 0.45f, 0.45f));

    if (state.grid_view) {
        const float cell_w = 100.0f;
        const float cell_h = 104.0f;
        const float padding = 8.0f;

        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(padding, padding));
        if (state.files.empty()) {
            render_empty_state(48.0f);
        } else {
            float avail_w = ImGui::GetContentRegionAvail().x;
            int cols = std::max(1, static_cast<int>(avail_w / (cell_w + padding)));
            const float base_x = ImGui::GetCursorPosX();
            const float grid_width = cols * cell_w + std::max(0, cols - 1) * padding;
            const float side_padding = std::max(2.0f, (avail_w - grid_width) * 0.5f);
            for (int i = 0; i < static_cast<int>(state.files.size()); ++i) {
                const int column = i % cols;
                if (column == 0) {
                    ImGui::SetCursorPosX(base_x + side_padding);
                } else {
                    ImGui::SameLine(0.0f, padding);
                }
                show_grid_item(state, i, cell_w, cell_h);
            }

            if (ImGui::IsMouseClicked(ImGuiMouseButton_Right) &&
                ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup) &&
                !ImGui::IsAnyItemHovered() &&
                !ImGui::IsPopupOpen("FileContextMenu")) {
                state.context_menu_target_path.clear();
                state.selected_files.clear();
                ImGui::OpenPopup("BackgroundContextMenu");
            }

            show_context_menu(state);
            show_background_context_menu(state);
        }
        ImGui::PopStyleVar();
    } else {
        const float table_inner_width = kTableMinInnerWidth;
        if (ImGui::BeginTable("FileTable", 6, flags, ImVec2(0.0f, 0.0f), table_inner_width)) {
            ImGui::TableSetupScrollFreeze(0, 1);
            ImGui::TableSetupColumn("Name", ImGuiTableColumnFlags_WidthFixed | ImGuiTableColumnFlags_DefaultSort,
                                    kNameColumnWidth);
            ImGui::TableSetupColumn("Size", ImGuiTableColumnFlags_WidthFixed, kSizeColumnWidth);
            ImGui::TableSetupColumn("Type", ImGuiTableColumnFlags_WidthFixed, kTypeColumnWidth);
            ImGui::TableSetupColumn("Last Modified", ImGuiTableColumnFlags_WidthFixed, kModifiedColumnWidth);
            ImGui::TableSetupColumn("State", ImGuiTableColumnFlags_WidthFixed, kStateColumnWidth);
            ImGui::TableSetupColumn("Sync",
                                    ImGuiTableColumnFlags_WidthFixed |
                                        ImGuiTableColumnFlags_NoSort |
                                        ImGuiTableColumnFlags_NoResize,
                                    kSyncColumnWidth);
            ImGui::TableHeadersRow();

            if (ImGuiTableSortSpecs* sorts_specs = ImGui::TableGetSortSpecs()) {
                if (sorts_specs->SpecsDirty || state.sort_dirty) {
                    apply_table_sort(state, *sorts_specs);
                    sorts_specs->SpecsDirty = false;
                    state.sort_dirty = false;
                }
            }

            if (state.files.empty()) {
                ImGui::TableNextRow();
                ImGui::TableSetColumnIndex(0);
                render_empty_state(40.0f);
            } else {
                for (int i = 0; i < static_cast<int>(state.files.size()); ++i) {
                    show_file_item(state, i);
                }
            }

            show_context_menu(state);
            if (ImGui::IsMouseClicked(ImGuiMouseButton_Right) &&
                ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup) &&
                !ImGui::IsAnyItemHovered() &&
                !ImGui::IsPopupOpen("FileContextMenu")) {
                state.context_menu_target_path.clear();
                state.selected_files.clear();
                ImGui::OpenPopup("BackgroundContextMenu");
            }
            show_background_context_menu(state);
            ImGui::EndTable();
        }
    }

    if (!prominent_drag_target_hovered_this_frame() && !ImGui::IsAnyItemHovered()) {
        handle_file_drop_target(state, std::string(state.current_path), overlay_min, overlay_max, false, false);
    }
    draw_file_drag_preview(state);

    ImGui::PopStyleColor(3);

    if (show_loading_animation && overlay_size.x > 0.0f && overlay_size.y > 0.0f) {
        ImGui::SetCursorScreenPos(overlay_min);
        ImGui::InvisibleButton("##file_loading_blocker", overlay_size);
        misty::UI::DrawMistyLoadingAnimation(overlay_min, overlay_max);
    }

    show_rename_modal(state);
    show_new_entry_modal(state);
    show_permanent_delete_modal(state);
    show_permission_delete_modal(state);
}

void FileExplorerPanel::apply_table_sort(FileExplorerState& state, const ImGuiTableSortSpecs& sort_specs) {
    if (state.files.size() < 2 || sort_specs.SpecsCount <= 0 || sort_specs.Specs == nullptr) {
        return;
    }

    auto compare_for_column = [&state](const UnifiedFileItem& lhs, const UnifiedFileItem& rhs, ImGuiTableColumnSortSpecs spec) {
        int delta = 0;

        if (lhs.is_dir != rhs.is_dir) {
            delta = lhs.is_dir ? -1 : 1;
        } else {
            switch (static_cast<FileTableColumn>(spec.ColumnIndex)) {
                case FileTableColumn::Name:
                    delta = compare_strings(lhs.name, rhs.name);
                    break;
                case FileTableColumn::Size:
                    if (lhs.size < rhs.size) delta = -1;
                    else if (lhs.size > rhs.size) delta = 1;
                    break;
                case FileTableColumn::Type:
                    delta = compare_strings(type_label_for_item(lhs), type_label_for_item(rhs));
                    break;
                case FileTableColumn::LastModified:
                    delta = compare_strings(lhs.last_modified, rhs.last_modified);
                    break;
                case FileTableColumn::State:
                    delta = compare_strings(state_label_for_item(state, lhs), state_label_for_item(state, rhs));
                    break;
                case FileTableColumn::Sync:
                    if (lhs.sync_dirty != rhs.sync_dirty) delta = lhs.sync_dirty ? 1 : -1;
                    break;
            }
        }

        if (delta == 0) {
            delta = compare_strings(lhs.name, rhs.name);
        }
        if (delta == 0) {
            delta = compare_strings(lhs.path, rhs.path);
        }
        if (spec.SortDirection == ImGuiSortDirection_Descending) {
            delta = -delta;
        }
        return delta;
    };

    std::stable_sort(state.files.begin(), state.files.end(),
        [&sort_specs, &compare_for_column](const UnifiedFileItem& lhs, const UnifiedFileItem& rhs) {
            for (int i = 0; i < sort_specs.SpecsCount; ++i) {
                const int delta = compare_for_column(lhs, rhs, sort_specs.Specs[i]);
                if (delta < 0) return true;
                if (delta > 0) return false;
            }
            return false;
        });
}

void FileExplorerPanel::show_file_item(FileExplorerState& state, int i) {
    ImGuiIO& io = ImGui::GetIO();
    const UnifiedFileItem& file = state.files[i];
    bool is_selected = state.selected_files.count(file.id) > 0;

    float row_height = 32.0f;
    ImGui::TableNextRow(ImGuiTableRowFlags_None, row_height);
    ImGui::TableNextColumn();

    std::string label_id = "##row_" + file.id;

    ImVec2 p = ImGui::GetCursorScreenPos();
    if (ImGui::Selectable(label_id.c_str(), is_selected, ImGuiSelectableFlags_SpanAllColumns | ImGuiSelectableFlags_AllowDoubleClick, ImVec2(0, row_height))) {
        select_item(state, file, i, is_selected, io);
    }
    const ImVec2 row_min = ImGui::GetItemRectMin();
    const ImVec2 row_max = ImGui::GetItemRectMax();

    if (ImGui::IsItemHovered() && !is_selected) {
        ImDrawList* dl = ImGui::GetWindowDrawList();
        ImU32 col_left = ImGui::IsItemActive() ? IM_COL32(255, 255, 255, 30) : IM_COL32(255, 255, 255, 20);
        ImU32 col_right = IM_COL32(255, 255, 255, 0);
        dl->AddRectFilledMultiColor(row_min, row_max, col_left, col_right, col_right, col_left);
    }

    if (ImGui::IsItemClicked(ImGuiMouseButton_Right)) {
        state.context_menu_target_path = file.path;
        if (!is_selected) select_item(state, file, i, false, io);
        ImGui::OpenPopup("FileContextMenu");
    }

    begin_file_drag_source(state, file, i, is_selected);
    if (file.is_dir) {
        handle_file_drop_target(state,
                                file.path,
                                row_min,
                                row_max,
                                true,
                                true,
                                false);
    }
    const bool show_open_folder_icon = show_open_folder_for_drag_hover(file, row_min, row_max);

    if (ImGui::IsItemHovered() && ImGui::IsMouseDoubleClicked(0)) {
        if (file.is_dir) {
            std::string nav_path = file.path;
            navigate_to_path(nav_path);
            return;
        }

        if (file.source == FileSource::LOCAL) {
            state.add_recent(file);
            open_file(file.path);
        } else if (file.source == FileSource::REMOTE) {
            if (state.is_deleting(file.path)) {
                return;
            }
            if (fs::exists(file.path)) {
                state.add_recent(file);
                open_file(file.path);
            } else if (!state.is_downloading(file.path)) {
                state.add_recent(file);
                download_remote_file(file);
            }
        }
    }

    float content_padding_y = (row_height - 16.0f) / 2.0f;
    ImVec2 icon_p = ImVec2(p.x + 4.0f, p.y + content_padding_y);
    ImGui::SetCursorScreenPos(icon_p);
    auto& icon = AssetManager::get().get_svg_texture(icon_name_for_file(state, file, show_open_folder_icon), 16);
    if (icon.id != 0) {
        ImU32 icon_col = file.is_dir ? IM_COL32(230, 191, 76, 255) : IM_COL32(100, 170, 230, 255);
        if (state.is_deleting(file.path)) {
            icon_col = IM_COL32(180, 180, 180, 210);
        }
        ImGui::GetWindowDrawList()->AddImage(icon.id, icon_p, ImVec2(icon_p.x + 16, icon_p.y + 16), ImVec2(0, 0), ImVec2(1, 1), icon_col);
    }
    ImGui::Dummy(ImVec2(16, 16));

    ImGui::SameLine(0, 8.0f);
    float text_y_offset = (row_height - ImGui::GetTextLineHeight()) / 2.0f;
    ImGui::SetCursorScreenPos(ImVec2(ImGui::GetCursorScreenPos().x, p.y + text_y_offset));
    if (state.is_deleting(file.path)) {
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.72f, 0.72f, 0.72f, 1.0f));
        ImGui::TextUnformatted(file.name.c_str());
        ImGui::PopStyleColor();
    } else {
        ImGui::TextUnformatted(file.name.c_str());
    }

    ImGui::TableNextColumn();
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + text_y_offset);
    if (!file.is_dir && file.size > 0) {
        if (file.size < 1024) ImGui::Text("%lld B", file.size);
        else if (file.size < 1024 * 1024) ImGui::Text("%.1f KB", file.size / 1024.0);
        else if (file.size < 1024 * 1024 * 1024) ImGui::Text("%.1f MB", file.size / (1024.0 * 1024.0));
        else ImGui::Text("%.1f GB", file.size / (1024.0 * 1024.0 * 1024.0));
    } else {
        ImGui::Text("-");
    }

    ImGui::TableNextColumn();
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + text_y_offset);
    ImGui::Text("%s", file.is_dir ? "Folder" : "File");

    ImGui::TableNextColumn();
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + text_y_offset);
    if (!file.last_modified.empty()) ImGui::Text("%s", file.last_modified.c_str());
    else ImGui::Text("-");

    ImGui::TableNextColumn();
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + text_y_offset);
    ImGui::TextUnformatted(state_label_for_item(state, file).c_str());

    ImGui::TableNextColumn();
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + content_padding_y);
    if (file.source == FileSource::REMOTE) {
        auto& sync_icon = AssetManager::get().get_svg_texture(sync_icon_name_for_item(state, file), 16);
        if (sync_icon.id != 0) {
            ImGui::Image(sync_icon.id, ImVec2(16, 16), ImVec2(0, 0), ImVec2(1, 1),
                sync_icon_tint_for_item(state, file), ImVec4(0, 0, 0, 0));
        } else {
            ImGui::TextUnformatted(file.sync_dirty ? "!" : "");
        }

        if (ImGui::IsItemHovered()) {
            show_sync_tooltip_for_item(file);
        }
    } else {
        ImGui::TextUnformatted("-");
    }
}

void FileExplorerPanel::show_grid_item(FileExplorerState& state, int i, float cell_w, float cell_h) {
    ImGuiIO& io = ImGui::GetIO();
    const UnifiedFileItem& file = state.files[i];
    bool is_selected = state.selected_files.count(file.id) > 0;

    ImVec2 cell_pos = ImGui::GetCursorScreenPos();
    std::string btn_id = "##grid_" + file.id;
    bool clicked = ImGui::InvisibleButton(btn_id.c_str(), ImVec2(cell_w, cell_h));
    bool hovered = ImGui::IsItemHovered();
    bool double_clicked = hovered && ImGui::IsMouseDoubleClicked(0);

    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 cell_max = ImVec2(cell_pos.x + cell_w, cell_pos.y + cell_h);
    dl->PushClipRect(cell_pos, cell_max, true);
    if (is_selected) dl->AddRectFilled(cell_pos, cell_max, IM_COL32(255, 255, 255, 40), 6.0f);
    else if (hovered) dl->AddRectFilled(cell_pos, cell_max, IM_COL32(255, 255, 255, 20), 6.0f);

    const float icon_size = 32.0f;
    float icon_x = cell_pos.x + (cell_w - icon_size) * 0.5f;
    float icon_y = cell_pos.y + 10.0f;
    const bool show_open_folder_icon = show_open_folder_for_drag_hover(file, cell_pos, cell_max);
    auto& icon = AssetManager::get().get_svg_texture(icon_name_for_file(state, file, show_open_folder_icon), 32);
    if (icon.id != 0) {
        ImU32 icon_col = file.is_dir ? IM_COL32(230, 191, 76, 255) : IM_COL32(100, 170, 230, 255);
        if (state.is_deleting(file.path)) {
            icon_col = IM_COL32(180, 180, 180, 210);
        }
        dl->AddImage(icon.id, ImVec2(icon_x, icon_y), ImVec2(icon_x + icon_size, icon_y + icon_size), ImVec2(0, 0), ImVec2(1, 1), icon_col);
    }

    float text_y = icon_y + icon_size + 6.0f;
    const bool has_sync_badge = file.source == FileSource::REMOTE;
    const float sync_badge_size = has_sync_badge ? 14.0f : 0.0f;
    const float sync_badge_gap = has_sync_badge ? 4.0f : 0.0f;
    const float text_wrap_width = cell_w - 10.0f - sync_badge_size - sync_badge_gap;
    ImVec2 name_size = ImGui::CalcTextSize(file.name.c_str(), nullptr, false, text_wrap_width);
    const float visible_text_width = std::min(name_size.x, text_wrap_width);
    const float label_group_width = visible_text_width + sync_badge_size + sync_badge_gap;
    float group_x = cell_pos.x + (cell_w - label_group_width) * 0.5f;
    float text_x = group_x + sync_badge_size + sync_badge_gap;
    if (has_sync_badge) {
        const ImVec2 badge_min(group_x, text_y + 1.0f);
        const ImVec2 badge_max(badge_min.x + sync_badge_size, badge_min.y + sync_badge_size);
        auto& sync_icon = AssetManager::get().get_svg_texture(sync_icon_name_for_item(state, file), 14);
        if (sync_icon.id != 0) {
            dl->AddImage(sync_icon.id, badge_min, badge_max, ImVec2(0, 0), ImVec2(1, 1),
                ImGui::ColorConvertFloat4ToU32(sync_icon_tint_for_item(state, file)));
        } else {
            dl->AddText(ImVec2(group_x, text_y), IM_COL32(212, 212, 216, 255), file.sync_dirty ? "!" : "*");
        }
        if (hovered &&
            io.MousePos.x >= badge_min.x && io.MousePos.x <= badge_max.x &&
            io.MousePos.y >= badge_min.y && io.MousePos.y <= badge_max.y) {
            show_sync_tooltip_for_item(file);
        }
    }
    dl->AddText(ImGui::GetFont(), ImGui::GetFontSize(), ImVec2(text_x, text_y),
        state.is_deleting(file.path)
            ? IM_COL32(170, 170, 174, 255)
            : (is_selected ? IM_COL32(255, 255, 255, 255) : IM_COL32(212, 212, 216, 255)),
        file.name.c_str(), nullptr, text_wrap_width);
    dl->PopClipRect();

    if (clicked) select_item(state, file, i, is_selected, io);
    begin_file_drag_source(state, file, i, is_selected);
    if (file.is_dir) {
        handle_file_drop_target(state, file.path, cell_pos, cell_max, true, true, false);
    }

    if (double_clicked) {
        if (file.is_dir) {
            std::string nav_path = file.path;
            navigate_to_path(nav_path);
            return;
        }

        if (file.source == FileSource::LOCAL) {
            state.add_recent(file);
            open_file(file.path);
        } else if (file.source == FileSource::REMOTE) {
            if (state.is_deleting(file.path)) {
                return;
            }
            if (fs::exists(file.path)) {
                state.add_recent(file);
                open_file(file.path);
            } else if (!state.is_downloading(file.path)) {
                state.add_recent(file);
                download_remote_file(file);
            }
        }
    }

    if (ImGui::IsItemClicked(ImGuiMouseButton_Right)) {
        state.context_menu_target_path = file.path;
        if (!is_selected) select_item(state, file, i, false, io);
        ImGui::OpenPopup("FileContextMenu");
    }
}


} // namespace misty::panel
