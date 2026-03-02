#include "panels/file_explorer/file_explorer_panel.h"

namespace misty::panel {

bool FileExplorerPanel::resolve_remote_path_context(const std::string& path,
                                                    std::string& remote_name,
                                                    std::string& remote_path) const {
    remote_name.clear();
    remote_path.clear();

    const auto info = path_utils::parse_remote_path(path);
    if (info.provider_folder.empty() || info.remote_name.empty()) {
        return false;
    }

    remote_name = info.remote_name;
    remote_path = info.relative_path;
    return true;
}

void FileExplorerPanel::toggle_current_sync_watch(FileExplorerState& state) {
    (void)state;
}

void FileExplorerPanel::sync_account_mappings() {}

void FileExplorerPanel::navigate_to_remote_mount_root(bool update_history) {
    (void)update_history;
}

void FileExplorerPanel::navigate_to_provider_folder(const std::string& provider_folder, bool update_history) {
    (void)provider_folder;
    (void)update_history;
}

void FileExplorerPanel::navigate_to_remote(const std::string& remote_name,
                                           const std::string& path,
                                           bool update_history,
                                           bool create_if_missing,
                                           uint64_t navigation_generation) {
    (void)remote_name;
    (void)path;
    (void)update_history;
    (void)create_if_missing;
    (void)navigation_generation;
}

void FileExplorerPanel::fetch_remote_folder(const std::string& remote_name,
                                            const std::string& remote_path,
                                            const std::string& target_path,
                                            uint64_t navigation_generation) {
    (void)remote_name;
    (void)remote_path;
    (void)target_path;
    (void)navigation_generation;
}

void FileExplorerPanel::handle_remote_folder_fetch(const std::string& remote_name,
                                                   const std::string& target_path,
                                                   uint64_t navigation_generation,
                                                   bool success,
                                                   const std::string& body,
                                                   const std::string& error,
                                                   bool preserve_selection) {
    (void)remote_name;
    (void)target_path;
    (void)navigation_generation;
    (void)success;
    (void)body;
    (void)error;
    (void)preserve_selection;
}

void FileExplorerPanel::download_remote_file(const UnifiedFileItem& file) {
    (void)file;
}

void FileExplorerPanel::apply_remote_folder_fetch(core::UIRegistry& registry,
                                                  const std::string& state_key,
                                                  const std::string& remote_name,
                                                  const std::string& target_path,
                                                  uint64_t navigation_generation,
                                                  bool success,
                                                  const std::string& body,
                                                  const std::string& error,
                                                  bool preserve_selection) {
    (void)registry;
    (void)state_key;
    (void)remote_name;
    (void)target_path;
    (void)navigation_generation;
    (void)success;
    (void)body;
    (void)error;
    (void)preserve_selection;
}

} // namespace misty::panel
