#pragma once

#include <atomic>
#include <functional>
#include <mutex>
#include <string>
#include <vector>

#include "wtr/watcher.hpp"


namespace misty::core {

/**
* @brief Represents the kind of filesystem event.
*/
enum class FsEventEffect {
    CREATED,
    MODIFIED,
    DELETED,
    RENAMED,
};

/**
 * @brief Represents what kind of change occurred to a file or folder, both remote and local.
 */
enum class FileSyncChange {
    LocalFile,
    LocalFolder,
    LocalDelete,
    LocalRename,
    RemoteFile,
    RemoteFolder,
    RemoteDelete,
    RemoteRename,
    Noop,
};

/**
 * @brief Represents a filesystem event.
 */
struct FsEvent {
    std::string new_path;
    std::string old_path;
    FsEventEffect effect = FsEventEffect::MODIFIED;
};

using FsEventCallback = std::function<void(std::vector<FsEvent>)>;

/**
 * @brief Recursive filesystem watcher backed by github.com/e-dant/watcher.
 */
class FileSyncWatcher final {
public:
    FileSyncWatcher() = default;
    ~FileSyncWatcher();

    /**
     * @brief Starts a recursive watcher for a directory.
     */
    bool fs_watcher_start(const std::string& directory, const FsEventCallback& callback);

    /**
     * @brief Stops the active watcher.
     */
    void fs_watcher_stop();

    /**
     * @brief Returns true if the watcher is currently running.
     */
    bool fs_watcher_running();

private:
    void handle_event(const wtr::event& event);
    std::unique_ptr<wtr::watch> watch_;
    std::atomic<bool> running_{false};
    std::mutex mu_;
    FsEventCallback callback_;
};

} // namespace misty::core
