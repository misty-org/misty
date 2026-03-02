#include "core/file_master/file_master_local.h"

#include <filesystem>
#include <memory>

namespace fs = std::filesystem;

namespace misty::core {
namespace {


FileMasterResult make_success() {
    return FileMasterResult{true, ""};
}

FileMasterResult make_error(std::string error_message) {
    return FileMasterResult{false, std::move(error_message)};
}

void complete(const std::shared_ptr<FileMasterCompletion>& callback, FileMasterResult result) {
    if (callback && *callback) {
        (*callback)(std::move(result));
    }
}

FileMasterResult rename_local_path(const FileMasterProps& props) {
    if (props.local_source_path.empty()) {
        return make_error("local_source_path is required");
    }
    if (props.local_dest_path.empty()) {
        return make_error("local_dest_path is required");
    }

    std::error_code ec;
    fs::rename(props.local_source_path, props.local_dest_path, ec);
    if (ec) {
        return make_error("rename failed: " + ec.message());
    }
    return make_success();
}

FileMasterResult remove_local_path(const FileMasterProps& props) {
    if (props.local_source_path.empty()) {
        return make_error("local_source_path is required");
    }

    std::error_code ec;
    fs::remove_all(props.local_source_path, ec);
    if (ec) {
        return make_error("remove failed: " + ec.message());
    }
    return make_success();
}

FileMasterResult copy_local_path(const FileMasterProps& props) {
    if (props.local_source_path.empty()) {
        return make_error("local_source_path is required");
    }
    if (props.local_dest_path.empty()) {
        return make_error("local_dest_path is required");
    }

    std::error_code ec;
    const bool source_is_dir = fs::is_directory(props.local_source_path, ec);
    if (ec) {
        return make_error("copy failed: " + ec.message());
    }

    if (source_is_dir) {
        fs::copy(props.local_source_path, props.local_dest_path, fs::copy_options::recursive, ec);
    } else {
        fs::copy_file(props.local_source_path, props.local_dest_path, fs::copy_options::none, ec);
    }
    if (ec) {
        return make_error("copy failed: " + ec.message());
    }
    return make_success();
}

FileMasterResult cut_local_path(const FileMasterProps& props) {
    if (props.local_source_path.empty()) {
        return make_error("local_source_path is required");
    }
    if (props.local_dest_path.empty()) {
        return make_error("local_dest_path is required");
    }

    std::error_code ec;
    fs::rename(props.local_source_path, props.local_dest_path, ec);
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
    fs::remove_all(props.local_source_path, remove_ec);
    if (remove_ec) {
        return make_error("cut failed: " + remove_ec.message());
    }
    return make_success();
}

} // namespace

FileMasterLocal::FileMasterLocal(WorkerPool& worker_pool)
    : worker_pool_(worker_pool) {}

void FileMasterLocal::rename(const FileMasterProps& props, FileMasterCompletion callback) {
    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [props, completion]() {
            complete(completion, rename_local_path(props));
        },
        []() {},
        [completion](const std::string& err_msg) {
            complete(completion, make_error("rename failed: " + err_msg));
        });
}

void FileMasterLocal::remove(const FileMasterProps& props, FileMasterCompletion callback) {
    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [props, completion]() {
            complete(completion, remove_local_path(props));
        },
        []() {},
        [completion](const std::string& err_msg) {
            complete(completion, make_error("remove failed: " + err_msg));
        });
}

void FileMasterLocal::copy(const FileMasterProps& props, FileMasterCompletion callback) {
    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [props, completion]() {
            complete(completion, copy_local_path(props));
        },
        []() {},
        [completion](const std::string& err_msg) {
            complete(completion, make_error("copy failed: " + err_msg));
        });
}

void FileMasterLocal::cut(const FileMasterProps& props, FileMasterCompletion callback) {
    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [props, completion]() {
            complete(completion, cut_local_path(props));
        },
        []() {},
        [completion](const std::string& err_msg) {
            complete(completion, make_error("cut failed: " + err_msg));
        });
}

} // namespace misty::core
