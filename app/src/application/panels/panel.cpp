#include "panel.h"
#include "imgui.h"

namespace minidfs::panel {
    void Panel::show_error_modal(std::string& error_msg, const char* modal_id) {
        if (!error_msg.empty()) {
            ImGui::OpenPopup(modal_id);
        }
        
        if (ImGui::BeginPopupModal(modal_id, nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
            ImGui::TextColored(ImVec4(1.0f, 0.4f, 0.4f, 1.0f), "Error");
            ImGui::Separator();
            ImGui::TextWrapped("%s", error_msg.c_str());
            ImGui::Spacing();

            float button_width = 120.0f;
            float window_width = ImGui::GetWindowWidth();
            float button_x = (window_width - button_width) * 0.5f;
            ImGui::SetCursorPosX(button_x);

            if (ImGui::Button("OK", ImVec2(button_width, 0))) {
                error_msg = "";
                ImGui::CloseCurrentPopup();
            }
            ImGui::EndPopup();
        }
    }
}
