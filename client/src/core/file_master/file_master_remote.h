#pragma once

#include <string>

#include "core/file_master/file_master.h"
#include "core/threading/worker_pool.h"

namespace misty::core {

class file_master_remote : public IFileMaster {
public:
    explicit file_master_remote(WorkerPool& worker_pool);

    void rename(const FileMasterProps& props, FileMasterCompletion callback) override;
    void remove(const FileMasterProps& props, FileMasterCompletion callback) override;
    void copy(const FileMasterProps& props, FileMasterCompletion callback) override;
    void cut(const FileMasterProps& props, FileMasterCompletion callback) override;

private:
    WorkerPool& worker_pool_;
};

} // namespace misty::core
