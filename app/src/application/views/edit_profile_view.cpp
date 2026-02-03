#include "edit_profile_view.h"
#include "imgui.h"

namespace misty::view {
    EditProfileView::EditProfileView(core::UIRegistry& ui_registry)
        : ui_registry_(ui_registry) {
        init_panels();
    }

    void EditProfileView::init_panels() {
        navbar_panel_ = std::make_shared<panel::NavbarPanel>(ui_registry_);
        edit_profile_panel_ = std::make_shared<panel::EditProfilePanel>(ui_registry_);
        notification_panel_ = std::make_shared<panel::NotificationPanel>(ui_registry_);
    }

    ViewID EditProfileView::get_view_id() {
        return ViewID::EditProfile;
    }

    void EditProfileView::render() {
        ImGuiViewport* viewport = ImGui::GetMainViewport();
        float navbar_width = 77.0f;

        // Navbar on the left
        ImVec2 navbar_pos = viewport->WorkPos;
        ImVec2 navbar_size = ImVec2(navbar_width, viewport->WorkSize.y);

        ImGui::SetNextWindowPos(navbar_pos, ImGuiCond_Always);
        ImGui::SetNextWindowSize(navbar_size, ImGuiCond_Always);
        navbar_panel_->render();

        // Edit profile panel takes the rest
        float sx = viewport->WorkPos.x + navbar_width;
        float sy = viewport->WorkPos.y;
        float sw = viewport->WorkSize.x - navbar_width;
        float sh = viewport->WorkSize.y;

        ImGui::SetNextWindowPos(ImVec2(sx, sy), ImGuiCond_Always);
        ImGui::SetNextWindowSize(ImVec2(sw, sh), ImGuiCond_Always);
        edit_profile_panel_->render();

        // Render notifications on top
        notification_panel_->render();
    }
}
