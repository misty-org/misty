#include "core/file_sync/file_sync_watcher.h"
#include "core/system/util.h"

#include <wtr/watcher.hpp>

#include <filesystem>
#include <sys/stat.h>

namespace misty::core {

namespace {
    bool valid_watcher_event(const wtr::event& event) {
        if (event.path_type == wtr::event::path_type::watcher) return false;
        const std::string name = path_utf8_filename(event.path_name);
        if (name == ".DS_Store" || name.rfind("._", 0) == 0) return false;
        if (event.associated && (path_utf8_filename(event.associated->path_name) == ".DS_Store"
            || path_utf8_filename(event.associated->path_name).rfind("._", 0) == 0)) return false;
        return true;
    }

    FsEventEffect convert_effect(enum wtr::event::effect_type effect) {
        switch (effect) {
            case wtr::event::effect_type::create:
                return FsEventEffect::CREATED;
            case wtr::event::effect_type::destroy:
                return FsEventEffect::DELETED;
            case wtr::event::effect_type::rename:
                return FsEventEffect::RENAMED;
            case wtr::event::effect_type::modify:
            case wtr::event::effect_type::owner:
            case wtr::event::effect_type::other:
                return FsEventEffect::MODIFIED;
        }
        return FsEventEffect::MODIFIED;
    }


    FsEvent convert_fs_event(const wtr::event& watcher_event) {
        FsEvent event;
        event.new_path = path_utf8_string(watcher_event.path_name);
        event.effect = convert_effect(watcher_event.effect_type);

        if (event.effect == FsEventEffect::RENAMED && watcher_event.associated) {
            event.old_path = event.new_path;
            event.new_path = path_utf8_string(watcher_event.associated->path_name);
        }

        return event;
    }
}

FileSyncWatcher::~FileSyncWatcher() {
    fs_watcher_stop();
}

bool FileSyncWatcher::fs_watcher_start(const std::string& directory, const FsEventCallback& callback) {
    fs_watcher_stop();
    if (directory.empty() || !std::filesystem::is_directory(directory)) return false;

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

void FileSyncWatcher::fs_watcher_stop() {
    std::unique_ptr<wtr::watch> watch;
    {
        std::lock_guard<std::mutex> lock(mu_);
        watch = std::move(watch_);
        callback_ = nullptr;
    }

    if (watch) watch->close();

    running_.store(false);
}

bool FileSyncWatcher::fs_watcher_running() {
    return running_.load();
}

void FileSyncWatcher::handle_event(const wtr::event& event) {
    if (!valid_watcher_event(event)) return;

    FsEventCallback callback;
    {
        std::lock_guard<std::mutex> lock(mu_);
        callback = callback_;
    }

    auto fs_event = convert_fs_event(event);
    if (callback) {
        std::vector<FsEvent> fs_events;
        fs_events.push_back(std::move(fs_event));
        callback(std::move(fs_events));
    }
}

} // namespace misty::core
