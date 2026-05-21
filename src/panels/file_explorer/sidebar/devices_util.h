#pragma once

#include <functional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "imgui.h"

#include "panels/devices/device_state.h"
#include "panels/file_explorer/state/clipboard_state.h"

namespace misty::panel {

/**
 * @brief Display model for one mounted-device row.
 */
struct DeviceDisplayEntry {
    MountedDevice device;
};

/**
 * @brief Actions emitted by the devices section header.
 */
struct DeviceHeaderResult {
    bool toggle_collapsed = false;
    bool request_rescan = false;
    bool request_add_device = false;
};

/**
 * @brief Actions emitted by one mounted-device row.
 */
struct DeviceRowResult {
    bool navigate_to_mount = false;
    bool request_rename = false;
    bool request_hide = false;
};

/**
 * @brief Renders the compact devices refresh icon button.
 */
bool devices_refresh_button(const char* id, float size = 14.0f);

/**
 * @brief Renders the devices section header and returns requested actions.
 */
DeviceHeaderResult render_devices_header(bool collapsed, float content_width);

/**
 * @brief Builds visible device rows from detected, custom, hidden, and renamed devices.
 */
std::vector<DeviceDisplayEntry> build_device_display_entries(
    const std::vector<MountedDevice>& cached_devices,
    const std::unordered_map<std::string, std::string>& name_overrides,
    const std::unordered_set<std::string>& hidden_paths,
    const std::vector<std::string>& custom_mount_paths);

/**
 * @brief Renders the placeholder row shown when no mounted devices are available.
 */
void render_empty_devices_row(float x_position);

/**
 * @brief Renders one mounted-device row and returns requested actions.
 */
DeviceRowResult render_device_row(
    const DeviceDisplayEntry& entry,
    float content_width,
    const std::function<void(const std::string&, const std::string&, ClipboardOp)>& file_drop_handler);

}  // namespace misty::panel
