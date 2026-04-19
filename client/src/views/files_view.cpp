#include "views/files_view.h"

#include <algorithm>

#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"
#include "core/manager/proxy_manager.h"
#include "core/manager/session_manager.h"
#include "core/ui/imgui_utils.h"
#include "panels/file_explorer/file_explorer_state.h"

namespace misty::view {
    FilesView::FilesView(core::UIRegistry& ui_registry,
                         core::WorkerPool& worker_pool,
                         std::shared_ptr<MistyClient> client)
        : ui_registry_(ui_registry)
        , worker_pool_(worker_pool)
        , client_(std::move(client)) {
        init_panels();
        schedule_proxy_probe();
    }

    FilesView::~FilesView() = default;

    void FilesView::init_panels() {
        file_sidebar_panel_ = std::make_shared<panel::FileSidebarPanel>(ui_registry_, worker_pool_, client_);
        file_sidebar_panel_->set_mount_path_provider([this]() -> std::string {
            return client_ ? client_->GetClientMountPath() : "";
        });
        file_sidebar_panel_->set_active_explorer_state_key_provider([this]() -> std::string {
            return active_explorer_state_key();
        });
        navbar_panel_ = std::make_shared<panel::NavbarPanel>(ui_registry_);
        notification_panel_ = std::make_shared<panel::NotificationPanel>(ui_registry_);
        claude_panel_ = std::make_shared<panel::ClaudePanel>(ui_registry_, worker_pool_);
        filetree_panel_ = std::make_shared<panel::FileTreePanel>(ui_registry_, worker_pool_, client_);
    }

    view::ViewID FilesView::get_view_id() {
        return view::ViewID::Files;
    }

    std::string FilesView::active_explorer_state_key() const {
        return filetree_panel_ ? filetree_panel_->active_explorer_state_key() : "Files";
    }

    bool FilesView::invoke_command(const std::string& command_id) {
        return filetree_panel_ ? filetree_panel_->invoke_command(command_id) : false;
    }

    void FilesView::render() {
        ImGuiViewport* viewport = ImGui::GetMainViewport();

        const float navbar_width = 77.0f;
        const float content_x = viewport->WorkPos.x + navbar_width;
        const float content_width = viewport->WorkSize.x - navbar_width;
        const float proxy_banner_height = render_proxy_status_banner(
            ImVec2(content_x, viewport->WorkPos.y),
            content_width
        );

        const ImVec2 navbar_pos = viewport->WorkPos;
        const ImVec2 navbar_size(navbar_width, viewport->WorkSize.y);

        float sidebar_w = sidebar_width_;
        const float sidebar_h = viewport->WorkSize.y - proxy_banner_height;
        const ImVec2 sidebar_pos(content_x, viewport->WorkPos.y + proxy_banner_height);

        float claude_w = claude_panel_->is_open() ? claude_panel_width_ : 0.0f;
        float explorer_w = viewport->WorkSize.x - navbar_width - sidebar_w - claude_w;
        const float explorer_h = viewport->WorkSize.y - proxy_banner_height;
        ImVec2 explorer_pos(sidebar_pos.x + sidebar_w, viewport->WorkPos.y + proxy_banner_height);

        const float handle_x0 = explorer_pos.x - kResizeHandleWidth * 0.5f;
        const float handle_x1 = handle_x0 + kResizeHandleWidth;
        const float handle_y0 = sidebar_pos.y;
        const float handle_y1 = viewport->WorkPos.y + viewport->WorkSize.y;

        ImGuiIO& io = ImGui::GetIO();

        if (core::CommandManager::get().matches("search.toggle")) {
            filetree_panel_->toggle_active_search();
        }
        if (core::CommandManager::get().matches("app.open_settings")) {
            view::switch_view(view::ViewID::Settings);
        }
        if (core::CommandManager::get().matches("explorer.toggle_claude")) {
            claude_panel_->toggle();
        }
        filetree_panel_->handle_commands();

        if (claude_panel_->is_open()) {
            const std::string key = active_explorer_state_key();
            if (!key.empty()) {
                auto& explorer_state = ui_registry_.get_state<panel::FileExplorerState>(key);
                const std::string path(explorer_state.current_path);
                if (!path.empty()) {
                    claude_panel_->set_working_dir(path);
                }
            }
        }

        const bool hovered = io.MousePos.x >= handle_x0 && io.MousePos.x <= handle_x1 &&
                             io.MousePos.y >= handle_y0 && io.MousePos.y <= handle_y1;

        if (hovered || is_resizing_sidebar_) {
            ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeEW);
        }
        if (hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
            is_resizing_sidebar_ = true;
        }
        if (is_resizing_sidebar_) {
            if (ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
                const float new_width = io.MousePos.x - sidebar_pos.x;
                sidebar_width_ = std::clamp(new_width, kSidebarMinWidth, kSidebarMaxWidth);
                sidebar_w = sidebar_width_;
                explorer_w = viewport->WorkSize.x - navbar_width - sidebar_w - claude_w;
                explorer_pos.x = sidebar_pos.x + sidebar_w;
            } else {
                is_resizing_sidebar_ = false;
            }
        }

        if (hovered || is_resizing_sidebar_) {
            ImDrawList* fg = ImGui::GetForegroundDrawList();
            const float line_x = sidebar_pos.x + sidebar_w;
            fg->AddLine(
                ImVec2(line_x, sidebar_pos.y),
                ImVec2(line_x, viewport->WorkPos.y + viewport->WorkSize.y),
                IM_COL32(100, 100, 100, 180), 2.0f);
        }

        if (claude_panel_->is_open()) {
            const float claude_handle_x = explorer_pos.x + explorer_w;
            const float ch_x0 = claude_handle_x - kResizeHandleWidth * 0.5f;
            const float ch_x1 = ch_x0 + kResizeHandleWidth;

            const bool ch_hovered = io.MousePos.x >= ch_x0 && io.MousePos.x <= ch_x1 &&
                                    io.MousePos.y >= handle_y0 && io.MousePos.y <= handle_y1;

            if (ch_hovered || is_resizing_claude_panel_) {
                ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeEW);
            }
            if (ch_hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
                is_resizing_claude_panel_ = true;
            }
            if (is_resizing_claude_panel_) {
                if (ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
                    const float right_edge = viewport->WorkPos.x + viewport->WorkSize.x;
                    const float new_w = right_edge - io.MousePos.x;
                    claude_panel_width_ = std::clamp(new_w, kClaudePanelMinWidth, kClaudePanelMaxWidth);
                    claude_w = claude_panel_width_;
                    explorer_w = viewport->WorkSize.x - navbar_width - sidebar_w - claude_w;
                } else {
                    is_resizing_claude_panel_ = false;
                }
            }
            if (ch_hovered || is_resizing_claude_panel_) {
                ImDrawList* fg = ImGui::GetForegroundDrawList();
                fg->AddLine(
                    ImVec2(claude_handle_x, handle_y0),
                    ImVec2(claude_handle_x, handle_y1),
                    IM_COL32(100, 100, 100, 180), 2.0f);
            }
        }

        ImGui::SetNextWindowPos(navbar_pos);
        ImGui::SetNextWindowSize(navbar_size);
        navbar_panel_->render();

        ImGui::SetNextWindowPos(sidebar_pos);
        ImGui::SetNextWindowSize(ImVec2(sidebar_w, sidebar_h));
        file_sidebar_panel_->render();

        filetree_panel_->render(explorer_pos, ImVec2(explorer_w, explorer_h));

        if (claude_panel_->is_open()) {
            const float claude_x = explorer_pos.x + explorer_w;
            const float claude_y = viewport->WorkPos.y + proxy_banner_height;
            const float claude_h = viewport->WorkSize.y - proxy_banner_height;

            ImGui::SetNextWindowPos(ImVec2(claude_x, claude_y));
            ImGui::SetNextWindowSize(ImVec2(claude_w, claude_h));
            ImGuiWindowFlags claude_flags =
                ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoMove |
                ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoCollapse;
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
            if (ImGui::Begin("##claude_window", nullptr, claude_flags)) {
                claude_panel_->render();
            }
            ImGui::End();
            ImGui::PopStyleVar();
        }

        notification_panel_->render();
        show_session_expired_modal();
    }

    void FilesView::schedule_proxy_probe() {
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

    float FilesView::render_proxy_status_banner(const ImVec2& pos, float width) {
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

    void FilesView::show_session_expired_modal() {
        if (!core::SessionManager::get().is_session_expired()) {
            return;
        }

        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(vp->WorkPos);
        ImGui::SetNextWindowSize(vp->WorkSize);
        ImGui::SetNextWindowBgAlpha(0.0f);

        ImGuiWindowFlags host_flags =
            ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoDecoration |
            ImGuiWindowFlags_NoNav;

        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
        if (ImGui::Begin("##session_host", nullptr, host_flags)) {
            ImGui::OpenPopup("##session_expired");

            ImGui::SetNextWindowPos(vp->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
            ImGui::SetNextWindowSize(ImVec2(360.0f, 0.0f), ImGuiCond_Always);

            ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.10f, 0.10f, 0.11f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.22f, 0.22f, 0.24f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(28.0f, 28.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 12.0f));

            if (ImGui::BeginPopupModal("##session_expired", nullptr,
                    ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                    ImGuiWindowFlags_NoMove | ImGuiWindowFlags_AlwaysAutoResize)) {

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
                    ImGui::CloseCurrentPopup();
                    view::switch_view(view::ViewID::Login);
                }

                ImGui::EndPopup();
            }

            ImGui::PopStyleVar(3);
            ImGui::PopStyleColor(2);
        }
        ImGui::End();
        ImGui::PopStyleVar();
    }
}
