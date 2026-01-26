#include "services_state.h"
#include "core/http_client.h"
#include "core/env_manager.h"
#include <filesystem>

namespace fs = std::filesystem;
namespace minidfs::panel {

    ServicesState::~ServicesState() {
        stop_ping_thread();
    }

    void ServicesState::start_ping_thread() {
        if (ping_thread_running.load()) return;
        ping_thread_running.store(true);
        ping_thread = std::thread([this]() {
            while (ping_thread_running.load()) {
                try {
                    ping_all_devices();
                } catch (...) {}
                for (int i = 0; i < 300 && ping_thread_running.load(); ++i)
                    std::this_thread::sleep_for(std::chrono::seconds(1));
            }
        });
    }

    void ServicesState::stop_ping_thread() {
        ping_thread_running.store(false);
        if (ping_thread.joinable())
            ping_thread.join();
    }

    bool ServicesState::ping_device(const std::string& hostname) {
        if (hostname.empty()) return false;
        std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "http://localhost:3000");
        if (base.empty()) base = "http://localhost:3000";
        std::string url = base + "/api/ts-ping?hostname=" + hostname;
        core::HttpResponse response = core::HttpClient::get().get(url);
        return response.status_code >= 200 && response.status_code < 300;
    }

    void ServicesState::ping_all_devices() {
        std::vector<std::pair<std::string, std::string>> devices_to_ping;
        {
            std::lock_guard<std::mutex> lock(mu);
            for (const auto& device : devices) {
                if (!device.hostname.empty())
                    devices_to_ping.push_back({device.id, device.hostname});
            }
        }
        for (const auto& [id, hostname] : devices_to_ping) {
            bool is_online = ping_device(hostname);
            std::lock_guard<std::mutex> lock(mu);
            for (auto& device : devices) {
                if (device.id == id) {
                    device.is_online = is_online;
                    break;
                }
            }
        }
        last_ping_time = std::chrono::steady_clock::now();
    }

    void ServicesState::fetch_devices() {
        if (is_fetching_devices) return;
        auto now = std::chrono::steady_clock::now();
        if (last_fetch_time != std::chrono::steady_clock::time_point{} &&
            std::chrono::duration_cast<std::chrono::milliseconds>(now - last_fetch_time).count() < fetch_interval_ms)
            return;

        is_fetching_devices = true;
        error_msg = "";

        std::string url = "http://localhost:3000/api/devices";
        if (!current_workspace_id.empty())
            url += "?workspace_id=" + current_workspace_id;

        core::HttpResponse response = core::HttpClient::get().get(url);
        if (response.status_code >= 200 && response.status_code < 300) {
            try {
                auto json = nlohmann::json::parse(response.body);
                std::unordered_map<std::string, bool> existing_status;
                {
                    std::lock_guard<std::mutex> lock(mu);
                    for (const auto& device : devices)
                        existing_status[device.id] = device.is_online;
                }

                std::vector<DeviceInfo> new_devices;
                if (json.is_array()) {
                    for (const auto& device_json : json) {
                        DeviceInfo device;
                        device.id = device_json.value("id", "");
                        device.hostname = device_json.value("peer_hostname", "");
                        device.name = device_json.value("device_name", "");
                        if (device.name.empty()) device.name = device.hostname;
                        device.ip_address = device_json.value("peer_address", "");
                        device.status_detail = device_json.value("peer_type", "");
                        device.mount_path = device_json.value("mount_path", "");
                        device.workspace_id = device_json.value("workspace_id", "");

                        if (!device.mount_path.empty()) {
                            std::error_code ec;
                            fs::create_directories(device.mount_path, ec);
                        }

                        auto it = existing_status.find(device.id);
                        device.is_online = (it != existing_status.end()) ? it->second : false;

                        if (device_json.contains("last_seen"))
                            device.last_seen = device_json["last_seen"].get<std::string>();

                        new_devices.push_back(device);
                    }
                }

                {
                    std::lock_guard<std::mutex> lock(mu);
                    devices = std::move(new_devices);
                }

                start_ping_thread();
                if (last_ping_time == std::chrono::steady_clock::time_point{})
                    std::thread([this]() { ping_all_devices(); }).detach();
            } catch (const std::exception& ex) {
                error_msg = std::string("Failed to parse devices JSON: ") + ex.what();
            }
        } else {
            error_msg = "Failed to fetch devices (" + std::to_string(response.status_code) + ")";
        }

        last_fetch_time = now;
        is_fetching_devices = false;
    }

    bool ServicesState::has_ms_token() const {
        return !ms_access_token.empty();
    }
}
