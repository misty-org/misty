#include "core/file_master/file_master_remote.h"

namespace misty::core {

FileMasterRemote::FileMasterRemote(WorkerPool& worker_pool)
    : worker_pool_(worker_pool) {}

void FileMasterRemote::rename(const FileMasterProps&, FileMasterCompletion callback) {
    if (callback) {
        callback(FileMasterResult{false, "Remote rename is not implemented yet."});
    }
}

void FileMasterRemote::remove(const FileMasterProps&, FileMasterCompletion callback) {
    if (callback) {
        callback(FileMasterResult{false, "Remote remove is not implemented yet."});
    }
}

void FileMasterRemote::copy(const FileMasterProps&, FileMasterCompletion callback) {
    if (callback) {
        callback(FileMasterResult{false, "Remote copy is not implemented yet."});
    }
}

void FileMasterRemote::cut(const FileMasterProps&, FileMasterCompletion callback) {
    if (callback) {
        callback(FileMasterResult{false, "Remote cut is not implemented yet."});
    }
}

}  // namespace misty::core
