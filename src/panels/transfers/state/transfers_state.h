#pragma once

#include <cstddef>
#include <cstring>

#include "core/file_transfer/file_transfer.h"
#include "core/ui/state_registry.h"

namespace misty::panel {

inline constexpr const char* kTransfersStateKey = "Transfers";

class TransfersState : public core::StateEntry {
public:
    void set_filter(core::FileTransferFilter filter) { filter_ = filter; }
    core::FileTransferFilter filter() const { return filter_; }

    char* search_query() { return search_query_; }
    const char* search_query() const { return search_query_; }
    std::size_t search_query_capacity() const { return sizeof(search_query_); }
    void clear_search_query() { std::memset(search_query_, 0, sizeof(search_query_)); }

private:
    core::FileTransferFilter filter_ = core::FileTransferFilter::Active;
    char search_query_[256] = "";
};

}  // namespace misty::panel
