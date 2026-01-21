#include "devices_view.h"
#include "imgui.h"

namespace minidfs::view {
    DevicesView::DevicesView(UIRegistry& ui_registry)
        : ui_registry_(ui_registry) {
        init_panels();
    }

    void DevicesView::init_panels() {
        navbar_panel_ = std::make_shared<panel::NavbarPanel>(ui_registry_);
        devices_panel_ = std::make_shared<panel::DevicesPanel>(ui_registry_);
    }

    ViewID DevicesView::get_view_id() {
        return ViewID::Devices;
    }

    void DevicesView::render() {
        ImGuiViewport* viewport = ImGui::GetMainViewport();

        // Navbar on the left
        float navbar_width = 77.0f;
        ImVec2 navbar_pos = viewport->WorkPos;
        ImVec2 navbar_size = ImVec2(navbar_width, viewport->WorkSize.y);
        
        ImGui::SetNextWindowPos(navbar_pos, ImGuiCond_Always);
        ImGui::SetNextWindowSize(navbar_size, ImGuiCond_Always);
        navbar_panel_->render();

        // Devices panel takes remaining space
        float devices_x = viewport->WorkPos.x + navbar_width;
        float devices_y = viewport->WorkPos.y;
        float devices_width = viewport->WorkSize.x - navbar_width;
        float devices_height = viewport->WorkSize.y;
        
        ImGui::SetNextWindowPos(ImVec2(devices_x, devices_y), ImGuiCond_Always);
        ImGui::SetNextWindowSize(ImVec2(devices_width, devices_height), ImGuiCond_Always);
        devices_panel_->render();
    }
}
