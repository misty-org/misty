#include "panels/file_explorer/selection/drag_and_drop.h"

#include <algorithm>
#include <chrono>
#include <cmath>

#include "core/manager/asset_manager.h"
#include "panels/file_explorer/file_explorer_panel.h"

using namespace misty::core;

namespace misty::panel {
namespace {

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

}  // namespace

namespace selection_detail {

bool prominent_drag_target_hovered_this_frame() {
    return g_active_file_drag.last_prominent_target_hover_frame == ImGui::GetFrameCount();
}

bool show_open_folder_for_drag_hover(const UnifiedFileItem& file, const ImVec2& min, const ImVec2& max) {
    return file.is_dir &&
           has_file_drag_context() &&
           mouse_in_rect(min, max) &&
           !active_drag_contains_path(file.path);
}

void draw_file_drag_preview(const FileExplorerState& state,
                            const std::function<std::string(const UnifiedFileItem&)>& icon_name_for_file) {
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
        : icon_name_for_file(g_active_file_drag.items.front());
    auto& icon = AssetManager::get().get_svg_texture(icon_name, 32);

    const ImVec2 mouse = ImGui::GetIO().MousePos;
    const ImVec2 start(mouse.x + 14.0f, mouse.y + 12.0f);
    ImDrawList* dl = ImGui::GetForegroundDrawList();
    const ImU32 shadow = IM_COL32(0, 0, 0, 95);
    const ImU32 stack_back = IM_COL32(56, 56, 62, 238);
    const ImU32 stack_front = IM_COL32(82, 82, 92, 248);
    const ImU32 icon_col = includes_dir ? IM_COL32(230, 191, 76, 255) : IM_COL32(100, 170, 230, 255);
    (void)state;

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

}  // namespace selection_detail

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

}  // namespace misty::panel
