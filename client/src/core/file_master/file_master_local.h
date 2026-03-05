#pragma once

#include "core/file_master/file_master.h"
#include "core/threading/worker_pool.h"

/* This should support both same-device and cross-device file operations locally.
 * need to test extensively
 *
 *
 *
 */

namespace misty::core {

class FileMasterLocal : public IFileMaster {
public:
    explicit FileMasterLocal(WorkerPool& worker_pool);

    void rename(const FileMasterProps& props, FileMasterCompletion callback) override;
    void remove(const FileMasterProps& props, FileMasterCompletion callback) override;
    void copy(const FileMasterProps& props, FileMasterCompletion callback) override;
    void cut(const FileMasterProps& props, FileMasterCompletion callback) override;
    void list(const FileMasterProps& props, FileMasterCompletion callback) override;

private:
    WorkerPool& worker_pool_;
};

} // namespace misty::core
