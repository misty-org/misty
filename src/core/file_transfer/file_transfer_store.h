#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "core/file_transfer/file_transfer.h"

namespace misty::core {

class FileTransferStore {
public:
    static FileTransferStore& get();

    bool initialize(std::string* error = nullptr);
    std::vector<FileTransferRecord> load_recent(std::size_t limit, std::string* error = nullptr);
    bool upsert(const FileTransferRecord& record, std::string* error = nullptr);
    bool delete_completed(std::string* error = nullptr);
    bool delete_failed_like(std::string* error = nullptr);
    bool prune_history(std::size_t limit, std::string* error = nullptr);
    uint64_t next_transfer_id(std::string* error = nullptr);
    void reset_for_testing();

private:
    FileTransferStore() = default;
    ~FileTransferStore() = default;
    FileTransferStore(const FileTransferStore&) = delete;
    FileTransferStore& operator=(const FileTransferStore&) = delete;

    std::string session_id_;
};

}  // namespace misty::core
