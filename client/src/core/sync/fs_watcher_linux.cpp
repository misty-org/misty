#if defined(__linux__) && !defined(__APPLE__)

#include "core/sync/fs_watcher.h"

#include <sys/inotify.h>
#include <sys/select.h>
#include <sys/stat.h>
#include <unistd.h>

#include <array>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <cstdint>
#include <ctime>
#include <cstdio>
#include <filesystem>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

namespace misty::core::sync {

namespace {

using Clock = std::chrono::steady_clock;

constexpr uint32_t kWatchMask = IN_ATTRIB |
                                IN_CLOSE_WRITE |
                                IN_CREATE |
                                IN_DELETE |
                                IN_DELETE_SELF |
                                IN_MODIFY |
                                IN_MOVED_FROM |
                                IN_MOVED_TO |
                                IN_MOVE_SELF;

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
    std::snprintf(buf + head, sizeof(buf) - head, ".%09ldZ", static_cast<long>(ts.tv_nsec));
    return std::string(buf);
}

bool should_ignore_name(const std::string& name) {
    if (name == ".DS_Store") return true;
    return !name.empty() && name[0] == '.' && name.rfind(".~", 0) == 0;
}

} // namespace

struct FsWatcher::Impl {
    struct Pending {
        FsEventKind kind = FsEventKind::MODIFIED;
        bool is_dir = false;
        int64_t size = 0;
        std::string mtime;
    };

    std::mutex mu;
    int inotify_fd = -1;
    std::thread thread;
    std::string root;
    FsEventCallback callback;
    int debounce_ms = 250;
    std::unordered_map<std::string, Pending> pending;
    std::set<std::string> suppressed;
    std::unordered_map<int, std::string> watch_to_path;
    std::unordered_map<std::string, int> path_to_watch;
    std::atomic<bool> running{false};

    bool is_suppressed_locked(const std::string& path) const {
        for (const auto& p : suppressed) {
            if (path_under(p, path)) return true;
        }
        return false;
    }

    static FsEventKind merge_kind(FsEventKind current, FsEventKind next) {
        if (next == FsEventKind::DELETED) return FsEventKind::DELETED;
        if (current == FsEventKind::CREATED) return FsEventKind::CREATED;
        if (current == FsEventKind::DELETED && next == FsEventKind::CREATED) {
            return FsEventKind::MODIFIED;
        }
        return next;
    }

    bool add_watch_locked(const std::string& path) {
        if (path_to_watch.count(path)) return true;
        int wd = inotify_add_watch(inotify_fd, path.c_str(), kWatchMask);
        if (wd < 0) return false;
        watch_to_path[wd] = path;
        path_to_watch[path] = wd;
        return true;
    }

    void remove_watch_locked(int wd) {
        auto it = watch_to_path.find(wd);
        if (it == watch_to_path.end()) return;
        std::string path = it->second;
        watch_to_path.erase(it);
        path_to_watch.erase(path);
        if (inotify_fd >= 0) {
            inotify_rm_watch(inotify_fd, wd);
        }
    }

    void sync_watches_locked() {
        std::set<std::string> desired;
        desired.insert(root);

        std::error_code ec;
        for (std::filesystem::recursive_directory_iterator it(root, ec), end; !ec && it != end; it.increment(ec)) {
            if (ec) break;
            if (!it->is_directory(ec)) {
                ec.clear();
                continue;
            }
            desired.insert(it->path().string());
        }

        std::vector<int> to_remove;
        to_remove.reserve(watch_to_path.size());
        for (const auto& [wd, path] : watch_to_path) {
            if (!desired.count(path)) to_remove.push_back(wd);
        }
        for (int wd : to_remove) {
            remove_watch_locked(wd);
        }
        for (const auto& path : desired) {
            add_watch_locked(path);
        }
    }

    void enqueue_event_locked(const std::string& path, FsEventKind kind, bool is_dir) {
        if (path.empty()) return;
        if (is_suppressed_locked(path)) return;

        Pending next;
        next.kind = kind;
        next.is_dir = is_dir;

        struct stat st {};
        if (kind != FsEventKind::DELETED && ::lstat(path.c_str(), &st) == 0) {
            next.is_dir = S_ISDIR(st.st_mode);
            if (!next.is_dir) next.size = static_cast<int64_t>(st.st_size);
            next.mtime = format_rfc3339_nano(st.st_mtim);
        }

        Pending& current = pending[path];
        current.kind = merge_kind(current.kind, next.kind);
        current.is_dir = next.is_dir;
        current.size = next.size;
        current.mtime = std::move(next.mtime);
    }

    void flush_pending() {
        std::vector<FsEvent> events;
        FsEventCallback cb;
        {
            std::lock_guard<std::mutex> lock(mu);
            if (!running.load()) {
                pending.clear();
                return;
            }
            if (pending.empty()) return;
            events.reserve(pending.size());
            for (auto& [path, data] : pending) {
                FsEvent ev;
                ev.path = path;
                ev.kind = data.kind;
                ev.is_dir = data.is_dir;
                ev.size = data.size;
                ev.mtime = std::move(data.mtime);
                events.push_back(std::move(ev));
            }
            pending.clear();
            cb = callback;
        }
        if (cb && !events.empty()) {
            cb(std::move(events));
        }
    }

    void process_event(const inotify_event& event, bool& needs_rescan) {
        std::lock_guard<std::mutex> lock(mu);
        auto it = watch_to_path.find(event.wd);
        if (it == watch_to_path.end()) return;

        std::string path = it->second;
        if ((event.mask & IN_IGNORED) != 0) {
            path_to_watch.erase(path);
            watch_to_path.erase(it);
            needs_rescan = true;
            return;
        }
        if (event.len > 0 && event.name[0] != '\0') {
            path += "/";
            path += event.name;
        }
        sanitize_path(path);

        std::string name = event.len > 0 ? std::string(event.name) : std::filesystem::path(path).filename().string();
        if (should_ignore_name(name)) return;

        bool is_dir = (event.mask & IN_ISDIR) != 0;
        bool deleted = (event.mask & (IN_DELETE | IN_DELETE_SELF | IN_MOVED_FROM | IN_MOVE_SELF)) != 0;
        bool created = (event.mask & (IN_CREATE | IN_MOVED_TO)) != 0;
        bool modified = (event.mask & (IN_CLOSE_WRITE | IN_MODIFY)) != 0;

        if ((event.mask & IN_ATTRIB) != 0 && !deleted && !created && !modified) {
            return;
        }

        if (deleted) {
            enqueue_event_locked(path, FsEventKind::DELETED, is_dir);
        } else if (created) {
            enqueue_event_locked(path, FsEventKind::CREATED, is_dir);
        } else if (modified) {
            enqueue_event_locked(path, FsEventKind::MODIFIED, is_dir);
        } else {
            return;
        }

        if (is_dir || (event.mask & (IN_DELETE_SELF | IN_MOVE_SELF)) != 0) {
            needs_rescan = true;
        }
    }

    void run() {
        std::array<char, 64 * 1024> buffer{};
        bool has_pending = false;
        auto next_flush = Clock::time_point{};

        while (running.load()) {
            int timeout_ms = 100;
            if (has_pending) {
                auto now = Clock::now();
                if (now >= next_flush) {
                    flush_pending();
                    has_pending = false;
                    continue;
                }
                timeout_ms = static_cast<int>(
                    std::chrono::duration_cast<std::chrono::milliseconds>(next_flush - now).count());
                if (timeout_ms < 0) timeout_ms = 0;
                if (timeout_ms > 100) timeout_ms = 100;
            }

            fd_set readfds;
            FD_ZERO(&readfds);
            FD_SET(inotify_fd, &readfds);
            timeval tv{};
            tv.tv_sec = timeout_ms / 1000;
            tv.tv_usec = (timeout_ms % 1000) * 1000;

            int ready = select(inotify_fd + 1, &readfds, nullptr, nullptr, &tv);
            if (!running.load()) break;
            if (ready < 0) {
                if (errno == EINTR) continue;
                break;
            }
            if (ready == 0) continue;

            ssize_t bytes = read(inotify_fd, buffer.data(), buffer.size());
            if (bytes <= 0) {
                if (bytes < 0 && (errno == EAGAIN || errno == EINTR)) continue;
                break;
            }

            bool needs_rescan = false;
            ssize_t offset = 0;
            while (offset < bytes) {
                const auto* event = reinterpret_cast<const inotify_event*>(buffer.data() + offset);
                process_event(*event, needs_rescan);
                offset += sizeof(inotify_event) + event->len;
            }

            if (needs_rescan) {
                std::lock_guard<std::mutex> lock(mu);
                sync_watches_locked();
            }

            has_pending = true;
            next_flush = Clock::now() + std::chrono::milliseconds(debounce_ms);
        }

        flush_pending();
    }
};

FsWatcher::FsWatcher() : impl_(std::make_unique<Impl>()) {}

FsWatcher::~FsWatcher() {
    stop();
}

bool FsWatcher::start(const std::string& root, FsEventCallback callback, int debounce_ms) {
    stop();

    impl_->root = root;
    sanitize_path(impl_->root);
    impl_->callback = std::move(callback);
    impl_->debounce_ms = debounce_ms > 0 ? debounce_ms : 250;

    struct stat st {};
    if (impl_->root.empty() || ::lstat(impl_->root.c_str(), &st) != 0 || !S_ISDIR(st.st_mode)) {
        return false;
    }

    int fd = inotify_init1(IN_CLOEXEC | IN_NONBLOCK);
    if (fd < 0) return false;

    impl_->inotify_fd = fd;
    {
        std::lock_guard<std::mutex> lock(impl_->mu);
        impl_->pending.clear();
        impl_->suppressed.clear();
        impl_->watch_to_path.clear();
        impl_->path_to_watch.clear();
        impl_->sync_watches_locked();
        if (impl_->path_to_watch.empty()) {
            ::close(impl_->inotify_fd);
            impl_->inotify_fd = -1;
            return false;
        }
    }

    impl_->running.store(true);
    impl_->thread = std::thread([impl = impl_.get()] {
        impl->run();
    });
    return true;
}

void FsWatcher::stop() {
    if (!impl_->running.exchange(false)) return;

    if (impl_->thread.joinable()) {
        impl_->thread.join();
    }

    std::lock_guard<std::mutex> lock(impl_->mu);
    impl_->pending.clear();
    impl_->suppressed.clear();
    impl_->watch_to_path.clear();
    impl_->path_to_watch.clear();
    impl_->callback = nullptr;
    if (impl_->inotify_fd >= 0) {
        ::close(impl_->inotify_fd);
        impl_->inotify_fd = -1;
    }
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

#endif
