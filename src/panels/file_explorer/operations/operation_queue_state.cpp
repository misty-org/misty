#include "panels/file_explorer/operations/operation_queue_state.h"

#include <algorithm>
#include <filesystem>
#include <optional>
#include <unordered_set>
#include <utility>

#include "core/file_master/file_master_util.h"
#include "imgui.h"
#include "panels/file_explorer/content/file_explorer_content_util.h"
#include "panels/file_explorer/operations/file_master_operations.h"
#include "panels/file_explorer/operations/file_operation_jobs.h"
#include "panels/file_explorer/state/library_state.h"
#include "panels/file_explorer/state/remote_mount_state.h"

namespace fs = std::filesystem;

namespace misty::panel {
namespace {

struct ConflictProbeResult {
    bool supported = false;
    bool conflict = false;
    bool supports_replace = true;
    bool supports_keep_both = false;
};

OperationQueueState& queue_state(core::StateRegistry& registry) {
    return registry.get_state<OperationQueueState>(kOperationQueueStateKey);
}

core::FileTransfer& transfer_state(core::StateRegistry& registry) {
    return registry.get_state<core::FileTransfer>("FileMasterTransfers");
}

core::FileTransferConflictPolicy to_transfer_conflict_policy(ConflictPolicy policy) {
    switch (policy) {
        case ConflictPolicy::Ask:
            return core::FileTransferConflictPolicy::Ask;
        case ConflictPolicy::Replace:
            return core::FileTransferConflictPolicy::Replace;
        case ConflictPolicy::Skip:
            return core::FileTransferConflictPolicy::Skip;
        case ConflictPolicy::KeepBoth:
            return core::FileTransferConflictPolicy::KeepBoth;
    }
    return core::FileTransferConflictPolicy::Ask;
}

OperationKind operation_kind_for(core::FileTransferType type) {
    switch (type) {
        case core::FileTransferType::Copy:
        case core::FileTransferType::Upload:
            return OperationKind::Copy;
        case core::FileTransferType::Move:
            return OperationKind::Move;
        case core::FileTransferType::Rename:
            return OperationKind::Rename;
        case core::FileTransferType::Delete:
            return OperationKind::Delete;
        case core::FileTransferType::Download:
            return OperationKind::Download;
    }
    return OperationKind::Copy;
}

core::FileTransferType transfer_type_for(const OperationDescriptor& op) {
    switch (op.kind) {
        case OperationKind::Copy:
            if (op.payload.kind == OperationPayloadKind::Clipboard &&
                op.payload.item.type == FileType::LOCAL &&
                remote_browse_target_for(op.payload.dest_dir).has_value()) {
                return core::FileTransferType::Upload;
            }
            return core::FileTransferType::Copy;
        case OperationKind::Move:
            if (op.payload.kind == OperationPayloadKind::Clipboard &&
                op.payload.item.type == FileType::LOCAL &&
                remote_browse_target_for(op.payload.dest_dir).has_value()) {
                return core::FileTransferType::Upload;
            }
            return core::FileTransferType::Move;
        case OperationKind::Rename:
            return core::FileTransferType::Rename;
        case OperationKind::Delete:
            return core::FileTransferType::Delete;
        case OperationKind::Download:
            return core::FileTransferType::Download;
    }
    return core::FileTransferType::Copy;
}

std::string target_name_for(const OperationPayload& payload) {
    if (!payload.override_name.empty()) {
        return payload.override_name;
    }
    if (payload.kind == OperationPayloadKind::Rename) {
        return payload.rename_new_name;
    }
    return payload.item.name;
}

std::string join_remote_child(const std::string& parent, const std::string& name) {
    fs::path path(parent);
    path /= name;
    std::string out = path.generic_string();
    if (out.empty() || out.front() != '/') {
        out.insert(out.begin(), '/');
    }
    return out;
}

OperationEndpoint source_endpoint_for(const OperationPayload& payload) {
    OperationEndpoint endpoint;
    if (is_remote_file_master_item(payload.item)) {
        endpoint.remote_name = payload.item.sync_remote_name;
        endpoint.remote_path = payload.item.sync_remote_path;
    } else {
        endpoint.local_path = payload.item.path;
    }
    return endpoint;
}

OperationEndpoint target_endpoint_for(const OperationPayload& payload) {
    OperationEndpoint endpoint;
    const std::string target_name = target_name_for(payload);
    switch (payload.kind) {
        case OperationPayloadKind::Clipboard: {
            if (auto remote_target = remote_browse_target_for(payload.dest_dir); remote_target.has_value()) {
                endpoint.remote_name = remote_target->remote_name;
                endpoint.remote_path = join_remote_child(remote_target->remote_path, target_name);
            } else {
                endpoint.local_path = (fs::path(payload.dest_dir) / target_name).string();
            }
            break;
        }
        case OperationPayloadKind::Rename: {
            if (is_remote_file_master_item(payload.item)) {
                endpoint.remote_name = payload.item.sync_remote_name;
                endpoint.remote_path = join_remote_child(fs::path(payload.item.sync_remote_path).parent_path().generic_string(),
                                                         target_name);
            } else {
                endpoint.local_path = (fs::path(payload.item.path).parent_path() / target_name).string();
            }
            break;
        }
        case OperationPayloadKind::Delete:
            break;
        case OperationPayloadKind::Download:
            endpoint.local_path = (fs::path(payload.item.path).parent_path() / target_name).string();
            break;
    }
    return endpoint;
}

bool same_endpoint(const OperationEndpoint& lhs, const OperationEndpoint& rhs) {
    return lhs.local_path == rhs.local_path &&
           lhs.remote_name == rhs.remote_name &&
           lhs.remote_path == rhs.remote_path;
}

std::pair<std::string, std::string> split_name_for_copy_suffix(const std::string& name, bool is_dir) {
    if (is_dir) {
        return {name, {}};
    }
    const std::size_t dot = name.rfind('.');
    if (dot == std::string::npos || dot == 0) {
        return {name, {}};
    }
    return {name.substr(0, dot), name.substr(dot)};
}

bool remote_entry_exists(const OperationEndpoint& endpoint) {
    if (!endpoint.is_remote()) {
        return false;
    }
    core::FileMasterProps props;
    props.remote_source.remote_name = endpoint.remote_name;
    props.remote_source.remote_path = fs::path(endpoint.remote_path).parent_path().generic_string();
    if (props.remote_source.remote_path.empty()) {
        props.remote_source.remote_path = "/";
    }
    std::vector<core::FileMasterListItem> items;
    if (!core::list_remote_path(props, items).success) {
        return false;
    }
    const std::string filename = fs::path(endpoint.remote_path).filename().string();
    return std::any_of(items.begin(), items.end(), [&](const core::FileMasterListItem& item) {
        return item.name == filename;
    });
}

bool endpoint_exists(const OperationEndpoint& endpoint) {
    if (endpoint.is_remote()) {
        return remote_entry_exists(endpoint);
    }
    std::error_code ec;
    return !endpoint.local_path.empty() && fs::exists(endpoint.local_path, ec) && !ec;
}

bool remove_endpoint_for_replace(const OperationEndpoint& endpoint) {
    if (endpoint.is_remote()) {
        core::FileMasterProps props;
        props.remote_source.remote_name = endpoint.remote_name;
        props.remote_source.remote_path = endpoint.remote_path;
        return core::remove_remote_path(props).success;
    }

    std::error_code ec;
    fs::remove_all(endpoint.local_path, ec);
    return !ec;
}

std::optional<std::string> next_keep_both_name(const OperationDescriptor& op) {
    const auto [base, extension] = split_name_for_copy_suffix(target_name_for(op.payload), op.payload.item.is_dir);
    for (int attempt = 1; attempt <= 99; ++attempt) {
        const std::string candidate =
            base + (attempt == 1 ? " copy" : " copy " + std::to_string(attempt)) + extension;
        OperationPayload payload = op.payload;
        payload.override_name = candidate;
        if (!endpoint_exists(target_endpoint_for(payload))) {
            return candidate;
        }
    }
    return std::nullopt;
}

ConflictProbeResult probe_conflict(const OperationDescriptor& op) {
    ConflictProbeResult result;
    if (op.kind == OperationKind::Delete) {
        return result;
    }
    result.supported = true;
    result.supports_replace = !op.target.remote_name.empty() || !op.target.local_path.empty();
    result.supports_keep_both = op.kind != OperationKind::Delete &&
                                op.kind != OperationKind::Rename &&
                                !op.target.is_remote();
    result.conflict = !same_endpoint(op.source, op.target) && endpoint_exists(op.target);
    return result;
}

void replace_selected_id(FileExplorerState& state,
                         const std::string& old_id,
                         const std::string& new_id) {
    if (old_id.empty() || new_id.empty()) {
        return;
    }
    if (state.selected_files.erase(old_id) > 0) {
        state.selected_files.insert(new_id);
    }
}

FileItem renamed_item_snapshot(const FileItem& item, const std::string& new_name) {
    FileItem renamed = item;
    renamed.name = new_name;
    renamed.path = (fs::path(item.path).parent_path() / new_name).string();
    renamed.id = renamed.path;
    if (!renamed.sync_remote_path.empty()) {
        renamed.sync_remote_path = (fs::path(renamed.sync_remote_path).parent_path() / new_name).generic_string();
    }
    return renamed;
}

void apply_successful_rename_to_loaded_state(core::StateRegistry& registry,
                                             const std::string& owner_state_key,
                                             const FileItem& item,
                                             const std::string& new_name) {
    auto& listings_state = registry.get_state<FileListingsState>(kFileListingsStateKey);
    if (FileListing* listing = listings_state.find(owner_state_key)) {
        const FileItem new_item = renamed_item_snapshot(item, new_name);
        for (auto& candidate : listing->files) {
            if (candidate.path == item.path || candidate.id == item.id) {
                candidate = new_item;
                listing->note_listing_changed();
                break;
            }
        }
    }

    if (registry.has_state(owner_state_key)) {
        auto& owner_state = registry.get_state<FileExplorerState>(owner_state_key);
        std::lock_guard<std::recursive_mutex> lock(owner_state.mu);
        replace_selected_id(owner_state, item.id, (fs::path(item.path).parent_path() / new_name).string());
    }

    registry.get_state<LibraryState>(kLibraryStateKey).track_move(item.path, renamed_item_snapshot(item, new_name));
}

void remove_item_from_listing(FileListingsState& listings,
                              const std::string& source_state_key,
                              const FileItem& item) {
    if (source_state_key.empty()) {
        return;
    }

    FileListing* listing = listings.find(source_state_key);
    if (!listing) {
        return;
    }

    const auto old_size = listing->files.size();
    listing->files.erase(
        std::remove_if(listing->files.begin(), listing->files.end(), [&](const FileItem& candidate) {
            return (!item.id.empty() && candidate.id == item.id) ||
                   (!item.path.empty() && candidate.path == item.path);
        }),
        listing->files.end());

    if (listing->files.size() != old_size) {
        listing->note_listing_changed();
    }
}

void maybe_record_undo(core::StateRegistry& registry, const OperationDescriptor& op) {
    auto& queue = queue_state(registry);
    auto& transfers = transfer_state(registry);

    UndoRecord record;
    bool supported = false;
    if (op.kind == OperationKind::Rename && !op.target.is_remote()) {
        record.kind = OperationKind::Rename;
        record.item = renamed_item_snapshot(op.payload.item, target_name_for(op.payload));
        record.rename_new_name = op.payload.item.name;
        record.summary = "Undo rename";
        supported = true;
    } else if (op.kind == OperationKind::Move &&
               op.payload.kind == OperationPayloadKind::Clipboard &&
               op.payload.clipboard_op == ClipboardOp::CUT &&
               !op.target.is_remote() &&
               !op.source.is_remote()) {
        record.kind = OperationKind::Move;
        record.item = op.payload.item;
        record.item.name = target_name_for(op.payload);
        record.item.path = op.target.local_path;
        record.item.id = op.target.local_path;
        record.clipboard_op = ClipboardOp::CUT;
        record.dest_dir = fs::path(op.payload.item.path).parent_path().string();
        record.summary = "Undo move";
        supported = true;
    }

    if (!supported) {
        return;
    }

    record.source_transfer_id = op.transfer_id;
    record.created_at = std::chrono::steady_clock::now();
    record.expires_at = record.created_at + std::chrono::minutes(10);
    {
        std::lock_guard<std::mutex> lock(queue.mu);
        record.undo_id = queue.next_undo_id++;
        queue.undo_records[record.undo_id] = record;
    }
    transfers.update_action_flags(op.transfer_id, false, false, true, record.undo_id);
}

OperationDescriptor descriptor_for_payload(uint64_t batch_id,
                                           OperationPayload payload,
                                           ConflictPolicy conflict_policy,
                                           bool preserve_order,
                                           std::function<void(const core::FileMasterResult&)> on_complete) {
    OperationDescriptor op;
    op.batch_id = batch_id;
    op.payload = std::move(payload);
    op.kind = op.payload.kind == OperationPayloadKind::Rename
        ? OperationKind::Rename
        : op.payload.kind == OperationPayloadKind::Delete
            ? OperationKind::Delete
            : op.payload.kind == OperationPayloadKind::Download
                ? OperationKind::Download
                : (op.payload.clipboard_op == ClipboardOp::CUT ? OperationKind::Move : OperationKind::Copy);
    op.conflict_policy = conflict_policy;
    op.preserve_order = preserve_order;
    op.source = source_endpoint_for(op.payload);
    op.target = target_endpoint_for(op.payload);
    op.title = std::string(operation_kind_label(op.kind)) + " " + op.payload.item.name;
    op.on_complete = std::move(on_complete);
    const ConflictProbeResult probe = probe_conflict(op);
    op.supports_replace = probe.supports_replace;
    op.supports_keep_both = probe.supports_keep_both;
    op.retryable = true;
    op.cancelable = true;
    return op;
}

uint64_t register_operation(core::StateRegistry& registry,
                            OperationDescriptor op) {
    auto& transfers = transfer_state(registry);
    core::FileTransferRecord record;
    record.transfer_type = transfer_type_for(op);
    record.item_type = op.payload.item.type == FileType::REMOTE
        ? core::FileTransferItemType::Remote
        : core::FileTransferItemType::Local;
    record.file_name = op.payload.item.name;
    record.job_id = op.batch_id;
    record.status = core::FileTransferStatus::Queued;
    record.conflict_policy = to_transfer_conflict_policy(op.conflict_policy);
    record.cancelable = true;
    record.retryable = true;
    record.undoable = false;
    record.detail_message = "Queued";
    record.local_source_path = op.source.local_path;
    record.local_dest_path = op.target.local_path;
    record.remote_source_name = op.source.remote_name;
    record.remote_source_path = op.source.remote_path;
    record.remote_dest_name = op.target.remote_name;
    record.remote_dest_path = op.target.remote_path;
    op.transfer_id = transfers.create_transfer(std::move(record));

    auto& queue = queue_state(registry);
    std::lock_guard<std::mutex> lock(queue.mu);
    queue.pending_order.push_back(op.transfer_id);
    queue.batches[op.batch_id].operation_ids.push_back(op.transfer_id);
    queue.operations.emplace(op.transfer_id, std::move(op));
    return queue.pending_order.back();
}

void on_operation_finished(core::StateRegistry& registry,
                           core::WorkerPool& worker_pool,
                           uint64_t transfer_id,
                           core::FileMasterResult result) {
    std::optional<OperationDescriptor> descriptor;
    {
        auto& queue = queue_state(registry);
        std::lock_guard<std::mutex> lock(queue.mu);
        auto it = queue.operations.find(transfer_id);
        if (it == queue.operations.end()) {
            return;
        }
        descriptor = it->second;
        queue.active_count = queue.active_count > 0 ? queue.active_count - 1 : 0;
        auto batch_it = queue.batches.find(it->second.batch_id);
        if (batch_it != queue.batches.end()) {
            batch_it->second.paused = false;
            batch_it->second.paused_transfer_id = 0;
        }
    }

    if (descriptor->kind == OperationKind::Move &&
        descriptor->payload.clipboard_op == ClipboardOp::CUT &&
        result.success) {
        auto& listings = registry.get_state<FileListingsState>(kFileListingsStateKey);
        remove_item_from_listing(listings, descriptor->payload.source_state_key, descriptor->payload.item);
    }
    if (descriptor->kind == OperationKind::Rename && result.success) {
        apply_successful_rename_to_loaded_state(registry,
                                                descriptor->payload.owner_state_key,
                                                descriptor->payload.item,
                                                target_name_for(descriptor->payload));
    }
    if (result.success) {
        maybe_record_undo(registry, *descriptor);
    }
    if (descriptor->on_complete) {
        descriptor->on_complete(result);
    }
    pump_operation_queue(registry, worker_pool);
}

bool dispatch_one_operation(core::StateRegistry& registry,
                            core::WorkerPool& worker_pool,
                            OperationDescriptor& op) {
    auto& transfers = transfer_state(registry);
    const ConflictProbeResult probe = probe_conflict(op);
    if (probe.supported && probe.conflict) {
        if (op.conflict_policy == ConflictPolicy::Skip) {
            transfers.cancel_transfer(op.transfer_id, "Skipped due to conflict policy.");
            finish_file_operation_job(registry, op.batch_id, true);
            on_operation_finished(registry, worker_pool, op.transfer_id, core::make_success());
            return true;
        }
        if (op.conflict_policy == ConflictPolicy::KeepBoth) {
            if (const auto candidate = next_keep_both_name(op); candidate.has_value()) {
                op.payload.override_name = *candidate;
                op.target = target_endpoint_for(op.payload);
            }
        } else if (op.conflict_policy == ConflictPolicy::Replace) {
            if (!remove_endpoint_for_replace(op.target)) {
                transfers.fail_transfer(op.transfer_id, "Failed to replace existing destination.");
                finish_file_operation_job(registry, op.batch_id, false, "replace failed");
                on_operation_finished(registry, worker_pool, op.transfer_id, core::make_error("replace failed"));
                return true;
            }
        } else {
            transfers.mark_waiting_for_resolution(op.transfer_id, "Waiting for conflict resolution.");
            auto& queue = queue_state(registry);
            std::lock_guard<std::mutex> lock(queue.mu);
            auto& batch = queue.batches[op.batch_id];
            batch.paused = true;
            batch.paused_transfer_id = op.transfer_id;
            queue.conflict_dialog.open = true;
            queue.conflict_dialog.transfer_id = op.transfer_id;
            queue.conflict_dialog.batch_id = op.batch_id;
            queue.conflict_dialog.supports_keep_both = op.supports_keep_both;
            queue.conflict_dialog.selected_policy = op.supports_replace ? ConflictPolicy::Replace : ConflictPolicy::Skip;
            queue.conflict_dialog.title = "Resolve conflict";
            queue.conflict_dialog.source_label = op.source.display();
            queue.conflict_dialog.target_label = op.target.display();
            op.waiting_for_conflict = true;
            return false;
        }
    }

    transfers.update_conflict_policy(op.transfer_id, to_transfer_conflict_policy(op.conflict_policy));
    transfers.mark_started(op.transfer_id);
    transfers.update_action_flags(op.transfer_id, false, true, false, 0);

    bool dispatched = false;
    switch (op.payload.kind) {
        case OperationPayloadKind::Clipboard:
            dispatched = dispatch_file_master_clipboard_operation(
                worker_pool,
                transfers,
                op.payload.item,
                op.payload.dest_dir,
                op.payload.clipboard_op,
                op.batch_id,
                [&, transfer_id = op.transfer_id](core::FileMasterResult result) {
                    finish_file_operation_job(registry, op.batch_id, result.success, result.error_message);
                    on_operation_finished(registry, worker_pool, transfer_id, std::move(result));
                },
                op.transfer_id,
                target_name_for(op.payload));
            break;
        case OperationPayloadKind::Rename:
            dispatched = rename_file_master_item(
                worker_pool,
                transfers,
                op.payload.item,
                target_name_for(op.payload),
                op.batch_id,
                [&, transfer_id = op.transfer_id](core::FileMasterResult result) {
                    finish_file_operation_job(registry, op.batch_id, result.success, result.error_message);
                    on_operation_finished(registry, worker_pool, transfer_id, std::move(result));
                },
                op.transfer_id);
            break;
        case OperationPayloadKind::Delete:
            dispatched = remove_file_master_item(
                worker_pool,
                transfers,
                op.payload.item,
                op.batch_id,
                [&, transfer_id = op.transfer_id](core::FileMasterResult result) {
                    finish_file_operation_job(registry, op.batch_id, result.success, result.error_message);
                    on_operation_finished(registry, worker_pool, transfer_id, std::move(result));
                },
                op.transfer_id);
            break;
        case OperationPayloadKind::Download:
            dispatched = download_remote_file_master_item(
                worker_pool,
                transfers,
                op.payload.item,
                op.batch_id,
                [&, transfer_id = op.transfer_id](core::FileMasterResult result) {
                    finish_file_operation_job(registry, op.batch_id, result.success, result.error_message);
                    on_operation_finished(registry, worker_pool, transfer_id, std::move(result));
                },
                op.transfer_id,
                target_name_for(op.payload));
            break;
    }

    if (!dispatched) {
        transfers.fail_transfer(op.transfer_id, "Dispatch failed.");
        finish_file_operation_job(registry, op.batch_id, false, "dispatch failed");
        on_operation_finished(registry, worker_pool, op.transfer_id, core::make_error("dispatch failed"));
    }
    return dispatched;
}

}  // namespace

bool OperationEndpoint::is_remote() const {
    return !remote_name.empty();
}

std::string OperationEndpoint::display() const {
    if (is_remote()) {
        return remote_name + ":" + remote_path;
    }
    return local_path;
}

const char* conflict_policy_label(ConflictPolicy policy) {
    switch (policy) {
        case ConflictPolicy::Ask: return "Ask";
        case ConflictPolicy::Replace: return "Replace";
        case ConflictPolicy::Skip: return "Skip";
        case ConflictPolicy::KeepBoth: return "Keep Both";
    }
    return "Ask";
}

const char* operation_kind_label(OperationKind kind) {
    switch (kind) {
        case OperationKind::Copy: return "Copy";
        case OperationKind::Move: return "Move";
        case OperationKind::Rename: return "Rename";
        case OperationKind::Delete: return "Delete";
        case OperationKind::Download: return "Download";
    }
    return "Operation";
}

uint64_t enqueue_clipboard_operation_batch(core::StateRegistry& registry,
                                           core::WorkerPool& worker_pool,
                                           const std::string& owner_state_key,
                                           const std::vector<FileItem>& items,
                                           const std::string& dest_dir,
                                           ClipboardOp op,
                                           const std::string& source_state_key,
                                           std::function<void(const core::FileMasterResult&)> on_complete) {
    const uint64_t batch_id = begin_file_operation_job(registry, op == ClipboardOp::CUT ? "Move" : "Copy");
    {
        auto& queue = queue_state(registry);
        std::lock_guard<std::mutex> lock(queue.mu);
        queue.batches[batch_id] = OperationBatch{.batch_id = batch_id,
                                                 .label = op == ClipboardOp::CUT ? "Move" : "Copy",
                                                 .preserve_order = false};
    }

    for (const auto& item : items) {
        if (!is_file_master_item(item)) {
            continue;
        }
        add_file_operation_to_job(registry, batch_id);
        OperationPayload payload;
        payload.kind = OperationPayloadKind::Clipboard;
        payload.item = item;
        payload.clipboard_op = op;
        payload.owner_state_key = owner_state_key;
        payload.source_state_key = source_state_key;
        payload.dest_dir = dest_dir;
        register_operation(registry, descriptor_for_payload(batch_id, std::move(payload), ConflictPolicy::Ask, false, on_complete));
    }
    close_file_operation_job(registry, batch_id);
    pump_operation_queue(registry, worker_pool);
    return batch_id;
}

uint64_t enqueue_delete_operation_batch(core::StateRegistry& registry,
                                        core::WorkerPool& worker_pool,
                                        const std::string& owner_state_key,
                                        const std::vector<FileItem>& items,
                                        std::function<void(const core::FileMasterResult&)> on_complete) {
    const uint64_t batch_id = begin_file_operation_job(registry, "Delete");
    {
        auto& queue = queue_state(registry);
        std::lock_guard<std::mutex> lock(queue.mu);
        queue.batches[batch_id] = OperationBatch{.batch_id = batch_id, .label = "Delete", .preserve_order = false};
    }
    for (const auto& item : items) {
        if (!is_file_master_item(item)) {
            continue;
        }
        add_file_operation_to_job(registry, batch_id);
        OperationPayload payload;
        payload.kind = OperationPayloadKind::Delete;
        payload.item = item;
        payload.owner_state_key = owner_state_key;
        register_operation(registry, descriptor_for_payload(batch_id, std::move(payload), ConflictPolicy::Ask, false, on_complete));
    }
    close_file_operation_job(registry, batch_id);
    pump_operation_queue(registry, worker_pool);
    return batch_id;
}

uint64_t enqueue_download_operation(core::StateRegistry& registry,
                                    core::WorkerPool& worker_pool,
                                    const std::string& owner_state_key,
                                    const FileItem& item,
                                    std::function<void(const core::FileMasterResult&)> on_complete) {
    const uint64_t batch_id = begin_file_operation_job(registry, "Download");
    {
        auto& queue = queue_state(registry);
        std::lock_guard<std::mutex> lock(queue.mu);
        queue.batches[batch_id] = OperationBatch{.batch_id = batch_id, .label = "Download", .preserve_order = false};
    }
    add_file_operation_to_job(registry, batch_id);
    OperationPayload payload;
    payload.kind = OperationPayloadKind::Download;
    payload.item = item;
    payload.owner_state_key = owner_state_key;
    register_operation(registry, descriptor_for_payload(batch_id, std::move(payload), ConflictPolicy::Ask, false, on_complete));
    close_file_operation_job(registry, batch_id);
    pump_operation_queue(registry, worker_pool);
    return batch_id;
}

uint64_t enqueue_rename_operation_batch(core::StateRegistry& registry,
                                        core::WorkerPool& worker_pool,
                                        const std::vector<RenameExecutionRequest>& requests,
                                        std::function<void(const core::FileMasterResult&)> on_complete) {
    const uint64_t batch_id = begin_file_operation_job(registry, "Rename");
    {
        auto& queue = queue_state(registry);
        std::lock_guard<std::mutex> lock(queue.mu);
        queue.batches[batch_id] = OperationBatch{.batch_id = batch_id, .label = "Rename", .preserve_order = true};
    }
    for (const auto& request : requests) {
        add_file_operation_to_job(registry, batch_id);
        OperationPayload payload;
        payload.kind = OperationPayloadKind::Rename;
        payload.item = request.item;
        payload.owner_state_key = request.owner_state_key;
        payload.dest_dir = request.directory_path;
        payload.rename_new_name = request.new_name;
        register_operation(registry, descriptor_for_payload(batch_id, std::move(payload), ConflictPolicy::Ask, true, on_complete));
    }
    close_file_operation_job(registry, batch_id);
    pump_operation_queue(registry, worker_pool);
    return batch_id;
}

void pump_operation_queue(core::StateRegistry& registry, core::WorkerPool& worker_pool) {
    std::vector<uint64_t> ready_ids;
    {
        auto& queue = queue_state(registry);
        std::lock_guard<std::mutex> lock(queue.mu);
        auto it = queue.pending_order.begin();
        while (it != queue.pending_order.end()) {
            if (queue.active_count >= queue.max_concurrent) {
                break;
            }
            const uint64_t transfer_id = *it;
            auto op_it = queue.operations.find(transfer_id);
            if (op_it == queue.operations.end()) {
                it = queue.pending_order.erase(it);
                continue;
            }
            if (op_it->second.waiting_for_conflict) {
                ++it;
                continue;
            }
            auto batch_it = queue.batches.find(op_it->second.batch_id);
            if (batch_it != queue.batches.end() && batch_it->second.paused) {
                ++it;
                continue;
            }
            if (op_it->second.preserve_order) {
                bool earlier_pending_same_batch = false;
                for (uint64_t candidate : queue.pending_order) {
                    if (candidate == transfer_id) {
                        break;
                    }
                    const auto earlier_it = queue.operations.find(candidate);
                    if (earlier_it != queue.operations.end() &&
                        earlier_it->second.batch_id == op_it->second.batch_id) {
                        earlier_pending_same_batch = true;
                        break;
                    }
                }
                if (earlier_pending_same_batch) {
                    ++it;
                    continue;
                }
            }
            ready_ids.push_back(transfer_id);
            ++queue.active_count;
            it = queue.pending_order.erase(it);
        }
    }

    for (uint64_t transfer_id : ready_ids) {
        OperationDescriptor op;
        {
            auto& queue = queue_state(registry);
            std::lock_guard<std::mutex> lock(queue.mu);
            auto it = queue.operations.find(transfer_id);
            if (it == queue.operations.end()) {
                continue;
            }
            op = it->second;
        }
        dispatch_one_operation(registry, worker_pool, op);
        {
            auto& queue = queue_state(registry);
            std::lock_guard<std::mutex> lock(queue.mu);
            auto it = queue.operations.find(transfer_id);
            if (it != queue.operations.end()) {
                it->second = op;
            }
        }
    }
}

bool cancel_queued_operation(core::StateRegistry& registry, uint64_t transfer_id) {
    auto& queue = queue_state(registry);
    std::lock_guard<std::mutex> lock(queue.mu);
    auto it = queue.operations.find(transfer_id);
    if (it == queue.operations.end() || !it->second.cancelable) {
        return false;
    }
    transfer_state(registry).cancel_transfer(transfer_id, "Canceled");
    it->second.cancelable = false;
    queue.pending_order.erase(std::remove(queue.pending_order.begin(), queue.pending_order.end(), transfer_id),
                              queue.pending_order.end());
    cancel_file_operation_in_job(registry, it->second.batch_id);
    queue.operations.erase(it);
    return true;
}

bool retry_operation(core::StateRegistry& registry, core::WorkerPool& worker_pool, uint64_t transfer_id) {
    core::FileTransferRecord record;
    if (!transfer_state(registry).get_transfer(transfer_id, record)) {
        return false;
    }

    OperationDescriptor original;
    {
        auto& queue = queue_state(registry);
        std::lock_guard<std::mutex> lock(queue.mu);
        const auto it = queue.operations.find(transfer_id);
        if (it == queue.operations.end()) {
            return false;
        }
        original = it->second;
    }

    const uint64_t batch_id = begin_file_operation_job(registry, std::string("Retry ") + operation_kind_label(original.kind));
    {
        auto& queue = queue_state(registry);
        std::lock_guard<std::mutex> lock(queue.mu);
        queue.batches[batch_id] = OperationBatch{.batch_id = batch_id,
                                                 .label = std::string("Retry ") + operation_kind_label(original.kind),
                                                 .preserve_order = original.preserve_order};
    }
    add_file_operation_to_job(registry, batch_id);
    OperationDescriptor retried = descriptor_for_payload(batch_id,
                                                         original.payload,
                                                         original.conflict_policy,
                                                         original.preserve_order,
                                                         original.on_complete);
    register_operation(registry, std::move(retried));
    close_file_operation_job(registry, batch_id);
    pump_operation_queue(registry, worker_pool);
    return true;
}

bool undo_operation(core::StateRegistry& registry, core::WorkerPool& worker_pool, uint64_t undo_token_id) {
    UndoRecord record;
    {
        auto& queue = queue_state(registry);
        std::lock_guard<std::mutex> lock(queue.mu);
        const auto it = queue.undo_records.find(undo_token_id);
        if (it == queue.undo_records.end()) {
            return false;
        }
        record = it->second;
        queue.undo_records.erase(it);
    }

    if (record.kind == OperationKind::Rename) {
        RenameExecutionRequest request;
        request.owner_state_key = "";
        request.directory_path = fs::path(record.item.path).parent_path().string();
        request.item = record.item;
        request.new_name = record.rename_new_name;
        enqueue_rename_operation_batch(registry, worker_pool, {request});
        return true;
    }

    if (record.kind == OperationKind::Move) {
        return enqueue_clipboard_operation_batch(registry,
                                                 worker_pool,
                                                 "",
                                                 {record.item},
                                                 record.dest_dir,
                                                 ClipboardOp::CUT,
                                                 "") != 0;
    }
    return false;
}

void clear_completed_operations(core::StateRegistry& registry) {
    transfer_state(registry).clear_completed();
}

void clear_failed_operations(core::StateRegistry& registry) {
    transfer_state(registry).clear_failed();
}

void render_operation_conflict_modal(core::StateRegistry& registry, core::WorkerPool& worker_pool) {
    auto& queue = queue_state(registry);
    ConflictDialogState dialog;
    {
        std::lock_guard<std::mutex> lock(queue.mu);
        if (!queue.conflict_dialog.open) {
            return;
        }
        dialog = queue.conflict_dialog;
    }

    ImGui::OpenPopup("##operation_conflict_modal");
    bool open = true;
    if (ImGui::BeginPopupModal("##operation_conflict_modal", &open, ImGuiWindowFlags_AlwaysAutoResize)) {
        ImGui::TextUnformatted("A destination already exists.");
        ImGui::Dummy(ImVec2(0.0f, 6.0f));
        ImGui::TextWrapped("Source: %s", dialog.source_label.c_str());
        ImGui::TextWrapped("Target: %s", dialog.target_label.c_str());
        ImGui::Dummy(ImVec2(0.0f, 10.0f));

        int selected = dialog.selected_policy == ConflictPolicy::Replace
            ? 0
            : dialog.selected_policy == ConflictPolicy::Skip
                ? 1
                : 2;
        ImGui::RadioButton("Replace", &selected, 0);
        ImGui::RadioButton("Skip", &selected, 1);
        if (dialog.supports_keep_both) {
            ImGui::RadioButton("Keep both", &selected, 2);
        }
        bool apply_to_batch = dialog.apply_to_batch;
        ImGui::Checkbox("Apply to remaining items in this batch", &apply_to_batch);

        if (ImGui::Button("Cancel", ImVec2(96.0f, 0.0f))) {
            cancel_queued_operation(registry, dialog.transfer_id);
            std::lock_guard<std::mutex> lock(queue.mu);
            queue.conflict_dialog = {};
            ImGui::CloseCurrentPopup();
        }
        ImGui::SameLine();
        if (ImGui::Button("Continue", ImVec2(96.0f, 0.0f))) {
            const ConflictPolicy resolved = selected == 0
                ? ConflictPolicy::Replace
                : selected == 1
                    ? ConflictPolicy::Skip
                    : ConflictPolicy::KeepBoth;
            {
                std::lock_guard<std::mutex> lock(queue.mu);
                auto op_it = queue.operations.find(dialog.transfer_id);
                if (op_it != queue.operations.end()) {
                    op_it->second.conflict_policy = resolved;
                    op_it->second.waiting_for_conflict = false;
                }
                auto batch_it = queue.batches.find(dialog.batch_id);
                if (batch_it != queue.batches.end()) {
                    batch_it->second.paused = false;
                    batch_it->second.paused_transfer_id = 0;
                    if (apply_to_batch) {
                        for (uint64_t id : batch_it->second.operation_ids) {
                            auto candidate_it = queue.operations.find(id);
                            if (candidate_it != queue.operations.end()) {
                                candidate_it->second.conflict_policy = resolved;
                            }
                        }
                    }
                }
                queue.conflict_dialog = {};
            }
            ImGui::CloseCurrentPopup();
            pump_operation_queue(registry, worker_pool);
        }

        ImGui::EndPopup();
    }

    if (!open) {
        std::lock_guard<std::mutex> lock(queue.mu);
        queue.conflict_dialog = {};
    }
}

}  // namespace misty::panel
