#include "services_view.h"
#include "imgui.h"

namespace minidfs::view {
    ServicesView::ServicesView(UIRegistry& ui_registry)
        : ui_registry_(ui_registry) {
        init_panels();
    }

    void ServicesView::init_panels() {
        navbar_panel_ = std::make_shared<panel::NavbarPanel>(ui_registry_);
        services_panel_ = std::make_shared<panel::ServicesPanel>(ui_registry_);
    }

    ViewID ServicesView::get_view_id() {
        return ViewID::Services;
    }

    void ServicesView::render() {
        ImGuiViewport* viewport = ImGui::GetMainViewport();
        float navbar_width = 77.0f;
        ImVec2 navbar_pos = viewport->WorkPos;
        ImVec2 navbar_size = ImVec2(navbar_width, viewport->WorkSize.y);

        ImGui::SetNextWindowPos(navbar_pos, ImGuiCond_Always);
        ImGui::SetNextWindowSize(navbar_size, ImGuiCond_Always);
        navbar_panel_->render();

        float sx = viewport->WorkPos.x + navbar_width;
        float sy = viewport->WorkPos.y;
        float sw = viewport->WorkSize.x - navbar_width;
        float sh = viewport->WorkSize.y;
        ImGui::SetNextWindowPos(ImVec2(sx, sy), ImGuiCond_Always);
        ImGui::SetNextWindowSize(ImVec2(sw, sh), ImGuiCond_Always);
        services_panel_->render();
    }
}
