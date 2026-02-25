#include "views/main_view.h"
#include <algorithm>


namespace misty::view {
    MainView::MainView(UIRegistry& ui_registry,
        WorkerPool& worker_pool, std::shared_ptr<MistyClient> client) : 
        ui_registry_(ui_registry), worker_pool_(worker_pool), client_(client) {

        init_panels();
    }
  
    void MainView::init_panels() {
        file_explorer_panel_ = std::make_shared<panel::FileExplorerPanel>(ui_registry_, worker_pool_, client_);
        file_sidebar_panel_ = std::make_shared<panel::FileSidebarPanel>(ui_registry_, worker_pool_, client_);
        file_sidebar_panel_->set_mount_path_provider([this]() -> std::string {
            return client_ ? client_->GetClientMountPath() : "";
        });
        navbar_panel_ = std::make_shared<panel::NavbarPanel>(ui_registry_);
        notification_panel_ = std::make_shared<panel::NotificationPanel>(ui_registry_);
    }

    view::ViewID MainView::get_view_id() {
        return view::ViewID::Files;
    }
    
    void MainView::render() {
        ImGuiViewport* viewport = ImGui::GetMainViewport();

        // ---------------------------------------------------------
        // 1. Define Layout Constraints
        // ---------------------------------------------------------
        float navbar_width = 77.0f;

        // ---------------------------------------------------------
        // 2. Calculate Geometry (Left-to-Right Flow)
        // ---------------------------------------------------------

        // --- Navbar Geometry (Left Vertical Strip) ---
        ImVec2 navbar_pos = viewport->WorkPos;
        ImVec2 navbar_size = ImVec2(navbar_width, viewport->WorkSize.y);

        // --- Sidebar Geometry (Middle Column) ---
        float sidebar_w = sidebar_width_;
        float sidebar_h = viewport->WorkSize.y;
        ImVec2 sidebar_pos = ImVec2(viewport->WorkPos.x + navbar_width, viewport->WorkPos.y);

        // --- Explorer Geometry (Right Column) ---
        float explorer_w = viewport->WorkSize.x - navbar_width - sidebar_w;
        float explorer_h = viewport->WorkSize.y;
        ImVec2 explorer_pos = ImVec2(sidebar_pos.x + sidebar_w, viewport->WorkPos.y);

        // ---------------------------------------------------------
        // 3. Resize Handle (between sidebar and explorer)
        // ---------------------------------------------------------
        float handle_x0 = explorer_pos.x - kResizeHandleWidth * 0.5f;
        float handle_x1 = handle_x0 + kResizeHandleWidth;
        float handle_y0 = viewport->WorkPos.y;
        float handle_y1 = handle_y0 + viewport->WorkSize.y;

        ImGuiIO& io = ImGui::GetIO();
        bool hovered = io.MousePos.x >= handle_x0 && io.MousePos.x <= handle_x1
                    && io.MousePos.y >= handle_y0 && io.MousePos.y <= handle_y1;

        if (hovered || is_resizing_sidebar_) {
            ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeEW);
        }

        if (hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
            is_resizing_sidebar_ = true;
        }

        if (is_resizing_sidebar_) {
            if (ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
                float new_width = io.MousePos.x - sidebar_pos.x;
                sidebar_width_ = std::clamp(new_width, kSidebarMinWidth, kSidebarMaxWidth);

                // Recalculate positions after resize
                sidebar_w = sidebar_width_;
                explorer_w = viewport->WorkSize.x - navbar_width - sidebar_w;
                explorer_pos.x = sidebar_pos.x + sidebar_w;
            } else {
                is_resizing_sidebar_ = false;
            }
        }

        // Draw a subtle line for the handle on hover
        if (hovered || is_resizing_sidebar_) {
            ImDrawList* fg = ImGui::GetForegroundDrawList();
            float line_x = sidebar_pos.x + sidebar_w;
            fg->AddLine(
                ImVec2(line_x, viewport->WorkPos.y),
                ImVec2(line_x, viewport->WorkPos.y + viewport->WorkSize.y),
                IM_COL32(100, 100, 100, 180), 2.0f);
        }

        // ---------------------------------------------------------
        // 4. Render
        // ---------------------------------------------------------

        ImGui::SetNextWindowPos(navbar_pos);
        ImGui::SetNextWindowSize(navbar_size);
        navbar_panel_->render();

        ImGui::SetNextWindowPos(sidebar_pos);
        ImGui::SetNextWindowSize(ImVec2(sidebar_w, sidebar_h));
        file_sidebar_panel_->render();

        ImGui::SetNextWindowPos(explorer_pos);
        ImGui::SetNextWindowSize(ImVec2(explorer_w, explorer_h));
        file_explorer_panel_->render();

        // Render notifications on top (no position/size needed, it positions itself)
        notification_panel_->render();
    }

    

}