#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <unordered_set>
#include <vector>

#include "core/file_master/file_master.h"
#include "panels/file_explorer/state/file_explorer_state.h"
#include "panels/file_explorer/state/file_listings_state.h"
#include "panels/file_explorer/state/library_state.h"
#include "panels/providers/state/providers_state.h"

namespace misty::panel {

/**
 * @brief Parsed destination for a path under the virtual remote mount root.
 */
struct RemoteBrowseTarget {
    std::string provider_folder;
    std::string remote_name;
    std::string remote_path;
};

/**
 * @brief Result payload for virtual explorer locations such as Recent and Trash.
 */
struct VirtualListingResult {
    std::vector<FileItem> files;
    std::vector<FileItem> trash_files;
};

/**
 * @brief Builds a compact tab title from a local, virtual, or remote path.
 */
std::string file_explorer_tab_title_for_path(const std::string& path);

/**
 * @brief Returns the initial local folder used when no prior state is available.
 */
std::string default_local_start_path();

/**
 * @brief Returns true when a path points at a provider folder under the mount root.
 */
bool is_provider_mount_root(const std::string& path);

/**
 * @brief Parses a mounted provider path into a remote browse target.
 */
std::optional<RemoteBrowseTarget> remote_browse_target_for(const std::string& path);

/**
 * @brief Converts provider cards into explorer rows for a provider mount root.
 */
std::vector<FileItem> provider_mount_items_for(const std::string& provider_folder,
                                                      const std::vector<ProviderCard>& cards);

/**
 * @brief Builds FileMaster listing props for a remote browse target.
 */
core::FileMasterProps remote_list_props_for(const RemoteBrowseTarget& target);

/**
 * @brief Builds FileMaster operation props for a local explorer row.
 */
core::FileMasterProps local_file_master_props_for(const FileItem& item,
                                                  const std::string& dest_path = {});

/**
 * @brief Builds FileMaster operation props for a local or remote explorer row.
 */
core::FileMasterProps remote_file_master_props_for(const FileItem& item,
                                                   const std::string& dest_path = {});

/**
 * @brief Materializes remote list results under the mount root and returns cached explorer rows.
 */
std::vector<FileItem> remote_mount_items_for(
    const RemoteBrowseTarget& target,
    const std::vector<core::FileMasterListItem>& remote_items);

/**
 * @brief Returns true when the row has enough remote metadata for FileMasterRemote.
 */
bool is_remote_file_master_item(const FileItem& item);

/**
 * @brief Returns true when the row can be handled by FileMasterLocal or FileMasterRemote.
 */
bool is_file_master_item(const FileItem& item);

/**
 * @brief Returns true when every selected row can be handled by a FileMaster implementation.
 */
bool selected_items_are_file_master_items(const std::unordered_set<std::string>& selected_ids,
                                          const FileListing& listing);

/**
 * @brief Returns true when exactly one selected row can be handled by a FileMaster implementation.
 */
bool exactly_one_file_master_item_selected(const std::unordered_set<std::string>& selected_ids,
                                           const FileListing& listing);

/**
 * @brief Finds a row in a listing by its stable selection id.
 */
const FileItem* find_file_item_by_id(const FileListing& listing,
                                     const std::string& id);

/**
 * @brief Finds a row in a list by its filesystem or mounted path.
 */
const FileItem* find_file_item_by_path(const std::vector<FileItem>& items,
                                       const std::string& path);

/**
 * @brief Resolves selected ids into the corresponding listing rows.
 */
std::vector<FileItem> selected_file_items(const std::unordered_set<std::string>& selected_ids,
                                          const FileListing& listing);

/**
 * @brief Populates a virtual listing when the given path is a supported virtual path.
 */
bool populate_virtual_listing(LibraryState& library,
                              const std::string& path,
                              VirtualListingResult& result);

/**
 * @brief Returns true when a local directory entry should be hidden from the listing.
 */
bool should_skip_local_entry(const std::filesystem::directory_entry& entry, bool show_hidden);

/**
 * @brief Converts a filesystem directory entry into a FileItem row.
 */
FileItem make_local_file_item(const std::filesystem::directory_entry& entry);

}  // namespace misty::panel
