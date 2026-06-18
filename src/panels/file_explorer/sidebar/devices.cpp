#include "file_sidebar_panel.h"

#include "panels/file_explorer/sidebar/devices_util.h"
#include "panels/file_explorer/state/file_explorer_state.h"

namespace misty::panel {
    void FileSidebarPanel::show_devices_section(float width, float padding) {
        bool do_rescan = cached_devices_.empty() || device_watcher_.has_changed();

        float content_width = content_width_for(width, padding);
        ImGui::SetCursorPosX(padding);
        ImGui::BeginGroup();

        const DeviceHeaderResult header = render_devices_header(devices_collapsed_, content_width);
        if (header.toggle_collapsed) devices_collapsed_ = !devices_collapsed_;
        if (header.request_add_device) show_add_device_modal_ = true;
        if (header.request_rescan) do_rescan = true;

        if (do_rescan) cached_devices_ = scan_mounted_devices();

        if (!devices_collapsed_) {
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 2.0f));
            const auto display_devices = build_device_display_entries(
                cached_devices_, device_name_overrides_, hidden_device_paths_, custom_mount_paths_);
            if (display_devices.empty()) {
                render_empty_devices_row(padding + 8.0f);
            }

            for (const auto& entry : display_devices) {
                const DeviceRowResult row = render_device_row(entry, content_width, file_drop_handler_);
                if (row.request_rename) {
                    device_renaming_path_ = entry.device.mount_path;
                    strncpy(device_rename_buf_, entry.device.name.c_str(), sizeof(device_rename_buf_) - 1);
                    device_rename_buf_[sizeof(device_rename_buf_) - 1] = '\0';
                }
                if (row.request_hide) {
                    hidden_device_paths_.insert(entry.device.mount_path);
                }
                if (row.navigate_to_mount) {
                    if (navigation_handler_) {
                        navigation_handler_(entry.device.mount_path);
                    }
                }
            }
            ImGui::PopStyleVar();
        } // !devices_collapsed_

        ImGui::EndGroup();
        ImGui::Spacing();
    }

    // ─────────────────────────────────────────────────────────────────────────


}
