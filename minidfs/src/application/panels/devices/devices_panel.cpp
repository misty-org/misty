#include "devices_panel.h"
#include "imgui.h"
#include "panels/setup/ts_panel_state.h"
#include "core/imgui_utils.h"
#include <sstream>
#include <iomanip>
#include <cstring>
#include <algorithm>

namespace minidfs::panel {
    DevicesPanel::DevicesPanel(UIRegistry& registry)
        : registry_(registry) {
        ts_panel_ = std::make_shared<TSPanel>(registry_);
    }

    void DevicesPanel::render() {
        auto& state = registry_.get_state<DevicesState>("Devices");
        
        // Fetch devices periodically
        state.fetch_devices();

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoScrollbar;

        core::WithWindowStyle(ImVec4(0.18f, 0.18f, 0.18f, 1.0f), ImVec2(32.0f, 24.0f), [&]() {
        if (ImGui::Begin("DevicesPanel", nullptr, flags)) {
            show_header();
            ImGui::Spacing();
            show_filters(state);
            ImGui::Spacing();
            show_devices_list(state);
            show_add_device_modal(state);
            show_edit_device_modal(state);
            show_delete_confirm_modal(state);
            show_error_modal(state.error_msg, "DevicesError");
        }

        ImGui::End();
        });
    }

    void DevicesPanel::show_header() {
        ImGui::BeginGroup();
        core::WithFontScale(1.8f, []() {
            core::ColoredText(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "Devices");
        });
        
        core::ColoredText(ImVec4(0.7f, 0.7f, 0.7f, 1.0f), "View and manage all connected devices.");
        ImGui::EndGroup();
        
        // Add Device button on the right
        ImGui::SameLine(0, 20);
        float button_width = 180.0f;
        float window_width = ImGui::GetWindowWidth();
        float button_x = window_width - button_width - 32.0f;
        ImGui::SetCursorPosX(button_x);
        ImGui::SetCursorPosY(0);
        
        auto& state = registry_.get_state<DevicesState>("Devices");
        if (core::StyledButton("+ Add Device", ImVec2(button_width, 36), core::ButtonTheme::Primary())) {
            state.show_add_device_modal = true;
            // Reset TSPanelState when opening the modal and disable view switching
            auto& ts_state = registry_.get_state<TSPanelState>("TSPanel");
            ts_state.clear_state();
            ts_state.should_switch_view_on_register = false; // Don't switch views when used in modal
        }
    }

    void DevicesPanel::show_filters(DevicesState& state) {
        ImGui::BeginGroup();
        
        // Search box
        ImGui::SetNextItemWidth(300.0f);
        ImGui::InputTextWithHint("##search", "Search devices...", state.search_buffer, IM_ARRAYSIZE(state.search_buffer));
        
        ImGui::SameLine();
        
        // Filter online only checkbox
        ImGui::Checkbox("Online Only", &state.filter_online_only);
        
        ImGui::EndGroup();
    }

    void DevicesPanel::show_devices_list(DevicesState& state) {
        core::CustomStyleVar item_spacing(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 8.0f));
        
        // Filter devices based on search and filter
        std::vector<DeviceInfo*> filtered_devices;
        for (auto& device : state.devices) {
            // Search filter
            bool matches_search = strlen(state.search_buffer) == 0;
            if (!matches_search) {
                std::string search_lower = state.search_buffer;
                std::transform(search_lower.begin(), search_lower.end(), search_lower.begin(), ::tolower);
                std::string name_lower = device.name;
                std::transform(name_lower.begin(), name_lower.end(), name_lower.begin(), ::tolower);
                matches_search = name_lower.find(search_lower) != std::string::npos;
            }
            
            // Online filter
            bool matches_online = !state.filter_online_only || device.is_online;
            
            if (matches_search && matches_online) {
                filtered_devices.push_back(&device);
            }
        }
        
        if (filtered_devices.empty()) {
            core::ColoredText(ImVec4(0.6f, 0.6f, 0.6f, 1.0f), "No devices found.");
        } else {
            for (auto* device : filtered_devices) {
                show_device_item(*device);
            }
        }
    }

    void DevicesPanel::show_device_item(DeviceInfo& device) {
        ImGui::BeginChild(device.id.c_str(), ImVec2(-1, 80), true);
        {
            core::CustomStyleColor child_bg(ImGuiCol_ChildBg, ImVec4(0.22f, 0.22f, 0.22f, 1.0f));
            
            // Device icon/status indicator
            ImGui::BeginGroup();
            ImVec4 status_color = device.is_online ? ImVec4(0.3f, 0.8f, 0.4f, 1.0f) : ImVec4(0.6f, 0.6f, 0.6f, 1.0f);
            core::ColoredText(status_color, "●");
            ImGui::SameLine();
            
            // Device name
            core::WithFontScale(1.1f, [&]() {
                core::ColoredText(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "%s", device.name.c_str());
            });
            
            ImGui::EndGroup();
            
            ImGui::SameLine(0, 20);
            
            // Device info
            ImGui::BeginGroup();
            core::WithTextColor(ImVec4(0.7f, 0.7f, 0.7f, 1.0f), [&]() {
                ImGui::Text("ID: %s", device.id.c_str());
                if (!device.ip_address.empty()) {
                    ImGui::SameLine(0, 15);
                    ImGui::Text("IP: %s", device.ip_address.c_str());
                }
                
                if (!device.mount_path.empty()) {
                    ImGui::Text("Mount: %s", device.mount_path.c_str());
                }
                
                if (!device.last_seen.empty()) {
                    ImGui::Text("Last seen: %s", device.last_seen.c_str());
                }
                
                // Storage info
                if (device.total_bytes > 0) {
                    double used_gb = (double)device.used_bytes / (1024.0 * 1024.0 * 1024.0);
                    double total_gb = (double)device.total_bytes / (1024.0 * 1024.0 * 1024.0);
                    std::stringstream ss;
                    ss << std::fixed << std::setprecision(1) << used_gb << "GB / " << total_gb << "GB";
                    ImGui::Text("Storage: %s", ss.str().c_str());
                }
            });
            ImGui::EndGroup();
            
            // Action buttons and status on the right
            ImGui::SameLine(0, 20);
            float window_width = ImGui::GetWindowWidth();
            float label_x = window_width - 280.0f; // Space for buttons + status
            ImGui::SetCursorPosX(label_x);
            ImGui::BeginGroup();
            
            // Edit button
            auto& state = registry_.get_state<DevicesState>("Devices");
            if (core::StyledButton("Edit", ImVec2(60, 24), core::ButtonTheme::Primary())) {
                state.show_edit_device_modal = true;
                state.editing_device_id = device.id;
                strncpy(state.editing_device_name, device.name.c_str(), sizeof(state.editing_device_name) - 1);
                state.editing_device_name[sizeof(state.editing_device_name) - 1] = '\0';
                strncpy(state.editing_mount_path, device.mount_path.c_str(), sizeof(state.editing_mount_path) - 1);
                state.editing_mount_path[sizeof(state.editing_mount_path) - 1] = '\0';
            }
            
            ImGui::SameLine();
            
            // Delete button
            if (core::StyledButton("Delete", ImVec2(60, 24), core::ButtonTheme::Danger())) {
                state.show_delete_confirm = true;
                state.deleting_device_id = device.id;
                state.deleting_device_name = device.name;
            }
            
            ImGui::SameLine();
            
            // Online status label
            ImVec4 status_bg = device.is_online ? ImVec4(0.2f, 0.6f, 0.3f, 0.3f) : ImVec4(0.4f, 0.4f, 0.4f, 0.3f);
            ImVec4 status_text = device.is_online ? ImVec4(0.3f, 0.8f, 0.4f, 1.0f) : ImVec4(0.7f, 0.7f, 0.7f, 1.0f);
            
            core::CustomStyleColor btn_bg(ImGuiCol_Button, status_bg);
            core::CustomStyleColor btn_text(ImGuiCol_Text, status_text);
            ImGui::Button(device.is_online ? "ONLINE" : "OFFLINE", ImVec2(100, 24));
            ImGui::EndGroup();
        }
        ImGui::EndChild();
    }

    void DevicesPanel::show_add_device_modal(DevicesState& state) {
        if (state.show_add_device_modal) {
            ImGui::OpenPopup("Add Device");
        }

        ImVec2 center = ImGui::GetMainViewport()->GetCenter();
        ImGui::SetNextWindowPos(center, ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(500, 500), ImGuiCond_Appearing);

        core::CustomStyleVar padding(ImGuiStyleVar_WindowPadding, ImVec2(24.0f, 24.0f));
        core::CustomStyleVar spacing(ImGuiStyleVar_ItemSpacing, ImVec2(12.0f, 16.0f));

        if (ImGui::BeginPopupModal("Add Device", &state.show_add_device_modal, 
            ImGuiWindowFlags_NoResize | ImGuiWindowFlags_AlwaysAutoResize)) {
            
            // Header
            core::WithFontScale(1.3f, []() {
                core::ColoredText(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "Add New Device");
            });
            
            ImGui::Spacing();
            core::ColoredText(ImVec4(0.7f, 0.7f, 0.7f, 1.0f), "Connect a new device using Tailscale. Follow the steps below to authenticate and add your device.");
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            
            // Use TSPanel to handle the Tailscale setup flow
            // Render just the content without creating a window
            ts_panel_->render_content();
            
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            
            // Check if device was registered successfully to close modal
            auto& ts_state = registry_.get_state<TSPanelState>("TSPanel");
            if (ts_state.has_registered_device) {
                state.show_add_device_modal = false;
                ts_state.clear_state();
                // Refresh devices list
                state.fetch_devices();
                ImGui::CloseCurrentPopup();
            }
            
            // Close button
            float button_width = 120.0f;
            float window_width = ImGui::GetWindowWidth();
            float button_x = (window_width - button_width) * 0.5f;
            ImGui::SetCursorPosX(button_x);
            
            if (ImGui::Button("Close", ImVec2(button_width, 36))) {
                state.show_add_device_modal = false;
                ts_state.clear_state();
                ImGui::CloseCurrentPopup();
            }
            
            ImGui::EndPopup();
        }
    }

    void DevicesPanel::show_edit_device_modal(DevicesState& state) {
        if (state.show_edit_device_modal) {
            ImGui::OpenPopup("Edit Device");
        }

        ImVec2 center = ImGui::GetMainViewport()->GetCenter();
        ImGui::SetNextWindowPos(center, ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(450, 280), ImGuiCond_Appearing);

        core::CustomStyleVar padding(ImGuiStyleVar_WindowPadding, ImVec2(24.0f, 24.0f));
        core::CustomStyleVar spacing(ImGuiStyleVar_ItemSpacing, ImVec2(12.0f, 16.0f));

        if (ImGui::BeginPopupModal("Edit Device", &state.show_edit_device_modal, 
            ImGuiWindowFlags_NoResize | ImGuiWindowFlags_AlwaysAutoResize)) {
            
            // Header
            core::WithFontScale(1.3f, []() {
                core::ColoredText(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "Edit Device");
            });
            
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            
            float width = ImGui::GetContentRegionAvail().x;
            
            // Device Name input
            core::ColoredText(ImVec4(0.8f, 0.8f, 0.8f, 1.0f), "Device Name:");
            ImGui::SetNextItemWidth(width);
            ImGui::InputText("##edit_device_name", state.editing_device_name, IM_ARRAYSIZE(state.editing_device_name));
            ImGui::Spacing();
            
            // Mount Path input
            core::ColoredText(ImVec4(0.8f, 0.8f, 0.8f, 1.0f), "Mount Path (Optional):");
            ImGui::SetNextItemWidth(width);
            ImGui::InputText("##edit_mount_path", state.editing_mount_path, IM_ARRAYSIZE(state.editing_mount_path));
            ImGui::Spacing();
            
            ImGui::Separator();
            ImGui::Spacing();
            
            // Buttons
            float button_width = 100.0f;
            float button_spacing = 10.0f;
            float total_width = (button_width * 2) + button_spacing;
            float button_x = (width - total_width) * 0.5f;
            
            ImGui::SetCursorPosX(button_x);
            
            // Cancel button
            if (ImGui::Button("Cancel", ImVec2(button_width, 36))) {
                state.show_edit_device_modal = false;
                state.editing_device_id = "";
                state.editing_device_name[0] = '\0';
                state.editing_mount_path[0] = '\0';
                ImGui::CloseCurrentPopup();
            }
            
            ImGui::SameLine(0, button_spacing);
            
            // Save button
            if (core::StyledButton("Save", ImVec2(button_width, 36), core::ButtonTheme::Success())) {
                // Build JSON object with device information
                std::map<std::string, std::string> json_fields;
                json_fields["device_name"] = std::string(state.editing_device_name);
                json_fields["mount_path"] = std::string(state.editing_mount_path);
                std::string json_body = core::build_json_object(json_fields);
                
                // Set headers
                std::map<std::string, std::string> headers;
                headers["Content-Type"] = "application/json";
                
                // Make PUT request to update device
                std::string url = "http://localhost:3000/api/devices?id=" + state.editing_device_id;
                core::HttpResponse response = core::HttpClient::get().put(url, json_body, headers);
                
                if (response.status_code >= 200 && response.status_code < 300) {
                    state.success_msg = "Device updated successfully";
                    state.show_edit_device_modal = false;
                    state.editing_device_id = "";
                    state.editing_device_name[0] = '\0';
                    state.editing_mount_path[0] = '\0';
                    // Refresh devices list
                    state.fetch_devices();
                    ImGui::CloseCurrentPopup();
                } else {
                    state.error_msg = "Failed to update device (" + std::to_string(response.status_code) + ")";
                }
            }
            
            ImGui::EndPopup();
        }
    }

    void DevicesPanel::show_delete_confirm_modal(DevicesState& state) {
        if (state.show_delete_confirm) {
            ImGui::OpenPopup("Delete Device");
        }

        ImVec2 center = ImGui::GetMainViewport()->GetCenter();
        ImGui::SetNextWindowPos(center, ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(400, 180), ImGuiCond_Appearing);

        core::CustomStyleVar padding(ImGuiStyleVar_WindowPadding, ImVec2(24.0f, 24.0f));
        core::CustomStyleVar spacing(ImGuiStyleVar_ItemSpacing, ImVec2(12.0f, 16.0f));

        if (ImGui::BeginPopupModal("Delete Device", &state.show_delete_confirm, 
            ImGuiWindowFlags_NoResize | ImGuiWindowFlags_AlwaysAutoResize)) {
            
            // Header
            core::WithFontScale(1.2f, []() {
                core::ColoredText(ImVec4(1.0f, 0.3f, 0.3f, 1.0f), "Delete Device");
            });
            
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            
            // Warning message
            core::ColoredText(ImVec4(0.9f, 0.9f, 0.9f, 1.0f), 
                "Are you sure you want to delete \"%s\"?", state.deleting_device_name.c_str());
            ImGui::Spacing();
            core::ColoredText(ImVec4(0.7f, 0.7f, 0.7f, 1.0f), 
                "This action cannot be undone.");
            
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            
            // Buttons
            float width = ImGui::GetContentRegionAvail().x;
            float button_width = 100.0f;
            float button_spacing = 10.0f;
            float total_width = (button_width * 2) + button_spacing;
            float button_x = (width - total_width) * 0.5f;
            
            ImGui::SetCursorPosX(button_x);
            
            // Cancel button
            if (ImGui::Button("Cancel", ImVec2(button_width, 36))) {
                state.show_delete_confirm = false;
                state.deleting_device_id = "";
                state.deleting_device_name = "";
                ImGui::CloseCurrentPopup();
            }
            
            ImGui::SameLine(0, button_spacing);
            
            // Delete button
            if (core::StyledButton("Delete", ImVec2(button_width, 36), core::ButtonTheme::Danger())) {
                // Make DELETE request
                std::string url = "http://localhost:3000/api/devices?id=" + state.deleting_device_id;
                core::HttpResponse response = core::HttpClient::get().del(url);
                
                if (response.status_code >= 200 && response.status_code < 300) {
                    state.success_msg = "Device deleted successfully";
                    state.show_delete_confirm = false;
                    state.deleting_device_id = "";
                    state.deleting_device_name = "";
                    // Refresh devices list
                    state.fetch_devices();
                    ImGui::CloseCurrentPopup();
                } else {
                    state.error_msg = "Failed to delete device (" + std::to_string(response.status_code) + ")";
                }
            }
            
            ImGui::EndPopup();
        }
    }
}
