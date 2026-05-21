#pragma once

#include <atomic>
#include <cstdint>
#include <string>
#include <unordered_set>
#include <vector>

#include "core/ui/ui_registry.h"
#include "panels/file_explorer/state/loading_state.h"

namespace misty::panel {

/**
 * @brief Registry key for all per-explorer file listings.
 */
inline constexpr const char* kFileListingsStateKey = "Files_Listings";

/**
 * @brief File type for a file item.
 */
enum class FileType {
    LOCAL,
    DELETED,
    REMOTE,
    VIRTUAL,
};

/**
 * @brief A local, virtual, or remote row shown by the file explorer.
 */
struct FileItem {
    std::string name;
    std::string path;
    std::string id;
    bool is_dir = false;
    int64_t size = 0;
    std::string last_modified;
    std::string mime_type;
    FileType type = FileType::LOCAL;
};

/**
 * @brief Current row listing and loading state for one explorer tab.
 */
struct FileListing {
    std::string owner_key;
    std::vector<FileItem> files;
    std::vector<FileItem> trash_files;
    bool is_loading = false;
    bool sort_dirty = true;
    std::atomic<uint64_t> load_generation{0};
    std::atomic<uint64_t> listing_revision{0};
    std::unordered_set<std::string> deleting_files;
    LoadingState loading;

    FileListing() = default;
    explicit FileListing(std::string owner);
    FileListing(const FileListing& other);
    FileListing& operator=(const FileListing& other);
    FileListing(FileListing&& other) noexcept;
    FileListing& operator=(FileListing&& other) noexcept;

    /**
     * @brief Advances the listing revision so views can detect row changes.
     */
    void note_listing_changed();

    /**
     * @brief Returns true when a path is visually marked as deleting.
     */
    bool is_deleting(const std::string& path) const;

    /**
     * @brief Clears rows, delete markers, loading state, and sort metadata.
     */
    void clear();
};

/**
 * @brief Shared UI registry state containing file listings for all explorer tabs.
 */
struct FileListingsState : public core::UIState {
    std::vector<FileListing> listings;

    /**
     * @brief Returns the listing for an owner key, creating it if needed.
     */
    FileListing& get_or_create(const std::string& owner_key);

    /**
     * @brief Returns the listing for an owner key, or nullptr if absent.
     */
    FileListing* find(const std::string& owner_key);

    /**
     * @brief Returns the listing for an owner key, or nullptr if absent.
     */
    const FileListing* find(const std::string& owner_key) const;

    /**
     * @brief Removes the listing for an owner key.
     */
    void erase(const std::string& owner_key);

    /**
     * @brief Clears the listing for an owner key, creating it if absent.
     */
    void clear(const std::string& owner_key);

    /**
     * @brief Advances the listing revision for an owner key.
     */
    void note_listing_changed(const std::string& owner_key);

    /**
     * @brief Returns true when a path is marked as deleting for an owner key.
     */
    bool is_deleting(const std::string& owner_key, const std::string& path) const;
};

}  // namespace misty::panel
