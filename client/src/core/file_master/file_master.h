#pragma once

#include <functional>
#include "core/file_master/file_master_types.h"

namespace misty::core {

struct FileMasterResult {
    bool success = false;
    std::string error_message;
};

struct FileMasterProps {

};


using FileMasterCompletion = std::function<void(FileMasterResult)>;

class IFileMaster {
public:
    virtual ~IFileMaster() = default;

    virtual void rename(const FileMasterProps& props, FileMasterCompletion callback) = 0;
    virtual void remove(const FileMasterProps& props, FileMasterCompletion callback) = 0;
    virtual void copy(const FileMasterProps& props, FileMasterCompletion callback) = 0;
    virtual void cut(const FileMasterProps& props, FileMasterCompletion callback) = 0;
};

} // namespace misty::core
