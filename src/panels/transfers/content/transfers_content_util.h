#pragma once

#include <cstddef>
#include <map>
#include <set>
#include <string>
#include <vector>

#include "core/file_transfer/file_transfer.h"
#include "panels/transfers/state/transfers_state.h"

namespace misty::panel::transfers_content {

struct TransferCounts {
    std::size_t active = 0;
    std::size_t completed = 0;
    std::size_t failed = 0;
};

inline constexpr const char* kTransferProviderAll = "";
inline constexpr const char* kTransferProviderLocal = "__local__";

struct TransferProviderGroup {
    std::string key;
    std::string label;
    std::size_t count = 0;
    std::size_t active = 0;
};

TransferCounts count_rows(const std::vector<core::FileTransferRecord>& rows);
std::vector<std::string> provider_keys_for_row(const core::FileTransferRecord& row);
std::vector<TransferProviderGroup> provider_groups(
    const std::vector<core::FileTransferRecord>& rows,
    const std::map<std::string, std::string>& remote_labels = {});
std::vector<core::FileTransferRecord> sorted_rows(std::vector<core::FileTransferRecord> rows);
std::vector<core::FileTransferRecord> sorted_rows(std::vector<core::FileTransferRecord> rows,
                                                  TransferSortKey key,
                                                  TransferSortDirection direction);
std::vector<core::FileTransferRecord> visible_rows(const std::vector<core::FileTransferRecord>& rows,
                                                   const char* search_query,
                                                   core::FileTransferFilter filter = core::FileTransferFilter::All,
                                                   const std::set<std::string>& provider_filters = {},
                                                   const std::set<core::FileTransferType>& type_filters = {},
                                                   TransferLocationScope location_scope = TransferLocationScope::All);

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
