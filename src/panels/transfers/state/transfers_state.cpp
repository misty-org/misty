#include "panels/transfers/state/transfers_state.h"

#include <algorithm>
#include <unordered_set>

namespace misty::panel {

void TransfersState::set_filter(core::FileTransferFilter filter) {
    if (filter_ == filter) {
        return;
    }
    filter_ = filter;
    on_view_filter_changed();
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

void TransfersState::toggle_provider_filter(const std::string& provider) {
    if (provider.empty()) {
        return;
    }
    if (provider_filters_.contains(provider)) {
        provider_filters_.erase(provider);
    } else {
        provider_filters_.insert(provider);
    }
    on_view_filter_changed();
}

bool TransfersState::provider_selected(const std::string& provider) const {
    return provider_filters_.contains(provider);
}

void TransfersState::toggle_type_filter(core::FileTransferType type) {
    if (type_filters_.contains(type)) {
        type_filters_.erase(type);
    } else {
        type_filters_.insert(type);
    }
    on_view_filter_changed();
}

bool TransfersState::type_selected(core::FileTransferType type) const {
    return type_filters_.contains(type);
}

void TransfersState::set_location_scope(TransferLocationScope scope) {
    if (location_scope_ == scope) {
        return;
    }
    location_scope_ = scope;
    on_view_filter_changed();
}

void TransfersState::set_sort(TransferSortKey key, TransferSortDirection direction) {
    if (sort_key_ == key && sort_direction_ == direction) {
        return;
    }
    sort_key_ = key;
    sort_direction_ = direction;
    page_index_ = 0;
}

std::size_t TransfersState::active_filter_count() const {
    return provider_filters_.size() + type_filters_.size() +
        (location_scope_ == TransferLocationScope::All ? 0u : 1u) +
        (filter_ == core::FileTransferFilter::All ? 0u : 1u);
}

void TransfersState::clear_filters() {
    provider_filters_.clear();
    type_filters_.clear();
    location_scope_ = TransferLocationScope::All;
    filter_ = core::FileTransferFilter::All;
    on_view_filter_changed();
}

void TransfersState::on_view_filter_changed(bool clear_focus) {
    page_index_ = 0;
    clear_selection();
    if (clear_focus) {
        clear_focused_transfer();
    }
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

void TransfersState::prune_focused_transfer(const std::vector<core::FileTransferRecord>& rows) {
    if (focused_transfer_id_ == 0) {
        return;
    }
    const auto it = std::find_if(rows.begin(), rows.end(), [&](const core::FileTransferRecord& row) {
        return row.id == focused_transfer_id_;
    });
    if (it == rows.end()) {
        focused_transfer_id_ = 0;
    }
}

std::vector<uint64_t> TransfersState::selected_transfer_ids() const {
    return {selected_transfer_ids_.begin(), selected_transfer_ids_.end()};
}

}  // namespace misty::panel
