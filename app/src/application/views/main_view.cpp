#include "views/main_view.h"
#include "core/commands/command_manager.h"
#include "core/manager/session_manager.h"
#include "core/manager/asset_manager.h"
#include "core/manager/proxy_manager.h"
#include "core/net/http_client.h"
#include "core/ui/imgui_utils.h"
#include <algorithm>


namespace misty::view {
    MainView::MainView(UIRegistry& ui_registry,
        WorkerPool& worker_pool, std::shared_ptr<MistyClient> client) : 
        ui_registry_(ui_registry), worker_pool_(worker_pool), client_(client) {

        init_panels();
        schedule_proxy_probe();
    }
  
    void MainView::init_panels() {
        file_explorer_panel_ = std::make_shared<panel::FileExplorerPanel>(ui_registry_, worker_pool_, client_);
        file_sidebar_panel_ = std::make_shared<panel::FileSidebarPanel>(ui_registry_, worker_pool_, client_);
        file_sidebar_panel_->set_mount_path_provider([this]() -> std::string {
            return client_ ? client_->GetClientMountPath() : "";
        });
        navbar_panel_ = std::make_shared<panel::NavbarPanel>(ui_registry_);
        notification_panel_ = std::make_shared<panel::NotificationPanel>(ui_registry_);
        search_panel_ = std::make_shared<panel::SearchPanel>(ui_registry_, worker_pool_);
        file_explorer_panel_->set_search_panel(search_panel_.get());
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
        float content_x = viewport->WorkPos.x + navbar_width;
        float content_width = viewport->WorkSize.x - navbar_width;
        float proxy_banner_height = render_proxy_status_banner(
            ImVec2(content_x, viewport->WorkPos.y),
            content_width
        );

        // ---------------------------------------------------------
        // 2. Calculate Geometry (Left-to-Right Flow)
        // ---------------------------------------------------------

        // --- Navbar Geometry (Left Vertical Strip) ---
        ImVec2 navbar_pos = viewport->WorkPos;
        ImVec2 navbar_size = ImVec2(navbar_width, viewport->WorkSize.y);

        // --- Sidebar Geometry (Middle Column) ---
        float sidebar_w = sidebar_width_;
        float sidebar_h = viewport->WorkSize.y - proxy_banner_height;
        ImVec2 sidebar_pos = ImVec2(content_x, viewport->WorkPos.y + proxy_banner_height);

        // --- Explorer Geometry (Right Column) ---
        float explorer_w = viewport->WorkSize.x - navbar_width - sidebar_w;
        float explorer_h = viewport->WorkSize.y - proxy_banner_height;
        ImVec2 explorer_pos = ImVec2(sidebar_pos.x + sidebar_w, viewport->WorkPos.y);
        explorer_pos.y += proxy_banner_height;

        // ---------------------------------------------------------
        // 3. Resize Handle (between sidebar and explorer)
        // ---------------------------------------------------------
        float handle_x0 = explorer_pos.x - kResizeHandleWidth * 0.5f;
        float handle_x1 = handle_x0 + kResizeHandleWidth;
        float handle_y0 = sidebar_pos.y;
        float handle_y1 = viewport->WorkPos.y + viewport->WorkSize.y;

        ImGuiIO& io = ImGui::GetIO();

        if (core::CommandManager::get().matches("search.toggle")) {
            search_panel_->toggle();
        }
        if (core::CommandManager::get().matches("app.open_settings")) {
            view::switch_view(view::ViewID::Settings);
        }

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
                ImVec2(line_x, sidebar_pos.y),
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

        // Search modal renders last so it sits above everything
        search_panel_->render();

        // Session expiry modal — must be outermost so it blocks all interaction
        show_session_expired_modal();
    }

    void MainView::schedule_proxy_probe() {
        bool expected = false;
        if (!proxy_probe_in_flight_.compare_exchange_strong(expected, true)) {
            return;
        }

        worker_pool_.add(
            []() {
                core::ProxyManager::get().ensure_running();
            },
            [this]() {
                proxy_probe_in_flight_.store(false);
            },
            [this](const std::string&) {
                core::SessionManager::get().mark_proxy_unavailable();
                proxy_probe_in_flight_.store(false);
            }
        );
    }

    float MainView::render_proxy_status_banner(const ImVec2& pos, float width) {
        if (core::SessionManager::get().is_proxy_available()) {
            return 0.0f;
        }

        constexpr float kBannerHeight = 62.0f;
        constexpr float kButtonWidth = 112.0f;

        ImGui::SetNextWindowPos(pos);
        ImGui::SetNextWindowSize(ImVec2(width, kBannerHeight));
        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoSavedSettings;

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.20f, 0.13f, 0.09f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.48f, 0.31f, 0.15f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 12.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 1.0f);

        if (ImGui::Begin("##proxy_status_banner", nullptr, flags)) {
            ImGui::PushFont(core::AssetManager::get().get_font(core::FontID::DEFAULT));
            ImGui::TextUnformatted("Background Service Offline");
            ImGui::PopFont();

            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.90f, 0.84f, 0.76f, 1.0f));
            ImGui::TextWrapped("%s", core::SessionManager::get().get_proxy_status_message().c_str());
            ImGui::PopStyleColor();

            ImGui::SetCursorPos(ImVec2(
                ImGui::GetWindowWidth() - kButtonWidth - 16.0f,
                (kBannerHeight - 32.0f) * 0.5f
            ));
            if (proxy_probe_in_flight_.load()) {
                ImGui::BeginDisabled();
                ImGui::Button("Checking...", ImVec2(kButtonWidth, 32.0f));
                ImGui::EndDisabled();
            } else if (ImGui::Button("Retry", ImVec2(kButtonWidth, 32.0f))) {
                schedule_proxy_probe();
            }
        }
        ImGui::End();

        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor(2);
        return kBannerHeight;
    }

    void MainView::show_session_expired_modal() {
        if (!core::SessionManager::get().is_session_expired()) return;

        // Transparent full-screen host window — gives the popup a valid parent context
        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(vp->WorkPos);
        ImGui::SetNextWindowSize(vp->WorkSize);
        ImGui::SetNextWindowBgAlpha(0.0f);

        ImGuiWindowFlags host_flags =
            ImGuiWindowFlags_NoTitleBar      | ImGuiWindowFlags_NoResize    |
            ImGuiWindowFlags_NoMove          | ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoDecoration|
            ImGuiWindowFlags_NoNav;

        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
        if (ImGui::Begin("##session_host", nullptr, host_flags)) {
            ImGui::OpenPopup("##session_expired");

            ImGui::SetNextWindowPos(vp->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
            ImGui::SetNextWindowSize(ImVec2(360.0f, 0.0f), ImGuiCond_Always);

            ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.10f, 0.10f, 0.11f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_Border,  ImVec4(0.22f, 0.22f, 0.24f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,  ImVec2(28.0f, 28.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,    ImVec2(0.0f,  12.0f));

            if (ImGui::BeginPopupModal("##session_expired", nullptr,
                    ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                    ImGuiWindowFlags_NoMove     | ImGuiWindowFlags_AlwaysAutoResize)) {

                float w = ImGui::GetContentRegionAvail().x;

                // Lock icon
                auto& lock_icon = core::AssetManager::get().get_svg_texture("lock-24", 32);
                if (lock_icon.id) {
                    ImGui::SetCursorPosX((w - 32.0f) * 0.5f);
                    ImGui::Image(lock_icon.id, ImVec2(32.0f, 32.0f));
                    ImGui::Spacing();
                }

                // Title
                ImGui::PushFont(core::AssetManager::get().get_font(core::FontID::ROBOTO_LARGE));
                const char* title = "Session Expired";
                ImGui::SetCursorPosX((w - ImGui::CalcTextSize(title).x) * 0.5f);
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.90f, 0.90f, 0.90f, 1.0f));
                ImGui::TextUnformatted(title);
                ImGui::PopStyleColor();
                ImGui::PopFont();

                ImGui::Spacing();

                // Message
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.58f, 0.58f, 0.58f, 1.0f));
                ImGui::TextWrapped(
                    "Your session has expired and could not be renewed. "
                    "Please log in again to continue.");
                ImGui::PopStyleColor();

                ImGui::Spacing();
                ImGui::Separator();
                ImGui::Spacing();

                // Can't be dismissed any other way — no close button, no Esc
                if (core::StyledButton("Log In Again", ImVec2(w, 42.0f),
                                       core::ButtonTheme::Primary())) {
                    core::SessionManager::get().clear_token();
                    core::SessionManager::get().clear_session_expired();
                    ImGui::CloseCurrentPopup();
                    view::switch_view(view::ViewID::Login);
                }

                ImGui::EndPopup();
            }

            ImGui::PopStyleVar(3);
            ImGui::PopStyleColor(2);
        }
        ImGui::End();
        ImGui::PopStyleVar(); // host window padding
    }

}
