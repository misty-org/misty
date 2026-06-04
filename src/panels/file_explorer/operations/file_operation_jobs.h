#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <mutex>
#include <string>
#include <unordered_map>

#include "core/ui/state_registry.h"
#include "panels/notification/notification_state.h"

namespace misty::panel {

inline constexpr const char* kFileOperationJobsStateKey = "FileOperationJobs";

struct FileOperationJobRecord {
    uint64_t job_id = 0;
    uint64_t notification_id = 0;
    std::string operation_label;
    std::size_t expected_count = 0;
    std::size_t finished_count = 0;
    std::size_t failure_count = 0;
    std::string first_error;
    bool dispatch_closed = false;
};

class FileOperationJobs : public core::StateEntry {
public:
    uint64_t begin_job(NotificationState& notifications, const std::string& operation_label);
    void add_operation(uint64_t job_id);
    void cancel_operation(NotificationState& notifications, uint64_t job_id);
    void close_job(NotificationState& notifications, uint64_t job_id);
    void finish_operation(NotificationState& notifications,
                          uint64_t job_id,
                          bool success,
                          const std::string& error_message = {});

private:
    void complete_if_ready_locked(NotificationState& notifications, uint64_t job_id);

    std::mutex mu_;
    std::unordered_map<uint64_t, FileOperationJobRecord> jobs_;
    std::atomic<uint64_t> next_job_id_{1};
};

uint64_t begin_file_operation_job(core::StateRegistry& registry,
                                  const std::string& operation_label);
void add_file_operation_to_job(core::StateRegistry& registry, uint64_t job_id);
void cancel_file_operation_in_job(core::StateRegistry& registry, uint64_t job_id);
void close_file_operation_job(core::StateRegistry& registry, uint64_t job_id);
void finish_file_operation_job(core::StateRegistry& registry,
                               uint64_t job_id,
                               bool success,
                               const std::string& error_message = {});

}  // namespace misty::panel
