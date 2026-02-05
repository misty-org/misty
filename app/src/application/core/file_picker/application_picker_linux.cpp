#ifdef __linux__

#include "application_picker.h"

#include <array>
#include <cstdio>
#include <string>

namespace misty::core {

std::optional<std::string> ApplicationPicker::pick() {
    const char* command =
        "zenity --file-selection --title=\"Choose Application\" --filename=\"/usr/bin/\"";

    std::array<char, 4096> buffer{};
    std::string output;
    FILE* pipe = popen(command, "r");
    if (!pipe) {
        return std::nullopt;
    }

    while (fgets(buffer.data(), static_cast<int>(buffer.size()), pipe) != nullptr) {
        output += buffer.data();
    }

    int status = pclose(pipe);
    if (status != 0 || output.empty()) {
        return std::nullopt;
    }

    while (!output.empty() && (output.back() == '\n' || output.back() == '\r')) {
        output.pop_back();
    }
    return output.empty() ? std::nullopt : std::optional<std::string>(output);
}

} // namespace misty::core

#endif
