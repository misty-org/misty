#include "core/file_master/file_master_util.h"

#include <filesystem>
#include <iostream>
#include <utility>

#include <nlohmann/json.hpp>

#include "core/cache/listing_cache.h"
#include "core/file_master/file_master_api.h"
#include "core/manager/env_manager.h"
#include "core/manager/session_manager.h"
#include "core/net/http_client.h"

namespace fs = std::filesystem;

namespace misty::core {
namespace {

FileMasterResult parse_remote_list_body(const std::string& body, std::vector<FileMasterListItem>& items) {
    try {
        const nlohmann::json parsed = nlohmann::json::parse(body);
        if (!parsed.is_array()) {
            return make_error("invalid remote list response: expected array");
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

    return make_success();
}

const FileMasterRemoteContext& remote_context_for_props(const FileMasterProps& props) {
    return !props.remote_source.empty() ? props.remote_source : props.remote_dest;
}

std::string parent_remote_path(const std::string& remote_path) {
    std::string parent = fs::path(remote_path).parent_path().generic_string();
    return parent.empty() ? "/" : parent;
}

std::string filename_for_path(const std::string& path) {
    return fs::path(path).filename().string();
}

FileMasterResult result_from_response(const HttpResponse& response, const std::string& operation) {
    if (response.status_code >= 200 && response.status_code < 300) {
        return make_success();
    }
    if (!response.body.empty()) {
        return make_error(operation + " failed: " + response.body);
    }
    return make_error(operation + " failed (HTTP " + std::to_string(response.status_code) + ")");
}

FileMasterResult validate_remote_source(const FileMasterProps& props) {
    if (props.remote_source.remote_name.empty() || props.remote_source.remote_path.empty()) {
        return make_error("remote_source.remote_name and remote_source.remote_path are required");
    }
    return make_success();
}

FileMasterResult validate_remote_dest(const FileMasterProps& props) {
    if (props.remote_dest.remote_name.empty() || props.remote_dest.remote_path.empty()) {
        return make_error("remote_dest.remote_name and remote_dest.remote_path are required");
    }
    return make_success();
}

FileMasterResult validate_remote_source_and_dest(const FileMasterProps& props) {
    FileMasterResult result = validate_remote_source(props);
    if (!result.success) {
        return result;
    }
    return validate_remote_dest(props);
}

FileMasterResult create_remote_folder_for_path(const FileMasterProps& props,
                                               const std::string& remote_path,
                                               RemoteJobProgressCallback progress_callback = nullptr) {
    HttpResponse response = mkdir_remote_call(
        props.remote_dest.remote_name,
        remote_path,
        std::move(progress_callback));
    if (response.status_code == 400) {
        return make_success();
    }
    return result_from_response(response, "remote mkdir");
}

FileMasterResult copy_remote_file_to_local(const FileMasterProps& props,
                                           RemoteJobProgressCallback progress_callback = nullptr) {
    if (props.local_dest.path.empty()) {
        return make_error("local_dest.path is required");
    }
    DownloadResult result = download_remote_call(props, props.local_dest.path, std::move(progress_callback));
    if (!result.success) {
        return make_error(result.error_message.empty() ? "remote download failed" : result.error_message);
    }
    return make_success();
}

FileMasterResult copy_remote_dir_to_local(const FileMasterProps& props,
                                          RemoteJobProgressCallback progress_callback = nullptr) {
    std::vector<FileMasterListItem> items;
    FileMasterResult result = list_remote_path(props, items, std::move(progress_callback));
    if (!result.success) {
        return result;
    }

    std::error_code ec;
    fs::create_directories(props.local_dest.path, ec);
    if (ec) {
        return make_error("local directory create failed: " + ec.message());
    }

    for (const auto& item : items) {
        FileMasterProps child = props;
        child.remote_source.remote_path = item.path;
        child.local_dest.path = (fs::path(props.local_dest.path) / item.name).string();
        result = item.is_dir ? copy_remote_dir_to_local(child) : copy_remote_file_to_local(child);
        if (!result.success) {
            return result;
        }
    }
    return make_success();
}

FileMasterResult copy_remote_to_local(const FileMasterProps& props,
                                      RemoteJobProgressCallback progress_callback = nullptr) {
    FileMasterResult dir_result = copy_remote_dir_to_local(props, std::move(progress_callback));
    if (dir_result.success) {
        return dir_result;
    }
    return copy_remote_file_to_local(props);
}

FileMasterResult upload_local_file_to_remote(const FileMasterProps& props,
                                             RemoteJobProgressCallback progress_callback = nullptr) {
    const std::string file_name = filename_for_path(props.remote_dest.remote_path);
    if (file_name.empty()) {
        return make_error("remote_dest.remote_path must include a file name");
    }
    const std::string remote_dir = parent_remote_path(props.remote_dest.remote_path);
    return result_from_response(
        upload_remote_call(props, props.local_source.path, remote_dir, file_name, std::move(progress_callback)),
        "remote upload");
}

FileMasterResult upload_local_dir_to_remote(const FileMasterProps& props,
                                            RemoteJobProgressCallback progress_callback = nullptr) {
    FileMasterResult result = create_remote_folder_for_path(
        props,
        props.remote_dest.remote_path,
        std::move(progress_callback));
    if (!result.success) {
        return result;
    }

    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(props.local_source.path, ec)) {
        if (ec) {
            return make_error("local directory read failed: " + ec.message());
        }

        FileMasterProps child = props;
        child.local_source.path = entry.path().string();
        child.remote_dest.remote_path = (fs::path(props.remote_dest.remote_path) /
                                         entry.path().filename()).generic_string();
        result = entry.is_directory(ec) ? upload_local_dir_to_remote(child) : upload_local_file_to_remote(child);
        if (ec) {
            return make_error("local directory read failed: " + ec.message());
        }
        if (!result.success) {
            return result;
        }
    }
    return make_success();
}

FileMasterResult upload_local_to_remote(const FileMasterProps& props,
                                        RemoteJobProgressCallback progress_callback = nullptr) {
    if (props.local_source.path.empty()) {
        return make_error("local_source.path is required");
    }
    FileMasterResult result = validate_remote_dest(props);
    if (!result.success) {
        return result;
    }

    std::error_code ec;
    const bool source_is_dir = fs::is_directory(props.local_source.path, ec);
    if (ec) {
        return make_error("local source stat failed: " + ec.message());
    }
    return source_is_dir ? upload_local_dir_to_remote(props, std::move(progress_callback))
                         : upload_local_file_to_remote(props, std::move(progress_callback));
}

void clear_remote_mutation_cache(const FileMasterProps& props) {
    if (!props.remote_source.remote_name.empty()) {
        listing_cache::clear(props.remote_source.remote_name, parent_remote_path(props.remote_source.remote_path));
        listing_cache::clear(props.remote_source.remote_name, props.remote_source.remote_path);
    }
    if (!props.remote_dest.remote_name.empty()) {
        listing_cache::clear(props.remote_dest.remote_name, parent_remote_path(props.remote_dest.remote_path));
        listing_cache::clear(props.remote_dest.remote_name, props.remote_dest.remote_path);
    }
}

}  // namespace

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

FileMasterResult rename_remote_path(const FileMasterProps& props,
                                    RemoteJobProgressCallback progress_callback) {
    FileMasterResult validation = validate_remote_source_and_dest(props);
    if (!validation.success) {
        return validation;
    }
    if (props.remote_source.remote_name != props.remote_dest.remote_name) {
        return make_error("remote rename requires source and destination to use the same remote");
    }

    FileMasterResult result = result_from_response(rename_remote_call(props, std::move(progress_callback)), "remote rename");
    if (result.success) {
        clear_remote_mutation_cache(props);
    }
    return result;
}

FileMasterResult remove_remote_path(const FileMasterProps& props,
                                    RemoteJobProgressCallback progress_callback) {
    FileMasterResult validation = validate_remote_source(props);
    if (!validation.success) {
        return validation;
    }

    FileMasterResult result = result_from_response(remove_remote_call(props, std::move(progress_callback)), "remote remove");
    if (result.success) {
        clear_remote_mutation_cache(props);
    }
    return result;
}

FileMasterResult copy_remote_path(const FileMasterProps& props,
                                  RemoteJobProgressCallback progress_callback) {
    if (!props.remote_source.empty() && !props.remote_dest.empty()) {
        std::cerr << "[FileMasterRemote] copy_remote_path branch=remote_to_remote"
                  << " source_remote=" << props.remote_source.remote_name
                  << " source_path=" << props.remote_source.remote_path
                  << " dest_remote=" << props.remote_dest.remote_name
                  << " dest_path=" << props.remote_dest.remote_path
                  << std::endl;
        FileMasterResult validation = validate_remote_source_and_dest(props);
        if (!validation.success) {
            std::cerr << "[FileMasterRemote] copy_remote_path validation failed: "
                      << validation.error_message << std::endl;
            return validation;
        }
        FileMasterResult result = result_from_response(copy_remote_call(props, std::move(progress_callback)), "remote copy");
        if (!result.success) {
            std::cerr << "[FileMasterRemote] copy_remote_path remote_to_remote failed: "
                      << result.error_message << std::endl;
        }
        if (result.success) {
            clear_remote_mutation_cache(props);
        }
        return result;
    }

    if (!props.remote_source.empty() && !props.local_dest.empty()) {
        std::cerr << "[FileMasterRemote] copy_remote_path branch=remote_to_local"
                  << " source_remote=" << props.remote_source.remote_name
                  << " source_path=" << props.remote_source.remote_path
                  << " local_dest=" << props.local_dest.path
                  << std::endl;
        FileMasterResult validation = validate_remote_source(props);
        if (!validation.success) {
            std::cerr << "[FileMasterRemote] copy_remote_path validation failed: "
                      << validation.error_message << std::endl;
            return validation;
        }
        return copy_remote_to_local(props, std::move(progress_callback));
    }

    if (!props.local_source.empty() && !props.remote_dest.empty()) {
        std::cerr << "[FileMasterRemote] copy_remote_path branch=local_to_remote"
                  << " local_source=" << props.local_source.path
                  << " dest_remote=" << props.remote_dest.remote_name
                  << " dest_path=" << props.remote_dest.remote_path
                  << std::endl;
        FileMasterResult result = upload_local_to_remote(props, std::move(progress_callback));
        if (!result.success) {
            std::cerr << "[FileMasterRemote] copy_remote_path local_to_remote failed: "
                      << result.error_message << std::endl;
        }
        if (result.success) {
            clear_remote_mutation_cache(props);
        }
        return result;
    }

    std::cerr << "[FileMasterRemote] copy_remote_path branch=invalid"
              << " remote_source_name=" << props.remote_source.remote_name
              << " remote_source_path=" << props.remote_source.remote_path
              << " remote_dest_name=" << props.remote_dest.remote_name
              << " remote_dest_path=" << props.remote_dest.remote_path
              << " local_source=" << props.local_source.path
              << " local_dest=" << props.local_dest.path
              << std::endl;
    return make_error("remote copy requires remote_source with remote_dest or local_dest, or local_source with remote_dest");
}

FileMasterResult cut_remote_path(const FileMasterProps& props,
                                 RemoteJobProgressCallback progress_callback) {
    if (!props.remote_source.empty() && !props.remote_dest.empty()) {
        std::cerr << "[FileMasterRemote] cut_remote_path branch=remote_to_remote"
                  << " source_remote=" << props.remote_source.remote_name
                  << " source_path=" << props.remote_source.remote_path
                  << " dest_remote=" << props.remote_dest.remote_name
                  << " dest_path=" << props.remote_dest.remote_path
                  << std::endl;
        FileMasterResult validation = validate_remote_source_and_dest(props);
        if (!validation.success) {
            std::cerr << "[FileMasterRemote] cut_remote_path validation failed: "
                      << validation.error_message << std::endl;
            return validation;
        }
        FileMasterResult result = result_from_response(move_remote_call(props, std::move(progress_callback)), "remote move");
        if (!result.success) {
            std::cerr << "[FileMasterRemote] cut_remote_path remote_to_remote failed: "
                      << result.error_message << std::endl;
        }
        if (result.success) {
            clear_remote_mutation_cache(props);
        }
        return result;
    }

    FileMasterResult copy_result = copy_remote_path(props, std::move(progress_callback));
    if (!copy_result.success) {
        return copy_result;
    }

    if (!props.remote_source.empty() && !props.local_dest.empty()) {
        FileMasterResult remove_result = remove_remote_path(props);
        return remove_result.success ? make_success() : remove_result;
    }

    if (!props.local_source.empty() && !props.remote_dest.empty()) {
        std::error_code ec;
        fs::remove_all(props.local_source.path, ec);
        if (ec) {
            return make_error("local remove failed after upload: " + ec.message());
        }
        return make_success();
    }

    return make_error("remote cut requires a remote/local source and destination");
}

bool load_cached_remote_path(const FileMasterProps& props, std::vector<FileMasterListItem>& items) {
    const FileMasterRemoteContext& context = remote_context_for_props(props);
    std::string body;
    if (!listing_cache::load(context.remote_name, context.remote_path, body)) {
        return false;
    }

    FileMasterResult result = parse_remote_list_body(body, items);
    return result.success;
}

std::optional<std::chrono::system_clock::time_point> cached_remote_path_time(const FileMasterProps& props) {
    const FileMasterRemoteContext& context = remote_context_for_props(props);
    return listing_cache::last_write_time(context.remote_name, context.remote_path);
}

FileMasterResult list_remote_path(const FileMasterProps& props,
                                  std::vector<FileMasterListItem>& items,
                                  RemoteJobProgressCallback progress_callback) {
    FileMasterResult result = make_success();

    const HttpResponse response = list_remote_call(props, std::move(progress_callback));
    if (response.status_code < 200 || response.status_code >= 300) {
        return make_error("remote list request failed (HTTP " + std::to_string(response.status_code) + ")");
    }

    result = parse_remote_list_body(response.body, items);
    if (result.success) {
        const FileMasterRemoteContext& context = remote_context_for_props(props);
        listing_cache::save(context.remote_name, context.remote_path, response.body);
    }

    return result;
}

} // namespace misty::core
