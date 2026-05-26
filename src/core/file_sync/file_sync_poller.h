#pragma once

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <functional>
#include <unordered_map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "core/file_sync/file_sync_gate.h"

namespace misty::core {

/**
 * @brief Remote root watched by the sync poller through the proxy API.
 */
struct FileSyncRemoteTarget {
    std::string remote_name;
    std::string remote_path;
};

/**
 * @brief Remote metadata change emitted from proxy polling.
 */
struct FileSyncRemoteEvent {
    FileSyncChange change = FileSyncChange::Noop;
    FileSyncRemoteEntry entry;
    std::string old_remote_path;
};

using FileSyncRemoteCallback = std::function<void(std::vector<FileSyncRemoteEvent>)>;

/**
 * @brief Polls remote file metadata through the proxy API and emits remote sync changes.
 */
class FileSyncRemotePoller final {
public:
    FileSyncRemotePoller() = default;
    ~FileSyncRemotePoller();

    bool start(std::vector<FileSyncRemoteTarget> targets,
               FileSyncRemoteCallback callback,
               std::chrono::milliseconds interval = std::chrono::seconds(5));
    void stop();
    bool running() const;

private:
    void poll_loop();
    std::vector<FileSyncRemoteEvent> poll_targets();

    std::atomic<bool> running_{false};
    mutable std::mutex mu_;
    std::condition_variable cv_;
    std::thread thread_;
    std::vector<FileSyncRemoteTarget> targets_;
    FileSyncRemoteCallback callback_;
    std::chrono::milliseconds interval_{std::chrono::seconds(5)};
    std::unordered_map<std::string, std::unordered_map<std::string, FileSyncRemoteEntry>> last_seen_;
};

} // namespace misty::core
