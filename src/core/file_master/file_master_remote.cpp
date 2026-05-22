#include "core/file_master/file_master_remote.h"

#include <memory>
#include <utility>

#include "core/file_master/file_master_api.h"
#include "core/file_master/file_master_util.h"

namespace misty::core {

FileMasterRemote::FileMasterRemote(WorkerPool& worker_pool)
    : worker_pool_(worker_pool) {}

void FileMasterRemote::rename(const FileMasterProps& props, FileMasterCompletion callback) {
    if (callback) {
        callback(rename_remote_path(normalize_remote_props(props)));
    }
}

void FileMasterRemote::remove(const FileMasterProps& props, FileMasterCompletion callback) {
    if (callback) {
        callback(remove_remote_path(normalize_remote_props(props)));
    }
}

void FileMasterRemote::copy(const FileMasterProps& props, FileMasterCompletion callback) {
    if (callback) {
        callback(copy_remote_path(normalize_remote_props(props)));
    }
}

void FileMasterRemote::cut(const FileMasterProps& props, FileMasterCompletion callback) {
    if (callback) {
        callback(cut_remote_path(normalize_remote_props(props)));
    }
}

void FileMasterRemote::list(const FileMasterProps& props, FileMasterCompletion callback) {
    const FileMasterProps normalized = normalize_remote_props(props);
    FileMasterResult validation = validate_remote_props(normalized);
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }

    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [normalized, completion]() {
            std::vector<FileMasterListItem> items;
            complete(completion, list_remote_path(normalized, items));
        },
        []() {},
        [completion](const std::string& err) {
            complete(completion, make_error("remote list failed: " + err));
        }
    );
}

}  // namespace misty::core
