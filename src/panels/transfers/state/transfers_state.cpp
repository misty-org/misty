#include "panels/transfers/state/transfers_state.h"

#include <algorithm>
#include <unordered_set>

namespace misty::panel {

void TransfersState::set_filter(core::FileTransferFilter filter) {
    if (filter_ == filter) {
        return;
    }
    filter_ = filter;
    page_index_ = 0;
    clear_selection();
}

bool TransfersState::update_search_revision() {
    const std::string current(search_query_);
    if (current == last_search_query_) {
        return false;
    }
    last_search_query_ = current;
    page_index_ = 0;
    clear_selection();
    return true;
}

void TransfersState::next_page(std::size_t page_count) {
    if (page_count == 0) {
        page_index_ = 0;
        return;
    }
    page_index_ = std::min(page_index_ + 1, page_count - 1);
}

void TransfersState::previous_page() {
    if (page_index_ > 0) {
        --page_index_;
    }
}

void TransfersState::clamp_page(std::size_t total_count) {
    if (total_count == 0) {
        page_index_ = 0;
        return;
    }
    const std::size_t page_count = (total_count + kPageSize - 1) / kPageSize;
    page_index_ = std::min(page_index_, page_count - 1);
}

bool TransfersState::is_selected(uint64_t transfer_id) const {
    return selected_transfer_ids_.contains(transfer_id);
}

void TransfersState::set_selected(uint64_t transfer_id, bool selected) {
    if (selected) {
        selected_transfer_ids_.insert(transfer_id);
    } else {
        selected_transfer_ids_.erase(transfer_id);
    }
}

void TransfersState::toggle_selected(uint64_t transfer_id) {
    set_selected(transfer_id, !is_selected(transfer_id));
}

void TransfersState::clear_selection() {
    selected_transfer_ids_.clear();
}

void TransfersState::prune_selection(const std::vector<core::FileTransferRecord>& rows) {
    std::unordered_set<uint64_t> live_ids;
    live_ids.reserve(rows.size());
    for (const auto& row : rows) {
        live_ids.insert(row.id);
    }
    for (auto it = selected_transfer_ids_.begin(); it != selected_transfer_ids_.end();) {
        if (!live_ids.contains(*it)) {
            it = selected_transfer_ids_.erase(it);
        } else {
            ++it;
        }
    }
}

std::vector<uint64_t> TransfersState::selected_transfer_ids() const {
    return {selected_transfer_ids_.begin(), selected_transfer_ids_.end()};
}

}  // namespace misty::panel
