#include "core/file_master/file_master_local.h"
#include "core/file_master/file_master_util.h"

#include <memory>

namespace misty::core {

FileMasterLocal::FileMasterLocal(WorkerPool& worker_pool)
    : worker_pool_(worker_pool) {}

void FileMasterLocal::rename(const FileMasterProps& props, FileMasterCompletion callback) {
    const FileMasterProps normalized = normalize_local_props(props);
    FileMasterResult validation = validate_local_props(normalized);
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }

    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [normalized, completion]() {
            complete(completion, rename_local_path(normalized));
        },
        []() {},
        [completion](const std::string& err_msg) {
            complete(completion, make_error("rename failed: " + err_msg));
        });
}

void FileMasterLocal::remove(const FileMasterProps& props, FileMasterCompletion callback) {
    const FileMasterProps normalized = normalize_local_props(props);
    FileMasterResult validation = validate_local_props(normalized);
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }

    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [normalized, completion]() {
            complete(completion, remove_local_path(normalized));
        },
        []() {},
        [completion](const std::string& err_msg) {
            complete(completion, make_error("remove failed: " + err_msg));
        });
}

void FileMasterLocal::copy(const FileMasterProps& props, FileMasterCompletion callback) {
    const FileMasterProps normalized = normalize_local_props(props);
    FileMasterResult validation = validate_local_props(normalized);
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }

    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [normalized, completion]() {
            complete(completion, copy_local_path(normalized));
        },
        []() {},
        [completion](const std::string& err_msg) {
            complete(completion, make_error("copy failed: " + err_msg));
        });
}

void FileMasterLocal::cut(const FileMasterProps& props, FileMasterCompletion callback) {
    const FileMasterProps normalized = normalize_local_props(props);
    FileMasterResult validation = validate_local_props(normalized);
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }

    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [normalized, completion]() {
            complete(completion, cut_local_path(normalized));
        },
        []() {},
        [completion](const std::string& err_msg) {
            complete(completion, make_error("cut failed: " + err_msg));
        }
    );
}

void FileMasterLocal::list(const FileMasterProps& props, FileMasterCompletion callback) {
    const FileMasterProps normalized = normalize_local_props(props);
    FileMasterResult validation = validate_local_props(normalized);
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }

    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [normalized, completion]() {
            std::vector<FileMasterListItem> items;
            complete(completion, list_local_path(normalized, items));
        },
        []() {},
        [completion](const std::string& err_msg) {
            complete(completion, make_error("list failed: " + err_msg));
        }
    );
}

} // namespace misty::core
