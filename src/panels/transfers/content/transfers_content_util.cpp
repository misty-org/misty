#include "panels/transfers/content/transfers_content_util.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <iomanip>
#include <sstream>

namespace misty::panel::transfers_content {
namespace {

int64_t now_epoch_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

std::string lowercase_copy(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return value;
}

bool contains_case_insensitive(const std::string& haystack, const std::string& needle) {
    if (needle.empty()) {
        return true;
    }
    return lowercase_copy(haystack).find(lowercase_copy(needle)) != std::string::npos;
}

std::string format_bytes(int64_t bytes) {
    if (bytes < 0) {
        return "--";
    }

    static constexpr std::array<const char*, 5> suffixes = {"B", "KB", "MB", "GB", "TB"};
    double value = static_cast<double>(bytes);
    std::size_t suffix_index = 0;
    while (value >= 1024.0 && suffix_index + 1 < suffixes.size()) {
        value /= 1024.0;
        ++suffix_index;
    }

    std::ostringstream out;
    if (suffix_index == 0) {
        out << static_cast<int64_t>(value) << ' ' << suffixes[suffix_index];
    } else {
        out << std::fixed << std::setprecision(value >= 10.0 ? 0 : 1) << value << ' ' << suffixes[suffix_index];
    }
    return out.str();
}

bool matches_filter(const core::FileTransferRecord& row, core::FileTransferFilter filter) {
    switch (filter) {
        case core::FileTransferFilter::Active:
            return row.is_alive();
        case core::FileTransferFilter::Failed:
            return row.status == core::FileTransferStatus::Failed ||
                   row.status == core::FileTransferStatus::Interrupted;
        case core::FileTransferFilter::Completed:
            return row.status == core::FileTransferStatus::Completed;
        case core::FileTransferFilter::All:
            return true;
    }
    return true;
}

bool matches_search(const core::FileTransferRecord& row, const char* search_query) {
    const std::string query = search_query == nullptr ? std::string() : std::string(search_query);
    if (query.empty()) {
        return true;
    }

    const std::string haystack = row.file_name + "\n" +
        row.local_source_path + "\n" +
        row.local_dest_path + "\n" +
        row.remote_source_name + "\n" +
        row.remote_source_path + "\n" +
        row.remote_dest_name + "\n" +
        row.remote_dest_path + "\n" +
        job_id_text(row) + "\n" +
        row.error_message;
    return contains_case_insensitive(haystack, query);
}

bool matches_provider_filter(const core::FileTransferRecord& row, const std::set<std::string>& provider_filters) {
    if (provider_filters.empty()) {
        return true;
    }
    const auto keys = provider_keys_for_row(row);
    return std::any_of(keys.begin(), keys.end(), [&](const std::string& key) {
        return provider_filters.contains(key);
    });
}

bool matches_type_filter(const core::FileTransferRecord& row,
                         const std::set<core::FileTransferType>& type_filters) {
    return type_filters.empty() || type_filters.contains(row.transfer_type);
}

bool matches_location_scope(const core::FileTransferRecord& row, TransferLocationScope scope) {
    if (scope == TransferLocationScope::All) {
        return true;
    }
    const bool uses_remote = !row.remote_source_name.empty() || !row.remote_dest_name.empty();
    return scope == TransferLocationScope::Remote ? uses_remote : !uses_remote;
}

int64_t row_time(const core::FileTransferRecord& row) {
    if (row.is_alive()) {
        return row.started_at_ms > 0 ? row.started_at_ms : row.queued_at_ms;
    }
    return row.completed_at_ms > 0 ? row.completed_at_ms : row.started_at_ms;
}

int status_rank(const core::FileTransferRecord& row) {
    if (row.is_alive()) return 0;
    if (row.status == core::FileTransferStatus::Failed ||
        row.status == core::FileTransferStatus::Interrupted) return 1;
    if (row.status == core::FileTransferStatus::Completed) return 2;
    return 3;
}

}  // namespace

TransferCounts count_rows(const std::vector<core::FileTransferRecord>& rows) {
    TransferCounts counts;
    for (const auto& row : rows) {
        if (row.is_alive()) {
            ++counts.active;
        } else if (row.status == core::FileTransferStatus::Failed ||
                   row.status == core::FileTransferStatus::Interrupted) {
            ++counts.failed;
        } else {
            ++counts.completed;
        }
    }
    return counts;
}

std::vector<std::string> provider_keys_for_row(const core::FileTransferRecord& row) {
    std::vector<std::string> keys;
    if (!row.remote_source_name.empty()) {
        keys.push_back(row.remote_source_name);
    }
    if (!row.remote_dest_name.empty() &&
        std::find(keys.begin(), keys.end(), row.remote_dest_name) == keys.end()) {
        keys.push_back(row.remote_dest_name);
    }
    if (keys.empty()) {
        keys.push_back(kTransferProviderLocal);
    }
    return keys;
}

std::vector<TransferProviderGroup> provider_groups(
    const std::vector<core::FileTransferRecord>& rows,
    const std::map<std::string, std::string>& remote_labels) {
    std::map<std::string, TransferProviderGroup> grouped;
    grouped[kTransferProviderLocal] = TransferProviderGroup{kTransferProviderLocal, "Local", 0, 0};
    for (const auto& row : rows) {
        for (const auto& key : provider_keys_for_row(row)) {
            auto& group = grouped[key];
            if (group.key.empty()) {
                group.key = key;
                const auto label_it = remote_labels.find(key);
                group.label = label_it == remote_labels.end() ? key : label_it->second;
            }
            ++group.count;
            if (row.is_alive()) {
                ++group.active;
            }
        }
    }

    std::vector<TransferProviderGroup> out;
    out.reserve(grouped.size());
    for (auto& [key, group] : grouped) {
        if (key == kTransferProviderLocal && group.count == 0) {
            continue;
        }
        out.push_back(std::move(group));
    }
    std::sort(out.begin(), out.end(), [](const TransferProviderGroup& lhs, const TransferProviderGroup& rhs) {
        if (lhs.key == kTransferProviderLocal) {
            return true;
        }
        if (rhs.key == kTransferProviderLocal) {
            return false;
        }
        return lowercase_copy(lhs.label) < lowercase_copy(rhs.label);
    });
    return out;
}

std::vector<core::FileTransferRecord> sorted_rows(std::vector<core::FileTransferRecord> rows) {
    return sorted_rows(std::move(rows), TransferSortKey::Time, TransferSortDirection::Descending);
}

std::vector<core::FileTransferRecord> sorted_rows(std::vector<core::FileTransferRecord> rows,
                                                  TransferSortKey key,
                                                  TransferSortDirection direction) {
    std::sort(rows.begin(), rows.end(), [&](const core::FileTransferRecord& lhs,
                                            const core::FileTransferRecord& rhs) {
        int comparison = 0;
        switch (key) {
            case TransferSortKey::Name:
                comparison = lowercase_copy(lhs.file_name).compare(lowercase_copy(rhs.file_name));
                break;
            case TransferSortKey::Operation:
                comparison = std::string(type_label(lhs.transfer_type)).compare(type_label(rhs.transfer_type));
                break;
            case TransferSortKey::Status:
                comparison = status_rank(lhs) - status_rank(rhs);
                break;
            case TransferSortKey::Time:
                comparison = row_time(lhs) < row_time(rhs) ? -1 : row_time(lhs) > row_time(rhs) ? 1 : 0;
                break;
        }
        if (comparison == 0) {
            comparison = lhs.id < rhs.id ? -1 : lhs.id > rhs.id ? 1 : 0;
        }
        return direction == TransferSortDirection::Ascending ? comparison < 0 : comparison > 0;
    });
    return rows;
}

std::vector<core::FileTransferRecord> visible_rows(const std::vector<core::FileTransferRecord>& rows,
                                                   const char* search_query,
                                                   core::FileTransferFilter filter,
                                                   const std::set<std::string>& provider_filters,
                                                   const std::set<core::FileTransferType>& type_filters,
                                                   TransferLocationScope location_scope) {
    std::vector<core::FileTransferRecord> visible;
    visible.reserve(rows.size());
    for (const auto& row : rows) {
        if (matches_filter(row, filter) &&
            matches_search(row, search_query) &&
            matches_provider_filter(row, provider_filters) &&
            matches_type_filter(row, type_filters) &&
            matches_location_scope(row, location_scope)) {
            visible.push_back(row);
        }
    }
    return visible;
}

const char* filter_label(core::FileTransferFilter filter) {
    switch (filter) {
        case core::FileTransferFilter::Active: return "Active";
        case core::FileTransferFilter::All: return "All";
        case core::FileTransferFilter::Failed: return "Failed";
        case core::FileTransferFilter::Completed: return "Completed";
    }
    return "Active";
}

const char* type_label(core::FileTransferType type) {
    switch (type) {
        case core::FileTransferType::Upload: return "Upload";
        case core::FileTransferType::Download: return "Download";
        case core::FileTransferType::Create: return "Create";
        case core::FileTransferType::Copy: return "Copy";
        case core::FileTransferType::Move: return "Move";
        case core::FileTransferType::Rename: return "Rename";
        case core::FileTransferType::Delete: return "Delete";
    }
    return "Transfer";
}

const char* status_label(const core::FileTransferRecord& row) {
    switch (row.status) {
        case core::FileTransferStatus::Queued: return "Queued";
        case core::FileTransferStatus::WaitingForResolution: return "Needs input";
        case core::FileTransferStatus::Failed: return "Failed";
        case core::FileTransferStatus::Completed: return "Completed";
        case core::FileTransferStatus::Canceled: return "Canceled";
        case core::FileTransferStatus::Skipped: return "Skipped";
        case core::FileTransferStatus::Interrupted: return "Interrupted";
        case core::FileTransferStatus::Pending:
        case core::FileTransferStatus::InProgress:
            if (row.transfer_type == core::FileTransferType::Upload &&
                row.total_bytes > 0 &&
                row.transferred_bytes >= row.total_bytes) {
                return "Finalizing";
            }
            switch (row.transfer_type) {
                case core::FileTransferType::Upload: return "Uploading";
                case core::FileTransferType::Download: return "Downloading";
                case core::FileTransferType::Create: return "Creating";
                case core::FileTransferType::Copy: return "Copying";
                case core::FileTransferType::Move: return "Moving";
                case core::FileTransferType::Rename: return "Renaming";
                case core::FileTransferType::Delete: return "Deleting";
            }
    }
    return "Pending";
}

std::string progress_text(const core::FileTransferRecord& row) {
    if (row.total_bytes > 0) {
        return format_bytes(row.transferred_bytes) + " / " + format_bytes(row.total_bytes);
    }
    if (row.transferred_bytes > 0) {
        return format_bytes(row.transferred_bytes);
    }
    return "--";
}

float progress_fraction(const core::FileTransferRecord& row) {
    if (row.total_bytes <= 0) {
        return row.is_alive() ? 0.0f : 1.0f;
    }
    return std::clamp(
        static_cast<float>(row.transferred_bytes) / static_cast<float>(row.total_bytes),
        0.0f,
        1.0f);
}

std::string job_id_text(const core::FileTransferRecord& row) {
    if (row.job_id == 0) {
        return "--";
    }
    return "J-" + std::to_string(row.job_id);
}

std::string source_endpoint(const core::FileTransferRecord& row) {
    if (!row.remote_source_name.empty() || !row.remote_source_path.empty()) {
        return row.remote_source_name + ":" + row.remote_source_path;
    }
    if (!row.local_source_path.empty()) {
        return row.local_source_path;
    }
    return row.file_name;
}

std::string target_endpoint(const core::FileTransferRecord& row) {
    if (!row.remote_dest_name.empty() || !row.remote_dest_path.empty()) {
        return row.remote_dest_name + ":" + row.remote_dest_path;
    }
    if (!row.local_dest_path.empty()) {
        return row.local_dest_path;
    }
    return "";
}

std::string started_text(const core::FileTransferRecord& row) {
    const int64_t reference_time_ms = row.started_at_ms > 0 ? row.started_at_ms : row.queued_at_ms;
    if (reference_time_ms <= 0) {
        return "--";
    }

    const auto seconds = std::max<int64_t>(0, (now_epoch_ms() - reference_time_ms) / 1000);
    if (seconds < 5) {
        return "Now";
    }
    if (seconds < 60) {
        return std::to_string(seconds) + "s ago";
    }
    const auto minutes = seconds / 60;
    if (minutes < 60) {
        return std::to_string(minutes) + "m ago";
    }
    return std::to_string(minutes / 60) + "h ago";
}

}  // namespace misty::panel::transfers_content
