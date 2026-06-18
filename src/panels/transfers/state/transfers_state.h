#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>
#include <set>
#include <unordered_set>
#include <vector>

#include "core/file_transfer/file_transfer.h"
#include "core/ui/state_registry.h"

namespace misty::panel {

enum class TransferLocationScope {
    All,
    Local,
    Remote,
};

enum class TransferSortKey {
    Time,
    Name,
    Operation,
    Status,
};

enum class TransferSortDirection {
    Ascending,
    Descending,
};

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

    const std::set<std::string>& provider_filters() const { return provider_filters_; }
    void toggle_provider_filter(const std::string& provider);
    bool provider_selected(const std::string& provider) const;

    const std::set<core::FileTransferType>& type_filters() const { return type_filters_; }
    void toggle_type_filter(core::FileTransferType type);
    bool type_selected(core::FileTransferType type) const;

    TransferLocationScope location_scope() const { return location_scope_; }
    void set_location_scope(TransferLocationScope scope);
    TransferSortKey sort_key() const { return sort_key_; }
    TransferSortDirection sort_direction() const { return sort_direction_; }
    void set_sort(TransferSortKey key, TransferSortDirection direction);
    bool filters_panel_visible() const { return filters_panel_visible_; }
    void set_filters_panel_visible(bool visible) { filters_panel_visible_ = visible; }
    void toggle_filters_panel() { filters_panel_visible_ = !filters_panel_visible_; }
    std::size_t active_filter_count() const;
    void clear_filters();

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

    uint64_t focused_transfer_id() const { return focused_transfer_id_; }
    void set_focused_transfer_id(uint64_t transfer_id) { focused_transfer_id_ = transfer_id; }
    void clear_focused_transfer() { focused_transfer_id_ = 0; }
    void prune_focused_transfer(const std::vector<core::FileTransferRecord>& rows);

private:
    void on_view_filter_changed(bool clear_focus = true);

    core::FileTransferFilter filter_ = core::FileTransferFilter::All;
    std::set<std::string> provider_filters_;
    std::set<core::FileTransferType> type_filters_;
    TransferLocationScope location_scope_ = TransferLocationScope::All;
    TransferSortKey sort_key_ = TransferSortKey::Time;
    TransferSortDirection sort_direction_ = TransferSortDirection::Descending;
    bool filters_panel_visible_ = true;
    std::size_t page_index_ = 0;
    std::string last_search_query_;
    char search_query_[256] = "";
    std::unordered_set<uint64_t> selected_transfer_ids_;
    uint64_t focused_transfer_id_ = 0;
};

}  // namespace misty::panel
