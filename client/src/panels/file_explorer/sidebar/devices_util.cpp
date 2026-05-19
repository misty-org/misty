#include "panels/file_explorer/sidebar/devices_util.h"

#include <algorithm>
#include <cmath>
#include <filesystem>

#include "core/system/util.h"

namespace fs = std::filesystem;

namespace {
constexpr const char* kFileDragPayloadType = "MISTY_FILE_ITEMS";
}

namespace misty::panel {

bool devices_refresh_button(const char* id, float size) {
    ImGui::PushID(id);
    const bool clicked = ImGui::InvisibleButton("##", ImVec2(size, size));
    const bool hovered = ImGui::IsItemHovered();
    const bool active  = ImGui::IsItemActive();
    ImGui::PopID();

    const ImVec2 p0 = ImGui::GetItemRectMin();
    const float cx = p0.x + size * 0.5f;
    const float cy = p0.y + size * 0.5f;
    const float r  = size * 0.33f;

    const ImU32 col = active  ? IM_COL32(230, 230, 230, 255)
                    : hovered ? IM_COL32(190, 190, 190, 255)
                              : IM_COL32(120, 120, 120, 200);

    ImDrawList* dl = ImGui::GetWindowDrawList();
    static constexpr float kPi = 3.14159265f;
    const float a0 = kPi * 0.30f;
    const float a1 = kPi * 2.20f;
    dl->PathArcTo(ImVec2(cx, cy), r, a0, a1, 24);
    dl->PathStroke(col, false, 1.5f);

    const float tx = -std::sinf(a1);
    const float ty = std::cosf(a1);
    const float nx = std::cosf(a1);
    const float ny = std::sinf(a1);
    const ImVec2 tip{ cx + r * std::cosf(a1), cy + r * std::sinf(a1) };
    const float hw = 2.4f;
    const float hl = 4.2f;
    dl->AddTriangleFilled(
        tip,
        ImVec2(tip.x - tx * hl - nx * hw, tip.y - ty * hl - ny * hw),
        ImVec2(tip.x - tx * hl + nx * hw, tip.y - ty * hl + ny * hw),
        col);

    return clicked;
}

DeviceHeaderResult render_devices_header(bool collapsed, float content_width) {
    DeviceHeaderResult result;

    const ImVec2 hdr_cursor = ImGui::GetCursorScreenPos();
    const float height = ImGui::GetTextLineHeight() + 4.0f;

    ImGui::PushID("dev_hdr");
    if (ImGui::InvisibleButton("##hdr", ImVec2(content_width - 44.0f, height))) {
        result.toggle_collapsed = true;
    }
    const bool hovered = ImGui::IsMouseHoveringRect(
        hdr_cursor, ImVec2(hdr_cursor.x + content_width, hdr_cursor.y + height));
    ImGui::PopID();

    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    draw_list->AddText(ImVec2(hdr_cursor.x + 4.0f, hdr_cursor.y + 2.0f),
                       IM_COL32(178, 178, 178, 255), "Devices");
    if (hovered) {
        const float text_w = ImGui::CalcTextSize("Devices").x;
        const float tri_x  = hdr_cursor.x + 4.0f + text_w + 6.0f;
        const float mid_y  = hdr_cursor.y + height * 0.5f;
        const ImU32 tri_col = IM_COL32(160, 160, 160, 220);
        if (collapsed) {
            draw_list->AddTriangleFilled(
                ImVec2(tri_x,        mid_y - 4.0f),
                ImVec2(tri_x,        mid_y + 4.0f),
                ImVec2(tri_x + 7.0f, mid_y), tri_col);
        } else {
            draw_list->AddTriangleFilled(
                ImVec2(tri_x - 4.0f, mid_y - 2.0f),
                ImVec2(tri_x + 4.0f, mid_y - 2.0f),
                ImVec2(tri_x,        mid_y + 4.0f), tri_col);
        }
    }

    ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0,0,0,0));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(1,1,1,0.12f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(1,1,1,0.06f));
    ImGui::PushStyleColor(ImGuiCol_Text,          ImVec4(0.5f,0.5f,0.5f,1.0f));

    ImGui::SameLine(content_width - 40.0f);
    if (ImGui::SmallButton("+##add_dev")) {
        result.request_add_device = true;
    }
    ImGui::SameLine(0, 6);

    ImGui::PopStyleColor(4);

    if (devices_refresh_button("dev_ref")) {
        result.request_rescan = true;
    }

    return result;
}

std::vector<DeviceDisplayEntry> build_device_display_entries(
    const std::vector<MountedDevice>& cached_devices,
    const std::unordered_map<std::string, std::string>& name_overrides,
    const std::unordered_set<std::string>& hidden_paths,
    const std::vector<std::string>& custom_mount_paths) {
    std::vector<DeviceDisplayEntry> entries;

    for (const auto& device : cached_devices) {
        if (hidden_paths.count(device.mount_path)) continue;
        MountedDevice display = device;
        if (const auto it = name_overrides.find(device.mount_path); it != name_overrides.end()) {
            display.name = it->second;
        }
        entries.push_back({std::move(display)});
    }

    for (const auto& path : custom_mount_paths) {
        if (hidden_paths.count(path)) continue;
        const bool already_shown = std::any_of(
            cached_devices.begin(), cached_devices.end(),
            [&path](const MountedDevice& device) { return device.mount_path == path; });
        if (already_shown) continue;

        MountedDevice display;
        display.mount_path = path;
        if (const auto it = name_overrides.find(path); it != name_overrides.end()) {
            display.name = it->second;
        } else {
            display.name = fs::path(path).filename().string();
        }
        if (display.name.empty()) display.name = path;
        entries.push_back({std::move(display)});
    }

    return entries;
}

void render_empty_devices_row(float x_position) {
    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
    ImGui::SetCursorPosX(x_position);
    ImGui::TextUnformatted("No drives found");
    ImGui::PopStyleColor();
}

DeviceRowResult render_device_row(
    const DeviceDisplayEntry& entry,
    float content_width,
    const std::function<void(const std::string&, const std::string&, ClipboardOp)>& file_drop_handler) {
    DeviceRowResult result;
    const MountedDevice& device = entry.device;

    constexpr float kItemHeight = 42.0f;
    constexpr float kDotsWidth = 24.0f;
    const ImVec2 cursor = ImGui::GetCursorScreenPos();

    ImGui::PushID(device.mount_path.c_str());
    const bool pressed = ImGui::InvisibleButton("##dev", ImVec2(content_width - kDotsWidth, kItemHeight));
    const bool main_hovered = ImGui::IsItemHovered();
    const bool main_active = ImGui::IsItemActive();
    bool drop_delivered = false;
    if (ImGui::BeginDragDropTarget()) {
        if (const ImGuiPayload* payload = ImGui::AcceptDragDropPayload(
                kFileDragPayloadType, ImGuiDragDropFlags_AcceptBeforeDelivery)) {
            if (payload->Data != nullptr && payload->DataSize > 0 && payload->IsDelivery()) {
                const char* data = static_cast<const char*>(payload->Data);
                if (file_drop_handler) {
                    file_drop_handler(std::string(data), device.mount_path, ClipboardOp::CUT);
                }
                drop_delivered = true;
            }
        }
        ImGui::EndDragDropTarget();
    }

    ImGui::SameLine(0, 0);
    const bool rect_hovered = ImGui::IsMouseHoveringRect(
        cursor, ImVec2(cursor.x + content_width, cursor.y + kItemHeight));
    const bool dots_clicked = ImGui::InvisibleButton("##dots", ImVec2(kDotsWidth, kItemHeight));
    const bool dots_hovered = ImGui::IsItemHovered();

    if (rect_hovered) {
        ImDrawList* draw_list = ImGui::GetWindowDrawList();
        const float cx = cursor.x + content_width - kDotsWidth * 0.5f;
        const float cy = cursor.y + kItemHeight * 0.5f;
        const ImU32 dot_col = dots_hovered
            ? IM_COL32(220, 220, 220, 255)
            : IM_COL32(160, 160, 160, 200);
        draw_list->AddCircleFilled(ImVec2(cx, cy - 5.0f), 1.8f, dot_col);
        draw_list->AddCircleFilled(ImVec2(cx, cy), 1.8f, dot_col);
        draw_list->AddCircleFilled(ImVec2(cx, cy + 5.0f), 1.8f, dot_col);
    }

    if (dots_clicked) {
        ImGui::OpenPopup("##devctx");
    }
    if (ImGui::BeginPopup("##devctx")) {
        if (ImGui::MenuItem("Rename")) {
            result.request_rename = true;
        }
        if (ImGui::MenuItem("Hide")) {
            result.request_hide = true;
        }
        ImGui::EndPopup();
    }

    if (main_hovered || main_active || rect_hovered) {
        ImDrawList* draw_list = ImGui::GetWindowDrawList();
        const ImU32 col_l = main_active ? IM_COL32(255,255,255,30) : IM_COL32(255,255,255,20);
        draw_list->AddRectFilledMultiColor(
            cursor, ImVec2(cursor.x + content_width, cursor.y + kItemHeight),
            col_l, IM_COL32(255,255,255,0), IM_COL32(255,255,255,0), col_l);
    }

    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    draw_list->AddText(ImVec2(cursor.x + 8.0f, cursor.y + 5.0f),
                       IM_COL32(220, 220, 220, 255), device.name.c_str());

    std::string info = device.fs_type;
    if (device.total_bytes > 0) {
        info += "  ·  " + core::format_bytes(device.free_bytes) + " free";
    }
    draw_list->AddText(ImGui::GetFont(), ImGui::GetFontSize() * 0.85f,
                       ImVec2(cursor.x + 8.0f, cursor.y + 22.0f),
                       IM_COL32(130, 130, 130, 255), info.c_str());

    if (device.total_bytes > 0) {
        const float fill = 1.0f - static_cast<float>(device.free_bytes) /
                                     static_cast<float>(device.total_bytes);
        const float bar_x = cursor.x + 8.0f;
        const float bar_y = cursor.y + kItemHeight - 7.0f;
        const float bar_w = content_width - 16.0f;
        draw_list->AddRectFilled(ImVec2(bar_x, bar_y),
                                 ImVec2(bar_x + bar_w, bar_y + 3.0f),
                                 IM_COL32(60, 60, 60, 255), 1.5f);
        const ImU32 fill_col = (fill > 0.9f) ? IM_COL32(210, 70, 70, 255)
                                             : IM_COL32(100, 170, 230, 255);
        draw_list->AddRectFilled(ImVec2(bar_x, bar_y),
                                 ImVec2(bar_x + bar_w * fill, bar_y + 3.0f),
                                 fill_col, 1.5f);
    }

    ImGui::PopID();

    if (pressed && !dots_hovered && !drop_delivered) {
        result.navigate_to_mount = true;
    }

    return result;
}

}  // namespace misty::panel
