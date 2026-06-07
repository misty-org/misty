#pragma once

#include <chrono>
#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "core/file_master/file_master.h"
#include "core/file_transfer/file_transfer.h"
#include "core/threading/worker_pool.h"
#include "core/ui/state_registry.h"
#include "imgui.h"
#include "panels/file_explorer/state/clipboard_state.h"
#include "panels/file_explorer/state/file_listings_state.h"

namespace misty::panel {

inline constexpr const char* kOperationQueueStateKey = "OperationQueue";

enum class OperationKind {
    Copy,
    Move,
    Rename,
    Delete,
    Download,
};

enum class ConflictPolicy {
    Ask,
    Replace,
    Skip,
    KeepBoth,
};

enum class OperationStatus {
    Queued,
    InProgress,
    WaitingForResolution,
    Completed,
    Failed,
    Canceled,
    Skipped,
};

struct OperationEndpoint {
    std::string local_path;
    std::string remote_name;
    std::string remote_path;

    bool is_remote() const;
    std::string display() const;
};

struct RenameExecutionRequest {
    std::string owner_state_key;
    std::string directory_path;
    FileItem item;
    std::string new_name;
};

struct UndoRecord {
    uint64_t undo_id = 0;
    uint64_t source_transfer_id = 0;
    OperationKind kind = OperationKind::Rename;
    FileItem item;
    ClipboardOp clipboard_op = ClipboardOp::NONE;
    std::string dest_dir;
    std::string rename_new_name;
    std::string summary;
    std::chrono::steady_clock::time_point created_at{};
    std::chrono::steady_clock::time_point expires_at{};
};

enum class OperationPayloadKind {
    Clipboard,
    Rename,
    Delete,
    Download,
};

struct OperationPayload {
    OperationPayloadKind kind = OperationPayloadKind::Clipboard;
    FileItem item;
    ClipboardOp clipboard_op = ClipboardOp::NONE;
    std::string owner_state_key;
    std::string source_state_key;
    std::string dest_dir;
    std::string rename_new_name;
    std::string override_name;
};

struct OperationDescriptor {
    uint64_t transfer_id = 0;
    uint64_t batch_id = 0;
    OperationKind kind = OperationKind::Copy;
    OperationPayload payload;
    OperationEndpoint source;
    OperationEndpoint target;
    ConflictPolicy conflict_policy = ConflictPolicy::Ask;
    bool preserve_order = false;
    bool waiting_for_conflict = false;
    bool retryable = true;
    bool cancelable = true;
    bool undoable = false;
    bool supports_replace = true;
    bool supports_keep_both = false;
    std::string title;
    std::function<void(const core::FileMasterResult&)> on_complete;
};

struct OperationBatch {
    uint64_t batch_id = 0;
    std::string label;
    bool preserve_order = false;
    bool paused = false;
    uint64_t paused_transfer_id = 0;
    std::vector<uint64_t> operation_ids;
};

struct ConflictDialogState {
    bool open = false;
    uint64_t transfer_id = 0;
    uint64_t batch_id = 0;
    bool apply_to_batch = true;
    bool supports_keep_both = false;
    ConflictPolicy selected_policy = ConflictPolicy::Replace;
    std::string title;
    std::string source_label;
    std::string target_label;
};

class OperationQueueState : public core::StateEntry {
public:
    std::unordered_map<uint64_t, OperationDescriptor> operations;
    std::unordered_map<uint64_t, OperationBatch> batches;
    std::unordered_map<uint64_t, UndoRecord> undo_records;
    std::deque<uint64_t> pending_order;
    ConflictDialogState conflict_dialog;
    std::size_t active_count = 0;
    std::size_t max_concurrent = 2;
    uint64_t next_undo_id = 1;
    mutable std::mutex mu;
};

const char* conflict_policy_label(ConflictPolicy policy);
const char* operation_kind_label(OperationKind kind);

uint64_t enqueue_clipboard_operation_batch(core::StateRegistry& registry,
                                           core::WorkerPool& worker_pool,
                                           const std::string& owner_state_key,
                                           const std::vector<FileItem>& items,
                                           const std::string& dest_dir,
                                           ClipboardOp op,
                                           const std::string& source_state_key,
                                           std::function<void(const core::FileMasterResult&)> on_complete = {});

uint64_t enqueue_delete_operation_batch(core::StateRegistry& registry,
                                        core::WorkerPool& worker_pool,
                                        const std::string& owner_state_key,
                                        const std::vector<FileItem>& items,
                                        std::function<void(const core::FileMasterResult&)> on_complete = {});

uint64_t enqueue_download_operation(core::StateRegistry& registry,
                                    core::WorkerPool& worker_pool,
                                    const std::string& owner_state_key,
                                    const FileItem& item,
                                    std::function<void(const core::FileMasterResult&)> on_complete = {});

uint64_t enqueue_rename_operation_batch(core::StateRegistry& registry,
                                        core::WorkerPool& worker_pool,
                                        const std::vector<RenameExecutionRequest>& requests,
                                        std::function<void(const core::FileMasterResult&)> on_complete = {});
void enqueue_rename_operation_batch_async(core::StateRegistry& registry,
                                          core::WorkerPool& worker_pool,
                                          std::vector<RenameExecutionRequest> requests,
                                          std::function<void(const core::FileMasterResult&)> on_complete = {});

void pump_operation_queue(core::StateRegistry& registry, core::WorkerPool& worker_pool);
bool cancel_queued_operation(core::StateRegistry& registry, uint64_t transfer_id);
void cancel_queued_operation_async(core::StateRegistry& registry,
                                   core::WorkerPool& worker_pool,
                                   uint64_t transfer_id);
bool retry_operation(core::StateRegistry& registry, core::WorkerPool& worker_pool, uint64_t transfer_id);
void retry_operation_async(core::StateRegistry& registry,
                           core::WorkerPool& worker_pool,
                           uint64_t transfer_id);
bool undo_operation(core::StateRegistry& registry, core::WorkerPool& worker_pool, uint64_t undo_token_id);
void undo_operation_async(core::StateRegistry& registry,
                          core::WorkerPool& worker_pool,
                          uint64_t undo_token_id);
void rehydrate_persisted_undo_records(core::StateRegistry& registry);
void rehydrate_persisted_retry_operations(core::StateRegistry& registry);
void clear_completed_operations(core::StateRegistry& registry);
void clear_failed_operations(core::StateRegistry& registry);
void render_operation_conflict_modal(core::StateRegistry& registry, core::WorkerPool& worker_pool);

}  // namespace misty::panel
