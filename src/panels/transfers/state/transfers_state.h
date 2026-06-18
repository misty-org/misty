#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>
#include <unordered_set>
#include <vector>

#include "core/file_transfer/file_transfer.h"
#include "core/ui/state_registry.h"

namespace misty::panel {

inline constexpr const char* kTransfersStateKey = "Transfers";

class TransfersState : public core::StateEntry {
public:
    static constexpr std::size_t kPageSize = 25;

    void set_filter(core::FileTransferFilter filter);
    core::FileTransferFilter filter() const { return filter_; }

    char* search_query() { return search_query_; }
    const char* search_query() const { return search_query_; }
    std::size_t search_query_capacity() const { return sizeof(search_query_); }
    void clear_search_query() { std::memset(search_query_, 0, sizeof(search_query_)); }
    bool update_search_revision();

    std::size_t page_index() const { return page_index_; }
    void set_page_index(std::size_t page_index) { page_index_ = page_index; }
    void next_page(std::size_t page_count);
    void previous_page();
    void clamp_page(std::size_t total_count);
    std::size_t page_offset() const { return page_index_ * kPageSize; }

    bool is_selected(uint64_t transfer_id) const;
    void set_selected(uint64_t transfer_id, bool selected);
    void toggle_selected(uint64_t transfer_id);
    void clear_selection();
    void prune_selection(const std::vector<core::FileTransferRecord>& rows);
    std::size_t selected_count() const { return selected_transfer_ids_.size(); }
    std::vector<uint64_t> selected_transfer_ids() const;

private:
    core::FileTransferFilter filter_ = core::FileTransferFilter::All;
    std::size_t page_index_ = 0;
    std::string last_search_query_;
    char search_query_[256] = "";
    std::unordered_set<uint64_t> selected_transfer_ids_;
};

}  // namespace misty::panel
