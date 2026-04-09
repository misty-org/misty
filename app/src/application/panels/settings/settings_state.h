#pragma once

#include <string>
#include <cstring>
#include "core/ui/ui_registry.h"

namespace misty::panel {

    enum class SettingsSection {
        Account,
        General,
        Sync,
        Vault,
        Storage,
        Connection,
        Shortcuts,
        About
    };

    struct SettingsState : public core::UIState {
        SettingsSection active_section = SettingsSection::Account;

        // Account
        char account_display_name[128] = "";
        char account_email[256] = "";
        bool account_buffers_initialized = false;

        // General
        int startup_view_index = 0; // 0=Files, 1=Services, 2=Activity

        // Connection
        char server_address[256] = "localhost:50051";
        char mount_path[256] = "misty";
        bool connection_config_loaded = false;

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
        bool status_is_error = false;
    };

} // namespace misty::panel
