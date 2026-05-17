#include "file_sidebar_panel.h"

#include "panels/file_explorer/state/file_explorer_state.h"
#include "panels/services/state/services_state.h"
#include "panels/file_explorer/state/remote_mount_state.h"

#include <cmath>
#include <cstdlib>
#include <set>

namespace fs = std::filesystem;

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
    namespace {
        constexpr ImVec4 kFileSidebarBg = ImVec4(0.12f, 0.12f, 0.13f, 1.0f);
        constexpr ImVec4 kFileSidebarSeparator = ImVec4(0.22f, 0.22f, 0.24f, 1.0f);
    }

    FileSidebarPanel::FileSidebarPanel(core::UIRegistry& registry, core::WorkerPool& worker_pool)
        : registry_(registry), worker_pool_(worker_pool) {
    }

    void FileSidebarPanel::render() {
        auto& state = registry_.get_state<FileSidebarState>("FileSidebar");
        auto& workspace_state = registry_.get_state<RemoteMountState>("RemoteMounts");
        auto& services_state = registry_.get_state<ServicesState>("Services");

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoSavedSettings;

        if (ImGuiViewport* main_viewport = ImGui::GetMainViewport()) {
            ImGui::SetNextWindowViewport(main_viewport->ID);
        }

        ImGui::PushStyleColor(ImGuiCol_WindowBg, kFileSidebarBg);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 16.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 12.0f));

        if (ImGui::Begin("FileSidebar", nullptr, flags)) {
            float width = ImGui::GetWindowWidth();
            float padding = width * 0.08f;
            
            
            ImGui::PushStyleColor(ImGuiCol_Separator, kFileSidebarSeparator);
            show_quick_access(width, padding);
            ImGui::Separator();
            show_local_section(width, padding);
            ImGui::Separator();
            show_services_section(services_state, width, padding);
            ImGui::Separator();
            show_devices_section(width, padding);
            ImGui::Separator();
            ImGui::PopStyleColor();

      

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

            const std::vector<ServiceCard> cards = services_state.service_cards_snapshot();
            if (cards.empty()) {
                ImGui::TextDisabled("  No services configured");
            } else {
                for (const auto& card : cards) {
                    const std::string label = card.provider_label.empty() ? card.id : card.provider_label;
                    ImGui::TextDisabled("  %s", label.c_str());
                }
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
                    const std::string explorer_state_key =
                        active_explorer_state_key_provider_ ? active_explorer_state_key_provider_() : "Files";
                    auto& file_explorer_state = registry_.get_state<FileExplorerState>(explorer_state_key);
                    file_explorer_state.pending_navigation_path = home_path;
                }

                std::string desktop_path = home_path + "/Desktop";
                if (fs::exists(desktop_path)) {
                    if (HoverListItem("Desktop", content_width)) {
                        const std::string explorer_state_key =
                            active_explorer_state_key_provider_ ? active_explorer_state_key_provider_() : "Files";
                        auto& file_explorer_state = registry_.get_state<FileExplorerState>(explorer_state_key);
                        file_explorer_state.pending_navigation_path = desktop_path;
                    }
                }

                std::string documents_path = home_path + "/Documents";
                if (fs::exists(documents_path)) {
                    if (HoverListItem("Documents", content_width)) {
                        const std::string explorer_state_key =
                            active_explorer_state_key_provider_ ? active_explorer_state_key_provider_() : "Files";
                        auto& file_explorer_state = registry_.get_state<FileExplorerState>(explorer_state_key);
                        file_explorer_state.pending_navigation_path = documents_path;
                    }
                }

                std::string downloads_path = home_path + "/Downloads";
                if (fs::exists(downloads_path)) {
                    if (HoverListItem("Downloads", content_width)) {
                        const std::string explorer_state_key =
                            active_explorer_state_key_provider_ ? active_explorer_state_key_provider_() : "Files";
                        auto& file_explorer_state = registry_.get_state<FileExplorerState>(explorer_state_key);
                        file_explorer_state.pending_navigation_path = downloads_path;
                    }
                }

                std::string pictures_path = home_path + "/Pictures";
                if (fs::exists(pictures_path)) {
                    if (HoverListItem("Pictures", content_width)) {
                        const std::string explorer_state_key =
                            active_explorer_state_key_provider_ ? active_explorer_state_key_provider_() : "Files";
                        auto& file_explorer_state = registry_.get_state<FileExplorerState>(explorer_state_key);
                        file_explorer_state.pending_navigation_path = pictures_path;
                    }
                }

                std::string music_path = home_path + "/Music";
                if (fs::exists(music_path)) {
                    if (HoverListItem("Music", content_width)) {
                        const std::string explorer_state_key =
                            active_explorer_state_key_provider_ ? active_explorer_state_key_provider_() : "Files";
                        auto& file_explorer_state = registry_.get_state<FileExplorerState>(explorer_state_key);
                        file_explorer_state.pending_navigation_path = music_path;
                    }
                }

                std::string videos_path = home_path + "/Videos";
                if (fs::exists(videos_path)) {
                    if (HoverListItem("Videos", content_width)) {
                        const std::string explorer_state_key =
                            active_explorer_state_key_provider_ ? active_explorer_state_key_provider_() : "Files";
                        auto& file_explorer_state = registry_.get_state<FileExplorerState>(explorer_state_key);
                        file_explorer_state.pending_navigation_path = videos_path;
                    }
                }
            }

            ImGui::PopStyleVar();
        }

        ImGui::EndGroup();

        ImGui::Spacing();
    }


    void FileSidebarPanel::show_quick_access(float width, float padding) {
        float content_width = width - (padding * 2);
        ImGui::SetCursorPosX(padding);

        ImGui::BeginGroup();

        if (SectionHeader("quick_access_hdr", "Quick access", quick_access_collapsed_, content_width))
            quick_access_collapsed_ = !quick_access_collapsed_;

        if (!quick_access_collapsed_) {
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 2.0f));

            if (HoverListItem("Recent", content_width)) {
                 const std::string explorer_state_key =
                     active_explorer_state_key_provider_ ? active_explorer_state_key_provider_() : "Files";
                 auto& file_explorer_state = registry_.get_state<FileExplorerState>(explorer_state_key);
                 file_explorer_state.pending_navigation_path = FileExplorerState::VIRTUAL_PATH_RECENT;
            }
            if (HoverListItem("Starred", content_width)) {
                 const std::string explorer_state_key =
                     active_explorer_state_key_provider_ ? active_explorer_state_key_provider_() : "Files";
                 auto& file_explorer_state = registry_.get_state<FileExplorerState>(explorer_state_key);
                 file_explorer_state.pending_navigation_path = FileExplorerState::VIRTUAL_PATH_STARRED;
            }
            if (HoverListItem("Trash", content_width)) {
                 const std::string explorer_state_key =
                     active_explorer_state_key_provider_ ? active_explorer_state_key_provider_() : "Files";
                 auto& file_explorer_state = registry_.get_state<FileExplorerState>(explorer_state_key);
                 file_explorer_state.pending_navigation_path = FileExplorerState::VIRTUAL_PATH_TRASH;
            }

            ImGui::PopStyleVar();
        }
        ImGui::EndGroup();
        
        // Add bottom padding for consistent spacing
        ImGui::Spacing();
    }



}
