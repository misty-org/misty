#include "panels/file_explorer/sidebar/devices_util.h"

#include "core/manager/asset_manager.h"

#include <algorithm>
#include <cstdio>
#include <cmath>
#include <filesystem>
#include <string>

namespace fs = std::filesystem;

namespace {
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

void draw_svg_icon(ImDrawList* draw_list,
                   const char* icon_name,
                   ImVec2 center,
                   float size,
                   ImU32 tint,
                   bool apply_theme = true) {
    auto& icon = apply_theme
        ? misty::core::AssetManager::get().get_svg_texture(icon_name, static_cast<int>(size))
        : misty::core::AssetManager::get().get_svg_texture_path(
            std::string("assets/icons/") + icon_name + ".svg",
            static_cast<int>(size),
            false);
    if (icon.id == 0) {
        return;
    }
    const ImVec2 min(center.x - size * 0.5f, center.y - size * 0.5f);
    draw_list->AddImage(icon.id,
                        min,
                        ImVec2(min.x + size, min.y + size),
                        ImVec2(0, 0),
                        ImVec2(1, 1),
                        tint);
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
    const float height = ImGui::GetTextLineHeight() + 5.0f;

    ImGui::PushID("dev_hdr");
    if (ImGui::InvisibleButton("##hdr", ImVec2(content_width, height))) {
        result.toggle_collapsed = true;
    }
    ImGui::PopID();

    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    draw_list->AddText(ImVec2(hdr_cursor.x + 2.0f, hdr_cursor.y + 1.0f),
                       IM_COL32(210, 214, 222, 255), "Devices");

    constexpr float kChevronSize = 14.0f;
    draw_svg_icon(draw_list,
                  collapsed ? "chevron-right-16" : "chevron-down-16",
                  ImVec2(hdr_cursor.x + content_width - kChevronSize * 0.5f - 2.0f,
                         hdr_cursor.y + height * 0.5f),
                  kChevronSize,
                  IM_COL32(225, 229, 238, 235));

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
    (void)file_drop_handler;
    const MountedDevice& device = entry.device;

    constexpr float kItemHeight = 58.0f;
    constexpr float kDotsWidth = 18.0f;
    const ImVec2 cursor = ImGui::GetCursorScreenPos();

    ImGui::PushID(device.mount_path.c_str());
    const bool pressed = ImGui::InvisibleButton("##dev", ImVec2(content_width - kDotsWidth, kItemHeight));
    const bool main_hovered = ImGui::IsItemHovered();
    const bool main_active = ImGui::IsItemActive();

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
        draw_list->AddCircleFilled(ImVec2(cx, cy - 4.0f), 1.5f, dot_col);
        draw_list->AddCircleFilled(ImVec2(cx, cy), 1.5f, dot_col);
        draw_list->AddCircleFilled(ImVec2(cx, cy + 4.0f), 1.5f, dot_col);
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
        const ImU32 row_col = main_active ? IM_COL32(255,255,255,32) : IM_COL32(255,255,255,18);
        draw_list->AddRectFilled(cursor, ImVec2(cursor.x + content_width, cursor.y + kItemHeight),
                                 row_col, 7.0f);
    }

    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    const float icon_center_y = cursor.y + 26.0f;
    draw_svg_icon(draw_list,
                  "ssd-square-24",
                  ImVec2(cursor.x + 15.0f, icon_center_y),
                  20.0f,
                  IM_COL32(232, 236, 244, 245));

    const float text_x = cursor.x + 34.0f;
    draw_list->AddText(ImVec2(text_x, cursor.y + 6.0f),
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
                       ImVec2(text_x, cursor.y + 25.0f),
                       IM_COL32(164, 169, 181, 255), info.c_str());

    if (device.total_bytes > 0) {
        const float fill = std::clamp(static_cast<float>(device.free_bytes) /
                                      static_cast<float>(device.total_bytes), 0.0f, 1.0f);
        const float bar_x = text_x;
        const float bar_y = cursor.y + 46.0f;
        const float bar_w = std::max(20.0f, content_width - text_x + cursor.x - 12.0f);
        draw_list->AddRectFilled(ImVec2(bar_x, bar_y),
                                 ImVec2(bar_x + bar_w, bar_y + 4.0f),
                                 IM_COL32(47, 51, 59, 255), 2.0f);
        const ImU32 fill_col = fill < 0.10f ? IM_COL32(210, 70, 70, 255)
                                            : IM_COL32(95, 154, 233, 255);
        draw_list->AddRectFilled(ImVec2(bar_x, bar_y),
                                 ImVec2(bar_x + bar_w * fill, bar_y + 4.0f),
                                 fill_col, 2.0f);
    }

    ImGui::PopID();

    if (pressed && !dots_hovered) {
        result.navigate_to_mount = true;
    }

    return result;
}

}  // namespace misty::panel
