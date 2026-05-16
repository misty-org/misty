#pragma once

#include <functional>

namespace misty::core {

struct FileMasterResult {
    bool success = false;
    std::string error_message;
};

struct FileMasterProps {
    std::string file_name;
    std::string local_source_path;
    std::string local_dest_path;
    std::string remote_source_name;
    std::string remote_source_path;
    std::string remote_dest_name;
    std::string remote_dest_path;
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
