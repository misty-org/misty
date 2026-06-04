#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <string>
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
    Pending,
    InProgress,
    Completed,
    Failed,
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
    std::string error_message;
    std::chrono::steady_clock::time_point started_at{};
    std::chrono::steady_clock::time_point completed_at{};

    bool is_alive() const;
};

class FileTransfer : public StateEntry {
public:
    static constexpr size_t kMaxHistory = 50;

    void set_local_context(uint64_t id, const std::string& local_path);
    void set_remote_context(uint64_t id, const std::string& remote_name, const std::string& remote_path);
    void update_progress(uint64_t id, int64_t transferred_bytes, int64_t total_bytes = -1);

    uint64_t start_transfer(FileTransferRecord snapshot);
    void complete_transfer(uint64_t id);

    void fail_transfer(uint64_t id, const std::string& error_message);
    void clear_completed();
    std::vector<FileTransferRecord> get_all_transfers() const;

private:
    void trim_history();

    mutable std::mutex mu_;
    std::unordered_map<uint64_t, FileTransferRecord> transfers_;
    std::vector<uint64_t> transfer_order_;
    std::atomic<uint64_t> next_id_{1};
};

}  // namespace misty::core
