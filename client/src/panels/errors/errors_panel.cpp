#include "panels/errors/errors_panel.h"

#include "core/manager/asset_manager.h"
#include "core/manager/session_manager.h"
#include "core/ui/imgui_utils.h"
#include "views/app_view.h"
#include "imgui.h"

namespace misty::panel {

void ErrorsPanel::render() {
    render_session_expired();
}

void ErrorsPanel::render_session_expired() {
    if (!core::SessionManager::get().is_session_expired()) {
        return;
    }

    ImGuiViewport* vp = ImGui::GetMainViewport();

    // Dim backdrop drawn on the foreground layer — always on top, no window needed.
    ImDrawList* fg = ImGui::GetForegroundDrawList(vp);
    fg->AddRectFilled(
        vp->WorkPos,
        ImVec2(vp->WorkPos.x + vp->WorkSize.x, vp->WorkPos.y + vp->WorkSize.y),
        IM_COL32(0, 0, 0, 150));

    // Dialog window — regular Begin/End so there are no popup-stack timing issues.
    constexpr float kDialogW = 360.0f;
    ImGui::SetNextWindowPos(vp->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
    ImGui::SetNextWindowSize(ImVec2(kDialogW, 0.0f), ImGuiCond_Always);
    ImGui::SetNextWindowFocus();

    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.10f, 0.10f, 0.11f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_Border,   ImVec4(0.22f, 0.22f, 0.24f, 1.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,  ImVec2(28.0f, 28.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,    ImVec2(0.0f, 12.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 1.0f);

    constexpr ImGuiWindowFlags kDialogFlags =
        ImGuiWindowFlags_NoTitleBar   |
        ImGuiWindowFlags_NoResize     |
        ImGuiWindowFlags_NoMove       |
        ImGuiWindowFlags_NoScrollbar  |
        ImGuiWindowFlags_NoSavedSettings |
        ImGuiWindowFlags_AlwaysAutoResize;

    if (ImGui::Begin("##session_expired_dialog", nullptr, kDialogFlags)) {
        const float w = ImGui::GetContentRegionAvail().x;

        auto& lock_icon = core::AssetManager::get().get_svg_texture("lock-24", 32);
        if (lock_icon.id) {
            ImGui::SetCursorPosX((w - 32.0f) * 0.5f);
            ImGui::Image(lock_icon.id, ImVec2(32.0f, 32.0f));
            ImGui::Spacing();
        }

        ImGui::PushFont(core::AssetManager::get().get_font(core::FontID::ROBOTO_LARGE));
        const char* title = "Session Expired";
        ImGui::SetCursorPosX((w - ImGui::CalcTextSize(title).x) * 0.5f);
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.90f, 0.90f, 0.90f, 1.0f));
        ImGui::TextUnformatted(title);
        ImGui::PopStyleColor();
        ImGui::PopFont();

        ImGui::Spacing();

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.58f, 0.58f, 0.58f, 1.0f));
        ImGui::TextWrapped(
            "Your session has expired and could not be renewed. "
            "Please log in again to continue.");
        ImGui::PopStyleColor();

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();

        if (core::StyledButton("Log In Again", ImVec2(w, 42.0f),
                               core::ButtonTheme::Primary())) {
            core::SessionManager::get().clear_token();
            core::SessionManager::get().clear_session_expired();
            view::switch_view(view::ViewID::Login);
        }
    }
    ImGui::End();

    ImGui::PopStyleVar(4);
    ImGui::PopStyleColor(2);
}

} // namespace misty::panel
