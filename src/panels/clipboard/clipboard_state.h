#pragma once

#include <string>
#include <vector>

#include "core/clipboard/clipboard_types.h"
#include "core/ui/state_registry.h"

namespace misty::panel {

inline constexpr const char* kClipboardContextStateKey = "ClipboardContext";

struct ConnectedMistyDevice {
    std::string device_id;
    std::string display_name;
    int64_t last_seen_unix_ms = 0;
    bool online = false;
};

struct ClipboardContextState : public core::StateEntry {
    core::ClipboardPayload local_system;
    core::ClipboardPayload latest_shared;
    std::vector<ConnectedMistyDevice> devices;

    bool shared_available() const;
    void clear_shared();
};

}  // namespace misty::panel
