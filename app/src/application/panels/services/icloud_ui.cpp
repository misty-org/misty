#include "services_panel.h"

#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"
#include "core/ui/imgui_utils.h"

namespace misty::panel {
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
        core::ColoredText(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "Email");
        core::ColoredText(ImVec4(0.8f, 0.8f, 0.8f, 1.0f), "%s", email.c_str());
    }

    void ServicesPanel::show_icloud_card_actions(ServicesState& state, const std::string& email, bool is_connected) {
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10.0f, 7.0f));
        if (is_connected) {
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.5f, 0.2f, 0.2f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.6f, 0.3f, 0.3f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.45f, 0.15f, 0.15f, 1.0f));
            if (ImGui::Button("Disconnect##icl", ImVec2(ImGui::GetContentRegionAvail().x, 32.0f))) {
                pending_disconnect_provider_ = "icloud";
                pending_disconnect_id_ = email;
                ImGui::OpenPopup("##confirm_disconnect");
            }
            ImGui::PopStyleColor(3);
            ImGui::PopStyleVar();
            return;
        }
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.0f, 0.37f, 0.54f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.0f, 0.47f, 0.64f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.0f, 0.30f, 0.45f, 1.0f));
        if (ImGui::Button("Reconnect##icl", ImVec2(ImGui::GetContentRegionAvail().x * 0.48f, 32.0f))) {
            state.show_icl_login_modal = true;
        }
        ImGui::PopStyleColor(3);
        ImGui::SameLine();
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.4f, 0.4f, 0.4f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.25f, 0.25f, 0.25f, 1.0f));
        if (ImGui::Button("Remove##icl", ImVec2(ImGui::GetContentRegionAvail().x, 32.0f))) {
            pending_disconnect_provider_ = "icloud";
            pending_disconnect_id_ = email;
            ImGui::OpenPopup("##confirm_disconnect");
        }
        ImGui::PopStyleColor(3);
        ImGui::PopStyleVar();
    }

    void ServicesPanel::show_icloud_profile_card(ServicesState& state, const std::string& email) {
        ICloudCardState card;
        if (!state.get_icloud_card_state(email, card)) {
            return;
        }

        ImGui::PushID(("icl_" + email).c_str());
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 12.0f));
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.14f, 0.14f, 0.14f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.3f, 0.3f, 0.3f, 0.5f));
        ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, 1.0f);

        if (ImGui::BeginChild("ICloudCard", ImVec2(kCardWidth, 0.0f), ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_Borders | ImGuiChildFlags_AlwaysUseWindowPadding)) {
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

        ImGui::PopStyleVar(3);
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

    // ==================== Loading Overlay ====================


}
