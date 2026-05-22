#include "core/file_sync/file_sync_master.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <optional>
#include <utility>

#include "core/file_sync/file_sync_runner.h"
#include "core/system/util.h"

#define XXH_INLINE_ALL
#include <xxhash.h>

namespace fs = std::filesystem;
using namespace std::chrono_literals;

namespace misty::core {
namespace {

bool starts_with(const std::string& value, const std::string& prefix) {
    return value.rfind(prefix, 0) == 0;
}

bool ends_with(const std::string& value, const std::string& suffix) {
    return value.size() >= suffix.size() &&
           value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
}

std::string lower_copy(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return value;
}

std::string normalize_path(const std::string& path) {
    return path_utf8_generic_string(fs::path(path).lexically_normal());
}

bool path_under_root(const std::string& root, const std::string& path) {
    const std::string normalized_root = normalize_path(root);
    const std::string normalized_path = normalize_path(path);
    return normalized_path == normalized_root || starts_with(normalized_path, normalized_root + "/");
}

bool should_ignore_event(const FsEvent& event, const std::string& watch_root) {
    const bool path_in_root = !event.new_path.empty() && path_under_root(watch_root, event.new_path);
    const bool old_path_in_root =
        event.effect == FsEventEffect::RENAMED &&
        !event.old_path.empty() &&
        path_under_root(watch_root, event.old_path);

    if (!path_in_root && !old_path_in_root) {
        return true;
    }

    const std::string normalized_path = normalize_path(path_in_root ? event.new_path : event.old_path);
    if (normalized_path.find("/.misty/.cache/") != std::string::npos) {
        return true;
    }

    const std::string name = path_utf8_filename(normalized_path);
    const std::string lower_name = lower_copy(name);
    if (name == ".DS_Store" ||
        starts_with(name, "._") ||
        starts_with(name, "~$") ||
        ends_with(lower_name, ".swp") ||
        ends_with(lower_name, ".swo") ||
        ends_with(lower_name, ".tmp") ||
        ends_with(lower_name, ".temp") ||
        ends_with(lower_name, "~")) {
        return true;
    }

    return event.effect == FsEventEffect::CREATED && starts_with(lower_name, "untitled");
}

bool is_finder_placeholder_path(const std::string& path) {
    const std::string name = path_utf8_filename(normalize_path(path));
    return starts_with(lower_copy(name), "untitled");
}

std::string key_for_event(const FsEvent& event) {
    if (event.effect == FsEventEffect::RENAMED && !event.old_path.empty()) {
        return normalize_path(event.old_path) + "->" + normalize_path(event.new_path);
    }
    return normalize_path(event.new_path);
}

const char* change_label(FileSyncChange change) {
    switch (change) {
        case FileSyncChange::LocalFile:
            return "LocalFile";
        case FileSyncChange::LocalFolder:
            return "LocalFolder";
        case FileSyncChange::LocalDelete:
            return "LocalDelete";
        case FileSyncChange::LocalRename:
            return "LocalRename";
        case FileSyncChange::RemoteFile:
            return "RemoteFile";
        case FileSyncChange::RemoteFolder:
            return "RemoteFolder";
        case FileSyncChange::RemoteDelete:
            return "RemoteDelete";
        case FileSyncChange::RemoteRename:
            return "RemoteRename";
        case FileSyncChange::Noop:
            return "Noop";
    }
    return "Unknown";
}

const char* event_label(FsEventEffect effect) {
    switch (effect) {
        case FsEventEffect::CREATED:
            return "CREATED";
        case FsEventEffect::MODIFIED:
            return "MODIFIED";
        case FsEventEffect::DELETED:
            return "DELETED";
        case FsEventEffect::RENAMED:
            return "RENAMED";
    }
    return "UNKNOWN";
}

bool saw_effect(const FileSyncPendingEvent& pending, FsEventEffect effect) {
    return std::any_of(pending.events.begin(), pending.events.end(), [effect](const FsEvent& event) {
        return event.effect == effect;
    });
}

std::optional<XXH64_hash_t> xxh3_file(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in.is_open()) {
        return std::nullopt;
    }

    XXH3_state_t state;
    XXH3_64bits_reset(&state);

    std::array<char, 64 * 1024> buffer {};
    while (in) {
        in.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
        const auto count = in.gcount();
        if (count > 0) {
            const auto result = XXH3_64bits_update(&state, buffer.data(), static_cast<std::size_t>(count));
            if (result == XXH_ERROR) {
                return std::nullopt;
            }
        }
    }

    if (in.bad()) {
        return std::nullopt;
    }

    return XXH3_64bits_digest(&state);
}

std::string content_hash_for_path(const std::string& path) {
    const auto hash = xxh3_file(path);
    if (!hash) {
        return {};
    }
    return std::to_string(*hash);
}

} // namespace

FileSyncMaster::FileSyncMaster(std::string watch_root, FileSyncPolicy mode)
    : runner_(nullptr),
      gate_(mode),
      watch_root_(std::move(watch_root)) {}

FileSyncMaster::~FileSyncMaster() {
    sync_stop();
}

void FileSyncMaster::sync_start() {
    if (watch_root_.empty() || running_.exchange(true)) {
        return;
    }

    std::error_code ec;
    fs::create_directories(watch_root_, ec);
    if (ec) {
        running_.store(false);
        std::cout << "[FileSyncMaster] failed to create watch root path=" << watch_root_
                  << " error=" << ec.message() << std::endl;
        return;
    }

    {
        std::lock_guard<std::mutex> lock(mu_);
        final_events_.clear();
        gate_.reset();
        known_local_paths_.clear();
    }

    runner_ = std::make_unique<FileSyncRunner>(watch_root_, gate_);
    runner_->start();
    reconcile_thread_ = std::thread(&FileSyncMaster::reconcile_loop, this);

    if (!watcher_.fs_watcher_start(watch_root_, [this](std::vector<FsEvent> events) {
        handle_events(std::move(events));
    })) {
        running_.store(false);
        reconcile_cv_.notify_all();
        if (reconcile_thread_.joinable()) {
            reconcile_thread_.join();
        }
        if (runner_) {
            runner_->stop();
        }
        std::cout << "[FileSyncMaster] failed to start watcher path=" << watch_root_ << std::endl;
        return;
    }

    remote_poller_.start({}, [this](std::vector<FileSyncRemoteEvent> events) {
        handle_remote_events(std::move(events));
    });

    std::cout << "[FileSyncMaster] started path=" << watch_root_ << std::endl;
}

void FileSyncMaster::sync_stop() {
    if (!running_.exchange(false)) {
        return;
    }

    watcher_.fs_watcher_stop();
    remote_poller_.stop();
    reconcile_cv_.notify_all();
    if (reconcile_thread_.joinable()) {
        reconcile_thread_.join();
    }
    if (runner_) {
        runner_->stop();
    }
}

void FileSyncMaster::handle_events(std::vector<FsEvent> events) {
    for (const auto& event : events) {
        handle_event(event);
    }
}

void FileSyncMaster::handle_event(const FsEvent& event) {
    if (should_ignore_event(event, watch_root_)) {
        return;
    }

    append_final_events_for_raw_event(event);
}

void FileSyncMaster::handle_remote_events(std::vector<FileSyncRemoteEvent> events) {
    for (const auto& event : events) {
        handle_remote_event(event);
    }
}

void FileSyncMaster::handle_remote_event(const FileSyncRemoteEvent& event) {
    FileSyncFinalEvent final_event;
    final_event.change = event.change;
    final_event.pending_event.key = event.entry.entry_id;
    final_event.pending_event.new_path = event.entry.remote_path;
    final_event.pending_event.old_path = event.old_remote_path;
    final_event.data.is_dir = event.entry.is_dir;
    final_event.data.size = event.entry.size;
    final_event.data.mtime = event.entry.last_modified;
    final_event.data.content_hash = event.entry.checksum;
    append_final_event(std::move(final_event));
}

void FileSyncMaster::append_final_event(FileSyncFinalEvent event) {
    {
        std::lock_guard<std::mutex> lock(mu_);
        event.result = gate_.result(event);
        if (!should_emit_final_event_locked(event)) {
            return;
        }
        final_events_.push_back(event);
    }
    log_final_event(event);
    if (running_.load()) {
        runner_->enqueue(event);
    }
}

void FileSyncMaster::append_final_events_for_raw_event(const FsEvent& event) {
    FsEvent normalized_event = event;
    if (normalized_event.effect != FsEventEffect::RENAMED && !fs::exists(normalized_event.new_path)) {
        normalized_event.effect = FsEventEffect::DELETED;
    }

    if (normalized_event.effect == FsEventEffect::RENAMED) {
        const bool new_path_in_root =
            !normalized_event.new_path.empty() && path_under_root(watch_root_, normalized_event.new_path);
        const bool old_path_in_root =
            !normalized_event.old_path.empty() && path_under_root(watch_root_, normalized_event.old_path);

        if (old_path_in_root && !new_path_in_root) {
            FsEvent delete_event = normalized_event;
            delete_event.effect = FsEventEffect::DELETED;
            delete_event.new_path = normalize_path(normalized_event.old_path);
            delete_event.old_path.clear();

            FileSyncPendingEvent delete_pending;
            delete_pending.key = normalize_path(delete_event.new_path);
            delete_pending.new_path = normalize_path(delete_event.new_path);
            delete_pending.events.push_back(delete_event);
            append_final_event(coalesce_pending_event(delete_pending));
            return;
        }

        if (new_path_in_root && !old_path_in_root) {
            normalized_event.effect = FsEventEffect::CREATED;
            normalized_event.old_path.clear();
        }
    }

    FileSyncPendingEvent pending;
    pending.key = key_for_event(normalized_event);
    pending.new_path = normalize_path(normalized_event.new_path);
    pending.old_path = normalized_event.old_path.empty() ? "" : normalize_path(normalized_event.old_path);
    pending.events.push_back(normalized_event);

    const bool is_missing_rename =
        normalized_event.effect == FsEventEffect::RENAMED &&
        !pending.old_path.empty() &&
        !fs::exists(pending.new_path);

    if (is_missing_rename) {
        FsEvent old_delete = normalized_event;
        old_delete.effect = FsEventEffect::DELETED;
        old_delete.new_path = pending.old_path;
        old_delete.old_path.clear();

        FileSyncPendingEvent old_pending;
        old_pending.key = normalize_path(old_delete.new_path);
        old_pending.new_path = normalize_path(old_delete.new_path);
        old_pending.events.push_back(old_delete);
        append_final_event(coalesce_pending_event(old_pending));

        FsEvent new_delete = normalized_event;
        new_delete.effect = FsEventEffect::DELETED;
        new_delete.new_path = pending.new_path;
        new_delete.old_path.clear();

        FileSyncPendingEvent new_pending;
        new_pending.key = normalize_path(new_delete.new_path);
        new_pending.new_path = normalize_path(new_delete.new_path);
        new_pending.events.push_back(new_delete);
        append_final_event(coalesce_pending_event(new_pending));
        return;
    }

    append_final_event(coalesce_pending_event(pending));
}

FileSyncFinalEvent FileSyncMaster::coalesce_pending_event(const FileSyncPendingEvent& pending) const {
    FileSyncFinalEvent final_event;
    final_event.pending_event = pending;
    final_event.change = FileSyncChange::Noop;

    if (pending.events.empty() || pending.new_path.empty()) {
        return final_event;
    }

    const bool saw_delete_event = saw_effect(pending, FsEventEffect::DELETED);
    const bool saw_rename_event = saw_effect(pending, FsEventEffect::RENAMED);
    std::error_code ec;
    const bool exists = fs::exists(pending.new_path, ec);

    const bool rename_from_finder_placeholder =
        saw_rename_event && !pending.old_path.empty() && is_finder_placeholder_path(pending.old_path);

    if (saw_delete_event && !exists) {
        final_event.change = FileSyncChange::LocalDelete;
    } else if (saw_rename_event && !pending.old_path.empty() && exists && !rename_from_finder_placeholder) {
        final_event.change = FileSyncChange::LocalRename;
    } else if (!exists) {
        final_event.change = FileSyncChange::LocalDelete;
    } else {
        const bool is_dir = fs::is_directory(pending.new_path, ec);
        final_event.change = is_dir ? FileSyncChange::LocalFolder : FileSyncChange::LocalFile;
    }

    if (exists) {
        final_event.data.is_dir = fs::is_directory(pending.new_path, ec);
        if (!final_event.data.is_dir) {
            final_event.data.size = static_cast<int64_t>(fs::file_size(pending.new_path, ec));
            if (ec) {
                final_event.data.size = 0;
                ec.clear();
            }
        }
    }

    if (final_event.change == FileSyncChange::LocalFile && !final_event.data.is_dir) {
        final_event.data.content_hash = content_hash_for_path(pending.new_path);
    }

    return final_event;
}

bool FileSyncMaster::should_emit_final_event_locked(const FileSyncFinalEvent& event) {
    const std::string& path = event.pending_event.new_path;
    if (path.empty()) {
        return false;
    }

    if (event.result.action == FileSyncAction::Noop ||
        event.result.action == FileSyncAction::Conflict) {
        return event.result.action == FileSyncAction::Conflict;
    }

    if (event.result.action == FileSyncAction::UploadLocal) {
        known_local_paths_.insert(path);
        return true;
    }

    if (event.change == FileSyncChange::LocalFolder) {
        known_local_paths_.insert(path);
    }

    if (event.result.action == FileSyncAction::DeleteRemote) {
        known_local_paths_.erase(path);
    } else if (event.result.action == FileSyncAction::RenameRemote) {
        known_local_paths_.erase(event.pending_event.old_path);
        known_local_paths_.insert(path);
    }

    return true;
}

void FileSyncMaster::reconcile_loop() {
    while (running_.load()) {
        std::unique_lock<std::mutex> lock(mu_);
        reconcile_cv_.wait_for(lock, 750ms, [this] {
            return !running_.load();
        });
        lock.unlock();

        if (!running_.load()) {
            break;
        }
        reconcile_missing_paths();
    }
}

void FileSyncMaster::reconcile_missing_paths() {
    std::vector<std::string> missing_paths;
    {
        std::lock_guard<std::mutex> lock(mu_);
        missing_paths.reserve(known_local_paths_.size());
        for (const auto& path : known_local_paths_) {
            std::error_code ec;
            if (!fs::exists(path, ec)) {
                missing_paths.push_back(path);
            }
        }
    }

    for (const auto& path : missing_paths) {
        FsEvent delete_event;
        delete_event.new_path = path;
        delete_event.effect = FsEventEffect::DELETED;

        FileSyncPendingEvent pending;
        pending.key = path;
        pending.new_path = path;
        pending.events.push_back(std::move(delete_event));
        append_final_event(coalesce_pending_event(pending));
    }
}

void FileSyncMaster::log_final_event(const FileSyncFinalEvent& event) const {
    const auto& pending = event.pending_event;
    std::cout << "[FileSyncMaster] final change=" << change_label(event.change)
              << " key=" << pending.key
              << " old_path=" << pending.old_path
              << " new_path=" << pending.new_path
              << " is_dir=" << (event.data.is_dir ? "true" : "false")
              << " size=" << event.data.size
              << " source_events=" << pending.events.size();

    if (!pending.events.empty()) {
        std::cout << " [";
        for (std::size_t i = 0; i < pending.events.size(); ++i) {
            if (i > 0) {
                std::cout << ",";
            }
            std::cout << event_label(pending.events[i].effect);
        }
        std::cout << "]";
    }

    std::cout << std::endl;
}

} // namespace misty::core
