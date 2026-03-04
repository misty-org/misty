#pragma once

#include "file_master.h"
#include "core/file_transfer/file_transfer.h"
#include "core/threading/worker_pool.h"

namespace misty::core {

class FileMasterRemote : public IFileMaster {
public:
    FileMasterRemote(WorkerPool& worker_pool, FileTransfer& transfers);

    void rename(const FileMasterProps& props, FileMasterCompletion callback) override;
    void remove(const FileMasterProps& props, FileMasterCompletion callback) override;
    void copy(const FileMasterProps& props, FileMasterCompletion callback) override;
    void cut(const FileMasterProps& props, FileMasterCompletion callback) override;

private:
    WorkerPool& worker_pool_;
    FileTransfer& transfers_;
};

} // namespace misty::core
