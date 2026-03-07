#pragma once

#include <atomic>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_set>
#include <vector>

#include "core/file_sync/file_sync_gate.h"
#include "core/file_sync/file_sync_poller.h"
#include "file_sync_runner.h"

namespace misty::core {
    /**
     * @brief Owns the file sync watcher and coalesces raw filesystem events into final operations.
     */
    class FileSyncMaster final {
    public:
        explicit FileSyncMaster(std::string watch_root,
                                FileSyncPolicy mode = FileSyncPolicy::BiDirectional);
        ~FileSyncMaster();

        void sync_start();
        void sync_stop();

    private:
        void handle_events(std::vector<FsEvent> events);
        void handle_event(const FsEvent& event);
        void handle_remote_events(std::vector<FileSyncRemoteEvent> events);
        void handle_remote_event(const FileSyncRemoteEvent& event);
        void append_final_event(FileSyncFinalEvent event);
        void append_final_events_for_raw_event(const FsEvent& event);
        FileSyncFinalEvent coalesce_pending_event(const FileSyncPendingEvent& pending) const;
        bool should_emit_final_event_locked(const FileSyncFinalEvent& event);
        void reconcile_loop();
        void reconcile_missing_paths();
        void log_final_event(const FileSyncFinalEvent& event) const;

        FileSyncWatcher watcher_;
        FileSyncRemotePoller remote_poller_;
        std::unique_ptr<FileSyncRunner> runner_;
        std::string watch_root_;
        std::atomic<bool> running_{false};
        mutable std::mutex mu_;
        std::condition_variable reconcile_cv_;
        std::thread reconcile_thread_;
        std::vector<FileSyncFinalEvent> final_events_;
        FileSyncGate gate_;
        std::unordered_set<std::string> known_local_paths_;
    };

} // namespace misty::core
