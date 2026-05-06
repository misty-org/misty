#pragma once

#include <string>
#include <cstring>
#include <vector>

#include "core/manager/font_manager.h"
#include "core/ui/ui_registry.h"

namespace misty::panel {

    enum class SettingsSection {
        General,
        Appearance,
        Account,
        Privacy,
        Sync,
        Notifications,
        Shortcuts,
        Advanced
    };

    struct SettingsState : public core::UIState {
        SettingsSection active_section = SettingsSection::General;
        SettingsSection prev_section   = SettingsSection::General;

        // Account
        char account_email[256] = "";

        // General
        int theme_index = 0; // 0=System, 1=Dark, 2=Light
        int startup_view_index = 0; // 0=Files, 1=Services, 2=Activity
        std::vector<core::CustomFontEntry> custom_fonts;
        bool custom_fonts_loaded = false;
        bool custom_fonts_dirty = false;
        bool show_add_font_modal = false;
        char custom_font_label[128] = "";
        char custom_font_path[512] = "";

        // Connection
        char server_address[256] = "localhost:50051";
        char mount_path[256] = "misty";
        bool connection_config_loaded = false;

        // AI
        char llm_api_url[512] = "https://api.openai.com/v1/chat/completions";
        char llm_model[128] = "";
        char llm_api_key[512] = "";
        bool llm_config_loaded = false;

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

        void ensure_llm_config_loaded();
        bool save_llm_config(std::string* error = nullptr);
        bool llm_is_configured() const;
    };

} // namespace misty::panel
