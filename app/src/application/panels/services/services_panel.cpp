#include "services_panel.h"
#include "imgui.h"
#include "core/imgui_utils.h"
#include <nlohmann/json.hpp>
#include <cstring>

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
            ImGui::Spacing();
            show_cloud_section(state);
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
        // Tab colors
        ImVec4 active_text = ImVec4(1.0f, 1.0f, 1.0f, 1.0f);
        ImVec4 inactive_text = ImVec4(0.5f, 0.5f, 0.5f, 1.0f);
        ImVec4 od_accent = ImVec4(0.2f, 0.5f, 0.9f, 1.0f);   // blue
        ImVec4 gd_accent = ImVec4(0.2f, 0.7f, 0.4f, 1.0f);    // green

        ImVec4 transparent = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);

        float tab_width = 140.0f;
        float tab_height = 32.0f;

        // OneDrive tab
        ImGui::PushStyleColor(ImGuiCol_Button, transparent);
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.25f, 0.25f, 0.25f, 0.5f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, transparent);
        ImGui::PushStyleColor(ImGuiCol_Text, active_tab_ == 0 ? active_text : inactive_text);
        if (ImGui::Button("OneDrive", ImVec2(tab_width, tab_height))) {
            active_tab_ = 0;
        }
        ImGui::PopStyleColor(4);

        // Draw underline for active tab
        if (active_tab_ == 0) {
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            ImVec2 p_min = ImGui::GetItemRectMin();
            ImVec2 p_max = ImGui::GetItemRectMax();
            draw_list->AddLine(
                ImVec2(p_min.x, p_max.y),
                ImVec2(p_max.x, p_max.y),
                ImGui::ColorConvertFloat4ToU32(od_accent), 2.5f);
        }

        ImGui::SameLine(0.0f, 4.0f);

        // Google Drive tab
        ImGui::PushStyleColor(ImGuiCol_Button, transparent);
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.25f, 0.25f, 0.25f, 0.5f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, transparent);
        ImGui::PushStyleColor(ImGuiCol_Text, active_tab_ == 1 ? active_text : inactive_text);
        if (ImGui::Button("Google Drive", ImVec2(tab_width, tab_height))) {
            active_tab_ = 1;
        }
        ImGui::PopStyleColor(4);

        if (active_tab_ == 1) {
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            ImVec2 p_min = ImGui::GetItemRectMin();
            ImVec2 p_max = ImGui::GetItemRectMax();
            draw_list->AddLine(
                ImVec2(p_min.x, p_max.y),
                ImVec2(p_max.x, p_max.y),
                ImGui::ColorConvertFloat4ToU32(gd_accent), 2.5f);
        }

        ImGui::SameLine(0.0f, 4.0f);

        // Dropbox tab
        ImVec4 dbx_accent = ImVec4(0.0f, 0.38f, 1.0f, 1.0f);  // Dropbox blue
        ImGui::PushStyleColor(ImGuiCol_Button, transparent);
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.25f, 0.25f, 0.25f, 0.5f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, transparent);
        ImGui::PushStyleColor(ImGuiCol_Text, active_tab_ == 2 ? active_text : inactive_text);
        if (ImGui::Button("Dropbox", ImVec2(tab_width, tab_height))) {
            active_tab_ = 2;
        }
        ImGui::PopStyleColor(4);

        if (active_tab_ == 2) {
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            ImVec2 p_min = ImGui::GetItemRectMin();
            ImVec2 p_max = ImGui::GetItemRectMax();
            draw_list->AddLine(
                ImVec2(p_min.x, p_max.y),
                ImVec2(p_max.x, p_max.y),
                ImGui::ColorConvertFloat4ToU32(dbx_accent), 2.5f);
        }

        ImGui::SameLine(0.0f, 4.0f);

        // iCloud tab
        ImVec4 icl_accent = ImVec4(0.0f, 0.58f, 0.84f, 1.0f);  // iCloud blue
        ImGui::PushStyleColor(ImGuiCol_Button, transparent);
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.25f, 0.25f, 0.25f, 0.5f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, transparent);
        ImGui::PushStyleColor(ImGuiCol_Text, active_tab_ == 3 ? active_text : inactive_text);
        if (ImGui::Button("iCloud", ImVec2(tab_width, tab_height))) {
            active_tab_ = 3;
        }
        ImGui::PopStyleColor(4);

        if (active_tab_ == 3) {
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            ImVec2 p_min = ImGui::GetItemRectMin();
            ImVec2 p_max = ImGui::GetItemRectMax();
            draw_list->AddLine(
                ImVec2(p_min.x, p_max.y),
                ImVec2(p_max.x, p_max.y),
                ImGui::ColorConvertFloat4ToU32(icl_accent), 2.5f);
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

    void ServicesPanel::show_onedrive_card_header(bool is_connected) {
        ImGui::BeginGroup();
        ImDrawList* draw_list = ImGui::GetWindowDrawList();
        ImVec2 cursor = ImGui::GetCursorScreenPos();
        if (is_connected) {
            draw_list->AddCircleFilled(ImVec2(cursor.x + 6.0f, cursor.y + 8.0f), 5.0f, IM_COL32(76, 175, 80, 255));
        } else {
            draw_list->AddCircleFilled(ImVec2(cursor.x + 6.0f, cursor.y + 8.0f), 5.0f, IM_COL32(255, 152, 0, 255));
        }
        ImGui::Dummy(ImVec2(16.0f, 0.0f));
        ImGui::SameLine();
        core::WithFontScale(1.2f, []() {
            core::ColoredText(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "OneDrive");
        });
        ImGui::SameLine();
        if (is_connected) {
            core::ColoredText(ImVec4(0.5f, 0.8f, 0.5f, 1.0f), "Connected");
        } else {
            core::ColoredText(ImVec4(1.0f, 0.6f, 0.2f, 1.0f), "Not Connected");
        }
        ImGui::EndGroup();
    }

    void ServicesPanel::show_onedrive_card_profile(const OneDriveCardState& card, const std::string& ms_user_id) {
        if (card.profile_loaded && (!card.profile.display_name.empty() || !card.profile.email.empty())) {
            if (!card.profile.display_name.empty()) {
                core::ColoredText(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "Account");
                core::ColoredText(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "%s", card.profile.display_name.c_str());
                ImGui::Spacing();
            }
            if (!card.profile.email.empty()) {
                core::ColoredText(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "Email");
                core::ColoredText(ImVec4(0.8f, 0.8f, 0.8f, 1.0f), "%s", card.profile.email.c_str());
            }
            return;
        }
        core::ColoredText(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "Account");
        core::ColoredText(ImVec4(0.6f, 0.6f, 0.6f, 1.0f), "ID: %s", ms_user_id.substr(0, 8).c_str());
    }

    void ServicesPanel::show_onedrive_card_actions(ServicesState& state, const std::string& ms_user_id, bool is_connected) {
        if (is_connected) {
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.5f, 0.2f, 0.2f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.6f, 0.3f, 0.3f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.45f, 0.15f, 0.15f, 1.0f));
            if (ImGui::Button("Disconnect", ImVec2(ImGui::GetContentRegionAvail().x, 28.0f))) {
                state.disconnect_onedrive(ms_user_id);
            }
            ImGui::PopStyleColor(3);
            return;
        }
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.35f, 0.5f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.45f, 0.6f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.15f, 0.3f, 0.45f, 1.0f));
        if (ImGui::Button("Reconnect", ImVec2(ImGui::GetContentRegionAvail().x * 0.48f, 28.0f))) {
            state.show_ms_login_modal = true;
        }
        ImGui::PopStyleColor(3);
        ImGui::SameLine();
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.4f, 0.4f, 0.4f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.25f, 0.25f, 0.25f, 1.0f));
        if (ImGui::Button("Remove", ImVec2(ImGui::GetContentRegionAvail().x, 28.0f))) {
            state.disconnect_onedrive(ms_user_id);
        }
        ImGui::PopStyleColor(3);
    }

    void ServicesPanel::show_onedrive_profile_card(ServicesState& state, const std::string& ms_user_id) {
        OneDriveCardState card;
        if (!state.get_onedrive_card_state(ms_user_id, card)) {
            return;
        }

        ImGui::PushID(ms_user_id.c_str());
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.14f, 0.14f, 0.14f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.3f, 0.3f, 0.3f, 0.5f));
        ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, 1.0f);

        if (ImGui::BeginChild("OneDriveCard", ImVec2(kCardWidth, 0.0f), ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_Borders)) {
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(8.0f, 6.0f));
            show_onedrive_card_header(card.is_connected);
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            show_onedrive_card_profile(card, ms_user_id);
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            show_onedrive_card_actions(state, ms_user_id, card.is_connected);
            ImGui::PopStyleVar();
        }
        ImGui::EndChild();

        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor(2);
        ImGui::PopID();
    }

    void ServicesPanel::show_ms_login_modal(ServicesState& state) {
        if (state.show_ms_login_modal) {
            ImGui::OpenPopup("Connect to OneDrive");
        }

        ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(480, 0), ImGuiCond_Appearing);

        ImVec4 accent = ImVec4(0.21f, 0.50f, 0.89f, 1.0f); // OneDrive blue

        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 12.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(28.0f, 28.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(12.0f, 10.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 10.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.11f, 0.11f, 0.12f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.22f, 0.22f, 0.24f, 1.0f));

        if (ImGui::BeginPopupModal("Connect to OneDrive", &state.show_ms_login_modal,
            ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_AlwaysAutoResize)) {

            // --- Header ---
            core::WithFontScale(1.6f, [&]() {
                core::ColoredText(accent, "Connect to OneDrive");
            });
            core::ColoredText(ImVec4(0.55f, 0.55f, 0.58f, 1.0f), "Link your Microsoft account to sync files");
            ImGui::Spacing();
            ImGui::Spacing();

            // --- Steps card ---
            ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.15f, 0.15f, 0.16f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 14.0f));

            if (ImGui::BeginChild("##steps_card", ImVec2(ImGui::GetContentRegionAvail().x, 0),
                ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_AlwaysUseWindowPadding)) {

                ImDrawList* dl = ImGui::GetWindowDrawList();
                const char* steps[] = {
                    "Click \"Sign in\" to open the browser",
                    "Sign in to your Microsoft account",
                    "Return here when complete"
                };
                ImU32 badge_col = ImGui::ColorConvertFloat4ToU32(accent);
                for (int i = 0; i < 3; i++) {
                    ImVec2 cursor = ImGui::GetCursorScreenPos();
                    // Draw numbered circle badge
                    float radius = 10.0f;
                    ImVec2 center(cursor.x + radius, cursor.y + ImGui::GetFontSize() * 0.5f);
                    dl->AddCircleFilled(center, radius, badge_col);
                    // Number inside badge
                    char num[2] = { (char)('1' + i), '\0' };
                    ImVec2 num_size = ImGui::CalcTextSize(num);
                    dl->AddText(ImVec2(center.x - num_size.x * 0.5f, center.y - num_size.y * 0.5f),
                        IM_COL32(255, 255, 255, 255), num);
                    // Step text
                    ImGui::Dummy(ImVec2(radius * 2 + 10.0f, 0.0f));
                    ImGui::SameLine();
                    core::ColoredText(ImVec4(0.82f, 0.82f, 0.84f, 1.0f), "%s", steps[i]);
                    if (i < 2) ImGui::Spacing();
                }
            }
            ImGui::EndChild();
            ImGui::PopStyleVar(2);
            ImGui::PopStyleColor();

            ImGui::Spacing();
            ImGui::Spacing();

            // --- Error / Success messages ---
            {
                std::lock_guard<std::mutex> lock(state.mu);
                if (!state.ms_auth_error.empty()) {
                    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.35f, 0.12f, 0.12f, 0.6f));
                    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 6.0f);
                    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 10.0f));
                    if (ImGui::BeginChild("##ms_err", ImVec2(ImGui::GetContentRegionAvail().x, 0),
                        ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_AlwaysUseWindowPadding)) {
                        // Red left accent
                        ImDrawList* dl = ImGui::GetWindowDrawList();
                        ImVec2 p = ImGui::GetWindowPos();
                        dl->AddRectFilled(p, ImVec2(p.x + 3.0f, p.y + ImGui::GetWindowHeight()),
                            IM_COL32(240, 80, 80, 255), 2.0f);
                        core::ColoredText(ImVec4(1.0f, 0.5f, 0.5f, 1.0f), "%s", state.ms_auth_error.c_str());
                    }
                    ImGui::EndChild();
                    ImGui::PopStyleVar(2);
                    ImGui::PopStyleColor();
                    ImGui::Spacing();
                }
                if (!state.success_msg.empty()) {
                    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.12f, 0.28f, 0.16f, 0.6f));
                    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 6.0f);
                    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 10.0f));
                    if (ImGui::BeginChild("##ms_ok", ImVec2(ImGui::GetContentRegionAvail().x, 0),
                        ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_AlwaysUseWindowPadding)) {
                        ImDrawList* dl = ImGui::GetWindowDrawList();
                        ImVec2 p = ImGui::GetWindowPos();
                        dl->AddRectFilled(p, ImVec2(p.x + 3.0f, p.y + ImGui::GetWindowHeight()),
                            IM_COL32(76, 175, 80, 255), 2.0f);
                        core::ColoredText(ImVec4(0.4f, 0.85f, 0.5f, 1.0f), "%s", state.success_msg.c_str());
                    }
                    ImGui::EndChild();
                    ImGui::PopStyleVar(2);
                    ImGui::PopStyleColor();
                    ImGui::Spacing();
                }
            }

            // --- Action buttons ---
            float button_width = ImGui::GetContentRegionAvail().x;

            core::WithButtonStyle({accent,
                ImVec4(accent.x + 0.08f, accent.y + 0.08f, accent.z + 0.08f, 1.0f),
                ImVec4(accent.x - 0.05f, accent.y - 0.05f, accent.z - 0.05f, 1.0f),
                ImVec4(1.0f, 1.0f, 1.0f, 1.0f), 8.0f}, [&]() {
                if (ImGui::Button("Sign in with Microsoft", ImVec2(button_width, 44))) {
                    state.initiate_ms_login();
                }
            });

            ImGui::Spacing();

            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.25f, 0.25f, 0.27f, 0.4f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.2f, 0.2f, 0.22f, 0.4f));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.55f, 0.55f, 0.58f, 1.0f));
            if (ImGui::Button("Done##od", ImVec2(button_width, 36))) {
                std::lock_guard<std::mutex> lock(state.mu);
                state.ms_auth_error.clear();
                state.success_msg.clear();
                state.show_ms_login_modal = false;
                state.check_connections();
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopStyleColor(4);

            ImGui::EndPopup();
        }
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(5);
    }

    // ==================== Google Drive Card UI ====================

    void ServicesPanel::show_gdrive_card_header(bool is_connected) {
        ImGui::BeginGroup();
        ImDrawList* draw_list = ImGui::GetWindowDrawList();
        ImVec2 cursor = ImGui::GetCursorScreenPos();
        if (is_connected) {
            draw_list->AddCircleFilled(ImVec2(cursor.x + 6.0f, cursor.y + 8.0f), 5.0f, IM_COL32(76, 175, 80, 255));
        } else {
            draw_list->AddCircleFilled(ImVec2(cursor.x + 6.0f, cursor.y + 8.0f), 5.0f, IM_COL32(255, 152, 0, 255));
        }
        ImGui::Dummy(ImVec2(16.0f, 0.0f));
        ImGui::SameLine();
        core::WithFontScale(1.2f, []() {
            core::ColoredText(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "Google Drive");
        });
        ImGui::SameLine();
        if (is_connected) {
            core::ColoredText(ImVec4(0.5f, 0.8f, 0.5f, 1.0f), "Connected");
        } else {
            core::ColoredText(ImVec4(1.0f, 0.6f, 0.2f, 1.0f), "Not Connected");
        }
        ImGui::EndGroup();
    }

    void ServicesPanel::show_gdrive_card_profile(const GDriveCardState& card, const std::string& gd_user_id) {
        if (card.profile_loaded && (!card.profile.display_name.empty() || !card.profile.email.empty())) {
            if (!card.profile.display_name.empty()) {
                core::ColoredText(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "Account");
                core::ColoredText(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "%s", card.profile.display_name.c_str());
                ImGui::Spacing();
            }
            if (!card.profile.email.empty()) {
                core::ColoredText(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "Email");
                core::ColoredText(ImVec4(0.8f, 0.8f, 0.8f, 1.0f), "%s", card.profile.email.c_str());
            }
            return;
        }
        core::ColoredText(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "Account");
        core::ColoredText(ImVec4(0.6f, 0.6f, 0.6f, 1.0f), "ID: %s", gd_user_id.substr(0, 8).c_str());
    }

    void ServicesPanel::show_gdrive_card_actions(ServicesState& state, const std::string& gd_user_id, bool is_connected) {
        if (is_connected) {
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.5f, 0.2f, 0.2f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.6f, 0.3f, 0.3f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.45f, 0.15f, 0.15f, 1.0f));
            if (ImGui::Button("Disconnect##gd", ImVec2(ImGui::GetContentRegionAvail().x, 28.0f))) {
                state.disconnect_gdrive(gd_user_id);
            }
            ImGui::PopStyleColor(3);
            return;
        }
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.13f, 0.44f, 0.24f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.18f, 0.54f, 0.34f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.10f, 0.38f, 0.20f, 1.0f));
        if (ImGui::Button("Reconnect##gd", ImVec2(ImGui::GetContentRegionAvail().x * 0.48f, 28.0f))) {
            state.show_gd_login_modal = true;
        }
        ImGui::PopStyleColor(3);
        ImGui::SameLine();
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.4f, 0.4f, 0.4f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.25f, 0.25f, 0.25f, 1.0f));
        if (ImGui::Button("Remove##gd", ImVec2(ImGui::GetContentRegionAvail().x, 28.0f))) {
            state.disconnect_gdrive(gd_user_id);
        }
        ImGui::PopStyleColor(3);
    }

    void ServicesPanel::show_gdrive_profile_card(ServicesState& state, const std::string& gd_user_id) {
        GDriveCardState card;
        if (!state.get_gdrive_card_state(gd_user_id, card)) {
            return;
        }

        ImGui::PushID(("gd_" + gd_user_id).c_str());
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.14f, 0.14f, 0.14f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.3f, 0.3f, 0.3f, 0.5f));
        ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, 1.0f);

        if (ImGui::BeginChild("GDriveCard", ImVec2(kCardWidth, 0.0f), ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_Borders)) {
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(8.0f, 6.0f));
            show_gdrive_card_header(card.is_connected);
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            show_gdrive_card_profile(card, gd_user_id);
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            show_gdrive_card_actions(state, gd_user_id, card.is_connected);
            ImGui::PopStyleVar();
        }
        ImGui::EndChild();

        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor(2);
        ImGui::PopID();
    }

    // ==================== Dropbox Tab ====================

    void ServicesPanel::show_dropbox_tab(ServicesState& state) {
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(8.0f, 8.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, kCardSpacing));

        std::vector<std::string> dbx_connection_ids;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            for (const auto& conn : state.dbx_connections) {
                if (!conn.profile.id.empty()) {
                    dbx_connection_ids.push_back(conn.profile.id);
                }
            }
        }

        int cards_drawn = 0;
        for (const auto& dbx_user_id : dbx_connection_ids) {
            try_same_line_or_wrap(cards_drawn);
            show_dropbox_profile_card(state, dbx_user_id);
            cards_drawn++;
        }

        // "Add Account" card
        try_same_line_or_wrap(cards_drawn);
        show_add_account_card("Add Account##dbx", state.show_dbx_login_modal);

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

    void ServicesPanel::show_dropbox_card_header(bool is_connected) {
        ImGui::BeginGroup();
        ImDrawList* draw_list = ImGui::GetWindowDrawList();
        ImVec2 cursor = ImGui::GetCursorScreenPos();
        if (is_connected) {
            draw_list->AddCircleFilled(ImVec2(cursor.x + 6.0f, cursor.y + 8.0f), 5.0f, IM_COL32(76, 175, 80, 255));
        } else {
            draw_list->AddCircleFilled(ImVec2(cursor.x + 6.0f, cursor.y + 8.0f), 5.0f, IM_COL32(255, 152, 0, 255));
        }
        ImGui::Dummy(ImVec2(16.0f, 0.0f));
        ImGui::SameLine();
        core::WithFontScale(1.2f, []() {
            core::ColoredText(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "Dropbox");
        });
        ImGui::SameLine();
        if (is_connected) {
            core::ColoredText(ImVec4(0.5f, 0.8f, 0.5f, 1.0f), "Connected");
        } else {
            core::ColoredText(ImVec4(1.0f, 0.6f, 0.2f, 1.0f), "Not Connected");
        }
        ImGui::EndGroup();
    }

    void ServicesPanel::show_dropbox_card_profile(const DropboxCardState& card, const std::string& dbx_user_id) {
        if (card.profile_loaded && (!card.profile.display_name.empty() || !card.profile.email.empty())) {
            if (!card.profile.display_name.empty()) {
                core::ColoredText(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "Account");
                core::ColoredText(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "%s", card.profile.display_name.c_str());
                ImGui::Spacing();
            }
            if (!card.profile.email.empty()) {
                core::ColoredText(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "Email");
                core::ColoredText(ImVec4(0.8f, 0.8f, 0.8f, 1.0f), "%s", card.profile.email.c_str());
            }
            return;
        }
        core::ColoredText(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "Account");
        core::ColoredText(ImVec4(0.6f, 0.6f, 0.6f, 1.0f), "ID: %s", dbx_user_id.substr(0, 8).c_str());
    }

    void ServicesPanel::show_dropbox_card_actions(ServicesState& state, const std::string& dbx_user_id, bool is_connected) {
        if (is_connected) {
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.5f, 0.2f, 0.2f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.6f, 0.3f, 0.3f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.45f, 0.15f, 0.15f, 1.0f));
            if (ImGui::Button("Disconnect##dbx", ImVec2(ImGui::GetContentRegionAvail().x, 28.0f))) {
                state.disconnect_dropbox(dbx_user_id);
            }
            ImGui::PopStyleColor(3);
            return;
        }
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.0f, 0.24f, 0.63f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.05f, 0.34f, 0.73f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.0f, 0.18f, 0.53f, 1.0f));
        if (ImGui::Button("Reconnect##dbx", ImVec2(ImGui::GetContentRegionAvail().x * 0.48f, 28.0f))) {
            state.show_dbx_login_modal = true;
        }
        ImGui::PopStyleColor(3);
        ImGui::SameLine();
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.4f, 0.4f, 0.4f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.25f, 0.25f, 0.25f, 1.0f));
        if (ImGui::Button("Remove##dbx", ImVec2(ImGui::GetContentRegionAvail().x, 28.0f))) {
            state.disconnect_dropbox(dbx_user_id);
        }
        ImGui::PopStyleColor(3);
    }

    void ServicesPanel::show_dropbox_profile_card(ServicesState& state, const std::string& dbx_user_id) {
        DropboxCardState card;
        if (!state.get_dropbox_card_state(dbx_user_id, card)) {
            return;
        }

        ImGui::PushID(("dbx_" + dbx_user_id).c_str());
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.14f, 0.14f, 0.14f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.3f, 0.3f, 0.3f, 0.5f));
        ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, 1.0f);

        if (ImGui::BeginChild("DropboxCard", ImVec2(kCardWidth, 0.0f), ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_Borders)) {
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(8.0f, 6.0f));
            show_dropbox_card_header(card.is_connected);
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            show_dropbox_card_profile(card, dbx_user_id);
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            show_dropbox_card_actions(state, dbx_user_id, card.is_connected);
            ImGui::PopStyleVar();
        }
        ImGui::EndChild();

        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor(2);
        ImGui::PopID();
    }

    void ServicesPanel::show_gd_login_modal(ServicesState& state) {
        if (state.show_gd_login_modal) {
            ImGui::OpenPopup("Connect to Google Drive");
        }

        ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(480, 0), ImGuiCond_Appearing);

        ImVec4 accent = ImVec4(0.20f, 0.66f, 0.33f, 1.0f); // Google Drive green

        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 12.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(28.0f, 28.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(12.0f, 10.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 10.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.11f, 0.11f, 0.12f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.22f, 0.22f, 0.24f, 1.0f));

        if (ImGui::BeginPopupModal("Connect to Google Drive", &state.show_gd_login_modal,
            ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_AlwaysAutoResize)) {

            // --- Header ---
            core::WithFontScale(1.6f, [&]() {
                core::ColoredText(accent, "Connect to Google Drive");
            });
            core::ColoredText(ImVec4(0.55f, 0.55f, 0.58f, 1.0f), "Link your Google account to sync files");
            ImGui::Spacing();
            ImGui::Spacing();

            // --- Steps card ---
            ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.15f, 0.15f, 0.16f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 14.0f));

            if (ImGui::BeginChild("##gd_steps_card", ImVec2(ImGui::GetContentRegionAvail().x, 0),
                ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_AlwaysUseWindowPadding)) {

                ImDrawList* dl = ImGui::GetWindowDrawList();
                const char* steps[] = {
                    "Click \"Sign in\" to open the browser",
                    "Sign in to your Google account",
                    "Return here when complete"
                };
                ImU32 badge_col = ImGui::ColorConvertFloat4ToU32(accent);
                for (int i = 0; i < 3; i++) {
                    ImVec2 cursor = ImGui::GetCursorScreenPos();
                    float radius = 10.0f;
                    ImVec2 center(cursor.x + radius, cursor.y + ImGui::GetFontSize() * 0.5f);
                    dl->AddCircleFilled(center, radius, badge_col);
                    char num[2] = { (char)('1' + i), '\0' };
                    ImVec2 num_size = ImGui::CalcTextSize(num);
                    dl->AddText(ImVec2(center.x - num_size.x * 0.5f, center.y - num_size.y * 0.5f),
                        IM_COL32(255, 255, 255, 255), num);
                    ImGui::Dummy(ImVec2(radius * 2 + 10.0f, 0.0f));
                    ImGui::SameLine();
                    core::ColoredText(ImVec4(0.82f, 0.82f, 0.84f, 1.0f), "%s", steps[i]);
                    if (i < 2) ImGui::Spacing();
                }
            }
            ImGui::EndChild();
            ImGui::PopStyleVar(2);
            ImGui::PopStyleColor();

            ImGui::Spacing();
            ImGui::Spacing();

            // --- Error / Success messages ---
            {
                std::lock_guard<std::mutex> lock(state.mu);
                if (!state.gd_auth_error.empty()) {
                    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.35f, 0.12f, 0.12f, 0.6f));
                    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 6.0f);
                    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 10.0f));
                    if (ImGui::BeginChild("##gd_err", ImVec2(ImGui::GetContentRegionAvail().x, 0),
                        ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_AlwaysUseWindowPadding)) {
                        ImDrawList* dl = ImGui::GetWindowDrawList();
                        ImVec2 p = ImGui::GetWindowPos();
                        dl->AddRectFilled(p, ImVec2(p.x + 3.0f, p.y + ImGui::GetWindowHeight()),
                            IM_COL32(240, 80, 80, 255), 2.0f);
                        core::ColoredText(ImVec4(1.0f, 0.5f, 0.5f, 1.0f), "%s", state.gd_auth_error.c_str());
                    }
                    ImGui::EndChild();
                    ImGui::PopStyleVar(2);
                    ImGui::PopStyleColor();
                    ImGui::Spacing();
                }
                if (!state.success_msg.empty()) {
                    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.12f, 0.28f, 0.16f, 0.6f));
                    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 6.0f);
                    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 10.0f));
                    if (ImGui::BeginChild("##gd_ok", ImVec2(ImGui::GetContentRegionAvail().x, 0),
                        ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_AlwaysUseWindowPadding)) {
                        ImDrawList* dl = ImGui::GetWindowDrawList();
                        ImVec2 p = ImGui::GetWindowPos();
                        dl->AddRectFilled(p, ImVec2(p.x + 3.0f, p.y + ImGui::GetWindowHeight()),
                            IM_COL32(76, 175, 80, 255), 2.0f);
                        core::ColoredText(ImVec4(0.4f, 0.85f, 0.5f, 1.0f), "%s", state.success_msg.c_str());
                    }
                    ImGui::EndChild();
                    ImGui::PopStyleVar(2);
                    ImGui::PopStyleColor();
                    ImGui::Spacing();
                }
            }

            // --- Action buttons ---
            float button_width = ImGui::GetContentRegionAvail().x;

            core::WithButtonStyle({accent,
                ImVec4(accent.x + 0.08f, accent.y + 0.08f, accent.z + 0.08f, 1.0f),
                ImVec4(accent.x - 0.05f, accent.y - 0.05f, accent.z - 0.05f, 1.0f),
                ImVec4(1.0f, 1.0f, 1.0f, 1.0f), 8.0f}, [&]() {
                if (ImGui::Button("Sign in with Google", ImVec2(button_width, 44))) {
                    state.initiate_gd_login();
                }
            });

            ImGui::Spacing();

            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.25f, 0.25f, 0.27f, 0.4f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.2f, 0.2f, 0.22f, 0.4f));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.55f, 0.55f, 0.58f, 1.0f));
            if (ImGui::Button("Done##gd", ImVec2(button_width, 36))) {
                std::lock_guard<std::mutex> lock(state.mu);
                state.gd_auth_error.clear();
                state.success_msg.clear();
                state.show_gd_login_modal = false;
                state.check_gd_connections();
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopStyleColor(4);

            ImGui::EndPopup();
        }
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(5);
    }

    void ServicesPanel::show_dbx_login_modal(ServicesState& state) {
        if (state.show_dbx_login_modal) {
            ImGui::OpenPopup("Connect to Dropbox");
        }

        ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(480, 0), ImGuiCond_Appearing);

        ImVec4 accent = ImVec4(0.0f, 0.38f, 1.0f, 1.0f); // Dropbox blue

        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 12.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(28.0f, 28.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(12.0f, 10.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 10.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.11f, 0.11f, 0.12f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.22f, 0.22f, 0.24f, 1.0f));

        if (ImGui::BeginPopupModal("Connect to Dropbox", &state.show_dbx_login_modal,
            ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_AlwaysAutoResize)) {

            // --- Header ---
            core::WithFontScale(1.6f, [&]() {
                core::ColoredText(accent, "Connect to Dropbox");
            });
            core::ColoredText(ImVec4(0.55f, 0.55f, 0.58f, 1.0f), "Link your Dropbox account to sync files");
            ImGui::Spacing();
            ImGui::Spacing();

            // --- Steps card ---
            ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.15f, 0.15f, 0.16f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 14.0f));

            if (ImGui::BeginChild("##dbx_steps_card", ImVec2(ImGui::GetContentRegionAvail().x, 0),
                ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_AlwaysUseWindowPadding)) {

                ImDrawList* dl = ImGui::GetWindowDrawList();
                const char* steps[] = {
                    "Click \"Sign in\" to open the browser",
                    "Sign in to your Dropbox account",
                    "Return here when complete"
                };
                ImU32 badge_col = ImGui::ColorConvertFloat4ToU32(accent);
                for (int i = 0; i < 3; i++) {
                    ImVec2 cursor = ImGui::GetCursorScreenPos();
                    float radius = 10.0f;
                    ImVec2 center(cursor.x + radius, cursor.y + ImGui::GetFontSize() * 0.5f);
                    dl->AddCircleFilled(center, radius, badge_col);
                    char num[2] = { (char)('1' + i), '\0' };
                    ImVec2 num_size = ImGui::CalcTextSize(num);
                    dl->AddText(ImVec2(center.x - num_size.x * 0.5f, center.y - num_size.y * 0.5f),
                        IM_COL32(255, 255, 255, 255), num);
                    ImGui::Dummy(ImVec2(radius * 2 + 10.0f, 0.0f));
                    ImGui::SameLine();
                    core::ColoredText(ImVec4(0.82f, 0.82f, 0.84f, 1.0f), "%s", steps[i]);
                    if (i < 2) ImGui::Spacing();
                }
            }
            ImGui::EndChild();
            ImGui::PopStyleVar(2);
            ImGui::PopStyleColor();

            ImGui::Spacing();
            ImGui::Spacing();

            // --- Error / Success messages ---
            {
                std::lock_guard<std::mutex> lock(state.mu);
                if (!state.dbx_auth_error.empty()) {
                    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.35f, 0.12f, 0.12f, 0.6f));
                    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 6.0f);
                    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 10.0f));
                    if (ImGui::BeginChild("##dbx_err", ImVec2(ImGui::GetContentRegionAvail().x, 0),
                        ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_AlwaysUseWindowPadding)) {
                        ImDrawList* dl = ImGui::GetWindowDrawList();
                        ImVec2 p = ImGui::GetWindowPos();
                        dl->AddRectFilled(p, ImVec2(p.x + 3.0f, p.y + ImGui::GetWindowHeight()),
                            IM_COL32(240, 80, 80, 255), 2.0f);
                        core::ColoredText(ImVec4(1.0f, 0.5f, 0.5f, 1.0f), "%s", state.dbx_auth_error.c_str());
                    }
                    ImGui::EndChild();
                    ImGui::PopStyleVar(2);
                    ImGui::PopStyleColor();
                    ImGui::Spacing();
                }
                if (!state.success_msg.empty()) {
                    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.12f, 0.28f, 0.16f, 0.6f));
                    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 6.0f);
                    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 10.0f));
                    if (ImGui::BeginChild("##dbx_ok", ImVec2(ImGui::GetContentRegionAvail().x, 0),
                        ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_AlwaysUseWindowPadding)) {
                        ImDrawList* dl = ImGui::GetWindowDrawList();
                        ImVec2 p = ImGui::GetWindowPos();
                        dl->AddRectFilled(p, ImVec2(p.x + 3.0f, p.y + ImGui::GetWindowHeight()),
                            IM_COL32(76, 175, 80, 255), 2.0f);
                        core::ColoredText(ImVec4(0.4f, 0.85f, 0.5f, 1.0f), "%s", state.success_msg.c_str());
                    }
                    ImGui::EndChild();
                    ImGui::PopStyleVar(2);
                    ImGui::PopStyleColor();
                    ImGui::Spacing();
                }
            }

            // --- Action buttons ---
            float button_width = ImGui::GetContentRegionAvail().x;

            core::WithButtonStyle({accent,
                ImVec4(accent.x + 0.08f, accent.y + 0.08f, accent.z + 0.08f, 1.0f),
                ImVec4(accent.x - 0.05f, accent.y - 0.05f, accent.z - 0.05f, 1.0f),
                ImVec4(1.0f, 1.0f, 1.0f, 1.0f), 8.0f}, [&]() {
                if (ImGui::Button("Sign in with Dropbox", ImVec2(button_width, 44))) {
                    state.initiate_dbx_login();
                }
            });

            ImGui::Spacing();

            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.25f, 0.25f, 0.27f, 0.4f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.2f, 0.2f, 0.22f, 0.4f));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.55f, 0.55f, 0.58f, 1.0f));
            if (ImGui::Button("Done##dbx", ImVec2(button_width, 36))) {
                std::lock_guard<std::mutex> lock(state.mu);
                state.dbx_auth_error.clear();
                state.success_msg.clear();
                state.show_dbx_login_modal = false;
                state.check_dbx_connections();
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopStyleColor(4);

            ImGui::EndPopup();
        }
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(5);
    }

    // ==================== iCloud Tab ====================

    void ServicesPanel::show_icloud_tab(ServicesState& state) {
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(8.0f, 8.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, kCardSpacing));

        std::vector<std::string> icl_emails;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            for (const auto& conn : state.icl_connections) {
                if (!conn.profile.email.empty()) {
                    icl_emails.push_back(conn.profile.email);
                }
            }
        }

        int cards_drawn = 0;
        for (const auto& email : icl_emails) {
            try_same_line_or_wrap(cards_drawn);
            show_icloud_profile_card(state, email);
            cards_drawn++;
        }

        try_same_line_or_wrap(cards_drawn);
        show_add_account_card("Add Account##icl", state.show_icl_login_modal);

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

    void ServicesPanel::show_icloud_card_header(bool is_connected) {
        ImGui::BeginGroup();
        ImDrawList* draw_list = ImGui::GetWindowDrawList();
        ImVec2 cursor = ImGui::GetCursorScreenPos();
        if (is_connected) {
            draw_list->AddCircleFilled(ImVec2(cursor.x + 6.0f, cursor.y + 8.0f), 5.0f, IM_COL32(76, 175, 80, 255));
        } else {
            draw_list->AddCircleFilled(ImVec2(cursor.x + 6.0f, cursor.y + 8.0f), 5.0f, IM_COL32(255, 152, 0, 255));
        }
        ImGui::Dummy(ImVec2(16.0f, 0.0f));
        ImGui::SameLine();
        core::WithFontScale(1.2f, []() {
            core::ColoredText(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "iCloud Drive");
        });
        ImGui::SameLine();
        if (is_connected) {
            core::ColoredText(ImVec4(0.5f, 0.8f, 0.5f, 1.0f), "Connected");
        } else {
            core::ColoredText(ImVec4(1.0f, 0.6f, 0.2f, 1.0f), "Not Connected");
        }
        ImGui::EndGroup();
    }

    void ServicesPanel::show_icloud_card_profile(const ICloudCardState& card, const std::string& email) {
        core::ColoredText(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "Apple ID");
        core::ColoredText(ImVec4(0.8f, 0.8f, 0.8f, 1.0f), "%s", email.c_str());
    }

    void ServicesPanel::show_icloud_card_actions(ServicesState& state, const std::string& email, bool is_connected) {
        if (is_connected) {
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.5f, 0.2f, 0.2f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.6f, 0.3f, 0.3f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.45f, 0.15f, 0.15f, 1.0f));
            if (ImGui::Button("Disconnect##icl", ImVec2(ImGui::GetContentRegionAvail().x, 28.0f))) {
                state.disconnect_icloud(email);
            }
            ImGui::PopStyleColor(3);
            return;
        }
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.0f, 0.37f, 0.54f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.0f, 0.47f, 0.64f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.0f, 0.30f, 0.45f, 1.0f));
        if (ImGui::Button("Reconnect##icl", ImVec2(ImGui::GetContentRegionAvail().x * 0.48f, 28.0f))) {
            state.show_icl_login_modal = true;
        }
        ImGui::PopStyleColor(3);
        ImGui::SameLine();
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.4f, 0.4f, 0.4f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.25f, 0.25f, 0.25f, 1.0f));
        if (ImGui::Button("Remove##icl", ImVec2(ImGui::GetContentRegionAvail().x, 28.0f))) {
            state.disconnect_icloud(email);
        }
        ImGui::PopStyleColor(3);
    }

    void ServicesPanel::show_icloud_profile_card(ServicesState& state, const std::string& email) {
        ICloudCardState card;
        if (!state.get_icloud_card_state(email, card)) {
            return;
        }

        ImGui::PushID(("icl_" + email).c_str());
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.14f, 0.14f, 0.14f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.3f, 0.3f, 0.3f, 0.5f));
        ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, 1.0f);

        if (ImGui::BeginChild("ICloudCard", ImVec2(kCardWidth, 0.0f), ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_Borders)) {
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(8.0f, 6.0f));
            show_icloud_card_header(card.is_connected);
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            show_icloud_card_profile(card, email);
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            show_icloud_card_actions(state, email, card.is_connected);
            ImGui::PopStyleVar();
        }
        ImGui::EndChild();

        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor(2);
        ImGui::PopID();
    }

    void ServicesPanel::show_icl_login_modal(ServicesState& state) {
        if (state.show_icl_login_modal) {
            ImGui::OpenPopup("Connect to iCloud");
        }

        ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(480, 0), ImGuiCond_Appearing);

        ImVec4 accent = ImVec4(0.0f, 0.58f, 0.84f, 1.0f); // iCloud blue

        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 12.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(28.0f, 28.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(12.0f, 10.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 10.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.11f, 0.11f, 0.12f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.22f, 0.22f, 0.24f, 1.0f));

        if (ImGui::BeginPopupModal("Connect to iCloud", &state.show_icl_login_modal,
            ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_AlwaysAutoResize)) {

            // --- Header ---
            core::WithFontScale(1.6f, [&]() {
                core::ColoredText(accent, "Connect to iCloud Drive");
            });

            bool awaiting_2fa;
            std::string pending_email;
            {
                std::lock_guard<std::mutex> lock(state.mu);
                awaiting_2fa = state.icl_awaiting_2fa;
                pending_email = state.icl_pending_2fa_email;
            }

            if (!awaiting_2fa) {
                core::ColoredText(ImVec4(0.55f, 0.55f, 0.58f, 1.0f), "Sign in with your Apple ID");
                ImGui::Spacing();
                ImGui::Spacing();

                float field_width = ImGui::GetContentRegionAvail().x;

                ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.18f, 0.18f, 0.20f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_FrameBgHovered, ImVec4(0.22f, 0.22f, 0.24f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_FrameBgActive, ImVec4(0.20f, 0.20f, 0.22f, 1.0f));

                core::ColoredText(ImVec4(0.7f, 0.7f, 0.7f, 1.0f), "Apple ID (Email)");
                ImGui::SetNextItemWidth(field_width);
                ImGui::InputText("##icl_email", icl_email_buf_, sizeof(icl_email_buf_));

                ImGui::Spacing();

                core::ColoredText(ImVec4(0.7f, 0.7f, 0.7f, 1.0f), "Password");
                ImGui::SetNextItemWidth(field_width);
                ImGui::InputText("##icl_password", icl_password_buf_, sizeof(icl_password_buf_),
                    ImGuiInputTextFlags_Password);

                ImGui::PopStyleColor(3);
                ImGui::Spacing();
                ImGui::Spacing();

                // --- Error message ---
                {
                    std::lock_guard<std::mutex> lock(state.mu);
                    if (!state.icl_auth_error.empty()) {
                        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.35f, 0.12f, 0.12f, 0.6f));
                        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 6.0f);
                        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 10.0f));
                        if (ImGui::BeginChild("##icl_err", ImVec2(ImGui::GetContentRegionAvail().x, 0),
                            ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_AlwaysUseWindowPadding)) {
                            ImDrawList* dl = ImGui::GetWindowDrawList();
                            ImVec2 p = ImGui::GetWindowPos();
                            dl->AddRectFilled(p, ImVec2(p.x + 3.0f, p.y + ImGui::GetWindowHeight()),
                                IM_COL32(240, 80, 80, 255), 2.0f);
                            core::ColoredText(ImVec4(1.0f, 0.5f, 0.5f, 1.0f), "%s", state.icl_auth_error.c_str());
                        }
                        ImGui::EndChild();
                        ImGui::PopStyleVar(2);
                        ImGui::PopStyleColor();
                        ImGui::Spacing();
                    }
                }

                float button_width = ImGui::GetContentRegionAvail().x;

                core::WithButtonStyle({accent,
                    ImVec4(accent.x + 0.08f, accent.y + 0.08f, accent.z + 0.08f, 1.0f),
                    ImVec4(accent.x - 0.05f, accent.y - 0.05f, accent.z - 0.05f, 1.0f),
                    ImVec4(1.0f, 1.0f, 1.0f, 1.0f), 8.0f}, [&]() {
                    if (ImGui::Button("Sign In##icl", ImVec2(button_width, 44))) {
                        std::string email(icl_email_buf_);
                        std::string password(icl_password_buf_);
                        if (!email.empty() && !password.empty()) {
                            state.initiate_icl_login(email, password);
                        } else {
                            std::lock_guard<std::mutex> lock(state.mu);
                            state.icl_auth_error = "Please enter your Apple ID and password.";
                        }
                    }
                });

                ImGui::Spacing();

                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.25f, 0.25f, 0.27f, 0.4f));
                ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.2f, 0.2f, 0.22f, 0.4f));
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.55f, 0.55f, 0.58f, 1.0f));
                if (ImGui::Button("Cancel##icl", ImVec2(button_width, 36))) {
                    std::lock_guard<std::mutex> lock(state.mu);
                    state.icl_auth_error.clear();
                    state.show_icl_login_modal = false;
                    memset(icl_email_buf_, 0, sizeof(icl_email_buf_));
                    memset(icl_password_buf_, 0, sizeof(icl_password_buf_));
                    ImGui::CloseCurrentPopup();
                }
                ImGui::PopStyleColor(4);

            } else {
                // --- 2FA step ---
                core::ColoredText(ImVec4(0.55f, 0.55f, 0.58f, 1.0f),
                    "Two-factor authentication required for %s", pending_email.c_str());
                ImGui::Spacing();
                ImGui::Spacing();

                float field_width = ImGui::GetContentRegionAvail().x;

                ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.18f, 0.18f, 0.20f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_FrameBgHovered, ImVec4(0.22f, 0.22f, 0.24f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_FrameBgActive, ImVec4(0.20f, 0.20f, 0.22f, 1.0f));

                core::ColoredText(ImVec4(0.7f, 0.7f, 0.7f, 1.0f), "Verification Code");
                ImGui::SetNextItemWidth(field_width);
                ImGui::InputText("##icl_2fa", icl_2fa_buf_, sizeof(icl_2fa_buf_),
                    ImGuiInputTextFlags_CharsDecimal);

                ImGui::PopStyleColor(3);
                ImGui::Spacing();
                ImGui::Spacing();

                // --- Error message ---
                {
                    std::lock_guard<std::mutex> lock(state.mu);
                    if (!state.icl_auth_error.empty()) {
                        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.35f, 0.12f, 0.12f, 0.6f));
                        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 6.0f);
                        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 10.0f));
                        if (ImGui::BeginChild("##icl_2fa_err", ImVec2(ImGui::GetContentRegionAvail().x, 0),
                            ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_AlwaysUseWindowPadding)) {
                            ImDrawList* dl = ImGui::GetWindowDrawList();
                            ImVec2 p = ImGui::GetWindowPos();
                            dl->AddRectFilled(p, ImVec2(p.x + 3.0f, p.y + ImGui::GetWindowHeight()),
                                IM_COL32(240, 80, 80, 255), 2.0f);
                            core::ColoredText(ImVec4(1.0f, 0.5f, 0.5f, 1.0f), "%s", state.icl_auth_error.c_str());
                        }
                        ImGui::EndChild();
                        ImGui::PopStyleVar(2);
                        ImGui::PopStyleColor();
                        ImGui::Spacing();
                    }
                }

                float button_width = ImGui::GetContentRegionAvail().x;

                core::WithButtonStyle({accent,
                    ImVec4(accent.x + 0.08f, accent.y + 0.08f, accent.z + 0.08f, 1.0f),
                    ImVec4(accent.x - 0.05f, accent.y - 0.05f, accent.z - 0.05f, 1.0f),
                    ImVec4(1.0f, 1.0f, 1.0f, 1.0f), 8.0f}, [&]() {
                    if (ImGui::Button("Verify##icl", ImVec2(button_width, 44))) {
                        std::string code(icl_2fa_buf_);
                        if (!code.empty()) {
                            state.verify_icl_2fa(pending_email, code);
                            memset(icl_2fa_buf_, 0, sizeof(icl_2fa_buf_));
                        } else {
                            std::lock_guard<std::mutex> lock(state.mu);
                            state.icl_auth_error = "Please enter the verification code.";
                        }
                    }
                });

                ImGui::Spacing();

                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.25f, 0.25f, 0.27f, 0.4f));
                ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.2f, 0.2f, 0.22f, 0.4f));
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.55f, 0.55f, 0.58f, 1.0f));
                if (ImGui::Button("Back##icl", ImVec2(button_width, 36))) {
                    std::lock_guard<std::mutex> lock(state.mu);
                    state.icl_awaiting_2fa = false;
                    state.icl_auth_error.clear();
                    memset(icl_2fa_buf_, 0, sizeof(icl_2fa_buf_));
                }
                ImGui::PopStyleColor(4);
            }

            ImGui::EndPopup();
        }

        if (!state.show_icl_login_modal) {
            std::lock_guard<std::mutex> lock(state.mu);
            if (!state.icl_awaiting_2fa) {
                memset(icl_email_buf_, 0, sizeof(icl_email_buf_));
                memset(icl_password_buf_, 0, sizeof(icl_password_buf_));
            }
        }

        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(5);
    }

}
