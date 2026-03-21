#pragma once

#include <optional>
#include <string>

namespace misty::core {

class ApplicationPicker {
public:
    static std::optional<std::string> pick();
};

} // namespace misty::core
