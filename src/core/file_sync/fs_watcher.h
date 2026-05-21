#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace wtr {
inline namespace watcher {
    class event;
    class watch;
}
}

namespace misty::core {

enum class FsEventKind {
    CREATED,
    MODIFIED,
    DELETED,
    RENAMED,
};

/**
 * @brief Represents a filesystem event.
 */
struct FsEvent {
    std::string path;
    std::string old_path;
    FsEventKind kind = FsEventKind::MODIFIED;
    uint64_t file_id = 0;
    uint64_t device_id = 0;
    bool is_dir = false;
    int64_t size = 0;
    std::string mtime;
};

using FsEventCallback = std::function<void(std::vector<FsEvent>)>;

/**
 * @brief Recursive filesystem watcher.
 *
 * All callbacks fire on a background thread; callers are responsible for
 * any cross-thread synchronization. Only FileSyncService
 */
class IFsWatcher {
public:
    IFsWatcher() = default;
    virtual ~IFsWatcher() = default;

    /**
     * @brief
     * All platforms must implement startup to for their own file
     */
    virtual void init() = 0;

    /**
     * @brief Start watching a directory recursively. Runs on a background thread.
     *
     * Returns false if the platform is unsupported or the stream could not be created.
     * Replaces any existing watch on the same instance.
     */
    virtual bool fs_watcher_start(const std::string& directory, FsEventCallback callback) = 0;


    /**
     * @brief Stop watching the directory for file events.
     */
    virtual void fs_watcher_stop() = 0;

    /**
     * @brief Returns true if the watcher is currently running.
     */
    bool fs_watcher_running() const {
        return running_.load();
    }


protected:
    std::atomic<bool> running_{false};

};

/**
 * @brief Recursive filesystem watcher backed by e-dant/watcher.
 */
class FsWatcher final : public IFsWatcher {
public:
    FsWatcher();
    ~FsWatcher() override;

    /**
     * @brief Initializes watcher state.
     */
    void init() override;

    /**
     * @brief Starts a recursive watcher for a directory.
     */
    bool fs_watcher_start(const std::string& directory, FsEventCallback callback) override;

    /**
     * @brief Stops the active watcher.
     */
    void fs_watcher_stop() override;

#ifdef MISTY_TESTING
    /**
     * @brief Sets the callback used by synthetic watcher events in tests.
     */
    void fs_watcher_set_callback_for_test(FsEventCallback callback);

    /**
     * @brief Sends a synthetic watcher event through the normal mapping path.
     */
    void fs_watcher_handle_event_for_test(const wtr::event& event);
#endif

private:
    void handle_event(const wtr::event& event);

    std::mutex mu_;
    std::unique_ptr<wtr::watch> watch_;
    FsEventCallback callback_;
};

} // namespace misty::core
