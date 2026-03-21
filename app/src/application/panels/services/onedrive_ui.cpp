#include "services_panel.h"

#include "core/manager/asset_manager.h"
#include "core/ui/imgui_utils.h"

namespace misty::panel {
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
        if (card.profile_loaded && !card.profile.email.empty()) {
            core::ColoredText(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "Email");
            core::ColoredText(ImVec4(0.8f, 0.8f, 0.8f, 1.0f), "%s", card.profile.email.c_str());
            return;
        }
        core::ColoredText(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "ID");
        core::ColoredText(ImVec4(0.6f, 0.6f, 0.6f, 1.0f), "%s", ms_user_id.substr(0, 8).c_str());
    }

    void ServicesPanel::show_onedrive_card_actions(ServicesState& state, const std::string& ms_user_id, bool is_connected) {
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10.0f, 7.0f));
        if (is_connected) {
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.5f, 0.2f, 0.2f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.6f, 0.3f, 0.3f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.45f, 0.15f, 0.15f, 1.0f));
            if (ImGui::Button("Disconnect", ImVec2(ImGui::GetContentRegionAvail().x, 32.0f))) {
                pending_disconnect_provider_ = "onedrive";
                pending_disconnect_id_ = ms_user_id;
                ImGui::OpenPopup("##confirm_disconnect");
            }
            ImGui::PopStyleColor(3);
            ImGui::PopStyleVar();
            return;
        }
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.35f, 0.5f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.45f, 0.6f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.15f, 0.3f, 0.45f, 1.0f));
        if (ImGui::Button("Reconnect", ImVec2(ImGui::GetContentRegionAvail().x * 0.48f, 32.0f))) {
            state.initiate_ms_login();
        }
        ImGui::PopStyleColor(3);
        ImGui::SameLine();
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.4f, 0.4f, 0.4f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.25f, 0.25f, 0.25f, 1.0f));
        if (ImGui::Button("Remove", ImVec2(ImGui::GetContentRegionAvail().x, 32.0f))) {
            pending_disconnect_provider_ = "onedrive";
            pending_disconnect_id_ = ms_user_id;
            ImGui::OpenPopup("##confirm_disconnect");
        }
        ImGui::PopStyleColor(3);
        ImGui::PopStyleVar();
    }

    void ServicesPanel::show_onedrive_profile_card(ServicesState& state, const std::string& ms_user_id) {
        OneDriveCardState card;
        if (!state.get_onedrive_card_state(ms_user_id, card)) {
            return;
        }

        ImGui::PushID(ms_user_id.c_str());
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 12.0f));
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.14f, 0.14f, 0.14f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.3f, 0.3f, 0.3f, 0.5f));
        ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, 1.0f);

        if (ImGui::BeginChild("OneDriveCard", ImVec2(kCardWidth, 0.0f), ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_Borders | ImGuiChildFlags_AlwaysUseWindowPadding)) {
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

        ImGui::PopStyleVar(3);
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


}
