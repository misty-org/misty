#pragma once

#include <chrono>
#include <mutex>
#include <string>

namespace misty::core {

class ProxyManager {
public:
    static ProxyManager& get();

    bool ensure_running(bool force = false);
    bool restart_proxy();
    void record_proxy_request_result(bool available, const std::string& message = "");
    bool is_proxy_available() const;
    std::string get_proxy_status_message() const;

private:
    ProxyManager() = default;
    ~ProxyManager() = default;
    ProxyManager(const ProxyManager&) = delete;
    ProxyManager& operator=(const ProxyManager&) = delete;

    bool should_manage_proxy() const;
    bool probe_proxy_once(bool force = false) const;
    bool launch_proxy_process();
    bool wait_until_ready(std::chrono::milliseconds timeout) const;
    std::string resolve_proxy_executable() const;
    bool terminate_existing_proxies(const std::string& proxy_executable) const;

    mutable std::mutex mu_;
    std::chrono::steady_clock::time_point last_launch_attempt_{};
    mutable std::chrono::steady_clock::time_point last_probe_attempt_{};
    std::chrono::steady_clock::time_point last_failure_recorded_at_{};
    int consecutive_probe_failures_ = 0;
    bool last_known_available_ = true;
    std::string proxy_status_message_;
};

} // namespace misty::core
