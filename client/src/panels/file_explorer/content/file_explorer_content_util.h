#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include "core/file_master/file_master.h"
#include "panels/file_explorer/state/file_explorer_state.h"
#include "panels/providers/state/providers_state.h"

namespace misty::panel {

struct RemoteBrowseTarget {
    std::string provider_folder;
    std::string remote_name;
    std::string remote_path;
};

struct VirtualListingResult {
    std::vector<UnifiedFileItem> files;
    std::vector<UnifiedFileItem> trash_files;
};

std::string file_explorer_tab_title_for_path(const std::string& path);

std::string default_local_start_path();

bool is_provider_mount_root(const std::string& path);

std::optional<RemoteBrowseTarget> remote_browse_target_for(const std::string& path);

std::vector<UnifiedFileItem> provider_mount_items_for(const std::string& provider_folder,
                                                      const std::vector<ProviderCard>& cards);

core::FileMasterProps remote_list_props_for(const RemoteBrowseTarget& target);

std::vector<UnifiedFileItem> remote_mount_items_for(
    const RemoteBrowseTarget& target,
    const std::vector<core::FileMasterListItem>& remote_items);

bool populate_virtual_listing(FileExplorerState& state,
                              const std::string& path,
                              VirtualListingResult& result);

bool should_skip_local_entry(const std::filesystem::directory_entry& entry, bool show_hidden);

UnifiedFileItem make_local_file_item(const std::filesystem::directory_entry& entry);

}  // namespace misty::panel
