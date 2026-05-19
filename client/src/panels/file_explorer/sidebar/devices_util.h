#pragma once

#include <functional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "imgui.h"

#include "panels/devices/device_state.h"
#include "panels/file_explorer/state/file_explorer_state.h"

namespace misty::panel {

struct DeviceDisplayEntry {
    MountedDevice device;
};

struct DeviceHeaderResult {
    bool toggle_collapsed = false;
    bool request_rescan = false;
    bool request_add_device = false;
};

struct DeviceRowResult {
    bool navigate_to_mount = false;
    bool request_rename = false;
    bool request_hide = false;
};

bool devices_refresh_button(const char* id, float size = 14.0f);

DeviceHeaderResult render_devices_header(bool collapsed, float content_width);

std::vector<DeviceDisplayEntry> build_device_display_entries(
    const std::vector<MountedDevice>& cached_devices,
    const std::unordered_map<std::string, std::string>& name_overrides,
    const std::unordered_set<std::string>& hidden_paths,
    const std::vector<std::string>& custom_mount_paths);

void render_empty_devices_row(float x_position);

DeviceRowResult render_device_row(
    const DeviceDisplayEntry& entry,
    float content_width,
    const std::function<void(const std::string&, const std::string&, ClipboardOp)>& file_drop_handler);

}  // namespace misty::panel
