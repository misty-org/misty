#pragma once

#include <string>
#include <vector>

#include "core/file_sync/file_sync_compare.h"

namespace misty::core {

class FileSyncPairStore {
public:
    static FileSyncPairStore& get();

    bool initialize(std::string* error = nullptr);
    std::vector<FileSyncPair> load_all(std::string* error = nullptr);
    bool save(FileSyncPair& pair, std::string* error = nullptr);
    bool remove(int64_t pair_id, std::string* error = nullptr);
    void reset_for_testing();

private:
    FileSyncPairStore() = default;
    FileSyncPairStore(const FileSyncPairStore&) = delete;
    FileSyncPairStore& operator=(const FileSyncPairStore&) = delete;

    int64_t next_pair_id(std::string* error = nullptr);
};

}  // namespace misty::core
