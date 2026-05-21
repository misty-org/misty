#include "core/file_sync/fs_watcher.h"
#include "core/system/util.h"

#include <wtr/watcher.hpp>

#include <filesystem>
#include <sys/stat.h>

namespace misty::core {

namespace {
    FsEventKind event_kind_from_watcher(enum wtr::event::effect_type effect) {
        switch (effect) {
            case wtr::event::effect_type::create:
                return FsEventKind::CREATED;
            case wtr::event::effect_type::destroy:
                return FsEventKind::DELETED;
            case wtr::event::effect_type::rename:
                return FsEventKind::RENAMED;
            case wtr::event::effect_type::modify:
            case wtr::event::effect_type::owner:
            case wtr::event::effect_type::other:
                return FsEventKind::MODIFIED;
        }
        return FsEventKind::MODIFIED;
    }

    bool is_dir_from_watcher(enum wtr::event::path_type type) {
        return type == wtr::event::path_type::dir;
    }

    bool is_status_event(const wtr::event& event) {
        return event.path_type == wtr::event::path_type::watcher;
    }

    bool should_ignore_path(const std::filesystem::path& path) {
        const std::string name = path_utf8_filename(path);
        return name == ".DS_Store" || name.rfind("._", 0) == 0;
    }

    FsEvent to_fs_event(const wtr::event& watcher_event) {
        FsEvent event;
        event.path = path_utf8_string(watcher_event.path_name);
        event.kind = event_kind_from_watcher(watcher_event.effect_type);
        event.is_dir = is_dir_from_watcher(watcher_event.path_type);

        if (event.kind == FsEventKind::RENAMED && watcher_event.associated) {
            event.old_path = event.path;
            event.path = path_utf8_string(watcher_event.associated->path_name);
            event.is_dir = is_dir_from_watcher(watcher_event.associated->path_type);
        }

        struct stat st {};
        if (::lstat(event.path.c_str(), &st) == 0) {
            event.file_id = static_cast<uint64_t>(st.st_ino);
            event.device_id = static_cast<uint64_t>(st.st_dev);
            event.is_dir = S_ISDIR(st.st_mode);
            event.size = event.is_dir ? 0 : static_cast<int64_t>(st.st_size);
#if defined(__APPLE__)
            event.mtime = format_rfc3339_nano(st.st_mtimespec);
#elif defined(__linux__)
            event.mtime = format_rfc3339_nano(st.st_mtim);
#endif
        }

        return event;
    }
}

FsWatcher::FsWatcher() = default;

FsWatcher::~FsWatcher() {
    fs_watcher_stop();
}

void FsWatcher::init() {}

bool FsWatcher::fs_watcher_start(const std::string& directory, FsEventCallback callback) {
    fs_watcher_stop();

    if (directory.empty() || !std::filesystem::is_directory(directory)) {
        return false;
    }

    {
        std::lock_guard<std::mutex> lock(mu_);
        callback_ = std::move(callback);
        watch_ = std::make_unique<wtr::watch>(
            std::filesystem::path(directory),
            [this](const wtr::event& event) {
                handle_event(event);
            }
        );
    }

    running_.store(true);
    return true;
}

void FsWatcher::fs_watcher_stop() {
    std::unique_ptr<wtr::watch> watch;
    {
        std::lock_guard<std::mutex> lock(mu_);
        watch = std::move(watch_);
        callback_ = nullptr;
    }

    if (watch) {
        watch->close();
    }

    running_.store(false);
}

#ifdef MISTY_TESTING
void FsWatcher::fs_watcher_set_callback_for_test(FsEventCallback callback) {
    std::lock_guard<std::mutex> lock(mu_);
    callback_ = std::move(callback);
}

void FsWatcher::fs_watcher_handle_event_for_test(const wtr::event& event) {
    handle_event(event);
}
#endif

void FsWatcher::handle_event(const wtr::event& watcher_event) {
    if (is_status_event(watcher_event)) {
        return;
    }

    if (should_ignore_path(watcher_event.path_name) ||
        (watcher_event.associated && should_ignore_path(watcher_event.associated->path_name))) {
        return;
    }

    FsEventCallback callback;
    {
        std::lock_guard<std::mutex> lock(mu_);
        callback = callback_;
    }

    auto event = to_fs_event(watcher_event);
    if (callback) {
        std::vector<FsEvent> events;
        events.push_back(std::move(event));
        callback(std::move(events));
    }
}

} // namespace misty::core
