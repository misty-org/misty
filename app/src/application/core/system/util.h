#pragma once

#include <filesystem>
#include <string>
#include <map>
#include <vector>

namespace misty::core {
    bool open_file_in_browser(const std::string& path);
    bool open_path_default(const std::string& path);
    bool open_path_with_application(const std::string& application_path, const std::string& target_path);
    std::filesystem::path get_executable_path();
    bool launch_detached_process(const std::string& executable_path,
                                 const std::vector<std::string>& args = {},
                                 const std::string& working_directory = "");

}
