#include "panels/file_sidebar/file_sidebar_panel.h"
#include "panels/file_sidebar/file_sidebar_state.h"
#include "panels/workspace/workspace_state.h"
#include "panels/file_explorer/file_explorer_state.h"
#include "panels/services/onedrive/onedrive_state.h"
#include "panels/services/services_state.h"
#include "panels/activity/upload_state.h"
#include "panels/panel_ui.h"
#include "core/manager/asset_manager.h"
#include "core/file_picker/file_picker.h"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <vector>
#include <algorithm>
#include <cmath>
#include <cstdlib>

namespace {
    // Draws a clickable section header with a collapse triangle indicator.
    // Returns true when clicked (caller should toggle their collapsed bool).
    bool SectionHeader(const char* id, const char* label, bool collapsed, float width) {
        ImVec2 cursor = ImGui::GetCursorScreenPos();
        float h = ImGui::GetTextLineHeight() + 4.0f;

        ImGui::PushID(id);
        bool clicked = ImGui::InvisibleButton("##hdr", ImVec2(width, h));
        bool hovered = ImGui::IsItemHovered();
        ImGui::PopID();

        ImDrawList* dl = ImGui::GetWindowDrawList();

        // Label at the left
        dl->AddText(ImVec2(cursor.x + 4.0f, cursor.y + 2.0f),
                    IM_COL32(178, 178, 178, 255), label);

        // Triangle to the right of the label, only visible on hover
        if (hovered) {
            float text_w = ImGui::CalcTextSize(label).x;
            float tri_x  = cursor.x + 4.0f + text_w + 6.0f;
            float mid_y  = cursor.y + h * 0.5f;
            ImU32 tri_col = IM_COL32(160, 160, 160, 220);

            if (collapsed) {
                dl->AddTriangleFilled(
                    ImVec2(tri_x,        mid_y - 4.0f),
                    ImVec2(tri_x,        mid_y + 4.0f),
                    ImVec2(tri_x + 7.0f, mid_y),
                    tri_col);
            } else {
                dl->AddTriangleFilled(
                    ImVec2(tri_x - 4.0f, mid_y - 2.0f),
                    ImVec2(tri_x + 4.0f, mid_y - 2.0f),
                    ImVec2(tri_x,        mid_y + 4.0f),
                    tri_col);
            }
        }

        return clicked;
    }

    // Draws a circular-arrow refresh icon as an invisible button.
    // Returns true when clicked.
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

        // Arc: ~300° clockwise (screen-space: increasing θ = clockwise because y is down)
        static constexpr float kPi = 3.14159265f;
        float a0 = kPi * 0.30f;   // start ~1:30 position
        float a1 = kPi * 2.20f;   // end   ~12:30 position (just past top)
        dl->PathArcTo(ImVec2(cx, cy), r, a0, a1, 24);
        dl->PathStroke(col, false, 1.5f);

        // Arrowhead at end of arc.
        // Tangent direction at angle a1 (clockwise in screen space): (-sin, cos)
        float tx = -std::sinf(a1), ty = std::cosf(a1);
        // Outward normal at a1: (cos, sin)
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

    // A simple list item with a subtle left-to-right hover gradient.
    // Returns true when clicked.
    bool HoverListItem(const char* label, float width, float height = 28.0f) {
        ImVec2 cursor = ImGui::GetCursorScreenPos();
        ImVec2 item_size(width, height);

        ImGui::PushID(label);
        bool pressed = ImGui::InvisibleButton(label, item_size);
        bool hovered = ImGui::IsItemHovered();
        bool active  = ImGui::IsItemActive();

        if (hovered || active) {
            ImDrawList* dl = ImGui::GetWindowDrawList();
            ImU32 col_left  = active
                ? IM_COL32(255, 255, 255, 30)
                : IM_COL32(255, 255, 255, 20);
            ImU32 col_right = IM_COL32(255, 255, 255, 0);
            dl->AddRectFilledMultiColor(
                cursor,
                ImVec2(cursor.x + item_size.x, cursor.y + item_size.y),
                col_left, col_right, col_right, col_left);
        }

        // Draw text vertically centered
        ImVec2 text_pos(cursor.x + 8.0f, cursor.y + (height - ImGui::GetTextLineHeight()) * 0.5f);
        ImGui::GetWindowDrawList()->AddText(text_pos, IM_COL32(220, 220, 220, 255), label);

        ImGui::PopID();
        return pressed;
    }
}


namespace misty::panel {
    FileSidebarPanel::FileSidebarPanel(core::UIRegistry& registry, core::WorkerPool& worker_pool, std::shared_ptr<MistyClient> client)
        : registry_(registry), worker_pool_(worker_pool), client_(client) {
    }

    void FileSidebarPanel::render() {
        auto& state = registry_.get_state<FileSidebarState>("FileSidebar");
        auto& workspace_state = registry_.get_state<WorkspaceState>("Workspace");
        auto& services_state = registry_.get_state<ServicesState>("Services");
        services_state.init(worker_pool_);


        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoScrollbar;

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.15f, 0.15f, 0.15f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 16.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 12.0f));

        if (ImGui::Begin("FileSidebar", nullptr, flags)) {
            float width = ImGui::GetWindowWidth();
            float padding = width * 0.08f;



            show_create_new(state, width, padding);

            ImGui::PushStyleColor(ImGuiCol_Separator, ImVec4(0.30f, 0.30f, 0.32f, 1.0f));
            ImGui::Separator();
            show_local_section(width, padding);
            ImGui::Separator();
            show_services_section(services_state, width, padding);
            ImGui::Separator();
            show_devices_section(width, padding);
            ImGui::Separator();
            ImGui::PopStyleColor();

            show_quick_access(width, padding);

            show_chooser_modal(state);
            show_create_entry_modal(state);
            show_uploader_modal(state);
            show_add_device_modal();
            show_device_rename_modal();

            // Check for externally-queued uploads (e.g., from paste-to-cloud)
            if (state.pending_upload_start) {
                state.pending_upload_start = false;
                if (!state.upload_queue.empty() && !state.is_uploading) {
                    state.is_uploading = true;
                    start_next_upload(state);
                }
            }

            show_upload_progress_modal(state);
        }

        ImGui::End();
        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor();
    }
    
    void FileSidebarPanel::show_services_section(ServicesState& services_state, float width, float padding) {
        float content_width = width - (padding * 2);
        ImGui::SetCursorPosX(padding);

        ImGui::BeginGroup();

        if (SectionHeader("services_hdr", "Services", services_collapsed_, content_width))
            services_collapsed_ = !services_collapsed_;

        if (!services_collapsed_) {
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 2.0f));

            if (HoverListItem("OneDrive", content_width)) {
                auto& file_explorer_state = registry_.get_state<FileExplorerState>("Files");
                file_explorer_state.pending_navigation_path = mount_utils::get_onedrive_root();
            }

            if (HoverListItem("Google Drive", content_width)) {
                auto& file_explorer_state = registry_.get_state<FileExplorerState>("Files");
                file_explorer_state.pending_navigation_path = mount_utils::get_gdrive_root();
            }

            if (HoverListItem("Dropbox", content_width)) {
                auto& file_explorer_state = registry_.get_state<FileExplorerState>("Files");
                file_explorer_state.pending_navigation_path = mount_utils::get_dropbox_root();
            }

            if (HoverListItem("iCloud", content_width)) {
                auto& file_explorer_state = registry_.get_state<FileExplorerState>("Files");
                file_explorer_state.pending_navigation_path = mount_utils::get_icloud_root();
            }

            ImGui::PopStyleVar();
        }

        ImGui::EndGroup();

        ImGui::Spacing();
    }

    void FileSidebarPanel::show_local_section(float width, float padding) {
        float content_width = width - (padding * 2);
        ImGui::SetCursorPosX(padding);

        ImGui::BeginGroup();

        if (SectionHeader("local_hdr", "Local", local_collapsed_, content_width))
            local_collapsed_ = !local_collapsed_;

        if (!local_collapsed_) {
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 2.0f));

            const char* home = std::getenv("HOME");
            if (!home) {
                home = std::getenv("USERPROFILE");
            }

            if (home) {
                std::string home_path = home;

                if (HoverListItem("Home", content_width)) {
                    auto& file_explorer_state = registry_.get_state<FileExplorerState>("Files");
                    file_explorer_state.pending_navigation_path = home_path;
                }

                std::string desktop_path = home_path + "/Desktop";
                if (fs::exists(desktop_path)) {
                    if (HoverListItem("Desktop", content_width)) {
                        auto& file_explorer_state = registry_.get_state<FileExplorerState>("Files");
                        file_explorer_state.pending_navigation_path = desktop_path;
                    }
                }

                std::string documents_path = home_path + "/Documents";
                if (fs::exists(documents_path)) {
                    if (HoverListItem("Documents", content_width)) {
                        auto& file_explorer_state = registry_.get_state<FileExplorerState>("Files");
                        file_explorer_state.pending_navigation_path = documents_path;
                    }
                }

                std::string downloads_path = home_path + "/Downloads";
                if (fs::exists(downloads_path)) {
                    if (HoverListItem("Downloads", content_width)) {
                        auto& file_explorer_state = registry_.get_state<FileExplorerState>("Files");
                        file_explorer_state.pending_navigation_path = downloads_path;
                    }
                }

                std::string pictures_path = home_path + "/Pictures";
                if (fs::exists(pictures_path)) {
                    if (HoverListItem("Pictures", content_width)) {
                        auto& file_explorer_state = registry_.get_state<FileExplorerState>("Files");
                        file_explorer_state.pending_navigation_path = pictures_path;
                    }
                }

                std::string music_path = home_path + "/Music";
                if (fs::exists(music_path)) {
                    if (HoverListItem("Music", content_width)) {
                        auto& file_explorer_state = registry_.get_state<FileExplorerState>("Files");
                        file_explorer_state.pending_navigation_path = music_path;
                    }
                }

                std::string videos_path = home_path + "/Videos";
                if (fs::exists(videos_path)) {
                    if (HoverListItem("Videos", content_width)) {
                        auto& file_explorer_state = registry_.get_state<FileExplorerState>("Files");
                        file_explorer_state.pending_navigation_path = videos_path;
                    }
                }
            }

            ImGui::PopStyleVar();
        }

        ImGui::EndGroup();

        ImGui::Spacing();
    }


    void FileSidebarPanel::show_create_new(FileSidebarState& state, float width, float padding) {
        ImGui::SetCursorPosX(padding);
        
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 8.0f));

        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.2f, 0.2f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.5f, 0.5f, 0.5f, 0.3f));

        float b_width = width - (padding * 2);
        core::SVGTexture& plus_icon = core::AssetManager::get().get_svg_texture("plus-24", 24);

        if (IconButton("##add_file", plus_icon, "New", ImVec2(b_width, 48.0f), nullptr, 18.0f)) {
            state.show_chooser_modal = true;
        }

        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(2);
    }

    void FileSidebarPanel::show_chooser_modal(FileSidebarState& state)
    {
        if (state.show_chooser_modal)
            ImGui::OpenPopup("New");

        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(
            ImVec2(vp->WorkPos.x + 16, vp->WorkPos.y + 16),
            ImGuiCond_Appearing);

        ImGui::SetNextWindowSize(ImVec2(320, 360), ImGuiCond_Appearing);

        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(24, 24));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(12, 16));

        if (ImGui::BeginPopupModal("New", &state.show_chooser_modal,
            ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove))
        {
            float w = ImGui::GetContentRegionAvail().x;

            ImGui::TextDisabled("Upload");
            ImGui::Separator();

            if (ImGui::Button("Upload Files", ImVec2(w, 40))) {
                state.show_uploader_modal = true;
                state.show_chooser_modal = false;
            }

            ImGui::TextDisabled("Create");
            ImGui::Separator();

            if (ImGui::Button("Create File", ImVec2(w, 40))) {
                state.create_is_dir = false;
                state.show_create_entry_modal = true;
                state.show_chooser_modal = false;
            }

            if (ImGui::Button("Create Folder", ImVec2(w, 40))) {
                state.create_is_dir = true;
                state.show_create_entry_modal = true;
                state.show_chooser_modal = false;
            }

            ImGui::EndPopup();
        }

        ImGui::PopStyleVar(3);
    }


    void FileSidebarPanel::show_create_entry_modal(FileSidebarState& state) {
        const char* title = state.create_is_dir ? "Create Folder" : "Create File";

        if (state.show_create_entry_modal) {
            ImGui::OpenPopup(title); // Match the title exactly
            state.show_create_entry_modal = false;
        }

        // Centering and Styling
        ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, { 0.5f, 0.5f });
        ImGui::SetNextWindowSize({ 420, 190 }, ImGuiCond_Appearing);

        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, { 24, 24 });
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, { 12, 16 });
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, { 12, 10 });

        if (ImGui::BeginPopupModal(title, nullptr, ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove)) {

            ImGui::Text("%s Name", state.create_is_dir ? "Folder" : "File");
            ImGui::SetNextItemWidth(-1);
            ImGui::InputTextWithHint("##name", "Enter name...", state.name_buffer, IM_ARRAYSIZE(state.name_buffer));

            ImGui::Separator();

            float w = (ImGui::GetContentRegionAvail().x - ImGui::GetStyle().ItemSpacing.x) * 0.5f;

            if (ImGui::Button("Create", { w, 36 }) && state.name_buffer[0]) {
                // Use the pointer we stored in the state to avoid registry deadlocks!
				auto& file_explorer_state = registry_.get_state<FileExplorerState>("Files");
                fs::path p = fs::path(file_explorer_state.current_path) / state.name_buffer;
                create_file(p.generic_string());

                state.name_buffer[0] = '\0';
                ImGui::CloseCurrentPopup();
            }

            ImGui::SameLine();

            if (ImGui::Button("Cancel", { w, 36 })) {
                state.name_buffer[0] = '\0';
                ImGui::CloseCurrentPopup();
            }

            ImGui::EndPopup();
        }
        ImGui::PopStyleVar(4);
    }

    // ─── Devices section ──────────────────────────────────────────────────────

    static std::string format_bytes(uint64_t bytes) {
        if (bytes == 0) return "";
        if (bytes < 1024ULL * 1024)
            return std::to_string(bytes / 1024) + " KB";
        double gb = static_cast<double>(bytes) / (1024.0 * 1024.0 * 1024.0);
        if (gb >= 1.0) {
            char buf[32];
            std::snprintf(buf, sizeof(buf), "%.1f GB", gb);
            return buf;
        }
        char buf[32];
        std::snprintf(buf, sizeof(buf), "%.0f MB", static_cast<double>(bytes) / (1024.0 * 1024.0));
        return buf;
    }

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
                    info += "  ·  " + format_bytes(dev.free_bytes) + " free";
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
                    auto& fe_state = registry_.get_state<FileExplorerState>("Files");
                    fe_state.pending_navigation_path = dev.mount_path;
                }
            }

            ImGui::PopStyleVar();
        } // !devices_collapsed_

        ImGui::EndGroup();
        ImGui::Spacing();
    }

    // ─────────────────────────────────────────────────────────────────────────

    void FileSidebarPanel::show_quick_access(float width, float padding) {
        float content_width = width - (padding * 2);
        ImGui::SetCursorPosX(padding);

        ImGui::BeginGroup();

        if (SectionHeader("quick_access_hdr", "Quick access", quick_access_collapsed_, content_width))
            quick_access_collapsed_ = !quick_access_collapsed_;

        if (!quick_access_collapsed_) {
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 2.0f));

            if (HoverListItem("Recent", content_width)) {
                 auto& file_explorer_state = registry_.get_state<FileExplorerState>("Files");
                 file_explorer_state.pending_navigation_path = FileExplorerState::VIRTUAL_PATH_RECENT;
            }
            if (HoverListItem("Starred", content_width)) {
                 auto& file_explorer_state = registry_.get_state<FileExplorerState>("Files");
                 file_explorer_state.pending_navigation_path = FileExplorerState::VIRTUAL_PATH_STARRED;
            }
            if (HoverListItem("Trash", content_width)) {
                 auto& file_explorer_state = registry_.get_state<FileExplorerState>("Files");
                 file_explorer_state.pending_navigation_path = FileExplorerState::VIRTUAL_PATH_TRASH;
            }

            ImGui::PopStyleVar();
        }
        ImGui::EndGroup();
        
        // Add bottom padding for consistent spacing
        ImGui::Spacing();
    }


    void FileSidebarPanel::show_uploader_modal(FileSidebarState& state) {
        if (!state.show_uploader_modal) return;

        // Detect which cloud service has upload context
        UploadTarget target_service = UploadTarget::ONEDRIVE;
        bool has_context = false;

        auto& onedrive_state = registry_.get_state<OneDriveState>("OneDrive");
        auto& gdrive_state = registry_.get_state<GDriveState>("GDrive");
        auto& dropbox_state = registry_.get_state<DropboxState>("Dropbox");

        if (onedrive_state.has_upload_context()) {
            target_service = UploadTarget::ONEDRIVE;
            has_context = true;
        } else if (gdrive_state.has_upload_context()) {
            target_service = UploadTarget::GDRIVE;
            has_context = true;
        } else if (dropbox_state.has_upload_context()) {
            target_service = UploadTarget::DROPBOX;
            has_context = true;
        }

        if (!has_context) {
            state.show_uploader_modal = false;
            state.status_message = "Navigate to a cloud folder first.";
            return;
        }

        // Open file picker (this blocks until user selects files or cancels)
        core::FilePickerOptions options;
        options.title = "Select Files to Upload";
        core::FilePickerResult result = core::FilePicker::show_dialog(options);

        state.show_uploader_modal = false;

        if (result.has_selection()) {
            // Queue files for upload
            {
                std::lock_guard<std::mutex> lock(state.upload_mutex);
                state.upload_queue.clear();
                state.current_upload_index = 0;
                state.cancel_upload.store(false);

                for (const auto& path : result.paths) {
                    FileUploadProgress progress;
                    progress.file_path = path;
                    progress.file_name = fs::path(path).filename().string();
                    progress.target_service = target_service;

                    std::error_code ec;
                    progress.file_size = fs::file_size(path, ec);
                    if (ec) progress.file_size = 0;

                    progress.bytes_uploaded = 0;
                    progress.is_complete = false;
                    progress.has_error = false;

                    state.upload_queue.push_back(progress);
                }
            }

            if (!state.upload_queue.empty()) {
                state.is_uploading = true;
                start_next_upload(state);
            }
        }
    }

    void FileSidebarPanel::start_next_upload(FileSidebarState& state) {
        size_t index;
        std::string file_path;
        std::string file_name;
        int64_t file_size = 0;
        UploadTarget target_service;

        {
            std::lock_guard<std::mutex> lock(state.upload_mutex);
            if (state.current_upload_index >= state.upload_queue.size()) {
                state.is_uploading = false;
                return;
            }
            index = state.current_upload_index;
            file_path = state.upload_queue[index].file_path;
            file_name = state.upload_queue[index].file_name;
            file_size = static_cast<int64_t>(state.upload_queue[index].file_size);
            target_service = state.upload_queue[index].target_service;
        }

        std::string service_name = (target_service == UploadTarget::ONEDRIVE) ? "OneDrive" :
                                   (target_service == UploadTarget::GDRIVE) ? "Google Drive" : "Dropbox";

        // Register this upload in UploadState for activity tracking
        auto& upload_state = registry_.get_state<UploadState>("Uploads");
        uint64_t upload_id = upload_state.start_upload(file_name, file_path, service_name, file_size);

        // Progress callback - updates both the sidebar UI state and the activity UploadState
        auto progress_cb = [&state, &upload_state, index, upload_id](size_t bytes_uploaded, size_t total_bytes) -> bool {
            {
                std::lock_guard<std::mutex> lock(state.upload_mutex);
                if (index < state.upload_queue.size()) {
                    state.upload_queue[index].bytes_uploaded = bytes_uploaded;
                }
            }
            upload_state.update_progress(upload_id, static_cast<int64_t>(bytes_uploaded));
            return !state.cancel_upload.load();
        };

        // Completion callback
        auto completion_cb = [this, &state, &upload_state, index, upload_id](bool success, const std::string& error_msg) {
            {
                std::lock_guard<std::mutex> lock(state.upload_mutex);
                if (index < state.upload_queue.size()) {
                    state.upload_queue[index].is_complete = true;
                    state.upload_queue[index].has_error = !success;
                    state.upload_queue[index].error_message = error_msg;
                }
                state.current_upload_index++;
            }

            // Update activity UploadState
            if (success) {
                upload_state.complete_upload(upload_id);
            } else {
                upload_state.fail_upload(upload_id, error_msg);
            }

            // Start next upload or finish
            if (!state.cancel_upload.load()) {
                start_next_upload(state);
            } else {
                state.is_uploading = false;
            }
        };

        // Dispatch to the appropriate service
        if (target_service == UploadTarget::ONEDRIVE) {
            auto& onedrive_state = registry_.get_state<OneDriveState>("OneDrive");
            onedrive_state.set_worker_pool(worker_pool_);
            onedrive_state.upload_file(file_path, progress_cb, completion_cb);
        } else if (target_service == UploadTarget::GDRIVE) {
            auto& gdrive_state = registry_.get_state<GDriveState>("GDrive");
            gdrive_state.set_worker_pool(worker_pool_);
            gdrive_state.upload_file(file_path, progress_cb, completion_cb);
        } else if (target_service == UploadTarget::DROPBOX) {
            auto& dropbox_state = registry_.get_state<DropboxState>("Dropbox");
            dropbox_state.set_worker_pool(worker_pool_);
            dropbox_state.upload_file(file_path, progress_cb, completion_cb);
        }
    }

    void FileSidebarPanel::show_upload_progress_modal(FileSidebarState& state) {
        if (!state.is_uploading && state.upload_queue.empty()) return;

        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(
            ImVec2(vp->WorkPos.x + vp->WorkSize.x - 340, vp->WorkPos.y + vp->WorkSize.y - 200),
            ImGuiCond_Appearing);
        ImGui::SetNextWindowSize(ImVec2(320, 180), ImGuiCond_Appearing);

        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16, 16));

        ImGuiWindowFlags flags = ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoCollapse;

        bool show = true;
        if (ImGui::Begin("Upload Progress", &show, flags)) {
            std::lock_guard<std::mutex> lock(state.upload_mutex);

            size_t total = state.upload_queue.size();
            size_t completed = 0;
            for (const auto& item : state.upload_queue) {
                if (item.is_complete) completed++;
            }

            ImGui::Text("Uploading %zu of %zu files", completed + (state.is_uploading ? 1 : 0), total);
            ImGui::Separator();

            // Show current upload progress
            if (state.current_upload_index < state.upload_queue.size()) {
                const auto& current = state.upload_queue[state.current_upload_index];
                ImGui::Text("%s", current.file_name.c_str());

                float progress = current.file_size > 0
                    ? static_cast<float>(current.bytes_uploaded) / static_cast<float>(current.file_size)
                    : 0.0f;
                ImGui::ProgressBar(progress, ImVec2(-1, 0));

                if (current.has_error) {
                    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.3f, 0.3f, 1.0f));
                    ImGui::TextWrapped("Error: %s", current.error_message.c_str());
                    ImGui::PopStyleColor();
                }
            }

            ImGui::Spacing();

            // Cancel button
            if (state.is_uploading) {
                if (ImGui::Button("Cancel", ImVec2(-1, 0))) {
                    state.cancel_upload.store(true);
                }
            } else {
                if (ImGui::Button("Close", ImVec2(-1, 0))) {
                    state.upload_queue.clear();
                }
            }
        }
        ImGui::End();

        ImGui::PopStyleVar(2);

        if (!show) {
            state.cancel_upload.store(true);
            state.upload_queue.clear();
            state.is_uploading = false;
        }
    }

    void FileSidebarPanel::show_add_device_modal() {
        if (show_add_device_modal_) {
            ImGui::OpenPopup("Add Mount Point");
            show_add_device_modal_ = false;
        }

        ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, {0.5f, 0.5f});
        ImGui::SetNextWindowSize({460, 280}, ImGuiCond_Appearing);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,  {24, 24});
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,    {12, 14});
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding,   {12, 10});

        bool modal_open = true;
        if (ImGui::BeginPopupModal("Add Mount Point", &modal_open,
                ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove)) {

            // Close on the X button
            if (!modal_open) {
                add_device_path_buf_[0] = '\0';
                ImGui::CloseCurrentPopup();
            }

            ImGui::Text("Mount Path");
            ImGui::Spacing();
            ImGui::SetNextItemWidth(-1);
            ImGui::InputTextWithHint("##addpath", "/Volumes/MyDrive",
                                     add_device_path_buf_, sizeof(add_device_path_buf_));

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            float w = (ImGui::GetContentRegionAvail().x - ImGui::GetStyle().ItemSpacing.x) * 0.5f;
            bool has_path = add_device_path_buf_[0] != '\0';
            if (!has_path) ImGui::BeginDisabled();
            if (ImGui::Button("Add", {w, 38})) {
                std::string path = add_device_path_buf_;
                if (path.size() > 1 && path.back() == '/') path.pop_back();
                if (std::find(custom_mount_paths_.begin(), custom_mount_paths_.end(), path)
                        == custom_mount_paths_.end()) {
                    custom_mount_paths_.push_back(path);
                    hidden_device_paths_.erase(path);
                }
                add_device_path_buf_[0] = '\0';
                ImGui::CloseCurrentPopup();
            }
            if (!has_path) ImGui::EndDisabled();
            ImGui::SameLine();
            if (ImGui::Button("Cancel", {w, 38})) {
                add_device_path_buf_[0] = '\0';
                ImGui::CloseCurrentPopup();
            }
            ImGui::EndPopup();
        }
        ImGui::PopStyleVar(4);
    }

    void FileSidebarPanel::show_device_rename_modal() {
        if (!device_renaming_path_.empty())
            ImGui::OpenPopup("Rename Drive");

        ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, {0.5f, 0.5f});
        ImGui::SetNextWindowSize({420, 160}, ImGuiCond_Appearing);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,  {24, 24});
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,    {12, 16});
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding,   {12, 10});

        if (ImGui::BeginPopupModal("Rename Drive", nullptr,
                ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove)) {
            ImGui::Text("Drive Name");
            ImGui::SetNextItemWidth(-1);
            ImGui::InputText("##drvname", device_rename_buf_, sizeof(device_rename_buf_));
            ImGui::Separator();

            float w = (ImGui::GetContentRegionAvail().x - ImGui::GetStyle().ItemSpacing.x) * 0.5f;
            if (ImGui::Button("Save", {w, 36}) && device_rename_buf_[0]) {
                device_name_overrides_[device_renaming_path_] = device_rename_buf_;
                device_renaming_path_.clear();
                ImGui::CloseCurrentPopup();
            }
            ImGui::SameLine();
            if (ImGui::Button("Cancel", {w, 36})) {
                device_renaming_path_.clear();
                ImGui::CloseCurrentPopup();
            }
            ImGui::EndPopup();
        }
        ImGui::PopStyleVar(4);
    }
}
