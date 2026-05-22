#pragma once

#include <cstdint>
#include <ctime>
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

    /**
     * @brief Converts a filesystem path to a UTF-8 string for display or storage.
     */
    std::string path_utf8_string(const std::filesystem::path& path);

    /**
     * @brief Converts a filesystem path to a generic UTF-8 string with forward separators.
     */
    std::string path_utf8_generic_string(const std::filesystem::path& path);

    /**
     * @brief Returns the filename component of a path as UTF-8 text.
     */
    std::string path_utf8_filename(const std::filesystem::path& path);

    uint64_t get_directory_size(const std::string& dir_path);
    std::string default_string(const std::string& value, const char* fallback);

    /**
     * @brief Removes trailing path separators while preserving roots such as `/` and `C:\`.
     */
    std::string strip_trailing_separators(std::string path);

    /**
     * @brief Removes trailing slash separators from a path in place.
     */
    void sanitize_path(std::string& path);

    /**
     * @brief Returns true when the descendant path is equal to or below the ancestor path.
     */
    bool path_under(const std::string& ancestor, const std::string& descendant);

    /**
     * @brief Formats a POSIX timestamp as an RFC3339 nanosecond UTC timestamp.
     */
    std::string format_rfc3339_nano(const timespec& ts);

    /**
     * @brief Splits a slash-delimited path into non-empty components.
     */
    std::vector<std::string> split_path(const std::string& path);

}
