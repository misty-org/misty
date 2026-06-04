#include "panels/file_explorer/operations/file_operation_jobs.h"

#include <utility>

namespace misty::panel {

namespace {

constexpr float kJobToastDurationSeconds = 3.0f;

std::string start_message(uint64_t job_id) {
    return "Starting job " + std::to_string(job_id);
}

std::string success_message(uint64_t job_id) {
    return "Job " + std::to_string(job_id) + " completed";
}

std::string failure_message(uint64_t job_id, const std::string& reason) {
    std::string message = "Job " + std::to_string(job_id) + " failed";
    if (!reason.empty()) {
        message += ": " + reason;
    }
    return message;
}

NotificationState& notification_state(core::StateRegistry& registry) {
    return registry.get_state<NotificationState>("Notifications");
}

FileOperationJobs& jobs_state(core::StateRegistry& registry) {
    return registry.get_state<FileOperationJobs>(kFileOperationJobsStateKey);
}

}  // namespace

uint64_t FileOperationJobs::begin_job(NotificationState& notifications, const std::string& operation_label) {
    const uint64_t job_id = next_job_id_.fetch_add(1);
    FileOperationJobRecord record;
    record.job_id = job_id;
    record.operation_label = operation_label;
    record.notification_id = notifications.add_toast(
        start_message(job_id),
        kJobToastDurationSeconds,
        NotificationType::INFO);

    std::lock_guard<std::mutex> lock(mu_);
    jobs_.emplace(job_id, std::move(record));
    return job_id;
}

void FileOperationJobs::add_operation(uint64_t job_id) {
    if (job_id == 0) {
        return;
    }

    std::lock_guard<std::mutex> lock(mu_);
    auto it = jobs_.find(job_id);
    if (it == jobs_.end()) {
        return;
    }
    ++it->second.expected_count;
}

void FileOperationJobs::cancel_operation(NotificationState& notifications, uint64_t job_id) {
    if (job_id == 0) {
        return;
    }

    std::lock_guard<std::mutex> lock(mu_);
    auto it = jobs_.find(job_id);
    if (it == jobs_.end()) {
        return;
    }
    if (it->second.expected_count > it->second.finished_count) {
        --it->second.expected_count;
    }
    complete_if_ready_locked(notifications, job_id);
}

void FileOperationJobs::close_job(NotificationState& notifications, uint64_t job_id) {
    if (job_id == 0) {
        return;
    }

    std::lock_guard<std::mutex> lock(mu_);
    auto it = jobs_.find(job_id);
    if (it == jobs_.end()) {
        return;
    }
    it->second.dispatch_closed = true;
    complete_if_ready_locked(notifications, job_id);
}

void FileOperationJobs::finish_operation(NotificationState& notifications,
                                         uint64_t job_id,
                                         bool success,
                                         const std::string& error_message) {
    if (job_id == 0) {
        return;
    }

    std::lock_guard<std::mutex> lock(mu_);
    auto it = jobs_.find(job_id);
    if (it == jobs_.end()) {
        return;
    }

    ++it->second.finished_count;
    if (!success) {
        ++it->second.failure_count;
        if (it->second.first_error.empty()) {
            it->second.first_error = error_message;
        }
    }
    complete_if_ready_locked(notifications, job_id);
}

void FileOperationJobs::complete_if_ready_locked(NotificationState& notifications, uint64_t job_id) {
    auto it = jobs_.find(job_id);
    if (it == jobs_.end() || !it->second.dispatch_closed) {
        return;
    }

    FileOperationJobRecord& job = it->second;
    if (job.expected_count == 0) {
        notifications.dismiss(job.notification_id);
        jobs_.erase(it);
        return;
    }
    if (job.finished_count < job.expected_count) {
        return;
    }

    const bool failed = job.failure_count > 0;
    const std::string message = failed ? failure_message(job_id, job.first_error) : success_message(job_id);
    const NotificationType type = failed ? NotificationType::ERROR : NotificationType::SUCCESS;
    if (!notifications.update_toast(job.notification_id, message, kJobToastDurationSeconds, type)) {
        notifications.add_toast(message, kJobToastDurationSeconds, type);
    }
    jobs_.erase(it);
}

uint64_t begin_file_operation_job(core::StateRegistry& registry,
                                  const std::string& operation_label) {
    return jobs_state(registry).begin_job(notification_state(registry), operation_label);
}

void add_file_operation_to_job(core::StateRegistry& registry, uint64_t job_id) {
    jobs_state(registry).add_operation(job_id);
}

void cancel_file_operation_in_job(core::StateRegistry& registry, uint64_t job_id) {
    jobs_state(registry).cancel_operation(notification_state(registry), job_id);
}

void close_file_operation_job(core::StateRegistry& registry, uint64_t job_id) {
    jobs_state(registry).close_job(notification_state(registry), job_id);
}

void finish_file_operation_job(core::StateRegistry& registry,
                               uint64_t job_id,
                               bool success,
                               const std::string& error_message) {
    jobs_state(registry).finish_operation(notification_state(registry), job_id, success, error_message);
}

}  // namespace misty::panel
