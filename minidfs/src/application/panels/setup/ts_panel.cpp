#include "ts_panel.h"
#include "imgui.h"
#include "core/util.h"
#include "core/imgui_utils.h"
#include <cstring>

namespace minidfs::panel {
    TSPanel::TSPanel(UIRegistry& registry)
        : registry_(registry) {
    }

    void TSPanel::render() {
        auto& state = registry_.get_state<TSPanelState>("TSPanel");

        state.poll_status_if_needed();

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoDocking;

        // Dark background
        core::CustomStyleColor bg(ImGuiCol_WindowBg, ImVec4(0.1f, 0.1f, 0.1f, 1.0f));
        core::CustomStyleVar padding(ImGuiStyleVar_WindowPadding, ImVec2(32.0f, 40.0f));
        core::CustomStyleVar item_spacing(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 10.0f));
        core::CustomStyleVar frame_padding(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 8.0f));

        if (ImGui::Begin("TailscalePanel", nullptr, flags)) {
            render_content();
        }

        ImGui::End();
    }

    void TSPanel::render_content() {
        auto& state = registry_.get_state<TSPanelState>("TSPanel");

        state.poll_status_if_needed();

        float window_width = ImGui::GetContentRegionAvail().x;
        float content_width = window_width;

        show_status_message(state);
        show_login_url(state);
        show_fetch_button(state);
        show_open_browser_button(state);
        
        // Show device info inputs and register button when connected
        if (state.is_connected && !state.has_registered_device) {
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            show_device_info_inputs(state);
            ImGui::Spacing();
            show_register_button(state);
        }
        
        show_error_modal(state.error_msg, "TailscaleError");
    }

    void TSPanel::show_header() {
        const char* text = "Tailscale Integration";
        
        // Scale font to 1.5x
        float original_scale = ImGui::GetFontSize();
        ImGui::SetWindowFontScale(1.5f);
        
        // Calculate text width and center it
        ImVec2 text_size = ImGui::CalcTextSize(text);
        float window_width = ImGui::GetWindowWidth();
        float center_x = (window_width - text_size.x) * 0.5f;
        ImGui::SetCursorPosX(center_x);
        
        core::ColoredText(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "%s", text);
        
        // Restore original font scale
        ImGui::SetWindowFontScale(1.0f);
        
        ImGui::Spacing();
        ImGui::Spacing();
    }

    void TSPanel::show_status_message(TSPanelState& state) {
        if (!state.error_msg.empty()) {
            core::ColoredText(ImVec4(1.0f, 0.3f, 0.3f, 1.0f), "%s", state.error_msg.c_str());
            ImGui::Spacing();
        }
        
        if (!state.success_msg.empty()) {
            core::ColoredText(ImVec4(0.3f, 1.0f, 0.3f, 1.0f), "%s", state.success_msg.c_str());
            ImGui::Spacing();
        }
        
        if (state.is_fetching_url) {
            core::ColoredText(ImVec4(0.8f, 0.8f, 0.8f, 1.0f), "Fetching login URL...");
            ImGui::Spacing();
        }

        if (state.has_fetched_url && !state.is_connected) {
            core::WithTextColor(ImVec4(0.8f, 0.8f, 0.8f, 1.0f), [&]() {
                ImGui::TextWrapped("Finish signing in to Tailscale in your browser, then return here.");
                if (state.is_polling_status) {
                    ImGui::Text("Checking connection status...");
                }
            });
            ImGui::Spacing();
        }
    }

    void TSPanel::show_login_url(TSPanelState& state) {
        if (!state.login_url.empty()) {
            float width = ImGui::GetContentRegionAvail().x;
            
            core::ColoredText(ImVec4(0.8f, 0.8f, 0.8f, 1.0f), "Login URL:");
            ImGui::Spacing();
            
            // Display the URL in a read-only text field
            // Create a local buffer to avoid const_cast issues
            static char url_buffer[512] = "";
            strncpy(url_buffer, state.login_url.c_str(), sizeof(url_buffer) - 1);
            url_buffer[sizeof(url_buffer) - 1] = '\0';
            
            core::CustomStyleColor frame_bg(ImGuiCol_FrameBg, ImVec4(0.15f, 0.15f, 0.15f, 1.0f));
            ImGui::InputText("##login_url", url_buffer, sizeof(url_buffer), ImGuiInputTextFlags_ReadOnly);
            ImGui::Spacing();
        }
    }

    void TSPanel::show_fetch_button(TSPanelState& state) {
        float width = ImGui::GetContentRegionAvail().x;
        
        core::ButtonColors colors = core::ButtonTheme::Primary();
        if (state.is_fetching_url) {
            colors.button = ImVec4(0.3f, 0.3f, 0.3f, 1.0f);
        }
        
        const char* button_text = state.is_fetching_url ? "Fetching..." : "Get Tailscale Login URL";
        if (core::StyledButton(button_text, ImVec2(width, 40), colors)) {
            if (!state.is_fetching_url) {
                state.handle_fetch_login_url();
            }
        }

        ImGui::Spacing();
    }

    void TSPanel::show_open_browser_button(TSPanelState& state) {
        if (!state.login_url.empty()) {
            float width = ImGui::GetContentRegionAvail().x;
            
            if (core::StyledButton("Open Login URL in Browser", ImVec2(width, 40), core::ButtonTheme::Success())) {
                core::open_file_in_browser(state.login_url);
            }
        }
    }

    void TSPanel::show_device_info_inputs(TSPanelState& state) {
        core::WithFontScale(1.1f, []() {
            core::ColoredText(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "Device Information");
        });
        ImGui::Spacing();

        float width = ImGui::GetContentRegionAvail().x;
        
        // Device Name input
        core::ColoredText(ImVec4(0.8f, 0.8f, 0.8f, 1.0f), "Device Name:");
        ImGui::SetNextItemWidth(width);
        ImGui::InputText("##device_name", state.device_name, IM_ARRAYSIZE(state.device_name));
        ImGui::Spacing();
        
        // Mount Path input
        core::ColoredText(ImVec4(0.8f, 0.8f, 0.8f, 1.0f), "Mount Path (Optional):");
        ImGui::SetNextItemWidth(width);
        ImGui::InputText("##mount_path", state.mount_path, IM_ARRAYSIZE(state.mount_path));
        ImGui::Spacing();
        
        core::ColoredText(ImVec4(0.6f, 0.6f, 0.6f, 1.0f), "Enter a friendly name for this device and optionally specify a mount path.");
    }

    void TSPanel::show_register_button(TSPanelState& state) {
        float width = ImGui::GetContentRegionAvail().x;
        
        if (core::StyledButton("Register Device", ImVec2(width, 40), core::ButtonTheme::Success())) {
            state.register_device();
        }
    }
}
