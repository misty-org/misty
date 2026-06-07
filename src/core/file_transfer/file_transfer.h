#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include "core/ui/state_registry.h"

namespace misty::core {

enum class FileTransferItemType {
    Local,
    Remote
};

enum class FileTransferType {
    Upload,
    Download,
    Copy,
    Move,
    Rename,
    Delete,
};

enum class FileTransferStatus {
    Queued,
    Pending,
    InProgress,
    WaitingForResolution,
    Completed,
    Failed,
    Canceled,
    Skipped,
    Interrupted,
};

enum class FileTransferConflictPolicy {
    Ask,
    Replace,
    Skip,
    KeepBoth,
};

enum class FileTransferFilter {
    Active,
    All,
    Failed,
    Completed,
};

struct FileTransferRecord {
    uint64_t id = 0;
    FileTransferType transfer_type = FileTransferType::Upload;
    FileTransferItemType item_type = FileTransferItemType::Local;
    std::string file_name;
    std::string local_source_path;
    std::string local_dest_path;
    std::string remote_source_name;
    std::string remote_source_path;
    std::string remote_dest_name;
    std::string remote_dest_path;
    uint64_t job_id = 0;
    int64_t total_bytes = 0;
    int64_t transferred_bytes = 0;
    FileTransferStatus status = FileTransferStatus::Pending;
    FileTransferConflictPolicy conflict_policy = FileTransferConflictPolicy::Ask;
    std::string error_message;
    std::string detail_message;
    int64_t queued_at_ms = 0;
    int64_t started_at_ms = 0;
    int64_t completed_at_ms = 0;
    bool cancelable = false;
    bool retryable = false;
    bool undoable = false;
    uint64_t undo_token_id = 0;

    bool is_alive() const;
};

class FileTransfer : public StateEntry {
public:
    static constexpr size_t kMaxHistory = 500;
    using Listener = std::function<void(const FileTransferRecord&)>;

    ~FileTransfer();
    bool initialize_persistence(std::string* error = nullptr);
    bool initialize_persistence_metadata(std::string* error = nullptr);
    bool start_background_hydration(std::string* error = nullptr);
    bool poll_background_hydration(std::string* error = nullptr);
    uint64_t create_transfer(FileTransferRecord snapshot);
    uint64_t add_listener(Listener listener);
    void remove_listener(uint64_t listener_id);
    void set_local_context(uint64_t id, const std::string& local_path);
    void set_remote_context(uint64_t id, const std::string& remote_name, const std::string& remote_path);
    void update_progress(uint64_t id, int64_t transferred_bytes, int64_t total_bytes = -1);
    void update_detail(uint64_t id, const std::string& detail_message);
    void update_action_flags(uint64_t id,
                             bool cancelable,
                             bool retryable,
                             bool undoable,
                             uint64_t undo_token_id = 0);
    void update_conflict_policy(uint64_t id, FileTransferConflictPolicy conflict_policy);
    void mark_waiting_for_resolution(uint64_t id, const std::string& detail_message = {});
    void mark_started(uint64_t id);
    void cancel_transfer(uint64_t id, const std::string& detail_message = {});

    uint64_t start_transfer(FileTransferRecord snapshot);
    void complete_transfer(uint64_t id);

    void fail_transfer(uint64_t id, const std::string& error_message);
    void clear_completed();
    void clear_failed();
    std::vector<FileTransferRecord> get_all_transfers() const;
    bool get_transfer(uint64_t id, FileTransferRecord& out) const;

private:
    bool should_persist_progress_locked(const FileTransferRecord& record, int64_t now_ms);
    void persist_record_if_enabled(const FileTransferRecord& record);
    void hydrate_persisted_rows(std::vector<FileTransferRecord> rows, uint64_t next_id);
    void merge_persisted_rows(std::vector<FileTransferRecord> rows, uint64_t next_id);
    void stop_background_hydration();
    void trim_history();
    void notify_listeners(const FileTransferRecord& record) const;

    mutable std::mutex mu_;
    std::unordered_map<uint64_t, FileTransferRecord> transfers_;
    std::unordered_map<uint64_t, Listener> listeners_;
    std::unordered_map<uint64_t, int64_t> last_persisted_progress_at_ms_;
    std::vector<uint64_t> transfer_order_;
    std::atomic<uint64_t> next_id_{1};
    std::atomic<uint64_t> next_listener_id_{1};
    bool persistence_enabled_ = false;
    mutable std::mutex hydration_mu_;
    std::thread hydration_thread_;
    bool hydration_in_flight_ = false;
    bool hydration_ready_ = false;
    bool hydration_failed_ = false;
    bool hydration_started_ = false;
    std::string hydration_error_;
    std::vector<FileTransferRecord> pending_hydrated_rows_;
    uint64_t pending_hydrated_next_id_ = 1;
};

}  // namespace misty::core
