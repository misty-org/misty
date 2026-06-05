#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace misty::core {

struct FileMasterListItem {
    std::string name;
    std::string path;
    bool is_dir = false;
    int64_t size = 0;
    std::string last_modified;
    std::string mime_type;
};


struct FileMasterResult {
    bool success = false;
    std::string error_message;
};

struct FileMasterLocalContext {
    std::string path;

    bool empty() const;
};

struct FileMasterRemoteContext {
    std::string remote_name;
    std::string provider_type;
    std::string remote_path;

    bool empty() const;
};

struct FileMasterProps {
    uint64_t job_id = 0;
    uint64_t transfer_id = 0;
    std::string file_name;
    FileMasterLocalContext local_source;
    FileMasterLocalContext local_dest;
    FileMasterRemoteContext remote_source;
    FileMasterRemoteContext remote_dest;
};


using FileMasterCompletion = std::function<void(FileMasterResult)>;

class IFileMaster {
public:
    virtual ~IFileMaster() = default;

    virtual void rename(const FileMasterProps& props, FileMasterCompletion callback) = 0;
    virtual void remove(const FileMasterProps& props, FileMasterCompletion callback) = 0;
    virtual void copy(const FileMasterProps& props, FileMasterCompletion callback) = 0;
    virtual void cut(const FileMasterProps& props, FileMasterCompletion callback) = 0;
    virtual void list(const FileMasterProps& props, FileMasterCompletion callback) = 0;
};

} // namespace misty::core
