#pragma once

#include <atomic>
#include <deque>
#include <mutex>
#include <string>
#include <vector>

#include "core/threading/worker_pool.h"
#include "core/ui/state_registry.h"
#include "panels/file_explorer/state/file_listings_state.h"

namespace misty::panel {

/**
 * @brief Registry key for persisted explorer library data.
 */
inline constexpr const char* kLibraryStateKey = "Files_Library";

/**
 * @brief Shared persisted state for explorer Recent, Starred, and last opened path.
 */
struct LibraryState : public core::StateEntry {
    std::deque<FileItem> recent_files;
    std::vector<FileItem> starred_files;
    std::string last_opened_path;
    std::mutex mu;
    std::atomic<bool> dirty{false};

    /**
     * @brief Loads persisted recent, starred, and last-opened explorer state.
     */
    void load();

    /**
     * @brief Writes persisted explorer library state synchronously.
     */
    void save();

    /**
     * @brief Queues a non-blocking write-behind save when state is dirty.
     */
    void save_async(core::WorkerPool& pool);

    /**
     * @brief Returns true when the path is present in the starred virtual listing.
     */
    bool is_starred(const std::string& path) const;

    /**
     * @brief Adds or removes an item from the starred virtual listing.
     */
    void toggle_star(const FileItem& item);

    /**
     * @brief Moves an item to the front of the recent virtual listing.
     */
    void add_recent(const FileItem& item);

    /**
     * @brief Updates virtual listings after a file is moved, renamed, or deleted.
     */
    void track_move(const std::string& old_path, const FileItem& new_item);

private:
    std::atomic<bool> save_in_flight_{false};
};

}  // namespace misty::panel
