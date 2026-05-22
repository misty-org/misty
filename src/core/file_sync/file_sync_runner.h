#pragma once

#include <atomic>
#include <condition_variable>
#include <mutex>
#include <optional>
#include <queue>
#include <string>
#include <thread>

#include "core/file_sync/file_sync_gate.h"

namespace misty::core {

/**
 * @brief Runs planned file sync operations against the configured remote API.
 */
class FileSyncRunner final {
public:
    struct RemotePath {
        std::string remote_name;
        std::string rel_path;
    };

    FileSyncRunner(std::string mount_root, FileSyncGate& gate);
    ~FileSyncRunner();

    void start();
    void stop();
    void enqueue(FileSyncFinalEvent event);

private:
    void run_loop();
    bool run_event(const FileSyncFinalEvent& event);
    bool run_local_tmp(const FileSyncFinalEvent& event);
    bool run_upload(const FileSyncFinalEvent& event, const RemotePath& remote_path);
    bool run_create_folder(const FileSyncFinalEvent& event, const RemotePath& remote_path);
    bool run_delete(const FileSyncFinalEvent& event, const RemotePath& remote_path);
    bool run_rename(const FileSyncFinalEvent& event,
                    const RemotePath& old_remote_path,
                    const RemotePath& new_remote_path);

    std::optional<RemotePath> map_path(const std::string& absolute_path) const;
    std::optional<bool> remote_path_exists(const RemotePath& remote_path) const;
    std::string proxy_url(const std::string& path) const;

    FileSyncGate& gate_;
    std::string mount_root_;
    std::atomic<bool> running_{false};
    mutable std::mutex mu_;
    std::condition_variable cv_;
    std::queue<FileSyncFinalEvent> queue_;
    std::thread worker_thread_;
};

} // namespace misty::core
