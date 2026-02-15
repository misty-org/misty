#pragma once

#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace misty::core::sync {

enum class FsEventKind {
    CREATED,
    MODIFIED,
    DELETED,
};

struct FsEvent {
    std::string path;   // absolute local path
    FsEventKind kind = FsEventKind::MODIFIED;
    bool is_dir = false;
    int64_t size = 0;
    std::string mtime; // RFC3339Nano when known, empty otherwise
};

using FsEventCallback = std::function<void(std::vector<FsEvent>)>;

// Recursive filesystem watcher. On macOS backed by FSEvents; elsewhere a stub.
// All callbacks fire on a background thread; callers are responsible for
// any cross-thread synchronisation.
class FsWatcher {
public:
    FsWatcher();
    ~FsWatcher();

    FsWatcher(const FsWatcher&) = delete;
    FsWatcher& operator=(const FsWatcher&) = delete;

    // Start watching `root` recursively. Returns false if the platform is
    // unsupported or the stream could not be created. Replaces any existing
    // watch on the same instance.
    bool start(const std::string& root, FsEventCallback callback, int debounce_ms = 250);
    void stop();
    bool is_running() const;

    // Temporarily ignore events originating under `path` (used by downloaders
    // to avoid reporting their own writes back through the dirty channel).
    void suppress(const std::string& path);
    void unsuppress(const std::string& path);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace misty::core::sync
