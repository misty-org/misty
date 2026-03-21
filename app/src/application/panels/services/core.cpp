#include "services_panel.h"

#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"
#include "core/ui/imgui_utils.h"

#include <cmath>

namespace misty::panel {
    ServicesPanel::ServicesPanel(UIRegistry& registry)
        : registry_(registry) {
    }

    void ServicesPanel::render() {
        auto& state = registry_.get_state<ServicesState>("Services");

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoScrollbar;

        core::WithWindowStyle(ImVec4(0.18f, 0.18f, 0.18f, 1.0f), ImVec2(32.0f, 24.0f), [&]() {
        if (ImGui::Begin("ServicesPanel", nullptr, flags)) {
            show_header();
            ImGui::SameLine();
            {
                float avail = ImGui::GetContentRegionAvail().x;
                ImGui::SetCursorPosX(ImGui::GetCursorPosX() + avail - 84.0f);
                ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.22f, 0.22f, 0.25f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.30f, 0.30f, 0.33f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.18f, 0.18f, 0.20f, 1.0f));
                ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
                bool refreshing = state.is_refreshing;
                if (refreshing) ImGui::BeginDisabled();
                if (ImGui::Button("Refresh", ImVec2(84.0f, 28.0f))) {
                    state.refresh_connections();
                }
                if (refreshing) ImGui::EndDisabled();
                ImGui::PopStyleVar();
                ImGui::PopStyleColor(3);
            }
            ImGui::Spacing();
            show_cloud_section(state);

            if (state.is_refreshing) {
                show_loading_overlay();
            }
            show_disconnect_confirm_modal(state);
        }
        ImGui::End();
        });
    }

    void ServicesPanel::show_header() {
        ImGui::BeginGroup();
        core::WithFontScale(1.8f, []() {
            core::ColoredText(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "Services");
        });
        core::ColoredText(ImVec4(0.7f, 0.7f, 0.7f, 1.0f), "Manage your cloud storage services.");
        ImGui::EndGroup();
    }

    void ServicesPanel::show_cloud_section(ServicesState& state) {
        show_tab_bar();

        ImGui::Spacing();
        ImGui::Spacing();

        if (active_tab_ == 0) {
            show_onedrive_tab(state);
        } else if (active_tab_ == 1) {
            show_gdrive_tab(state);
        } else if (active_tab_ == 2) {
            show_dropbox_tab(state);
        } else {
            show_icloud_tab(state);
        }

        show_ms_login_modal(state);
        show_gd_login_modal(state);
        show_dbx_login_modal(state);
        show_icl_login_modal(state);
        show_error_modal(state.error_msg, "ServicesError");
    }

    void ServicesPanel::show_tab_bar() {
        ImVec4 active_text   = ImVec4(1.0f, 1.0f, 1.0f, 1.0f);
        ImVec4 inactive_text = ImVec4(0.5f, 0.5f, 0.5f, 1.0f);
        ImVec4 transparent   = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        ImU32  underline_col = IM_COL32(255, 255, 255, 210);

        float tab_width  = 140.0f;
        float tab_height = 32.0f;

        const char* tab_labels[] = { "OneDrive", "Google Drive", "Dropbox", "iCloud" };

        for (int i = 0; i < 4; i++) {
            if (i > 0) ImGui::SameLine(0.0f, 4.0f);

            ImGui::PushID(i);
            ImGui::PushStyleColor(ImGuiCol_Button,        transparent);
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.25f, 0.25f, 0.25f, 0.5f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive,  transparent);
            ImGui::PushStyleColor(ImGuiCol_Text, active_tab_ == i ? active_text : inactive_text);
            if (ImGui::Button(tab_labels[i], ImVec2(tab_width, tab_height)))
                active_tab_ = i;
            ImGui::PopStyleColor(4);

            if (active_tab_ == i) {
                ImVec2 p_min = ImGui::GetItemRectMin();
                ImVec2 p_max = ImGui::GetItemRectMax();
                ImGui::GetWindowDrawList()->AddLine(
                    ImVec2(p_min.x, p_max.y),
                    ImVec2(p_max.x, p_max.y),
                    underline_col, 2.0f);
            }
            ImGui::PopID();
        }

        // Separator under tab bar
        ImGui::Spacing();
        ImGui::PushStyleColor(ImGuiCol_Separator, ImVec4(0.3f, 0.3f, 0.3f, 0.5f));
        ImGui::Separator();
        ImGui::PopStyleColor();
    }

    void ServicesPanel::try_same_line_or_wrap(int cards_drawn) {
        if (cards_drawn > 0) {
            float cursor_x = ImGui::GetCursorPosX();
            float avail = ImGui::GetContentRegionAvail().x;
            if (cursor_x + kCardWidth + kCardSpacing <= avail + ImGui::GetCursorPosX()) {
                // Check if another card fits on this line
                float next_end = ImGui::GetItemRectMax().x - ImGui::GetWindowPos().x + kCardSpacing + kCardWidth;
                float window_width = ImGui::GetContentRegionAvail().x + ImGui::GetCursorPosX();
                if (next_end <= window_width) {
                    ImGui::SameLine(0.0f, kCardSpacing);
                }
            }
        }
    }

    void ServicesPanel::show_onedrive_tab(ServicesState& state) {
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(8.0f, 8.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, kCardSpacing));

        std::vector<std::string> connection_ids;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            for (const auto& conn : state.ms_connections) {
                if (!conn.profile.id.empty()) {
                    connection_ids.push_back(conn.profile.id);
                }
            }
        }

        int cards_drawn = 0;
        for (const auto& ms_user_id : connection_ids) {
            try_same_line_or_wrap(cards_drawn);
            show_onedrive_profile_card(state, ms_user_id);
            cards_drawn++;
        }

        // "Add Account" card
        try_same_line_or_wrap(cards_drawn);
        show_add_account_card("Add Account", state.show_ms_login_modal);

        // Error display
        {
            std::lock_guard<std::mutex> lock(state.mu);
            if (!state.error_msg.empty()) {
                ImGui::Spacing();
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.4f, 0.4f, 1.0f));
                ImGui::TextWrapped("%s", state.error_msg.c_str());
                ImGui::PopStyleColor();
            }
        }

        ImGui::PopStyleVar(2);
    }

    void ServicesPanel::show_gdrive_tab(ServicesState& state) {
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(8.0f, 8.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, kCardSpacing));

        std::vector<std::string> gd_connection_ids;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            for (const auto& conn : state.gd_connections) {
                if (!conn.profile.id.empty()) {
                    gd_connection_ids.push_back(conn.profile.id);
                }
            }
        }

        int cards_drawn = 0;
        for (const auto& gd_user_id : gd_connection_ids) {
            try_same_line_or_wrap(cards_drawn);
            show_gdrive_profile_card(state, gd_user_id);
            cards_drawn++;
        }

        // "Add Account" card
        try_same_line_or_wrap(cards_drawn);
        show_add_account_card("Add Account", state.show_gd_login_modal);

        // Error display
        {
            std::lock_guard<std::mutex> lock(state.mu);
            if (!state.error_msg.empty()) {
                ImGui::Spacing();
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.4f, 0.4f, 1.0f));
                ImGui::TextWrapped("%s", state.error_msg.c_str());
                ImGui::PopStyleColor();
            }
        }

        ImGui::PopStyleVar(2);
    }

    void ServicesPanel::show_add_account_card(const char* label, bool& show_modal) {
        ImGui::PushID(label);
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.16f, 0.16f, 0.16f, 0.5f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.0f, 0.0f, 0.0f, 0.0f)); // hide default border
        ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, 0.0f);

        float card_height = 160.0f;
        if (ImGui::BeginChild("AddCard", ImVec2(kCardWidth, card_height), ImGuiChildFlags_None)) {
            // Draw dashed border manually
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            ImVec2 p_min = ImGui::GetWindowPos();
            ImVec2 p_max = ImVec2(p_min.x + kCardWidth, p_min.y + card_height);
            ImU32 border_col = IM_COL32(120, 120, 120, 150);

            // Draw dashed rectangle using line segments
            float dash_len = 8.0f;
            float gap_len = 5.0f;
            float rounding = 8.0f;

            // Use a dotted rect approximation by drawing many small segments
            auto draw_dashed_line = [&](ImVec2 a, ImVec2 b) {
                float dx = b.x - a.x;
                float dy = b.y - a.y;
                float len = sqrtf(dx * dx + dy * dy);
                if (len < 1.0f) return;
                float nx = dx / len;
                float ny = dy / len;
                float pos = 0.0f;
                bool drawing = true;
                while (pos < len) {
                    float seg = drawing ? dash_len : gap_len;
                    float end_pos = (pos + seg > len) ? len : pos + seg;
                    if (drawing) {
                        draw_list->AddLine(
                            ImVec2(a.x + nx * pos, a.y + ny * pos),
                            ImVec2(a.x + nx * end_pos, a.y + ny * end_pos),
                            border_col, 1.5f);
                    }
                    pos = end_pos;
                    drawing = !drawing;
                }
            };

            float inset = 0.5f;
            ImVec2 tl(p_min.x + inset, p_min.y + inset);
            ImVec2 tr(p_max.x - inset, p_min.y + inset);
            ImVec2 br(p_max.x - inset, p_max.y - inset);
            ImVec2 bl(p_min.x + inset, p_max.y - inset);

            draw_dashed_line(ImVec2(tl.x + rounding, tl.y), ImVec2(tr.x - rounding, tr.y)); // top
            draw_dashed_line(ImVec2(tr.x, tr.y + rounding), ImVec2(br.x, br.y - rounding)); // right
            draw_dashed_line(ImVec2(br.x - rounding, br.y), ImVec2(bl.x + rounding, bl.y)); // bottom
            draw_dashed_line(ImVec2(bl.x, bl.y - rounding), ImVec2(tl.x, tl.y + rounding)); // left

            // Center the "+" and label
            float total_content_height = ImGui::GetFontSize() * 2.5f + 8.0f;
            float start_y = (card_height - total_content_height) * 0.5f;

            ImGui::SetCursorPosY(start_y);

            // "+" symbol
            core::WithFontScale(2.0f, [&]() {
                float plus_width = ImGui::CalcTextSize("+").x;
                ImGui::SetCursorPosX((kCardWidth - plus_width) * 0.5f);
                core::ColoredText(ImVec4(0.5f, 0.5f, 0.5f, 0.8f), "+");
            });

            ImGui::Spacing();

            // Label
            float label_width = ImGui::CalcTextSize(label).x;
            ImGui::SetCursorPosX((kCardWidth - label_width) * 0.5f);
            core::ColoredText(ImVec4(0.5f, 0.5f, 0.5f, 0.8f), "%s", label);
        }
        ImGui::EndChild();

        // Make the card clickable
        if (ImGui::IsItemClicked()) {
            show_modal = true;
        }

        // Hover effect
        if (ImGui::IsItemHovered()) {
            ImGui::SetMouseCursor(ImGuiMouseCursor_Hand);
        }

        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor(2);
        ImGui::PopID();
    }

    void ServicesPanel::show_loading_overlay() {
        // Sprite sheet: 2560x1280, 10 cols x 5 rows = 50 frames, 256x256 per frame
        static constexpr int   COLS        = 10;
        static constexpr int   ROWS        = 5;
        static constexpr int   TOTAL       = COLS * ROWS;
        static constexpr float FRAME_RATE  = 20.0f; // fps
        static constexpr float SPRITE_SIZE = 128.0f; // display size in pixels

        auto& sprite = core::AssetManager::get().get_image_texture("assets/misty_sprite.png");

        ImDrawList* dl = ImGui::GetWindowDrawList();
        ImVec2 p  = ImGui::GetWindowPos();
        ImVec2 sz = ImGui::GetWindowSize();

        // Semi-transparent dark background
        dl->AddRectFilled(p, ImVec2(p.x + sz.x, p.y + sz.y), IM_COL32(15, 15, 18, 160));

        // Current frame based on elapsed time
        int frame = static_cast<int>(ImGui::GetTime() * FRAME_RATE) % TOTAL;
        int col   = frame % COLS;
        int row   = frame / COLS;

        float uv_w = 1.0f / COLS;
        float uv_h = 1.0f / ROWS;
        ImVec2 uv0(col * uv_w,        row * uv_h);
        ImVec2 uv1((col + 1) * uv_w,  (row + 1) * uv_h);

        // Gentle vertical bob — runs every render frame so it's smooth at any Hz
        float t    = static_cast<float>(ImGui::GetTime());
        float bob  = std::sin(t * 3.0f) * 6.0f; // ±6px, ~0.5 Hz cycle

        float cx   = p.x + sz.x * 0.5f;
        float cy   = p.y + sz.y * 0.5f + bob;
        float half = SPRITE_SIZE * 0.5f;

        dl->AddImage(
            (ImTextureID)(intptr_t)sprite.id,
            ImVec2(cx - half, cy - half),
            ImVec2(cx + half, cy + half),
            uv0, uv1
        );
    }

    void ServicesPanel::show_disconnect_confirm_modal(ServicesState& state) {
        if (pending_disconnect_provider_.empty()) return;

        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(vp->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(320.0f, 0.0f), ImGuiCond_Always);

        ImGui::PushStyleColor(ImGuiCol_PopupBg,  ImVec4(0.10f, 0.10f, 0.11f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border,   ImVec4(0.22f, 0.22f, 0.24f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,  ImVec2(24.0f, 24.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,    ImVec2(0.0f,  10.0f));

        if (ImGui::BeginPopupModal("##confirm_disconnect", nullptr,
                ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                ImGuiWindowFlags_NoMove     | ImGuiWindowFlags_AlwaysAutoResize)) {

            float w = ImGui::GetContentRegionAvail().x;

            ImGui::PushFont(core::AssetManager::get().get_font(core::FontID::ROBOTO_LARGE));
            const char* title = "Disconnect account?";
            ImGui::SetCursorPosX((w - ImGui::CalcTextSize(title).x) * 0.5f);
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.90f, 0.90f, 0.90f, 1.0f));
            ImGui::TextUnformatted(title);
            ImGui::PopStyleColor();
            ImGui::PopFont();

            ImGui::Spacing();

            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.58f, 0.58f, 0.58f, 1.0f));
            ImGui::TextWrapped(
                "This will remove the account from Misty. "
                "Your files in the cloud will not be affected.");
            ImGui::PopStyleColor();

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            float half_w = (w - 8.0f) * 0.5f;
            bool cancel_shortcut = core::CommandManager::get().matches("modal.cancel");
            bool confirm_shortcut = core::CommandManager::get().matches("modal.confirm");

            // Cancel
            ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.22f, 0.22f, 0.25f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.30f, 0.30f, 0.33f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.18f, 0.18f, 0.20f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
            if (ImGui::Button("Cancel", ImVec2(half_w, 36.0f)) || cancel_shortcut) {
                pending_disconnect_provider_.clear();
                pending_disconnect_id_.clear();
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopStyleVar();
            ImGui::PopStyleColor(3);

            ImGui::SameLine(0, 8.0f);

            // Disconnect (red)
            ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.55f, 0.18f, 0.18f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.65f, 0.28f, 0.28f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.45f, 0.12f, 0.12f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
            if (ImGui::Button("Disconnect", ImVec2(half_w, 36.0f)) || confirm_shortcut) {
                if (pending_disconnect_provider_ == "onedrive")
                    state.disconnect_onedrive(pending_disconnect_id_);
                else if (pending_disconnect_provider_ == "gdrive")
                    state.disconnect_gdrive(pending_disconnect_id_);
                else if (pending_disconnect_provider_ == "dropbox")
                    state.disconnect_dropbox(pending_disconnect_id_);
                else if (pending_disconnect_provider_ == "icloud")
                    state.disconnect_icloud(pending_disconnect_id_);
                pending_disconnect_provider_.clear();
                pending_disconnect_id_.clear();
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopStyleVar();
            ImGui::PopStyleColor(3);

            ImGui::EndPopup();
        }

        ImGui::PopStyleVar(3);
        ImGui::PopStyleColor(2);
    }

}
