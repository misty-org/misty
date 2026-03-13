#include "panels/file_explorer/selection/drag_and_drop.h"

#include <algorithm>
#include <string>
#include <vector>

#include "panels/file_explorer/content/file_explorer_content_util.h"
#include "panels/file_explorer/file_explorer_panel.h"

namespace misty::panel {

namespace selection_detail {
namespace {

constexpr const char* kFileDragPayloadType = "MISTY_FILE_EXPLORER_ITEMS";
constexpr float kFolderHoverOpenDelaySeconds = 3.0f;
constexpr ImGuiHoveredFlags kDropWindowHoverFlags =
    ImGuiHoveredFlags_AllowWhenBlockedByActiveItem |
    ImGuiHoveredFlags_AllowWhenBlockedByPopup |
    ImGuiHoveredFlags_ChildWindows;

int g_prominent_drag_hover_frame = -1;
int g_drop_consumed_frame = -1;
std::string g_hover_navigation_target;
double g_hover_navigation_started_at = 0.0;
bool g_hover_navigation_consumed = false;

std::string encode_drag_payload(const std::string& source_state_key,
                                const std::vector<std::string>& selected_ids) {
    std::string payload = source_state_key;
    payload.push_back('\0');
    for (const auto& id : selected_ids) {
        payload += id;
        payload.push_back('\0');
    }
    return payload;
}

std::vector<std::string> decode_payload_tokens(const ImGuiPayload* payload) {
    std::vector<std::string> tokens;
    if (!payload || payload->Data == nullptr || payload->DataSize <= 0) {
        return tokens;
    }

    const char* data = static_cast<const char*>(payload->Data);
    const int size = payload->DataSize;
    int token_start = 0;
    for (int index = 0; index < size; ++index) {
        if (data[index] == '\0') {
            tokens.emplace_back(data + token_start, data + index);
            token_start = index + 1;
        }
    }
    if (token_start < size) {
        tokens.emplace_back(data + token_start, data + size);
    }
    return tokens;
}

bool decode_drag_payload(const ImGuiPayload* payload,
                         std::string& source_state_key,
                         std::vector<std::string>& selected_ids) {
    if (!payload || !payload->IsDataType(kFileDragPayloadType)) {
        return false;
    }

    std::vector<std::string> tokens = decode_payload_tokens(payload);
    if (tokens.empty() || tokens.front().empty()) {
        return false;
    }

    source_state_key = std::move(tokens.front());
    selected_ids.clear();
    selected_ids.reserve(tokens.size() - 1);
    for (std::size_t index = 1; index < tokens.size(); ++index) {
        if (!tokens[index].empty()) {
            selected_ids.push_back(std::move(tokens[index]));
        }
    }
    return !selected_ids.empty();
}

bool file_drag_payload_hovered(const ImVec2& min, const ImVec2& max) {
    const ImGuiPayload* payload = ImGui::GetDragDropPayload();
    return payload &&
           payload->IsDataType(kFileDragPayloadType) &&
           ImGui::IsWindowHovered(kDropWindowHoverFlags) &&
           ImGui::IsMouseHoveringRect(min, max, false);
}

} // namespace

bool prominent_drag_target_hovered_this_frame() {
    return g_prominent_drag_hover_frame == ImGui::GetFrameCount();
}

bool show_open_folder_for_drag_hover(const FileItem& file, const ImVec2& min, const ImVec2& max) {
    return file.is_dir && file_drag_payload_hovered(min, max);
}

void draw_file_drag_preview(const FileExplorerState& state,
                            const std::function<std::string(const FileItem&)>& icon_name_for_file) {
    (void)state;
    (void)icon_name_for_file;
}

}  // namespace selection_detail

void FileExplorerPanel::begin_file_drag_source(FileExplorerState& state,
                                               FileListing& listing,
                                               FileExplorerPanel::TransientUiState& ui,
                                               const FileItem& file,
                                               int index,
                                               bool is_selected) {
    if (!is_file_master_item(file) || !ImGui::BeginDragDropSource(ImGuiDragDropFlags_SourceAllowNullID)) {
        return;
    }

    if (!is_selected) {
        ui.selected_files.clear();
        ui.selected_files.insert(file.id);
        ui.last_selected_index = index;
        state.selected_files = ui.selected_files;
        const std::string current_path(state.current_path);
        if (!current_path.empty()) {
            state.selected_files_by_path[current_path] = state.selected_files;
            state.last_selected_index_by_path[current_path] = ui.last_selected_index;
        }
    }

    std::vector<std::string> selected_ids;
    selected_ids.reserve(ui.selected_files.size());
    for (const auto& selected_id : ui.selected_files) {
        const FileItem* selected = find_file_item_by_id(listing, selected_id);
        if (selected && is_file_master_item(*selected)) {
            selected_ids.push_back(selected_id);
        }
    }
    if (selected_ids.empty()) {
        selected_ids.push_back(file.id);
    }

    const std::string payload = selection_detail::encode_drag_payload(state_key_, selected_ids);
    ImGui::SetDragDropPayload(selection_detail::kFileDragPayloadType, payload.data(), static_cast<int>(payload.size()));
    ImGui::Text("%s %zu %s",
                ImGui::GetIO().KeyShift ? "Copy" : "Move",
                selected_ids.size(),
                selected_ids.size() == 1 ? "item" : "items");
    ImGui::EndDragDropSource();
}

void FileExplorerPanel::handle_file_drop_target(FileExplorerState& state,
                                                const std::string& dest_dir,
                                                const ImVec2& min,
                                                const ImVec2& max,
                                                bool prominent,
                                                bool auto_navigate,
                                                bool draw_hover_feedback) {
    (void)state;
    (void)auto_navigate;

    const ImGuiPayload* payload = ImGui::GetDragDropPayload();
    if (!payload || !payload->IsDataType(selection_detail::kFileDragPayloadType)) {
        return;
    }
    if (selection_detail::g_drop_consumed_frame == ImGui::GetFrameCount()) {
        return;
    }

    const bool hovered =
        ImGui::IsWindowHovered(selection_detail::kDropWindowHoverFlags) &&
        ImGui::IsMouseHoveringRect(min, max, false);
    if (!hovered) {
        return;
    }

    if (prominent) {
        selection_detail::g_prominent_drag_hover_frame = ImGui::GetFrameCount();
    }

    if (draw_hover_feedback) {
        const ImU32 fill = prominent ? IM_COL32(241, 238, 232, 44) : IM_COL32(241, 238, 232, 26);
        const ImU32 border = prominent ? IM_COL32(201, 196, 188, 150) : IM_COL32(201, 196, 188, 92);
        ImDrawList* draw = ImGui::GetWindowDrawList();
        draw->AddRectFilled(min, max, fill, 4.0f);
        draw->AddRect(min, max, border, 4.0f, 0, 1.0f);
    }

    if (!ImGui::IsMouseReleased(ImGuiMouseButton_Left)) {
        return;
    }

    std::string resolved_dest;
    if (!resolve_drop_destination_path(dest_dir, resolved_dest) || resolved_dest.empty()) {
        return;
    }

    std::string source_state_key;
    std::vector<std::string> selected_ids;
    if (!selection_detail::decode_drag_payload(payload, source_state_key, selected_ids)) {
        return;
    }

    const ClipboardOp op = ImGui::GetIO().KeyShift ? ClipboardOp::COPY : ClipboardOp::CUT;
    drop_selected_items_to_path(source_state_key, selected_ids, resolved_dest, op);
    selection_detail::g_drop_consumed_frame = ImGui::GetFrameCount();
}

void FileExplorerPanel::handle_drag_navigation_target(FileExplorerState& state,
                                                      const std::string& target_path,
                                                      const ImVec2& min,
                                                      const ImVec2& max,
                                                      bool prominent,
                                                      std::function<void()> navigate_callback) {
    handle_file_drop_target(state, target_path, min, max, prominent, true, true);

    const ImGuiPayload* payload = ImGui::GetDragDropPayload();
    if (!payload || !payload->IsDataType(selection_detail::kFileDragPayloadType)) {
        selection_detail::g_hover_navigation_target.clear();
        selection_detail::g_hover_navigation_started_at = 0.0;
        selection_detail::g_hover_navigation_consumed = false;
        return;
    }

    const bool hovered = selection_detail::file_drag_payload_hovered(min, max);
    if (!hovered || target_path.empty() || !navigate_callback) {
        return;
    }

    const double now = ImGui::GetTime();
    if (selection_detail::g_hover_navigation_target != target_path) {
        selection_detail::g_hover_navigation_target = target_path;
        selection_detail::g_hover_navigation_started_at = now;
        selection_detail::g_hover_navigation_consumed = false;
        return;
    }

    if (!selection_detail::g_hover_navigation_consumed &&
        now - selection_detail::g_hover_navigation_started_at >= selection_detail::kFolderHoverOpenDelaySeconds) {
        selection_detail::g_hover_navigation_consumed = true;
        pending_drag_navigation_path_ = target_path;
    }
}

}  // namespace misty::panel
