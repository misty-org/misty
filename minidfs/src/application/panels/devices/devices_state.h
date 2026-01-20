#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <chrono>
#include "core/ui_registry.h"
#include "core/http_client.h"
#include "core/util.h"
#include <nlohmann/json.hpp>

namespace minidfs::panel {

    struct DeviceInfo {
        std::string name;
        std::string id;
        std::string ip_address;
        bool is_online;
        std::string last_seen;
        std::string status_detail; // Additional status info
        uint64_t used_bytes;
        uint64_t total_bytes;
        std::string mount_path;
    };

    struct DevicesState : public core::UIState {
        std::mutex mu;
        
        // Devices list
        std::vector<DeviceInfo> devices;
        
        // UI state
        std::string error_msg = "";
        std::string success_msg = "";
        
        // Filter/search
        char search_buffer[256] = "";
        bool filter_online_only = false;
        
        // Add Device modal
        bool show_add_device_modal = false;
        
        // Edit Device modal
        bool show_edit_device_modal = false;
        std::string editing_device_id = "";
        char editing_device_name[256] = "";
        char editing_mount_path[512] = "";
        
        // Delete confirmation
        bool show_delete_confirm = false;
        std::string deleting_device_id = "";
        std::string deleting_device_name = "";
        
        // Fetch state
        bool is_fetching_devices = false;
        std::chrono::steady_clock::time_point last_fetch_time = std::chrono::steady_clock::time_point{};
        static constexpr int fetch_interval_ms = 5000; // Fetch every 5 seconds
        
        void fetch_devices() {
            if (is_fetching_devices) {
                return;
            }
            
            auto now = std::chrono::steady_clock::now();
            if (last_fetch_time != std::chrono::steady_clock::time_point{} &&
                std::chrono::duration_cast<std::chrono::milliseconds>(now - last_fetch_time).count() < fetch_interval_ms) {
                return;
            }
            
            is_fetching_devices = true;
            error_msg = "";
            
            core::HttpResponse response = core::HttpClient::get().get("http://localhost:3000/api/devices");
            if (response.status_code >= 200 && response.status_code < 300) {
                std::cout << response.body << std::endl;
                try {
                    auto json = nlohmann::json::parse(response.body);
                    
                    std::lock_guard<std::mutex> lock(mu);
                    devices.clear();
                    
                    if (json.is_array()) {
                        for (const auto& device_json : json) {
                            DeviceInfo device;
                            device.id = device_json.value("id", "");
                            device.name = device_json.value("device_name", "");
                            // If device_name is empty, use peer_hostname as fallback
                            if (device.name.empty()) {
                                device.name = device_json.value("peer_hostname", "");
                            }
                            device.ip_address = device_json.value("peer_address", "");
                            device.status_detail = device_json.value("peer_type", "");
                            device.mount_path = device_json.value("mount_path", "");
                            
                            // Parse last_seen timestamp if available
                            if (device_json.contains("last_seen")) {
                                device.last_seen = device_json["last_seen"].get<std::string>();
                                device.is_online = core::is_device_online(device.last_seen);
                            } else {
                                device.is_online = false;
                                device.last_seen = "";
                            }
                            
                            // Storage info (if available in future)
                            device.used_bytes = 0;
                            device.total_bytes = 0;
                            device.mount_path = "";
                            
                            devices.push_back(device);
                        }
                    }
                } catch (const std::exception& ex) {
                    error_msg = std::string("Failed to parse devices JSON: ") + ex.what();
                }
            } else {
                error_msg = "Failed to fetch devices (" + std::to_string(response.status_code) + ")";
            }
            
            last_fetch_time = now;
            is_fetching_devices = false;
        }
    };

}
