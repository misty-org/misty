#include "core/file_sync/file_sync_poller.h"

#include <utility>

namespace misty::core {

FileSyncRemotePoller::~FileSyncRemotePoller() {
    stop();
}

bool FileSyncRemotePoller::start(std::vector<FileSyncRemoteTarget> targets,
                                 FileSyncRemoteCallback callback,
                                 std::chrono::milliseconds interval) {
    stop();
    if (interval <= std::chrono::milliseconds::zero()) {
        return false;
    }

    {
        std::lock_guard<std::mutex> lock(mu_);
        targets_ = std::move(targets);
        callback_ = std::move(callback);
        interval_ = interval;
    }

    running_.store(true);
    thread_ = std::thread(&FileSyncRemotePoller::poll_loop, this);
    return true;
}

void FileSyncRemotePoller::stop() {
    if (!running_.exchange(false)) {
        return;
    }
    cv_.notify_all();
    if (thread_.joinable()) {
        thread_.join();
    }
    {
        std::lock_guard<std::mutex> lock(mu_);
        callback_ = nullptr;
        targets_.clear();
    }
}

bool FileSyncRemotePoller::running() const {
    return running_.load();
}

void FileSyncRemotePoller::poll_loop() {
    while (running_.load()) {
        auto events = poll_targets();
        FileSyncRemoteCallback callback;
        {
            std::lock_guard<std::mutex> lock(mu_);
            callback = callback_;
        }
        if (callback && !events.empty()) {
            callback(std::move(events));
        }

        std::unique_lock<std::mutex> lock(mu_);
        cv_.wait_for(lock, interval_, [this] {
            return !running_.load();
        });
    }
}

std::vector<FileSyncRemoteEvent> FileSyncRemotePoller::poll_targets() {
    std::vector<FileSyncRemoteTarget> targets;
    {
        std::lock_guard<std::mutex> lock(mu_);
        targets = targets_;
    }

    std::vector<FileSyncRemoteEvent> events;
    for (const auto& target : targets) {
        (void)target;
        // Proxy polling will be added here once the remote metadata endpoint is settled.
    }
    return events;
}

} // namespace misty::core
