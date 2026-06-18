#pragma once

#include <cstddef>
#include <string>
#include <vector>

#include "core/file_transfer/file_transfer.h"

namespace misty::panel::transfers_content {

struct TransferCounts {
    std::size_t active = 0;
    std::size_t completed = 0;
    std::size_t failed = 0;
};

TransferCounts count_rows(const std::vector<core::FileTransferRecord>& rows);
std::vector<core::FileTransferRecord> sorted_rows(std::vector<core::FileTransferRecord> rows);
std::vector<core::FileTransferRecord> visible_rows(const std::vector<core::FileTransferRecord>& rows,
                                                   const char* search_query,
                                                   core::FileTransferFilter filter = core::FileTransferFilter::All);

const char* filter_label(core::FileTransferFilter filter);
const char* type_label(core::FileTransferType type);
const char* status_label(const core::FileTransferRecord& row);
std::string progress_text(const core::FileTransferRecord& row);
float progress_fraction(const core::FileTransferRecord& row);
std::string job_id_text(const core::FileTransferRecord& row);
std::string source_endpoint(const core::FileTransferRecord& row);
std::string target_endpoint(const core::FileTransferRecord& row);
std::string started_text(const core::FileTransferRecord& row);

}  // namespace misty::panel::transfers_content
