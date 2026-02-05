#pragma once

#include <chrono>
#include <mutex>
#include <string>

namespace misty::core {

class ProxyManager {
public:
    static ProxyManager& get();

    bool ensure_running();

private:
    ProxyManager() = default;
    ~ProxyManager() = default;
    ProxyManager(const ProxyManager&) = delete;
    ProxyManager& operator=(const ProxyManager&) = delete;

    bool should_manage_proxy() const;
    bool probe_proxy_once() const;
    bool launch_proxy_process();
    bool wait_until_ready(std::chrono::milliseconds timeout) const;
    std::string resolve_proxy_executable() const;

    mutable std::mutex mu_;
    std::chrono::steady_clock::time_point last_launch_attempt_{};
};

} // namespace misty::core
