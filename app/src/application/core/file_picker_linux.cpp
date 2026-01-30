#ifdef __linux__

#include "file_picker.h"
#include <cstdio>
#include <array>
#include <sstream>

namespace minidfs::core {

FilePickerResult FilePicker::show_dialog(const FilePickerOptions& options) {
    FilePickerResult result;
    result.success = false;

    // Build zenity command
    std::string cmd = "zenity --file-selection --multiple --separator=\"\\n\"";
    cmd += " --title=\"" + options.title + "\"";

    if (!options.default_directory.empty()) {
        cmd += " --filename=\"" + options.default_directory + "/\"";
    }

    // Execute zenity
    std::array<char, 4096> buffer;
    std::string output;
    FILE* pipe = popen(cmd.c_str(), "r");
    if (!pipe) {
        return result;
    }

    while (fgets(buffer.data(), buffer.size(), pipe) != nullptr) {
        output += buffer.data();
    }

    int status = pclose(pipe);
    if (status != 0) {
        return result;
    }

    // Parse output (newline-separated paths)
    result.success = true;
    std::istringstream stream(output);
    std::string line;
    while (std::getline(stream, line)) {
        if (!line.empty()) {
            result.paths.push_back(line);
        }
    }

    return result;
}

}

#endif
