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

std::vector<core::FileTransferRecord> sorted_rows(std::vector<core::FileTransferRecord> rows) {
    std::sort(rows.begin(), rows.end(), [](const core::FileTransferRecord& lhs,
                                           const core::FileTransferRecord& rhs) {
        if (lhs.is_alive() != rhs.is_alive()) {
            return lhs.is_alive() > rhs.is_alive();
        }
        if ((lhs.status == core::FileTransferStatus::Failed) !=
            (rhs.status == core::FileTransferStatus::Failed)) {
            return (lhs.status == core::FileTransferStatus::Failed) >
                   (rhs.status == core::FileTransferStatus::Failed);
        }
        if ((lhs.status == core::FileTransferStatus::Interrupted) !=
            (rhs.status == core::FileTransferStatus::Interrupted)) {
            return (lhs.status == core::FileTransferStatus::Interrupted) >
                   (rhs.status == core::FileTransferStatus::Interrupted);
        }
        const auto lhs_time = lhs.is_alive() ? lhs.started_at_ms : lhs.completed_at_ms;
        const auto rhs_time = rhs.is_alive() ? rhs.started_at_ms : rhs.completed_at_ms;
        if (lhs_time != rhs_time) {
            return lhs_time > rhs_time;
        }
        return lhs.id > rhs.id;
    });
    return rows;
}

std::vector<core::FileTransferRecord> visible_rows(const std::vector<core::FileTransferRecord>& rows,
                                                   const char* search_query,
                                                   core::FileTransferFilter filter) {
    std::vector<core::FileTransferRecord> visible;
    visible.reserve(rows.size());
    for (const auto& row : rows) {
        if (matches_filter(row, filter) && matches_search(row, search_query)) {
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
