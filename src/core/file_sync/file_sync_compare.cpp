#include "core/file_sync/file_sync_compare.h"

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <map>
#include <system_error>
#include <utility>

#include "core/file_master/file_master_util.h"

namespace fs = std::filesystem;

namespace misty::core {
namespace {

struct SnapshotEntry {
    bool is_dir = false;
    int64_t size = 0;
    std::string last_modified;
    std::string absolute_path;
    std::string remote_name;
    std::string remote_path;
    bool is_remote = false;
};

std::string trim_leading_slash(std::string value) {
    while (!value.empty() && value.front() == '/') {
        value.erase(value.begin());
    }
    return value;
}

std::string normalize_relative_path(const fs::path& path) {
    const std::string normalized = path.lexically_normal().generic_string();
    return normalized == "." ? std::string{} : normalized;
}

std::string join_remote_child(const std::string& parent, const std::string& name) {
    fs::path joined = parent.empty() ? fs::path("/") : fs::path(parent);
    joined /= name;
    std::string out = joined.generic_string();
    if (out.empty() || out.front() != '/') {
        out.insert(out.begin(), '/');
    }
    return out;
}

int64_t now_epoch_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

std::string remote_relative_path(const FileSyncEndpoint& endpoint, const std::string& full_remote_path) {
    const fs::path root = fs::path(endpoint.remote_path.empty() ? "/" : endpoint.remote_path).lexically_normal();
    const fs::path full = fs::path(full_remote_path.empty() ? "/" : full_remote_path).lexically_normal();
    return normalize_relative_path(full.lexically_relative(root));
}

bool capture_local_snapshot(const FileSyncEndpoint& endpoint,
                            std::map<std::string, SnapshotEntry>& entries,
                            std::string& error) {
    std::error_code ec;
    if (!fs::exists(endpoint.local_path, ec) || ec) {
        error = "Compare root does not exist: " + endpoint.local_path;
        return false;
    }
    if (!fs::is_directory(endpoint.local_path, ec) || ec) {
        error = "Compare root is not a directory: " + endpoint.local_path;
        return false;
    }

    for (fs::recursive_directory_iterator it(endpoint.local_path, ec), end; it != end; it.increment(ec)) {
        if (ec) {
            error = "Failed to scan local directory: " + ec.message();
            return false;
        }

        SnapshotEntry entry;
        entry.absolute_path = it->path().string();
        entry.is_dir = it->is_directory(ec);
        if (ec) {
            error = "Failed to stat local entry: " + ec.message();
            return false;
        }
        if (!entry.is_dir) {
            entry.size = static_cast<int64_t>(it->file_size(ec));
            if (ec) {
                ec.clear();
                entry.size = 0;
            }
        }
        const auto rel = normalize_relative_path(it->path().lexically_relative(endpoint.local_path));
        entries[rel] = std::move(entry);
    }
    return true;
}

bool capture_remote_snapshot_recursive(const FileSyncEndpoint& endpoint,
                                       const std::string& current_remote_path,
                                       std::map<std::string, SnapshotEntry>& entries,
                                       std::string& error) {
    FileMasterProps props;
    props.remote_source.remote_name = endpoint.remote_name;
    props.remote_source.provider_type = endpoint.provider_type;
    props.remote_source.remote_path = current_remote_path.empty() ? "/" : current_remote_path;

    std::vector<FileMasterListItem> items;
    const FileMasterResult result = list_remote_path(props, items);
    if (!result.success) {
        error = result.error_message.empty() ? "Failed to list remote path." : result.error_message;
        return false;
    }

    for (const auto& item : items) {
        const std::string full_remote_path = item.path.empty()
            ? join_remote_child(current_remote_path.empty() ? "/" : current_remote_path, item.name)
            : (item.path.front() == '/' ? item.path : "/" + item.path);
        const std::string rel = remote_relative_path(endpoint, full_remote_path);
        SnapshotEntry entry;
        entry.is_remote = true;
        entry.is_dir = item.is_dir;
        entry.size = item.size;
        entry.last_modified = item.last_modified;
        entry.remote_name = endpoint.remote_name;
        entry.remote_path = full_remote_path;
        entry.absolute_path = endpoint.display_path() + "/" + rel;
        entries[rel] = entry;
        if (item.is_dir && !rel.empty()) {
            if (!capture_remote_snapshot_recursive(endpoint, full_remote_path, entries, error)) {
                return false;
            }
        }
    }

    return true;
}

bool capture_remote_snapshot(const FileSyncEndpoint& endpoint,
                             std::map<std::string, SnapshotEntry>& entries,
                             std::string& error) {
    if (endpoint.remote_name.empty()) {
        error = "Remote compare root is missing a remote name.";
        return false;
    }
    return capture_remote_snapshot_recursive(endpoint,
                                             endpoint.remote_path.empty() ? "/" : endpoint.remote_path,
                                             entries,
                                             error);
}

bool capture_snapshot(const FileSyncEndpoint& endpoint,
                      std::map<std::string, SnapshotEntry>& entries,
                      std::string& error) {
    if (endpoint.kind == FileSyncEndpointKind::Remote) {
        return capture_remote_snapshot(endpoint, entries, error);
    }
    return capture_local_snapshot(endpoint, entries, error);
}

FileSyncCompareKind compare_kind_for(const SnapshotEntry* left, const SnapshotEntry* right) {
    if (left && right && left->is_dir != right->is_dir) {
        return FileSyncCompareKind::Mismatch;
    }
    if ((left && left->is_dir) || (right && right->is_dir)) {
        return FileSyncCompareKind::Folder;
    }
    return FileSyncCompareKind::File;
}

FileSyncCompareDisposition disposition_for(const SnapshotEntry* left, const SnapshotEntry* right) {
    if (left == nullptr) {
        return FileSyncCompareDisposition::RightOnly;
    }
    if (right == nullptr) {
        return FileSyncCompareDisposition::LeftOnly;
    }
    if (left->is_dir != right->is_dir) {
        return FileSyncCompareDisposition::Conflict;
    }
    if (left->is_dir && right->is_dir) {
        return FileSyncCompareDisposition::Same;
    }
    if (left->size == right->size && left->last_modified == right->last_modified) {
        return FileSyncCompareDisposition::Same;
    }
    return FileSyncCompareDisposition::Different;
}

FileSyncCompareSide side_from_snapshot(const SnapshotEntry* entry) {
    FileSyncCompareSide side;
    if (entry == nullptr) {
        return side;
    }
    side.present = true;
    side.is_remote = entry->is_remote;
    side.is_dir = entry->is_dir;
    side.size = entry->size;
    side.last_modified = entry->last_modified;
    side.absolute_path = entry->absolute_path;
    side.remote_name = entry->remote_name;
    side.remote_path = entry->remote_path;
    return side;
}

bool path_is_descendant_or_same(const std::string& parent, const std::string& child) {
    if (parent.empty() || child.empty()) {
        return false;
    }
    const fs::path parent_path(parent);
    const fs::path child_path(child);
    auto pit = parent_path.begin();
    auto cit = child_path.begin();
    for (; pit != parent_path.end(); ++pit, ++cit) {
        if (cit == child_path.end() || *pit != *cit) {
            return false;
        }
    }
    return true;
}

bool should_skip_descendant_for_apply(const FileSyncCompareRow& candidate,
                                      const std::vector<FileSyncCompareRow>& accepted) {
    for (const auto& row : accepted) {
        if (row.action != candidate.action) {
            continue;
        }
        if (row.kind != FileSyncCompareKind::Folder) {
            continue;
        }
        if (row.relative_path == candidate.relative_path) {
            return true;
        }
        if (path_is_descendant_or_same(row.relative_path, candidate.relative_path)) {
            return true;
        }
    }
    return false;
}

}  // namespace

bool FileSyncEndpoint::empty() const {
    if (kind == FileSyncEndpointKind::Remote) {
        return remote_name.empty();
    }
    return local_path.empty();
}

std::string FileSyncEndpoint::display_path() const {
    if (kind == FileSyncEndpointKind::Remote) {
        return remote_name + ":" + (remote_path.empty() ? "/" : remote_path);
    }
    return local_path;
}

const char* file_sync_compare_kind_label(FileSyncCompareKind kind) {
    switch (kind) {
        case FileSyncCompareKind::File: return "File";
        case FileSyncCompareKind::Folder: return "Folder";
        case FileSyncCompareKind::Mismatch: return "Mismatch";
    }
    return "File";
}

const char* file_sync_compare_disposition_label(FileSyncCompareDisposition disposition) {
    switch (disposition) {
        case FileSyncCompareDisposition::LeftOnly: return "Left only";
        case FileSyncCompareDisposition::RightOnly: return "Right only";
        case FileSyncCompareDisposition::Different: return "Different";
        case FileSyncCompareDisposition::Same: return "Same";
        case FileSyncCompareDisposition::Conflict: return "Conflict";
    }
    return "Same";
}

const char* file_sync_planned_action_label(FileSyncPlannedAction action) {
    switch (action) {
        case FileSyncPlannedAction::Skip: return "Skip";
        case FileSyncPlannedAction::CopyLeftToRight: return "Copy Left -> Right";
        case FileSyncPlannedAction::CopyRightToLeft: return "Copy Right -> Left";
        case FileSyncPlannedAction::DeleteLeft: return "Delete Left";
        case FileSyncPlannedAction::DeleteRight: return "Delete Right";
    }
    return "Skip";
}

FileSyncCompareResult compare_file_sync_endpoints(const FileSyncEndpoint& left,
                                                  const FileSyncEndpoint& right) {
    FileSyncCompareResult result;
    if (left.empty() || right.empty()) {
        result.error_message = "Both compare roots are required.";
        return result;
    }

    std::map<std::string, SnapshotEntry> left_entries;
    std::map<std::string, SnapshotEntry> right_entries;
    if (!capture_snapshot(left, left_entries, result.error_message) ||
        !capture_snapshot(right, right_entries, result.error_message)) {
        return result;
    }

    std::vector<std::string> keys;
    keys.reserve(left_entries.size() + right_entries.size());
    for (const auto& [key, _] : left_entries) {
        keys.push_back(key);
    }
    for (const auto& [key, _] : right_entries) {
        if (!left_entries.contains(key)) {
            keys.push_back(key);
        }
    }
    std::sort(keys.begin(), keys.end());

    result.rows.reserve(keys.size());
    for (const auto& key : keys) {
        const SnapshotEntry* left_entry = nullptr;
        const SnapshotEntry* right_entry = nullptr;
        if (const auto it = left_entries.find(key); it != left_entries.end()) {
            left_entry = &it->second;
        }
        if (const auto it = right_entries.find(key); it != right_entries.end()) {
            right_entry = &it->second;
        }

        FileSyncCompareRow row;
        row.relative_path = key;
        row.kind = compare_kind_for(left_entry, right_entry);
        row.disposition = disposition_for(left_entry, right_entry);
        row.left = side_from_snapshot(left_entry);
        row.right = side_from_snapshot(right_entry);
        row.action = default_action_for_disposition(row.disposition);
        result.rows.push_back(std::move(row));
    }

    result.success = true;
    result.compared_at_ms = now_epoch_ms();
    return result;
}

FileSyncPlannedAction default_action_for_disposition(FileSyncCompareDisposition disposition) {
    switch (disposition) {
        case FileSyncCompareDisposition::LeftOnly:
            return FileSyncPlannedAction::CopyLeftToRight;
        case FileSyncCompareDisposition::RightOnly:
            return FileSyncPlannedAction::CopyRightToLeft;
        case FileSyncCompareDisposition::Different:
        case FileSyncCompareDisposition::Same:
        case FileSyncCompareDisposition::Conflict:
            return FileSyncPlannedAction::Skip;
    }
    return FileSyncPlannedAction::Skip;
}

std::vector<FileSyncCompareRow> planned_rows_for_apply(const std::vector<FileSyncCompareRow>& rows) {
    std::vector<FileSyncCompareRow> candidates;
    candidates.reserve(rows.size());
    for (const auto& row : rows) {
        if (row.action != FileSyncPlannedAction::Skip) {
            candidates.push_back(row);
        }
    }

    std::sort(candidates.begin(), candidates.end(), [](const FileSyncCompareRow& lhs, const FileSyncCompareRow& rhs) {
        if (lhs.relative_path.size() != rhs.relative_path.size()) {
            return lhs.relative_path.size() < rhs.relative_path.size();
        }
        return lhs.relative_path < rhs.relative_path;
    });

    std::vector<FileSyncCompareRow> accepted;
    accepted.reserve(candidates.size());
    for (const auto& row : candidates) {
        if (!should_skip_descendant_for_apply(row, accepted)) {
            accepted.push_back(row);
        }
    }
    return accepted;
}

}  // namespace misty::core
