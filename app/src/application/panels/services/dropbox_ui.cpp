#include "services_panel.h"

#include "core/manager/asset_manager.h"
#include "core/ui/imgui_utils.h"

namespace misty::panel {
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


}
