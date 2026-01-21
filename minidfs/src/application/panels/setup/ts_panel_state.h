#pragma once
#include <string>
#include <map>
#include <mutex>
#include <cstring>
#include <chrono>
#include "core/ui_registry.h"
#include "core/http_client.h"
#include "core/util.h"
#include "views/app_view.h"
#include <nlohmann/json.hpp>

namespace minidfs::panel {

    struct TSPanelState : public core::UIState {
        std::mutex mu;
        
        // Tailscale login URL (fetched from proxy)
        std::string login_url = "";
        std::string status = "";
        bool is_connected = false;
        bool is_polling_status = false;
        std::chrono::steady_clock::time_point last_status_check = {};
        int poll_interval_ms = 2000;
        
        // UI Logic State
        bool is_fetching_url = false;
        bool has_fetched_url = false;
        bool has_registered_device = false;
        bool should_switch_view_on_register = true; // Can be disabled when used in modal
        std::string error_msg = "";
        std::string success_msg = "";
        
        // Device information inputs
        char device_name[256] = "";
        char mount_path[512] = "";
        
        // Proxy endpoint URL (for curl request)
        // User will integrate this, but we'll provide a placeholder
        const std::string proxy_url = "http://localhost:3000/api/ts-status";
        
        void clear_state() {
            login_url = "";
            error_msg = "";
            success_msg = "";
            has_fetched_url = false;
            is_fetching_url = false;
            has_registered_device = false;
            should_switch_view_on_register = true; // Reset to default
            status = "";
            is_connected = false;
            is_polling_status = false;
            last_status_check = {};
            device_name[0] = '\0';
            mount_path[0] = '\0';
        }

        void handle_fetch_login_url() {
            is_fetching_url = true;
            error_msg = "";
            success_msg = "";   

            core::HttpResponse response = core::HttpClient::get().get(proxy_url);
            if (response.status_code >= 200 && response.status_code < 300) {
                try {
                    auto json = nlohmann::json::parse(response.body);
                    if (json.contains("auth_url") && json["auth_url"].is_string()) {
                        login_url = json["auth_url"].get<std::string>();
                        has_fetched_url = true;
                        success_msg = "Login URL fetched.";
                        status = json.value("status", "");
                    } else {
                        error_msg = "Missing auth_url in response.";
                    }
                } catch (const std::exception& ex) {
                    error_msg = std::string("Invalid JSON: ") + ex.what();
                }
            } else {
                error_msg = "Proxy request failed (" + std::to_string(response.status_code) + ")";
            }

            is_fetching_url = false;
        }

        void poll_status_if_needed() {
            if (is_connected) {
                return;
            }

            auto now = std::chrono::steady_clock::now();
            if (last_status_check != std::chrono::steady_clock::time_point{} &&
                std::chrono::duration_cast<std::chrono::milliseconds>(now - last_status_check).count() < poll_interval_ms) {
                return;
            }

            is_polling_status = true;
            error_msg = "";

            core::HttpResponse response = core::HttpClient::get().get(proxy_url);
            if (response.status_code >= 200 && response.status_code < 300) {
                try {
                    auto json = nlohmann::json::parse(response.body);
                    status = json.value("status", "");
                    if (status == "connected") {
                        is_connected = true;
                    }
                } catch (const std::exception& ex) {
                    error_msg = std::string("Invalid JSON: ") + ex.what();
                }
            } else {
                error_msg = "Proxy request failed (" + std::to_string(response.status_code) + ")";
            }

            last_status_check = now;
            is_polling_status = false;
        }
        
        void register_device() {
            // Build JSON object with device information
            std::map<std::string, std::string> json_fields;
            if (strlen(device_name) > 0) {
                json_fields["device_name"] = std::string(device_name);
            }
            if (strlen(mount_path) > 0) {
                json_fields["mount_path"] = std::string(mount_path);
            }
            std::string json_body = core::build_json_object(json_fields);
            
            // Set headers
            std::map<std::string, std::string> headers;
            headers["Content-Type"] = "application/json";
            
            // Register the device in the database
            core::HttpResponse register_response = core::HttpClient::get().post(
                "http://localhost:3000/api/devices",
                json_body,
                headers
            );
            
            if (register_response.status_code >= 200 && register_response.status_code < 300) {
                success_msg = "Device registered successfully.";
                has_registered_device = true;
                // Only switch view if this is the default behavior (not when used in modal)
                if (should_switch_view_on_register) {
                    view::switch_view(view::ViewID::FileExplorer);
                }
            } else {
                error_msg = "Failed to register device (" + std::to_string(register_response.status_code) + ")";
            }
        }
    };

}
