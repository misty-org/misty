#include "file_sidebar_panel.h"

#include "core/system/util.h"
#include "panels/file_explorer/file_explorer_state.h"

#include <algorithm>

namespace fs = std::filesystem;

namespace {
    bool RefreshButton(const char* id, float size = 14.0f) {
        ImGui::PushID(id);
        bool clicked = ImGui::InvisibleButton("##", ImVec2(size, size));
        bool hovered = ImGui::IsItemHovered();
        bool active  = ImGui::IsItemActive();
        ImGui::PopID();

        ImVec2 p0 = ImGui::GetItemRectMin();
        float cx = p0.x + size * 0.5f;
        float cy = p0.y + size * 0.5f;
        float r  = size * 0.33f;

        ImU32 col = active  ? IM_COL32(230, 230, 230, 255)
                  : hovered ? IM_COL32(190, 190, 190, 255)
                            : IM_COL32(120, 120, 120, 200);

        ImDrawList* dl = ImGui::GetWindowDrawList();
        static constexpr float kPi = 3.14159265f;
        float a0 = kPi * 0.30f;
        float a1 = kPi * 2.20f;
        dl->PathArcTo(ImVec2(cx, cy), r, a0, a1, 24);
        dl->PathStroke(col, false, 1.5f);

        float tx = -std::sinf(a1), ty = std::cosf(a1);
        float nx = std::cosf(a1), ny = std::sinf(a1);
        ImVec2 tip{ cx + r * std::cosf(a1), cy + r * std::sinf(a1) };
        float hw = 2.4f, hl = 4.2f;
        dl->AddTriangleFilled(
            tip,
            ImVec2(tip.x - tx * hl - nx * hw, tip.y - ty * hl - ny * hw),
            ImVec2(tip.x - tx * hl + nx * hw, tip.y - ty * hl + ny * hw),
            col);

        return clicked;
    }

}

namespace misty::panel {
    void FileSidebarPanel::show_devices_section(float width, float padding) {
        bool do_rescan = cached_devices_.empty() || device_watcher_.has_changed();

        float content_width = width - (padding * 2.0f);
        ImGui::SetCursorPosX(padding);
        ImGui::BeginGroup();

        // ── Header row ───────────────────────────────────────────────────────
        {
            ImVec2 hdr_cursor = ImGui::GetCursorScreenPos();
            float h = ImGui::GetTextLineHeight() + 4.0f;

            // Collapse area (leave room for + and ↻ buttons on the right)
            ImGui::PushID("dev_hdr");
            if (ImGui::InvisibleButton("##hdr", ImVec2(content_width - 44.0f, h)))
                devices_collapsed_ = !devices_collapsed_;
            bool dev_hdr_hovered = ImGui::IsMouseHoveringRect(
                hdr_cursor, ImVec2(hdr_cursor.x + content_width, hdr_cursor.y + h));
            ImGui::PopID();

            // Label + hover-only triangle to its right
            ImDrawList* hdr_dl = ImGui::GetWindowDrawList();
            hdr_dl->AddText(ImVec2(hdr_cursor.x + 4.0f, hdr_cursor.y + 2.0f),
                            IM_COL32(178, 178, 178, 255), "Devices");
            if (dev_hdr_hovered) {
                const char* lbl = "Devices";
                float text_w = ImGui::CalcTextSize(lbl).x;
                float tri_x  = hdr_cursor.x + 4.0f + text_w + 6.0f;
                float mid_y  = hdr_cursor.y + h * 0.5f;
                ImU32 tri_col = IM_COL32(160, 160, 160, 220);
                if (devices_collapsed_) {
                    hdr_dl->AddTriangleFilled(
                        ImVec2(tri_x,        mid_y - 4.0f),
                        ImVec2(tri_x,        mid_y + 4.0f),
                        ImVec2(tri_x + 7.0f, mid_y), tri_col);
                } else {
                    hdr_dl->AddTriangleFilled(
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
            if (ImGui::SmallButton("+##add_dev")) show_add_device_modal_ = true;
            ImGui::SameLine(0, 6);

            ImGui::PopStyleColor(4);

            if (RefreshButton("dev_ref")) do_rescan = true;
        }

        if (do_rescan) cached_devices_ = scan_mounted_devices();

        if (!devices_collapsed_) {
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 2.0f));

            // Build display list: cached (apply name overrides, skip hidden) + custom paths
            std::vector<MountedDevice> display_devices;
            for (const auto& dev : cached_devices_) {
                if (hidden_device_paths_.count(dev.mount_path)) continue;
                MountedDevice d = dev;
                auto it = device_name_overrides_.find(dev.mount_path);
                if (it != device_name_overrides_.end()) d.name = it->second;
                display_devices.push_back(std::move(d));
            }
            for (const auto& path : custom_mount_paths_) {
                if (hidden_device_paths_.count(path)) continue;
                bool already_shown = std::any_of(
                    cached_devices_.begin(), cached_devices_.end(),
                    [&path](const MountedDevice& d) { return d.mount_path == path; });
                if (already_shown) continue;
                MountedDevice d;
                d.mount_path = path;
                auto nit = device_name_overrides_.find(path);
                d.name = (nit != device_name_overrides_.end())
                    ? nit->second : fs::path(path).filename().string();
                if (d.name.empty()) d.name = path;
                display_devices.push_back(std::move(d));
            }

            if (display_devices.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
                ImGui::SetCursorPosX(padding + 8.0f);
                ImGui::TextUnformatted("No drives found");
                ImGui::PopStyleColor();
            }

            for (auto& dev : display_devices) {
                const float item_h  = 42.0f;
                const float dots_w  = 24.0f;
                ImVec2 cursor = ImGui::GetCursorScreenPos();

                ImGui::PushID(dev.mount_path.c_str());

                // Main clickable area (narrower to leave room for ⋮ button)
                bool pressed      = ImGui::InvisibleButton("##dev", ImVec2(content_width - dots_w, item_h));
                bool main_hovered = ImGui::IsItemHovered();
                bool main_active  = ImGui::IsItemActive();

                // Three-dot button — always laid out, only drawn when item is hovered
                ImGui::SameLine(0, 0);
                bool rect_hovered = ImGui::IsMouseHoveringRect(
                    cursor, ImVec2(cursor.x + content_width, cursor.y + item_h));

                bool dots_clicked = ImGui::InvisibleButton("##dots", ImVec2(dots_w, item_h));
                bool dots_hovered = ImGui::IsItemHovered();

                // Draw three dots icon when item is hovered
                if (rect_hovered) {
                    ImDrawList* ddl = ImGui::GetWindowDrawList();
                    float cx = cursor.x + content_width - dots_w * 0.5f;
                    float cy = cursor.y + item_h * 0.5f;
                    ImU32 dot_col = dots_hovered
                        ? IM_COL32(220, 220, 220, 255) : IM_COL32(160, 160, 160, 200);
                    ddl->AddCircleFilled(ImVec2(cx, cy - 5.0f), 1.8f, dot_col);
                    ddl->AddCircleFilled(ImVec2(cx, cy),         1.8f, dot_col);
                    ddl->AddCircleFilled(ImVec2(cx, cy + 5.0f),  1.8f, dot_col);
                }

                if (dots_clicked) ImGui::OpenPopup("##devctx");

                if (ImGui::BeginPopup("##devctx")) {
                    if (ImGui::MenuItem("Rename")) {
                        device_renaming_path_ = dev.mount_path;
                        strncpy(device_rename_buf_, dev.name.c_str(), sizeof(device_rename_buf_) - 1);
                        device_rename_buf_[sizeof(device_rename_buf_) - 1] = '\0';
                    }
                    if (ImGui::MenuItem("Hide")) {
                        hidden_device_paths_.insert(dev.mount_path);
                    }
                    ImGui::EndPopup();
                }

                // Hover highlight over the full item width
                if (main_hovered || main_active || rect_hovered) {
                    ImDrawList* dl = ImGui::GetWindowDrawList();
                    ImU32 col_l = main_active ? IM_COL32(255,255,255,30) : IM_COL32(255,255,255,20);
                    dl->AddRectFilledMultiColor(
                        cursor, ImVec2(cursor.x + content_width, cursor.y + item_h),
                        col_l, IM_COL32(255,255,255,0), IM_COL32(255,255,255,0), col_l);
                }

                // Device name + info
                ImDrawList* dl = ImGui::GetWindowDrawList();
                dl->AddText(ImVec2(cursor.x + 8.0f, cursor.y + 5.0f),
                            IM_COL32(220, 220, 220, 255), dev.name.c_str());

                std::string info = dev.fs_type;
                if (dev.total_bytes > 0)
                    info += "  ·  " + core::format_bytes(dev.free_bytes) + " free";
                dl->AddText(ImGui::GetFont(), ImGui::GetFontSize() * 0.85f,
                            ImVec2(cursor.x + 8.0f, cursor.y + 22.0f),
                            IM_COL32(130, 130, 130, 255), info.c_str());

                // Disk usage bar
                if (dev.total_bytes > 0) {
                    float fill  = 1.0f - static_cast<float>(dev.free_bytes) /
                                         static_cast<float>(dev.total_bytes);
                    float bar_x = cursor.x + 8.0f;
                    float bar_y = cursor.y + item_h - 7.0f;
                    float bar_w = content_width - 16.0f;
                    dl->AddRectFilled(ImVec2(bar_x, bar_y),
                                      ImVec2(bar_x + bar_w, bar_y + 3.0f),
                                      IM_COL32(60, 60, 60, 255), 1.5f);
                    ImU32 fill_col = (fill > 0.9f) ? IM_COL32(210, 70, 70, 255)
                                                   : IM_COL32(100, 170, 230, 255);
                    dl->AddRectFilled(ImVec2(bar_x, bar_y),
                                      ImVec2(bar_x + bar_w * fill, bar_y + 3.0f),
                                      fill_col, 1.5f);
                }

                ImGui::PopID();

                if (pressed && !dots_hovered) {
                    const std::string explorer_state_key =
                        active_explorer_state_key_provider_ ? active_explorer_state_key_provider_() : "Files";
                    auto& fe_state = registry_.get_state<FileExplorerState>(explorer_state_key);
                    fe_state.pending_navigation_path = dev.mount_path;
                }
            }

            ImGui::PopStyleVar();
        } // !devices_collapsed_

        ImGui::EndGroup();
        ImGui::Spacing();
    }

    // ─────────────────────────────────────────────────────────────────────────


}
