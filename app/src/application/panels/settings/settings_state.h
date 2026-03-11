#pragma once

#include <string>
#include <cstring>
#include "core/ui/ui_registry.h"

namespace misty::panel {

    enum class SettingsSection {
        General,
        Storage,
        Services,
        Server,
        About
    };

    struct SettingsState : public core::UIState {
        SettingsSection active_section = SettingsSection::General;

        // General
        int startup_view_index = 0; // 0=Files, 1=Services, 2=Activity

        // Server
        char server_address[256] = "localhost:50051";
        char mount_path[256] = "misty";
        bool server_connected = false;

        // Sync
        bool auto_sync_enabled = true;

        // Confirmation flags
        bool confirm_clear_recent = false;
        bool confirm_clear_starred = false;
        bool confirm_empty_trash = false;
        bool confirm_clear_cache = false;

        // Status messages
        std::string status_message;
        float status_timer = 0.0f;
    };

} // namespace misty::panel
