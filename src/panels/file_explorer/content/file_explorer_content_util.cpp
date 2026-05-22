#include "panels/file_explorer/content/file_explorer_content_util.h"

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <fstream>
#include <mutex>

#include "core/system/util.h"
#include "panels/file_explorer/state/remote_mount_state.h"

namespace fs = std::filesystem;

namespace misty::panel {
namespace {

bool is_remote_mount_path(const std::string& path) {
    const std::string mount_root = get_mount_root();
    return !path.empty() && path.rfind(mount_root, 0) == 0;
}

std::string trim_leading_slash(std::string value) {
    while (!value.empty() && value.front() == '/') {
        value.erase(value.begin());
    }
    return value;
}

std::string remote_sync_path_for_item(const RemoteBrowseTarget& target,
                                      const core::FileMasterListItem& remote_item,
                                      const std::string& item_name) {
    if (!remote_item.path.empty()) {
        return trim_leading_slash(remote_item.path);
    }
    fs::path base = trim_leading_slash(target.remote_path);
    if (!item_name.empty()) {
        base /= item_name;
    }
    return base.generic_string();
}

void materialize_remote_cache_item(const fs::path& path, bool is_dir) {
    std::error_code ec;
    if (is_dir) {
        fs::create_directories(path, ec);
        return;
    }

    fs::create_directories(path.parent_path(), ec);
    if (ec || fs::exists(path, ec)) {
        return;
    }
    std::ofstream placeholder(path, std::ios::binary);
}

void assign_formatted_last_write_time(const fs::directory_entry& entry, FileItem& item) {
    std::error_code ec;
    auto ftime = entry.last_write_time(ec);
    if (ec) {
        return;
    }

    const auto sctp = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
        ftime - fs::file_time_type::clock::now() + std::chrono::system_clock::now());
    const auto time_value = std::chrono::system_clock::to_time_t(sctp);
    char buffer[32];
    if (std::strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M", std::localtime(&time_value)) != 0) {
        item.last_modified = buffer;
    }
}

}  // namespace

std::string file_explorer_tab_title_for_path(const std::string& path) {
    if (path.empty()) {
        return "Files";
    }

    if (path == FileExplorerState::VIRTUAL_PATH_RECENT) {
        return "Recent";
    }
    if (path == FileExplorerState::VIRTUAL_PATH_STARRED) {
        return "Starred";
    }
    if (path == FileExplorerState::VIRTUAL_PATH_TRASH) {
        return "Trash";
    }

    const fs::path normalized = fs::path(path).lexically_normal();
    const std::string leaf = normalized.filename().string();
    if (!leaf.empty() && leaf != ".") {
        return leaf;
    }

    const std::string normalized_path = normalized.string();
    return normalized_path.empty() ? path : normalized_path;
}

std::string default_local_start_path() {
    if (const char* home = std::getenv("HOME")) {
        return home;
    }
    return fs::current_path().string();
}

bool is_provider_mount_root(const std::string& path) {
    if (!is_remote_mount_path(path)) {
        return false;
    }

    const fs::path relative = fs::path(path).lexically_relative(get_mount_root());
    std::size_t components = 0;
    for (const auto& part : relative) {
        if (!part.empty() && part != ".") {
            ++components;
        }
    }
    return components == 1;
}

std::optional<RemoteBrowseTarget> remote_browse_target_for(const std::string& path) {
    if (!is_remote_mount_path(path)) {
        return std::nullopt;
    }

    const fs::path relative = fs::path(path).lexically_relative(get_mount_root());
    std::vector<std::string> parts;
    for (const auto& part : relative) {
        const std::string value = part.string();
        if (!value.empty() && value != ".") {
            parts.push_back(value);
        }
    }

    if (parts.size() < 2) {
        return std::nullopt;
    }

    RemoteBrowseTarget target;
    target.provider_folder = parts[0];
    target.remote_name = parts[1];
    if (parts.size() > 2) {
        fs::path remote_path;
        for (std::size_t i = 2; i < parts.size(); ++i) {
            remote_path /= parts[i];
        }
        target.remote_path = "/" + remote_path.generic_string();
    }
    return target;
}

std::vector<FileItem> provider_mount_items_for(const std::string& provider_folder,
                                                      const std::vector<ProviderCard>& cards) {
    std::vector<FileItem> items;
    for (const auto& card : cards) {
        if (card.provider_id != provider_folder) {
            continue;
        }

        FileItem item;
        item.name = card.account_label.empty() ? card.id : card.account_label;
        item.path = (fs::path(get_mount_root()) / provider_folder / item.name).string();
        item.id = item.path;
        item.is_dir = true;
        item.size = 0;
        item.mime_type = card.provider_label;
        item.type = FileType::LOCAL;
        items.push_back(std::move(item));
    }
    return items;
}

core::FileMasterProps remote_list_props_for(const RemoteBrowseTarget& target) {
    core::FileMasterProps props;
    props.remote_source.remote_name = target.remote_name;
    props.remote_source.provider_type = target.provider_folder;
    props.remote_source.remote_path = target.remote_path;
    return props;
}

std::vector<FileItem> remote_mount_items_for(
    const RemoteBrowseTarget& target,
    const std::vector<core::FileMasterListItem>& remote_items) {
    const fs::path remote_root =
        fs::path(get_mount_root()) /
        target.provider_folder /
        target.remote_name;

    std::vector<FileItem> items;
    items.reserve(remote_items.size());
    for (const auto& remote_item : remote_items) {
        FileItem item;
        item.name = remote_item.name.empty()
            ? fs::path(remote_item.path).filename().string()
            : remote_item.name;
        item.sync_remote_name = target.remote_name;
        item.sync_remote_path = remote_sync_path_for_item(target, remote_item, item.name);
        const fs::path remote_item_path = fs::path(item.sync_remote_path).relative_path();
        item.path = (remote_root / remote_item_path).string();
        materialize_remote_cache_item(item.path, remote_item.is_dir);
        item.id = item.path;
        item.is_dir = remote_item.is_dir;
        item.size = remote_item.size;
        item.last_modified = remote_item.last_modified;
        item.mime_type = remote_item.mime_type;
        item.type = FileType::REMOTE;
        items.push_back(std::move(item));
    }
    return items;
}

bool populate_virtual_listing(LibraryState& library,
                              const std::string& path,
                              VirtualListingResult& result) {
    if (path.rfind("misty://", 0) != 0) {
        return false;
    }

    std::lock_guard<std::mutex> lock(library.mu);

    if (path == FileExplorerState::VIRTUAL_PATH_RECENT) {
        const auto it = std::remove_if(library.recent_files.begin(), library.recent_files.end(),
            [](const FileItem& file) {
                return file.type == FileType::DELETED || !fs::exists(file.path);
            });
        if (it != library.recent_files.end()) {
            library.recent_files.erase(it, library.recent_files.end());
            library.dirty = true;
        }
        result.files.assign(library.recent_files.begin(), library.recent_files.end());
        return true;
    }

    if (path == FileExplorerState::VIRTUAL_PATH_STARRED) {
        result.files = library.starred_files;
        return true;
    }

    if (path == FileExplorerState::VIRTUAL_PATH_TRASH) {
        const char* home = std::getenv("HOME");
        if (!home) {
            return true;
        }

        const std::string trash_dir = std::string(home) + "/.misty/.cache/trash";
        if (!fs::exists(trash_dir)) {
            return true;
        }

        for (const auto& entry : fs::directory_iterator(trash_dir)) {
            FileItem item;
            item.path = core::path_utf8_string(entry.path());
            item.id = item.path;
            item.name = core::path_utf8_filename(entry.path());
            item.is_dir = entry.is_directory();
            item.type = FileType::DELETED;

            try {
                if (!item.is_dir) {
                    item.size = fs::file_size(entry.path());
                }
                assign_formatted_last_write_time(entry, item);
            } catch (...) {
            }

            result.files.push_back(item);
            result.trash_files.push_back(std::move(item));
        }
        return true;
    }

    return false;
}

bool should_skip_local_entry(const fs::directory_entry& entry, bool show_hidden) {
    const std::string file_name = core::path_utf8_filename(entry.path());
    return !show_hidden && !file_name.empty() && file_name[0] == '.';
}

FileItem make_local_file_item(const fs::directory_entry& entry) {
    FileItem item;
    item.path = core::path_utf8_generic_string(entry.path());
    item.id = item.path;
    item.name = core::path_utf8_filename(entry.path());

    std::error_code ec;
    item.is_dir = entry.is_directory(ec);
    item.type = FileType::LOCAL;

    if (!item.is_dir) {
        item.size = static_cast<int64_t>(entry.file_size(ec));
        if (ec) {
            ec.clear();
            item.size = 0;
        }
    }

    try {
        assign_formatted_last_write_time(entry, item);
    } catch (...) {
    }

    return item;
}

}  // namespace misty::panel
