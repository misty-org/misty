#pragma once

#include <functional>
#include <optional>
#include <string>

namespace misty::core {

class ApplicationPicker {
public:
    // Non-blocking: callback is invoked with the chosen path (or nullopt if cancelled).
    // On macOS the callback fires on the main thread; on other platforms it fires on a
    // background thread, so callers must synchronise access to shared state.
    static void pick(std::function<void(std::optional<std::string>)> callback);
};

} // namespace misty::core
