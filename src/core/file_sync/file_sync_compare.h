#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "core/file_sync/file_sync_types.h"

namespace misty::core {

enum class FileSyncEndpointKind {
    Local,
    Remote,
};

struct FileSyncEndpoint {
    FileSyncEndpointKind kind = FileSyncEndpointKind::Local;
    std::string local_path;
    std::string remote_name;
    std::string remote_path;
    std::string provider_type;

    bool empty() const;
    std::string display_path() const;
};

struct FileSyncPair {
    int64_t id = 0;
    std::string name;
    FileSyncEndpoint left;
    FileSyncEndpoint right;
    bool watch_mode = false;
    bool stale = false;
    FileSyncPolicy preferred_policy = FileSyncPolicy::BiDirectional;
    int64_t last_compared_at_ms = 0;
    int64_t last_scan_at_ms = 0;
};

struct FileSyncCompareSide {
    bool present = false;
    bool is_remote = false;
    bool is_dir = false;
    int64_t size = 0;
    std::string last_modified;
    std::string absolute_path;
    std::string remote_name;
    std::string remote_path;
};

enum class FileSyncCompareKind {
    File,
    Folder,
    Mismatch,
};

enum class FileSyncCompareDisposition {
    LeftOnly,
    RightOnly,
    Different,
    Same,
    Conflict,
};

enum class FileSyncPlannedAction {
    Skip,
    CopyLeftToRight,
    CopyRightToLeft,
    DeleteLeft,
    DeleteRight,
};

struct FileSyncCompareRow {
    std::string relative_path;
    FileSyncCompareKind kind = FileSyncCompareKind::File;
    FileSyncCompareDisposition disposition = FileSyncCompareDisposition::Same;
    FileSyncCompareSide left;
    FileSyncCompareSide right;
    FileSyncPlannedAction action = FileSyncPlannedAction::Skip;
};

struct FileSyncCompareResult {
    bool success = false;
    std::string error_message;
    std::vector<FileSyncCompareRow> rows;
    int64_t compared_at_ms = 0;
};

const char* file_sync_compare_kind_label(FileSyncCompareKind kind);
const char* file_sync_compare_disposition_label(FileSyncCompareDisposition disposition);
const char* file_sync_planned_action_label(FileSyncPlannedAction action);

FileSyncCompareResult compare_file_sync_endpoints(const FileSyncEndpoint& left,
                                                  const FileSyncEndpoint& right);

FileSyncPlannedAction default_action_for_disposition(FileSyncCompareDisposition disposition);

std::vector<FileSyncCompareRow> planned_rows_for_apply(const std::vector<FileSyncCompareRow>& rows);

}  // namespace misty::core
