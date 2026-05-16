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

bool validate_local_props(const FileMasterProps& props,
                          bool require_dest,
                          std::string* error_message) {
    if (props.local_source_path.empty()) {
        if (error_message) {
            *error_message = "local_source_path is required";
        }
        return false;
    }
    if (require_dest && props.local_dest_path.empty()) {
        if (error_message) {
            *error_message = "local_dest_path is required";
        }
        return false;
    }
    return true;
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

FileMasterLocal::FileMasterLocal(WorkerPool& worker_pool, FileTransfer& transfers)
    : worker_pool_(worker_pool),
      transfers_(transfers) {}

void FileMasterLocal::rename(const FileMasterProps& props, FileMasterCompletion callback) {
    std::string error_message;
    if (!validate_local_props(props, true, &error_message)) {
        if (callback) {
            callback(make_error(std::move(error_message)));
        }
        return;
    }

    FileTransferRecord record;
    record.transfer_type = FileTransferType::Rename;
    record.item_type = FileTransferItemType::Local;
    record.file_name = props.file_name;
    record.local_source_path = props.local_source_path;
    record.local_dest_path = props.local_dest_path;
    const uint64_t transfer_id = transfers_.start_transfer(std::move(record));
    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [this, props, completion, transfer_id]() {
            FileMasterResult result = rename_local_path(props);
            if (result.success) {
                transfers_.complete_transfer(transfer_id);
            } else {
                transfers_.fail_transfer(transfer_id, result.error_message);
            }
            complete(completion, std::move(result));
        },
        []() {},
        [this, completion, transfer_id](const std::string& err_msg) {
            const std::string message = "rename failed: " + err_msg;
            transfers_.fail_transfer(transfer_id, message);
            complete(completion, make_error(message));
        });
}

void FileMasterLocal::remove(const FileMasterProps& props, FileMasterCompletion callback) {
    std::string error_message;
    if (!validate_local_props(props, false, &error_message)) {
        if (callback) {
            callback(make_error(std::move(error_message)));
        }
        return;
    }

    FileTransferRecord record;
    record.transfer_type = FileTransferType::Delete;
    record.item_type = FileTransferItemType::Local;
    record.file_name = props.file_name;
    record.local_source_path = props.local_source_path;
    const uint64_t transfer_id = transfers_.start_transfer(std::move(record));
    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [this, props, completion, transfer_id]() {
            FileMasterResult result = remove_local_path(props);
            if (result.success) {
                transfers_.complete_transfer(transfer_id);
            } else {
                transfers_.fail_transfer(transfer_id, result.error_message);
            }
            complete(completion, std::move(result));
        },
        []() {},
        [this, completion, transfer_id](const std::string& err_msg) {
            const std::string message = "remove failed: " + err_msg;
            transfers_.fail_transfer(transfer_id, message);
            complete(completion, make_error(message));
        });
}

void FileMasterLocal::copy(const FileMasterProps& props, FileMasterCompletion callback) {
    std::string error_message;
    if (!validate_local_props(props, true, &error_message)) {
        if (callback) {
            callback(make_error(std::move(error_message)));
        }
        return;
    }

    FileTransferRecord record;
    record.transfer_type = FileTransferType::Copy;
    record.item_type = FileTransferItemType::Local;
    record.file_name = props.file_name;
    record.local_source_path = props.local_source_path;
    record.local_dest_path = props.local_dest_path;
    const uint64_t transfer_id = transfers_.start_transfer(std::move(record));
    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [this, props, completion, transfer_id]() {
            FileMasterResult result = copy_local_path(props);
            if (result.success) {
                transfers_.complete_transfer(transfer_id);
            } else {
                transfers_.fail_transfer(transfer_id, result.error_message);
            }
            complete(completion, std::move(result));
        },
        []() {},
        [this, completion, transfer_id](const std::string& err_msg) {
            const std::string message = "copy failed: " + err_msg;
            transfers_.fail_transfer(transfer_id, message);
            complete(completion, make_error(message));
        });
}

void FileMasterLocal::cut(const FileMasterProps& props, FileMasterCompletion callback) {
    std::string error_message;
    if (!validate_local_props(props, true, &error_message)) {
        if (callback) {
            callback(make_error(std::move(error_message)));
        }
        return;
    }

    FileTransferRecord record;
    record.transfer_type = FileTransferType::Move;
    record.item_type = FileTransferItemType::Local;
    record.file_name = props.file_name;
    record.local_source_path = props.local_source_path;
    record.local_dest_path = props.local_dest_path;
    const uint64_t transfer_id = transfers_.start_transfer(std::move(record));
    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [this, props, completion, transfer_id]() {
            FileMasterResult result = cut_local_path(props);
            if (result.success) {
                transfers_.complete_transfer(transfer_id);
            } else {
                transfers_.fail_transfer(transfer_id, result.error_message);
            }
            complete(completion, std::move(result));
        },
        []() {},
        [this, completion, transfer_id](const std::string& err_msg) {
            const std::string message = "cut failed: " + err_msg;
            transfers_.fail_transfer(transfer_id, message);
            complete(completion, make_error(message));
        });
}

} // namespace misty::core
