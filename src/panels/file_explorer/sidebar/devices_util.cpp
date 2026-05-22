#include "panels/file_explorer/sidebar/devices_util.h"

#include <algorithm>
#include <cstdio>
#include <cmath>
#include <filesystem>

namespace fs = std::filesystem;

namespace {
constexpr const char* kFileDragPayloadType = "MISTY_FILE_ITEMS";

std::string format_sidebar_bytes(uint64_t bytes) {
    static constexpr const char* kUnits[] = {"B", "KB", "MB", "GB", "TB"};
    double value = static_cast<double>(bytes);
    int unit = 0;
    while (value >= 1024.0 && unit < 4) {
        value /= 1024.0;
        ++unit;
    }

    char buf[32];
    if (unit == 0) {
        std::snprintf(buf, sizeof(buf), "%.0f %s", value, kUnits[unit]);
    } else if (value >= 100.0 || std::fabs(value - std::round(value)) < 0.05) {
        std::snprintf(buf, sizeof(buf), "%.0f %s", value, kUnits[unit]);
    } else {
        std::snprintf(buf, sizeof(buf), "%.1f %s", value, kUnits[unit]);
    }
    return buf;
}

void draw_drive_icon(ImDrawList* draw_list, ImVec2 center, bool removable, ImU32 color) {
    if (removable) {
        const ImVec2 p1(center.x - 10.0f, center.y + 8.0f);
        const ImVec2 p2(center.x + 10.0f, center.y + 8.0f);
        const ImVec2 p3(center.x + 7.0f, center.y - 8.0f);
        const ImVec2 p4(center.x - 7.0f, center.y - 8.0f);
        draw_list->AddQuad(p1, p2, p3, p4, color, 2.0f);
        draw_list->AddLine(ImVec2(center.x - 7.0f, center.y + 4.0f),
                           ImVec2(center.x + 7.0f, center.y + 4.0f),
                           color, 2.0f);
        return;
    }

    draw_list->AddRect(ImVec2(center.x - 11.0f, center.y - 8.0f),
                       ImVec2(center.x + 11.0f, center.y + 8.0f),
                       color, 3.0f, 0, 2.0f);
    draw_list->AddLine(ImVec2(center.x - 7.0f, center.y + 4.0f),
                       ImVec2(center.x + 7.0f, center.y + 4.0f),
                       color, 2.0f);
}
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
    const float height = ImGui::GetTextLineHeight() + 8.0f;

    ImGui::PushID("dev_hdr");
    if (ImGui::InvisibleButton("##hdr", ImVec2(content_width, height))) {
        result.toggle_collapsed = true;
    }
    ImGui::PopID();

    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    draw_list->AddText(ImVec2(hdr_cursor.x + 4.0f, hdr_cursor.y + 2.0f),
                       IM_COL32(210, 214, 222, 255), "Devices");

    const float tri_x  = hdr_cursor.x + content_width - 18.0f;
    const float mid_y  = hdr_cursor.y + height * 0.5f;
    const ImU32 tri_col = IM_COL32(225, 229, 238, 235);
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
    ImGui::TextUnformatted("No devices connected");
    ImGui::PopStyleColor();
}

DeviceRowResult render_device_row(
    const DeviceDisplayEntry& entry,
    float content_width,
    const std::function<void(const std::string&, const std::string&, ClipboardOp)>& file_drop_handler) {
    DeviceRowResult result;
    const MountedDevice& device = entry.device;

    constexpr float kItemHeight = 72.0f;
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
        const ImU32 col_l = main_active ? IM_COL32(255,255,255,30) : IM_COL32(255,255,255,18);
        draw_list->AddRectFilledMultiColor(
            cursor, ImVec2(cursor.x + content_width, cursor.y + kItemHeight),
            col_l, IM_COL32(255,255,255,0), IM_COL32(255,255,255,0), col_l);
    }

    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    const float icon_center_y = cursor.y + 31.0f;
    draw_drive_icon(draw_list, ImVec2(cursor.x + 22.0f, icon_center_y),
                    device.is_removable, IM_COL32(232, 236, 244, 245));

    const float text_x = cursor.x + 50.0f;
    draw_list->AddText(ImVec2(text_x, cursor.y + 7.0f),
                       IM_COL32(236, 239, 246, 255), device.name.c_str());

    std::string info;
    if (device.total_bytes > 0) {
        info = format_sidebar_bytes(device.free_bytes) + " free of " + format_sidebar_bytes(device.total_bytes);
    } else if (!device.fs_type.empty()) {
        info = device.fs_type;
    } else {
        info = device.mount_path;
    }
    draw_list->AddText(ImGui::GetFont(), ImGui::GetFontSize() * 0.85f,
                       ImVec2(text_x, cursor.y + 28.0f),
                       IM_COL32(164, 169, 181, 255), info.c_str());

    if (device.total_bytes > 0) {
        const float fill = std::clamp(static_cast<float>(device.free_bytes) /
                                      static_cast<float>(device.total_bytes), 0.0f, 1.0f);
        const float bar_x = text_x;
        const float bar_y = cursor.y + 52.0f;
        const float bar_w = std::max(20.0f, content_width - text_x + cursor.x - 18.0f);
        draw_list->AddRectFilled(ImVec2(bar_x, bar_y),
                                 ImVec2(bar_x + bar_w, bar_y + 5.0f),
                                 IM_COL32(47, 51, 59, 255), 2.5f);
        const ImU32 fill_col = fill < 0.10f ? IM_COL32(210, 70, 70, 255)
                                            : IM_COL32(95, 154, 233, 255);
        draw_list->AddRectFilled(ImVec2(bar_x, bar_y),
                                 ImVec2(bar_x + bar_w * fill, bar_y + 5.0f),
                                 fill_col, 2.5f);
    }

    ImGui::PopID();

    if (pressed && !dots_hovered && !drop_delivered) {
        result.navigate_to_mount = true;
    }

    return result;
}

}  // namespace misty::panel
