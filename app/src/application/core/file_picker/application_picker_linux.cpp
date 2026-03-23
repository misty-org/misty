#ifdef __linux__

#include "application_picker.h"

#include <array>
#include <cstdio>
#include <string>
#include <thread>

namespace misty::core {

void ApplicationPicker::pick(std::function<void(std::optional<std::string>)> callback) {
    std::thread([callback = std::move(callback)]() {
        const char* command =
            "zenity --file-selection --title=\"Choose Application\" --filename=\"/usr/bin/\"";

        std::array<char, 4096> buffer{};
        std::string output;
        FILE* pipe = popen(command, "r");
        if (!pipe) {
            callback(std::nullopt);
            return;
        }

        while (fgets(buffer.data(), static_cast<int>(buffer.size()), pipe) != nullptr) {
            output += buffer.data();
        }

        int status = pclose(pipe);
        if (status != 0 || output.empty()) {
            callback(std::nullopt);
            return;
        }

        while (!output.empty() && (output.back() == '\n' || output.back() == '\r')) {
            output.pop_back();
        }
        callback(output.empty() ? std::nullopt : std::optional<std::string>(output));
    }).detach();
}

} // namespace misty::core

#endif
