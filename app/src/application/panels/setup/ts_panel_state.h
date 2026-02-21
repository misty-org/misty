#pragma once
#include <string>
#include <map>
#include <mutex>
#include <cstring>
#include <chrono>
#include <thread>
#include "core/ui_registry.h"
#include "core/http_client.h"
#include "core/env_manager.h"
#include "core/util.h"
#include "views/app_view.h"
#include <nlohmann/json.hpp>

namespace misty::panel {

    struct TSPanelSnapshot {
        std::string login_url;
        std::string status;
        bool is_connected = false;
        bool is_polling_status = false;
        int poll_interval_ms = 2000;
        bool is_fetching_url = false;
        bool has_fetched_url = false;
        bool has_registered_device = false;
        bool should_switch_view_on_register = true;
        bool is_registering_device = false;
        std::string error_msg;
        std::string success_msg;
    };

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
        bool is_registering_device = false;
        
        // Device information inputs
        char device_name[256] = "";
        char mount_path[512] = "";
        
        std::string get_proxy_url() const {
            return core::EnvManager::get().get("PROXY_SERVICE_URL", "");
        }
        
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
            is_registering_device = false;
        }

        TSPanelSnapshot snapshot() {
            std::lock_guard<std::mutex> lock(mu);
            TSPanelSnapshot snap;
            snap.login_url = login_url;
            snap.status = status;
            snap.is_connected = is_connected;
            snap.is_polling_status = is_polling_status;
            snap.poll_interval_ms = poll_interval_ms;
            snap.is_fetching_url = is_fetching_url;
            snap.has_fetched_url = has_fetched_url;
            snap.has_registered_device = has_registered_device;
            snap.should_switch_view_on_register = should_switch_view_on_register;
            snap.error_msg = error_msg;
            snap.success_msg = success_msg;
            snap.is_registering_device = is_registering_device;
            return snap;
        }

        void handle_fetch_login_url() {
            {
                std::lock_guard<std::mutex> lock(mu);
                if (is_fetching_url) {
                    return;
                }
                is_fetching_url = true;
                error_msg = "";
                success_msg = "";
            }

            std::thread([this]() {
                std::string error;
                std::string new_login_url;
                std::string new_status;
                bool fetched_url = false;
                std::string base = get_proxy_url();
                if (base.empty()) {
                    error = "PROXY_SERVICE_URL is not set";
                } else {
                    core::HttpResponse response = core::HttpClient::get().get(base + "/api/ts-status");
                    if (response.status_code >= 200 && response.status_code < 300) {
                        try {
                            auto json = nlohmann::json::parse(response.body);
                            if (json.contains("auth_url") && json["auth_url"].is_string()) {
                                new_login_url = json["auth_url"].get<std::string>();
                                new_status = json.value("status", "");
                                fetched_url = true;
                            } else {
                                error = "Missing auth_url in response.";
                            }
                        } catch (const std::exception& ex) {
                            error = std::string("Invalid JSON: ") + ex.what();
                        }
                    } else {
                        error = "Proxy request failed (" + std::to_string(response.status_code) + ")";
                    }
                }

                std::lock_guard<std::mutex> lock(mu);
                if (fetched_url) {
                    login_url = new_login_url;
                    status = new_status;
                    has_fetched_url = true;
                    success_msg = "Login URL fetched.";
                    error_msg.clear();
                } else if (!error.empty()) {
                    error_msg = error;
                }
                is_fetching_url = false;
            }).detach();
        }

        void poll_status_if_needed() {
            auto now = std::chrono::steady_clock::now();
            {
                std::lock_guard<std::mutex> lock(mu);
                if (is_connected || is_polling_status) {
                    return;
                }
                if (last_status_check != std::chrono::steady_clock::time_point{} &&
                    std::chrono::duration_cast<std::chrono::milliseconds>(now - last_status_check).count() < poll_interval_ms) {
                    return;
                }
                is_polling_status = true;
                error_msg = "";
                last_status_check = now;
            }

            std::thread([this]() {
                std::string error;
                std::string new_status;
                bool became_connected = false;
                std::string base = get_proxy_url();
                if (base.empty()) {
                    error = "PROXY_SERVICE_URL is not set";
                } else {
                    core::HttpResponse response = core::HttpClient::get().get(base + "/api/ts-status");
                    if (response.status_code >= 200 && response.status_code < 300) {
                        try {
                            auto json = nlohmann::json::parse(response.body);
                            new_status = json.value("status", "");
                            if (new_status == "connected") {
                                became_connected = true;
                            }
                        } catch (const std::exception& ex) {
                            error = std::string("Invalid JSON: ") + ex.what();
                        }
                    } else {
                        error = "Proxy request failed (" + std::to_string(response.status_code) + ")";
                    }
                }

                std::lock_guard<std::mutex> lock(mu);
                if (!error.empty()) {
                    error_msg = error;
                } else {
                    status = new_status;
                    if (became_connected) {
                        is_connected = true;
                    }
                }
                is_polling_status = false;
            }).detach();
        }
        
        void register_device() {
            std::string device_name_copy;
            std::string mount_path_copy;
            {
                std::lock_guard<std::mutex> lock(mu);
                if (is_registering_device) {
                    return;
                }
                is_registering_device = true;
                error_msg.clear();
                success_msg.clear();
                if (strlen(device_name) > 0) {
                    device_name_copy = std::string(device_name);
                }
                if (strlen(mount_path) > 0) {
                    mount_path_copy = std::string(mount_path);
                }
            }

            std::thread([this, device_name_copy, mount_path_copy]() {
                std::map<std::string, std::string> json_fields;
                if (!device_name_copy.empty()) {
                    json_fields["device_name"] = device_name_copy;
                }
                if (!mount_path_copy.empty()) {
                    json_fields["mount_path"] = mount_path_copy;
                }
                std::string json_body = core::build_json_object(json_fields);

                std::map<std::string, std::string> headers;
                headers["Content-Type"] = "application/json";

                std::string base = get_proxy_url();
                std::string error;
                bool success = false;
                if (base.empty()) {
                    error = "PROXY_SERVICE_URL is not set";
                } else {
                    core::HttpResponse register_response = core::HttpClient::get().post(
                        base + "/api/devices",
                        json_body,
                        headers
                    );

                    if (register_response.status_code >= 200 && register_response.status_code < 300) {
                        success = true;
                    } else {
                        error = "Failed to register device (" + std::to_string(register_response.status_code) + ")";
                    }
                }

                std::lock_guard<std::mutex> lock(mu);
                if (success) {
                    success_msg = "Device registered successfully.";
                    has_registered_device = true;
                    if (should_switch_view_on_register) {
                        view::switch_view(view::ViewID::FileExplorer);
                    }
                } else if (!error.empty()) {
                    error_msg = error;
                }
                is_registering_device = false;
            }).detach();
        }
    };

}
