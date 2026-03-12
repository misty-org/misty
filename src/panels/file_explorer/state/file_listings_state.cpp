#include "panels/file_explorer/state/file_listings_state.h"

#include <algorithm>
#include <utility>

namespace misty::panel {

FileListing::FileListing(std::string owner) : owner_key(std::move(owner)) {}

FileListing::FileListing(const FileListing& other)
    : owner_key(other.owner_key),
      files(other.files),
      trash_files(other.trash_files),
      hidden_item_count(other.hidden_item_count),
      is_loading(other.is_loading),
      sort_dirty(other.sort_dirty),
      last_refreshed_at(other.last_refreshed_at),
      last_synced_at(other.last_synced_at),
      deleting_files(other.deleting_files),
      error_message(other.error_message),
      loading(other.loading) {
    load_generation.store(other.load_generation.load(std::memory_order_relaxed),
                                std::memory_order_relaxed);
    listing_revision.store(other.listing_revision.load(std::memory_order_relaxed),
                           std::memory_order_relaxed);
}

FileListing& FileListing::operator=(const FileListing& other) {
    if (this == &other) {
        return *this;
    }

    owner_key = other.owner_key;
    files = other.files;
    trash_files = other.trash_files;
    hidden_item_count = other.hidden_item_count;
    is_loading = other.is_loading;
    sort_dirty = other.sort_dirty;
    last_refreshed_at = other.last_refreshed_at;
    last_synced_at = other.last_synced_at;
    deleting_files = other.deleting_files;
    error_message = other.error_message;
    loading = other.loading;
    load_generation.store(other.load_generation.load(std::memory_order_relaxed),
                                std::memory_order_relaxed);
    listing_revision.store(other.listing_revision.load(std::memory_order_relaxed),
                           std::memory_order_relaxed);
    return *this;
}

FileListing::FileListing(FileListing&& other) noexcept
    : owner_key(std::move(other.owner_key)),
      files(std::move(other.files)),
      trash_files(std::move(other.trash_files)),
      hidden_item_count(other.hidden_item_count),
      is_loading(other.is_loading),
      sort_dirty(other.sort_dirty),
      last_refreshed_at(other.last_refreshed_at),
      last_synced_at(other.last_synced_at),
      deleting_files(std::move(other.deleting_files)),
      error_message(std::move(other.error_message)),
      loading(other.loading) {
    load_generation.store(other.load_generation.load(std::memory_order_relaxed),
                                std::memory_order_relaxed);
    listing_revision.store(other.listing_revision.load(std::memory_order_relaxed),
                           std::memory_order_relaxed);
}

FileListing& FileListing::operator=(FileListing&& other) noexcept {
    if (this == &other) {
        return *this;
    }

    owner_key = std::move(other.owner_key);
    files = std::move(other.files);
    trash_files = std::move(other.trash_files);
    hidden_item_count = other.hidden_item_count;
    is_loading = other.is_loading;
    sort_dirty = other.sort_dirty;
    last_refreshed_at = other.last_refreshed_at;
    last_synced_at = other.last_synced_at;
    deleting_files = std::move(other.deleting_files);
    error_message = std::move(other.error_message);
    loading = other.loading;
    load_generation.store(other.load_generation.load(std::memory_order_relaxed),
                                std::memory_order_relaxed);
    listing_revision.store(other.listing_revision.load(std::memory_order_relaxed),
                           std::memory_order_relaxed);
    return *this;
}

void FileListing::note_listing_changed() {
    listing_revision.fetch_add(1, std::memory_order_relaxed);
}

bool FileListing::is_deleting(const std::string& path) const {
    return deleting_files.count(path) > 0;
}

void FileListing::clear() {
    files.clear();
    trash_files.clear();
    deleting_files.clear();
    hidden_item_count = 0;
    is_loading = false;
    sort_dirty = true;
    last_refreshed_at = {};
    last_synced_at = {};
    error_message.clear();
    load_generation.fetch_add(1, std::memory_order_relaxed);
    loading.cancel();
    note_listing_changed();
}

FileListing& FileListingsState::get_or_create(const std::string& owner_key) {
    std::lock_guard<std::mutex> lock(mu);
    auto it = listings.find(owner_key);
    if (it != listings.end()) {
        return *it->second;
    }
    auto listing = std::make_unique<FileListing>(owner_key);
    FileListing& ref = *listing;
    listings.emplace(owner_key, std::move(listing));
    return ref;
}

FileListing* FileListingsState::find(const std::string& owner_key) {
    std::lock_guard<std::mutex> lock(mu);
    auto it = listings.find(owner_key);
    return it == listings.end() ? nullptr : it->second.get();
}

const FileListing* FileListingsState::find(const std::string& owner_key) const {
    std::lock_guard<std::mutex> lock(mu);
    auto it = listings.find(owner_key);
    return it == listings.end() ? nullptr : it->second.get();
}

void FileListingsState::erase(const std::string& owner_key) {
    std::lock_guard<std::mutex> lock(mu);
    listings.erase(owner_key);
}

void FileListingsState::clear(const std::string& owner_key) {
    get_or_create(owner_key).clear();
}

void FileListingsState::note_listing_changed(const std::string& owner_key) {
    get_or_create(owner_key).note_listing_changed();
}

bool FileListingsState::is_deleting(const std::string& owner_key, const std::string& path) const {
    const auto* listing = find(owner_key);
    return listing != nullptr && listing->is_deleting(path);
}

}  // namespace misty::panel
