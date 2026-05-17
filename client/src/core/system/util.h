#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <map>
#include <vector>

namespace misty::core {
    struct ProcessMemoryUsage {
        uint64_t resident_bytes = 0;
        uint64_t footprint_bytes = 0;
        bool available = false;
    };

    std::string format_bytes(uint64_t bytes);
    std::string format_bytes(int64_t bytes);
    ProcessMemoryUsage get_process_memory_usage();
    bool open_file_in_browser(const std::string& path);
    bool open_path_default(const std::string& path);
    bool open_path_with_application(const std::string& application_path, const std::string& target_path);
    bool move_path_with_user_approval(const std::filesystem::path& source_path,
                                      const std::filesystem::path& target_path);
    bool delete_path_with_user_approval(const std::filesystem::path& path);
    std::filesystem::path get_executable_path();
    bool launch_detached_process(const std::string& executable_path,
                                 const std::vector<std::string>& args = {},
                                 const std::string& working_directory = "");
    bool launch_detached_process(const std::string& executable_path,
                                 const std::vector<std::string>& args,
                                 const std::string& working_directory,
                                 const std::string& stdout_path,
                                 const std::string& stderr_path);
    
    uint64_t get_directory_size(const std::string& dir_path);
    std::string default_string(const std::string& value, const char* fallback);

}
