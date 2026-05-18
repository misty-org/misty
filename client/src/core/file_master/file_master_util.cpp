#include "core/file_master/file_master_util.h"

#include <filesystem>
#include <utility>

#include <nlohmann/json.hpp>

#include "core/file_master/file_master_api.h"

namespace fs = std::filesystem;

namespace misty::core {

void complete(const std::shared_ptr<FileMasterCompletion>& callback, FileMasterResult result) {
    if (callback && *callback) {
        (*callback)(std::move(result));
    }
}

FileMasterResult make_success() {
    return FileMasterResult{true, ""};
}

FileMasterResult make_error(std::string error_message) {
    return FileMasterResult{false, std::move(error_message)};
}

/* Local File Master Utility Functions */
FileMasterLocalContext normalize_local_context(const FileMasterLocalContext& context) {
    return context;
}

FileMasterProps normalize_local_props(const FileMasterProps& props) {
    FileMasterProps normalized = props;
    normalized.local_source = normalize_local_context(props.local_source);
    normalized.local_dest = normalize_local_context(props.local_dest);
    return normalized;
}

FileMasterResult validate_local_props(const FileMasterProps& props) {
    if (props.local_source.path.empty()) {
        return make_error("local_source.path is required");
    }

    return make_success();
}

/* A bunch of helper functions for local file operations. */
FileMasterResult rename_local_path(const FileMasterProps& props) {
    FileMasterResult result = make_success();

    std::error_code ec;
    fs::rename(props.local_source.path, props.local_dest.path, ec);
    if (ec) {
        return make_error("rename failed: " + ec.message());
    }
    return result;
}

FileMasterResult remove_local_path(const FileMasterProps& props) {
    FileMasterResult result = make_success();

    std::error_code ec;
    fs::remove_all(props.local_source.path, ec);
    if (ec) {
        return make_error("remove failed: " + ec.message());
    }
    return make_success();
}

FileMasterResult copy_local_path(const FileMasterProps& props) {
    FileMasterResult result = make_success();

    std::error_code ec;
    const bool source_is_dir = fs::is_directory(props.local_source.path, ec);
    if (ec) {
        return make_error("copy failed: " + ec.message());
    }

    if (source_is_dir) {
        fs::copy(props.local_source.path, props.local_dest.path, fs::copy_options::recursive, ec);
    } else {
        fs::copy_file(props.local_source.path, props.local_dest.path, fs::copy_options::none, ec);
    }
    if (ec) {
        return make_error("copy failed: " + ec.message());
    }
    return make_success();
}

FileMasterResult cut_local_path(const FileMasterProps& props) {
    FileMasterResult result = make_success();

    std::error_code ec;
    fs::rename(props.local_source.path, props.local_dest.path, ec);
    if (!ec) {
        return make_success();
    }
    if (ec != std::make_error_code(std::errc::cross_device_link)) {
        return make_error("cut failed: " + ec.message());
    }

    FileMasterResult copy_result = copy_local_path(props);
    if (!copy_result.success) {
        return copy_result;
    }

    std::error_code remove_ec;
    fs::remove_all(props.local_source.path, remove_ec);
    if (remove_ec) {
        return make_error("cut failed: " + remove_ec.message());
    }
    return make_success();
}

FileMasterResult list_local_path(const FileMasterProps& props, std::vector<FileMasterListItem>& items) {
    FileMasterResult result = make_success();

    std::error_code ec;
    fs::directory_iterator it(props.local_source.path, ec);
    if (ec) {
        return make_error("list failed: " + ec.message());
    }

    for (const auto& entry : it) {
        FileMasterListItem item;
        item.is_dir = fs::is_directory(entry.path(), ec);
        item.name = entry.path().filename().string();
        item.path = entry.path().string();
        item.size = item.is_dir ? 0 : static_cast<int64_t>(fs::file_size(entry.path(), ec));
        if (ec) {
            item.size = 0;
            ec.clear();
        }
        item.last_modified = std::to_string(
            static_cast<long long>(fs::last_write_time(entry.path(), ec).time_since_epoch().count())
        );
        if (ec) {
            item.last_modified.clear();
            ec.clear();
        }
        item.mime_type = entry.path().extension().string();
        items.emplace_back(std::move(item));
    }
    return result;
}

/* Remote File Master Utility Functions */
FileMasterRemoteContext normalize_remote_context(const FileMasterRemoteContext& context) {
    FileMasterRemoteContext normalized = context;
    if (!normalized.remote_path.empty() && normalized.remote_path.front() != '/') {
        normalized.remote_path.insert(normalized.remote_path.begin(), '/');
    }
    return normalized;
}

FileMasterProps normalize_remote_props(const FileMasterProps& props) {
    FileMasterProps normalized = props;
    normalized.remote_source = normalize_remote_context(props.remote_source);
    normalized.remote_dest = normalize_remote_context(props.remote_dest);
    return normalized;
}

FileMasterResult validate_remote_props(const FileMasterProps& props) {
    if (props.remote_source.remote_name.empty() && props.remote_dest.remote_name.empty()) {
        return make_error("remote_source or remote_dest with remote_name is required");
    }
    return make_success();
}

FileMasterResult rename_remote_path(const FileMasterProps& props) {
    return make_error("Remote rename is not implemented yet.");
}

FileMasterResult remove_remote_path(const FileMasterProps& props) {
    return make_error("Remote remove is not implemented yet.");
}

FileMasterResult copy_remote_path(const FileMasterProps& props) {
    return make_error("Remote copy is not implemented yet.");
}

FileMasterResult cut_remote_path(const FileMasterProps& props) {
    return make_error("Remote cut is not implemented yet.");
}

FileMasterResult list_remote_path(const FileMasterProps& props, std::vector<FileMasterListItem>& items) {
    FileMasterResult result = make_success();

    const HttpResponse response = list_remote_call(props);
    if (response.status_code < 200 || response.status_code >= 300) {
        return make_error("remote list request failed (HTTP " + std::to_string(response.status_code) + ")");
    }

    try {
        const nlohmann::json parsed = nlohmann::json::parse(response.body);
        if (!parsed.is_array()) {
            return result;
        }

        items.clear();
        items.reserve(parsed.size());
        for (const auto& item_json : parsed) {
            FileMasterListItem item;
            item.name = item_json.value("name", std::string{});
            item.path = item_json.value("path", std::string{});
            item.is_dir = item_json.value("is_dir", false);
            item.size = item_json.value("size", static_cast<int64_t>(0));
            item.last_modified = item_json.value("mod_time", std::string{});
            item.mime_type = item_json.value("mime_type", std::string{});
            items.emplace_back(std::move(item));
        }
    } catch (const std::exception& ex) {
        return make_error(std::string("invalid remote list response: ") + ex.what());
    }

    return result;
}

} // namespace misty::core
