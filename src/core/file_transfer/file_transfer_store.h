#pragma once

#include <cstddef>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "core/file_transfer/file_transfer.h"

namespace misty::core {

class FileTransferStore {
public:
    static FileTransferStore& get();

    FileTransferStore();
    ~FileTransferStore();

    bool initialize(std::string* error = nullptr);
    std::vector<FileTransferRecord> load_recent(std::size_t limit, std::string* error = nullptr);
    FileTransferPage load_page(std::size_t limit,
                               std::size_t offset,
                               const std::string& search_query = {},
                               std::string* error = nullptr);
    bool upsert(const FileTransferRecord& record, std::string* error = nullptr);
    bool delete_by_id(uint64_t id, std::string* error = nullptr);
    bool delete_all(std::string* error = nullptr);
    bool delete_completed(std::string* error = nullptr);
    bool delete_failed_like(std::string* error = nullptr);
    bool prune_history(std::size_t limit, std::string* error = nullptr);
    uint64_t next_transfer_id(std::string* error = nullptr);
    void schedule_upsert(const FileTransferRecord& record);
    void schedule_delete_by_id(uint64_t id);
    void schedule_delete_all();
    void schedule_delete_completed();
    void schedule_delete_failed_like();
    void flush();
    void reset_for_testing();

private:
    FileTransferStore(const FileTransferStore&) = delete;
    FileTransferStore& operator=(const FileTransferStore&) = delete;

    enum class PendingWriteKind {
        Upsert,
        DeleteById,
        DeleteAll,
        DeleteCompleted,
        DeleteFailedLike,
    };

    struct PendingWrite {
        PendingWriteKind kind = PendingWriteKind::Upsert;
        FileTransferRecord record;
        uint64_t id = 0;
    };

    bool upsert_sync(const FileTransferRecord& record, std::string* error = nullptr);
    bool delete_by_id_sync(uint64_t id, std::string* error = nullptr);
    bool delete_all_sync(std::string* error = nullptr);
    bool delete_completed_sync(std::string* error = nullptr);
    bool delete_failed_like_sync(std::string* error = nullptr);
    bool prune_history_sync(std::size_t limit, std::string* error = nullptr);
    uint64_t next_transfer_id_sync(std::string* error = nullptr);
    void ensure_worker_started();
    void stop_worker();
    void worker_loop();

    std::string session_id_;
    std::mutex queue_mu_;
    std::condition_variable queue_cv_;
    std::deque<PendingWrite> pending_writes_;
    std::thread worker_thread_;
    bool worker_started_ = false;
    bool stop_worker_ = false;
    bool worker_busy_ = false;
};

}  // namespace misty::core
