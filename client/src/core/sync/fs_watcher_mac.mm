#if defined(__APPLE__)

#include "core/sync/fs_watcher.h"

#include <CoreServices/CoreServices.h>
#include <dispatch/dispatch.h>
#include <sys/stat.h>
#include <time.h>

#include <atomic>
#include <mutex>
#include <set>
#include <string>
#include <unordered_map>
#include <vector>

namespace misty::core::sync {

namespace {

void sanitize_path(std::string& path) {
    while (path.size() > 1 && path.back() == '/') path.pop_back();
}

bool path_under(const std::string& ancestor, const std::string& descendant) {
    if (descendant.size() < ancestor.size()) return false;
    if (descendant.compare(0, ancestor.size(), ancestor) != 0) return false;
    return descendant.size() == ancestor.size() || descendant[ancestor.size()] == '/';
}

std::string format_rfc3339_nano(const timespec& ts) {
    char buf[64];
    struct tm tm_utc;
    gmtime_r(&ts.tv_sec, &tm_utc);
    int head = strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &tm_utc);
    if (head <= 0) return "";
    snprintf(buf + head, sizeof(buf) - head, ".%09ldZ", (long)ts.tv_nsec);
    return std::string(buf);
}

} // namespace

struct FsWatcher::Impl {
    std::mutex mu;
    FSEventStreamRef stream = nullptr;
    dispatch_queue_t queue = nullptr;
    std::string root;
    FsEventCallback callback;
    int debounce_ms = 250;

    struct Pending {
        FsEventKind kind = FsEventKind::MODIFIED;
        bool is_dir = false;
        int64_t size = 0;
        std::string mtime;
    };

    std::unordered_map<std::string, Pending> pending;
    std::set<std::string> suppressed;
    std::atomic<bool> flush_scheduled{false};
    std::atomic<bool> running{false};

    bool is_suppressed_locked(const std::string& path) const {
        for (const auto& p : suppressed) {
            if (path_under(p, path)) return true;
        }
        return false;
    }

    void schedule_flush_locked() {
        if (flush_scheduled.exchange(true)) return;
        int delay = debounce_ms;
        Impl* self = this;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)delay * NSEC_PER_MSEC),
                       queue,
                       ^{
                           self->flush();
                       });
    }

    void flush() {
        std::vector<FsEvent> events;
        FsEventCallback cb;
        {
            std::lock_guard<std::mutex> lock(mu);
            flush_scheduled.store(false);
            if (!running.load()) {
                pending.clear();
                return;
            }
            events.reserve(pending.size());
            for (auto& entry : pending) {
                FsEvent ev;
                ev.path = entry.first;
                ev.kind = entry.second.kind;
                ev.is_dir = entry.second.is_dir;
                ev.size = entry.second.size;
                ev.mtime = std::move(entry.second.mtime);
                events.push_back(std::move(ev));
            }
            pending.clear();
            cb = callback;
        }
        if (cb && !events.empty()) {
            cb(std::move(events));
        }
    }

    void handle_event(const std::string& raw_path, FSEventStreamEventFlags flags) {
        std::string path = raw_path;
        sanitize_path(path);
        if (path.empty()) return;

        auto slash = path.find_last_of('/');
        std::string name = (slash == std::string::npos) ? path : path.substr(slash + 1);
        if (name == ".DS_Store") return;
        if (!name.empty() && name[0] == '.' && name.rfind(".~", 0) == 0) return;

        struct stat st{};
        bool exists = ::lstat(path.c_str(), &st) == 0;

        bool renamed = (flags & kFSEventStreamEventFlagItemRenamed) != 0;
        bool removed = (flags & kFSEventStreamEventFlagItemRemoved) != 0;
        bool created = (flags & kFSEventStreamEventFlagItemCreated) != 0;
        bool modified = (flags & (kFSEventStreamEventFlagItemModified |
                                  kFSEventStreamEventFlagItemFinderInfoMod |
                                  kFSEventStreamEventFlagItemInodeMetaMod |
                                  kFSEventStreamEventFlagItemChangeOwner |
                                  kFSEventStreamEventFlagItemXattrMod)) != 0;

        FsEventKind kind;
        if (!exists) {
            kind = FsEventKind::DELETED;
        } else if (renamed) {
            kind = FsEventKind::CREATED;
        } else if (created && !modified) {
            kind = FsEventKind::CREATED;
        } else {
            kind = FsEventKind::MODIFIED;
        }
        (void)removed; // inferred from !exists above

        bool is_dir = false;
        int64_t size = 0;
        std::string mtime;
        if (exists) {
            is_dir = S_ISDIR(st.st_mode);
            if (!is_dir) size = (int64_t)st.st_size;
#if defined(__APPLE__)
            mtime = format_rfc3339_nano(st.st_mtimespec);
#endif
        } else {
            is_dir = (flags & kFSEventStreamEventFlagItemIsDir) != 0;
        }

        std::lock_guard<std::mutex> lock(mu);
        if (is_suppressed_locked(path)) return;

        Pending& p = pending[path];
        // Collapse: if we already had a DELETED for this path and a CREATED
        // arrives (fast rename-in-place), promote to MODIFIED so the proxy
        // doesn't bounce the row through a REM state.
        if (p.kind == FsEventKind::DELETED && kind == FsEventKind::CREATED) {
            p.kind = FsEventKind::MODIFIED;
        } else {
            p.kind = kind;
        }
        p.is_dir = is_dir;
        p.size = size;
        p.mtime = std::move(mtime);

        schedule_flush_locked();
    }

    static void stream_cb(ConstFSEventStreamRef,
                          void* userData,
                          size_t numEvents,
                          void* eventPaths,
                          const FSEventStreamEventFlags* eventFlags,
                          const FSEventStreamEventId*) {
        auto* self = static_cast<Impl*>(userData);
        char** paths = static_cast<char**>(eventPaths);
        for (size_t i = 0; i < numEvents; ++i) {
            self->handle_event(paths[i], eventFlags[i]);
        }
    }
};

FsWatcher::FsWatcher() : impl_(std::make_unique<Impl>()) {}
FsWatcher::~FsWatcher() { stop(); }

bool FsWatcher::start(const std::string& root, FsEventCallback callback, int debounce_ms) {
    stop();

    impl_->root = root;
    sanitize_path(impl_->root);
    impl_->callback = std::move(callback);
    impl_->debounce_ms = debounce_ms > 0 ? debounce_ms : 250;

    CFStringRef path_cf = CFStringCreateWithCString(kCFAllocatorDefault,
                                                    impl_->root.c_str(),
                                                    kCFStringEncodingUTF8);
    if (!path_cf) return false;

    CFArrayRef paths = CFArrayCreate(kCFAllocatorDefault,
                                     reinterpret_cast<const void**>(&path_cf),
                                     1,
                                     &kCFTypeArrayCallBacks);
    CFRelease(path_cf);
    if (!paths) return false;

    FSEventStreamContext ctx = {0, impl_.get(), nullptr, nullptr, nullptr};
    FSEventStreamRef stream = FSEventStreamCreate(
        kCFAllocatorDefault,
        &Impl::stream_cb,
        &ctx,
        paths,
        kFSEventStreamEventIdSinceNow,
        0.05,
        kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer);
    CFRelease(paths);
    if (!stream) return false;

    dispatch_queue_t queue = dispatch_queue_create("com.misty.fswatcher",
                                                   DISPATCH_QUEUE_SERIAL);
    FSEventStreamSetDispatchQueue(stream, queue);

    if (!FSEventStreamStart(stream)) {
        FSEventStreamInvalidate(stream);
        FSEventStreamRelease(stream);
#if !OS_OBJECT_USE_OBJC
        dispatch_release(queue);
#endif
        return false;
    }

    impl_->stream = stream;
    impl_->queue = queue;
    impl_->running.store(true);
    return true;
}

void FsWatcher::stop() {
    if (!impl_->running.exchange(false)) return;

    FSEventStreamRef stream = impl_->stream;
    dispatch_queue_t queue = impl_->queue;
    impl_->stream = nullptr;
    impl_->queue = nullptr;

    if (stream) {
        FSEventStreamStop(stream);
        FSEventStreamInvalidate(stream);
        FSEventStreamRelease(stream);
    }
    if (queue) {
#if !OS_OBJECT_USE_OBJC
        dispatch_release(queue);
#else
        (void)queue;
#endif
    }

    std::lock_guard<std::mutex> lock(impl_->mu);
    impl_->pending.clear();
    impl_->suppressed.clear();
    impl_->callback = nullptr;
    impl_->flush_scheduled.store(false);
}

bool FsWatcher::is_running() const {
    return impl_->running.load();
}

void FsWatcher::suppress(const std::string& path) {
    std::string p = path;
    sanitize_path(p);
    std::lock_guard<std::mutex> lock(impl_->mu);
    impl_->suppressed.insert(std::move(p));
}

void FsWatcher::unsuppress(const std::string& path) {
    std::string p = path;
    sanitize_path(p);
    std::lock_guard<std::mutex> lock(impl_->mu);
    impl_->suppressed.erase(p);
}

} // namespace misty::core::sync

#endif // __APPLE__
