#pragma once

#include <algorithm>
#include <cstdint>
#include <vector>

namespace misty::panel::transfer_state {

template <typename Item, typename Fn>
void update_item_by_id(std::vector<Item>& items, uint64_t id, Fn&& fn) {
    for (auto& item : items) {
        if (item.id == id) {
            fn(item);
            break;
        }
    }
}

template <typename Item, typename Predicate>
void erase_matching(std::vector<Item>& items, Predicate&& predicate) {
    items.erase(
        std::remove_if(items.begin(), items.end(), std::forward<Predicate>(predicate)),
        items.end()
    );
}

template <typename Item>
std::vector<Item> get_active_items_copy(const std::vector<Item>& items) {
    std::vector<Item> active;
    active.reserve(items.size());
    for (const auto& item : items) {
        if (item.is_active()) {
            active.push_back(item);
        }
    }
    return active;
}

template <typename Item>
void clear_inactive_items(std::vector<Item>& items) {
    erase_matching(items, [](const Item& item) { return !item.is_active(); });
}

template <typename Item>
size_t count_active_items(const std::vector<Item>& items) {
    size_t count = 0;
    for (const auto& item : items) {
        if (item.is_active()) {
            count++;
        }
    }
    return count;
}

template <typename Item>
void cleanup_old_history(std::vector<Item>& items, size_t max_history) {
    size_t completed_count = 0;
    for (auto it = items.rbegin(); it != items.rend(); ++it) {
        if (!it->is_active()) {
            completed_count++;
        }
    }

    if (completed_count <= max_history) return;

    size_t to_remove = completed_count - max_history;
    for (auto it = items.begin(); it != items.end() && to_remove > 0;) {
        if (!it->is_active()) {
            it = items.erase(it);
            to_remove--;
        } else {
            ++it;
        }
    }
}

} // namespace misty::panel::transfer_state
