#pragma once

#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include "core/file_sync/fs_watcher.h"

namespace misty::core {

    /**
     * @brief Final file sync operation selected after raw filesystem events are coalesced.
     */
    enum class FileSyncOperation {
        UploadFile,
        CreateFolder,
        DeleteRemote,
        RenameRemote,
        Noop,
    };

    /**
     * @brief Accumulated raw filesystem events for one debounce key.
     */
    struct FileSyncPendingEvent {
        std::string key;
        std::string old_path;
        std::string new_path;
        std::vector<FsEvent> events;
    };

    /**
     * @brief One final sync decision produced from a pending event group.
     */
    struct FileSyncFinalEvent {
        FileSyncPendingEvent pending_event;
        FileSyncOperation operation = FileSyncOperation::Noop;
        bool is_dir = false;
        int64_t size = 0;
        std::string mtime;
    };

    /**
     * @brief Owns the file sync watcher and coalesces raw filesystem events into final operations.
     */
    class FileSync final {
    public:
        explicit FileSync(std::string watch_root);
        ~FileSync();

        void start();
        void stop();

#ifdef MISTY_TESTING
        void handle_event_for_test(const FsEvent& event);
        void process_ready_events_for_test();
        FileSyncFinalEvent coalesce_pending_event_for_test(const FileSyncPendingEvent& pending) const;
        std::vector<FileSyncFinalEvent> final_events_for_test() const;
#endif

    private:
        void handle_events(std::vector<FsEvent> events);
        void handle_event(const FsEvent& event);
        void append_final_event(const FileSyncFinalEvent& event);
        void append_final_events_for_raw_event(const FsEvent& event);
        FileSyncFinalEvent coalesce_pending_event(const FileSyncPendingEvent& pending) const;
        bool should_emit_final_event_locked(const FileSyncFinalEvent& event);
        void log_final_event(const FileSyncFinalEvent& event) const;

        FsWatcher watcher_;
        std::string watch_root_;
        std::atomic<bool> running_{false};
        mutable std::mutex mu_;
        std::vector<FileSyncFinalEvent> final_events_;
        std::unordered_map<std::string, std::string> upload_fingerprints_;
    };

} // namespace misty::core
