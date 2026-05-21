#include "core/file_sync/file_sync.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <optional>
#include <utility>

#include "core/system/util.h"

#define XXH_INLINE_ALL
#include <xxhash.h>

namespace fs = std::filesystem;

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
    if (event.path.empty() || !path_under_root(watch_root, event.path)) {
        return true;
    }

    const std::string normalized_path = normalize_path(event.path);
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

    return event.kind == FsEventKind::CREATED && starts_with(lower_name, "untitled");
}

bool is_finder_placeholder_path(const std::string& path) {
    const std::string name = path_utf8_filename(normalize_path(path));
    return starts_with(lower_copy(name), "untitled");
}

std::string key_for_event(const FsEvent& event) {
    if (event.kind == FsEventKind::RENAMED && !event.old_path.empty()) {
        return normalize_path(event.old_path) + "->" + normalize_path(event.path);
    }
    return normalize_path(event.path);
}

const char* operation_label(FileSyncOperation operation) {
    switch (operation) {
        case FileSyncOperation::UploadFile:
            return "UploadFile";
        case FileSyncOperation::CreateFolder:
            return "CreateFolder";
        case FileSyncOperation::DeleteRemote:
            return "DeleteRemote";
        case FileSyncOperation::RenameRemote:
            return "RenameRemote";
        case FileSyncOperation::Noop:
            return "Noop";
    }
    return "Unknown";
}

const char* event_label(FsEventKind kind) {
    switch (kind) {
        case FsEventKind::CREATED:
            return "CREATED";
        case FsEventKind::MODIFIED:
            return "MODIFIED";
        case FsEventKind::DELETED:
            return "DELETED";
        case FsEventKind::RENAMED:
            return "RENAMED";
    }
    return "UNKNOWN";
}

bool saw_kind(const FileSyncPendingEvent& pending, FsEventKind kind) {
    return std::any_of(pending.events.begin(), pending.events.end(), [kind](const FsEvent& event) {
        return event.kind == kind;
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

std::string upload_fingerprint_for(const FileSyncFinalEvent& event) {
    const auto hash = xxh3_file(event.pending_event.new_path);
    if (!hash) {
        return std::to_string(event.size) + "|unreadable|" + event.pending_event.new_path;
    }
    return std::to_string(event.size) + "|" + std::to_string(*hash);
}

} // namespace

FileSync::FileSync(std::string watch_root)
    : watch_root_(std::move(watch_root)) {}

FileSync::~FileSync() {
    stop();
}

void FileSync::start() {
    if (watch_root_.empty() || running_.exchange(true)) {
        return;
    }

    std::error_code ec;
    fs::create_directories(watch_root_, ec);
    if (ec) {
        running_.store(false);
        std::cout << "[FileSync] failed to create watch root path=" << watch_root_
                  << " error=" << ec.message() << std::endl;
        return;
    }

    {
        std::lock_guard<std::mutex> lock(mu_);
        final_events_.clear();
        upload_fingerprints_.clear();
    }

    if (!watcher_.fs_watcher_start(watch_root_, [this](std::vector<FsEvent> events) {
        handle_events(std::move(events));
    })) {
        running_.store(false);
        std::cout << "[FileSync] failed to start watcher path=" << watch_root_ << std::endl;
        return;
    }

    std::cout << "[FileSync] started path=" << watch_root_ << std::endl;
}

void FileSync::stop() {
    if (!running_.exchange(false)) {
        return;
    }

    watcher_.fs_watcher_stop();
}

#ifdef MISTY_TESTING
void FileSync::handle_event_for_test(const FsEvent& event) {
    handle_event(event);
}

void FileSync::process_ready_events_for_test() {
    // FileSync no longer debounces events, so test callers do not need to flush anything.
}

FileSyncFinalEvent FileSync::coalesce_pending_event_for_test(const FileSyncPendingEvent& pending) const {
    return coalesce_pending_event(pending);
}

std::vector<FileSyncFinalEvent> FileSync::final_events_for_test() const {
    std::lock_guard<std::mutex> lock(mu_);
    return final_events_;
}
#endif

void FileSync::handle_events(std::vector<FsEvent> events) {
    for (const auto& event : events) {
        handle_event(event);
    }
}

void FileSync::handle_event(const FsEvent& event) {
    if (should_ignore_event(event, watch_root_)) {
        return;
    }

    append_final_events_for_raw_event(event);
}

void FileSync::append_final_event(const FileSyncFinalEvent& event) {
    {
        std::lock_guard<std::mutex> lock(mu_);
        if (!should_emit_final_event_locked(event)) {
            return;
        }
        final_events_.push_back(event);
    }
    log_final_event(event);
}

void FileSync::append_final_events_for_raw_event(const FsEvent& event) {
    FileSyncPendingEvent pending;
    pending.key = key_for_event(event);
    pending.new_path = normalize_path(event.path);
    pending.old_path = event.old_path.empty() ? "" : normalize_path(event.old_path);
    pending.events.push_back(event);

    const bool is_missing_rename =
        event.kind == FsEventKind::RENAMED &&
        !pending.old_path.empty() &&
        !fs::exists(pending.new_path);

    if (is_missing_rename) {
        FsEvent old_delete = event;
        old_delete.kind = FsEventKind::DELETED;
        old_delete.path = pending.old_path;
        old_delete.old_path.clear();

        FileSyncPendingEvent old_pending;
        old_pending.key = normalize_path(old_delete.path);
        old_pending.new_path = normalize_path(old_delete.path);
        old_pending.events.push_back(old_delete);
        append_final_event(coalesce_pending_event(old_pending));

        FsEvent new_delete = event;
        new_delete.kind = FsEventKind::DELETED;
        new_delete.path = pending.new_path;
        new_delete.old_path.clear();

        FileSyncPendingEvent new_pending;
        new_pending.key = normalize_path(new_delete.path);
        new_pending.new_path = normalize_path(new_delete.path);
        new_pending.events.push_back(new_delete);
        append_final_event(coalesce_pending_event(new_pending));
        return;
    }

    append_final_event(coalesce_pending_event(pending));
}

FileSyncFinalEvent FileSync::coalesce_pending_event(const FileSyncPendingEvent& pending) const {
    FileSyncFinalEvent final_event;
    final_event.pending_event = pending;
    final_event.operation = FileSyncOperation::Noop;

    if (pending.events.empty() || pending.new_path.empty()) {
        return final_event;
    }

    const bool saw_delete_event = saw_kind(pending, FsEventKind::DELETED);
    const bool saw_rename_event = saw_kind(pending, FsEventKind::RENAMED);
    std::error_code ec;
    const bool exists = fs::exists(pending.new_path, ec);

    const bool rename_from_finder_placeholder =
        saw_rename_event && !pending.old_path.empty() && is_finder_placeholder_path(pending.old_path);

    if (saw_delete_event && !exists) {
        final_event.operation = FileSyncOperation::DeleteRemote;
    } else if (saw_rename_event && !pending.old_path.empty() && exists && !rename_from_finder_placeholder) {
        final_event.operation = FileSyncOperation::RenameRemote;
    } else if (!exists) {
        final_event.operation = FileSyncOperation::DeleteRemote;
    } else {
        const bool is_dir = fs::is_directory(pending.new_path, ec);
        final_event.operation = is_dir ? FileSyncOperation::CreateFolder : FileSyncOperation::UploadFile;
    }

    if (exists) {
        final_event.is_dir = fs::is_directory(pending.new_path, ec);
        if (!final_event.is_dir) {
            final_event.size = static_cast<int64_t>(fs::file_size(pending.new_path, ec));
            if (ec) {
                final_event.size = 0;
                ec.clear();
            }
        }

        const auto& latest = pending.events.back();
        final_event.mtime = latest.mtime;
    }

    return final_event;
}

bool FileSync::should_emit_final_event_locked(const FileSyncFinalEvent& event) {
    const std::string& path = event.pending_event.new_path;
    if (path.empty()) {
        return false;
    }

    if (event.operation == FileSyncOperation::UploadFile) {
        const std::string fingerprint = upload_fingerprint_for(event);
        auto [it, inserted] = upload_fingerprints_.emplace(path, fingerprint);
        if (!inserted && it->second == fingerprint) {
            return false;
        }
        it->second = fingerprint;
        return true;
    }

    if (event.operation == FileSyncOperation::DeleteRemote) {
        upload_fingerprints_.erase(path);
    } else if (event.operation == FileSyncOperation::RenameRemote) {
        upload_fingerprints_.erase(event.pending_event.old_path);
        upload_fingerprints_.erase(path);
    }

    return event.operation != FileSyncOperation::Noop;
}

void FileSync::log_final_event(const FileSyncFinalEvent& event) const {
    const auto& pending = event.pending_event;
    std::cout << "[FileSync] final operation=" << operation_label(event.operation)
              << " key=" << pending.key
              << " old_path=" << pending.old_path
              << " new_path=" << pending.new_path
              << " is_dir=" << (event.is_dir ? "true" : "false")
              << " size=" << event.size
              << " source_events=" << pending.events.size();

    if (!pending.events.empty()) {
        std::cout << " [";
        for (std::size_t i = 0; i < pending.events.size(); ++i) {
            if (i > 0) {
                std::cout << ",";
            }
            std::cout << event_label(pending.events[i].kind);
        }
        std::cout << "]";
    }

    std::cout << std::endl;
}

} // namespace misty::core
