#include "panels/services/services_panel.h"

#include "imgui.h"

namespace misty::panel {
    namespace {
        constexpr ImVec4 kBorder = ImVec4(0.24f, 0.27f, 0.30f, 1.0f);
        constexpr ImVec4 kText = ImVec4(0.94f, 0.95f, 0.97f, 1.0f);
        constexpr ImVec4 kMuted = ImVec4(0.62f, 0.66f, 0.70f, 1.0f);

        bool outline_button(const char* label, const ImVec2& size) {
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.15f, 0.17f, 0.19f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.20f, 0.22f, 0.25f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.12f, 0.14f, 0.16f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
            bool pressed = ImGui::Button(label, size);
            ImGui::PopStyleVar(2);
            ImGui::PopStyleColor(5);
            return pressed;
        }
    }

    void ServicesPanel::show_placeholder_dialogs(ServicesState& state) {
        bool show_add = false;
        bool show_rename = false;
        bool show_disconnect = false;
        std::string pending_id;
        std::string flash_message;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            show_add = state.show_add_service_modal;
            show_rename = state.show_rename_modal;
            show_disconnect = state.show_disconnect_modal;
            pending_id = state.pending_service_id;
            flash_message = state.flash_message;
        }

        const char* popup_name = nullptr;
        const char* title = nullptr;
        if (show_add) {
            popup_name = "##services_add_placeholder";
            title = "Add Service";
        } else if (show_rename) {
            popup_name = "##services_rename_placeholder";
            title = "Rename Service";
        } else if (show_disconnect) {
            popup_name = "##services_disconnect_placeholder";
            title = "Disconnect Service";
        }

        if (!popup_name) {
            return;
        }

        if (!ImGui::IsPopupOpen(popup_name)) {
            ImGui::OpenPopup(popup_name);
        }

        ImGuiViewport* viewport = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(viewport->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(420.0f, 0.0f), ImGuiCond_Always);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 12.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(22.0f, 22.0f));
        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.12f, 0.13f, 0.15f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

        if (ImGui::BeginPopupModal(popup_name, nullptr,
                                   ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                                       ImGuiWindowFlags_NoMove | ImGuiWindowFlags_AlwaysAutoResize)) {
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.15f);
            ImGui::TextUnformatted(title);
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::TextWrapped("%s", flash_message.c_str());
            if (!pending_id.empty()) {
                ImGui::Spacing();
                ImGui::TextWrapped("Selected service id: %s", pending_id.c_str());
            }
            ImGui::PopStyleColor();

            ImGui::Spacing();
            if (outline_button("Close", ImVec2(-1.0f, 40.0f))) {
                state.dismiss_active_dialog();
                state.clear_flash_message();
                ImGui::CloseCurrentPopup();
            }
            ImGui::EndPopup();
        }

        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(2);
    }
}
