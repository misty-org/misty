#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <chrono>
#include <thread>
#include <atomic>
#include <cstring>
#include "core/ui_registry.h"
#include <nlohmann/json.hpp>


namespace minidfs::panel {

    struct DeviceInfo {
        std::string name;
        std::string id;
        std::string hostname;
        std::string ip_address;
        bool is_online = false;
        std::string last_seen;
        std::string status_detail;
        uint64_t used_bytes = 0;
        uint64_t total_bytes = 0;
        std::string mount_path;
        std::string workspace_id;
    };

    struct ServicesState : public core::UIState {
        std::mutex mu;

        std::vector<DeviceInfo> devices;

        std::string error_msg = "";
        std::string success_msg = "";

        char search_buffer[256] = "";
        bool filter_online_only = false;

        std::string current_workspace_id = "";

        bool show_add_device_modal = false;

        bool show_edit_device_modal = false;
        std::string editing_device_id = "";
        char editing_device_name[256] = "";
        char editing_mount_path[512] = "";

        bool show_delete_confirm = false;
        std::string deleting_device_id = "";
        std::string deleting_device_name = "";

        bool is_fetching_devices = false;
        std::chrono::steady_clock::time_point last_fetch_time = std::chrono::steady_clock::time_point{};
        static constexpr int fetch_interval_ms = 5000;

        std::atomic<bool> ping_thread_running{false};
        std::thread ping_thread;
        std::chrono::steady_clock::time_point last_ping_time = std::chrono::steady_clock::time_point{};
        static constexpr int ping_interval_ms = 300000;

        std::string ms_access_token;
        bool show_ms_login_modal = false;
        bool is_ms_authenticated = false;
        char ms_token_buffer[4096] = "";
        std::string ms_auth_error;

        ~ServicesState();

        bool has_ms_token() const;


        void start_ping_thread();
        void stop_ping_thread();

        // Device management
        bool ping_device(const std::string& hostname);
        void ping_all_devices();
        void fetch_devices();
    };
}
