#pragma once

#include <string>
#include <cstring>
#include <array>
#include <vector>

#include "core/manager/font_manager.h"
#include "core/ui/ui_registry.h"

namespace misty::panel {

    struct ShortcutEditorEntry {
        std::string command_id;
        std::string saved_value;
        std::array<char, 96> edit_value{};
    };

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
        bool app_settings_loaded = false;

        // Account
        char account_email[256] = "";
        char subscription_plan_label[64] = "Free";
        int connected_provider_count = 0;

        // General
        int theme_index = 0; // 0=System, 1=Dark, 2=Light
        int startup_view_index = 0; // 0=Files, 1=Providers, 2=Activity
        bool reopen_last_session = true;
        bool launch_on_login = false;
        bool auto_update_enabled = true;
        int release_channel_index = 0; // 0=Stable
        bool update_available = false;
        char available_version_label[64] = "v0.1.1";
        bool confirm_destructive_actions = true;
        int default_file_action_index = 0; // 0=Open, 1=Preview, 2=Details
        bool open_links_externally = true;
        char preferred_workspace_root[512] = "";
        int default_transfer_behavior_index = 0; // 0=Ask every time, 1=Use default location
        std::vector<core::CustomFontEntry> custom_fonts;
        bool custom_fonts_loaded = false;
        bool custom_fonts_dirty = false;
        bool show_add_font_modal = false;
        char custom_font_label[128] = "";
        char custom_font_path[512] = "";
        std::string last_update_check_label = "Never checked";
        bool compact_mode_enabled = false;
        bool reduced_motion_enabled = false;
        bool thumbnail_previews_enabled = true;
        int ui_scale_index = 1; // 0=Small, 1=Default, 2=Large
        int font_size_index = 1; // 0=Small, 1=Default, 2=Large

        // Connection
        char server_address[256] = "localhost:50051";
        char mount_path[256] = ".misty/mnt";
        bool connection_config_loaded = false;

        // AI
        char llm_api_url[512] = "https://api.openai.com/v1/chat/completions";
        char llm_model[128] = "";
        char llm_api_key[512] = "";
        bool llm_config_loaded = false;

        // Sync
        bool auto_sync_enabled = true;
        bool sync_on_launch_enabled = true;
        bool sync_on_quit_enabled = false;
        bool allow_metered_sync = false;
        int conflict_resolution_index = 0; // 0=Keep newest, 1=Ask me, 2=Keep both
        bool version_history_enabled = true;

        // Privacy
        bool local_processing_only = true;
        bool export_data_enabled = true;
        bool diagnostics_sharing_enabled = false;

        // Notifications
        bool desktop_notifications_enabled = true;
        bool in_app_notifications_enabled = true;
        bool sound_notifications_enabled = false;
        bool badge_count_enabled = true;
        bool quiet_hours_enabled = false;
        bool digest_notifications_enabled = false;

        // Shortcuts
        int keymap_index = 0; // 0=System, 1=VS Code, 2=Finder
        bool custom_shortcuts_enabled = false;
        bool shortcut_hints_enabled = true;
        std::vector<ShortcutEditorEntry> shortcut_editor_entries;
        bool shortcut_editor_loaded = false;

        // Confirmation flags
        bool confirm_clear_recent = false;
        bool confirm_clear_starred = false;
        bool confirm_empty_trash = false;
        bool confirm_clear_cache = false;

        // Advanced
        bool debug_logging_enabled = false;
        bool frame_pacing_overlay_enabled = false;
        bool experimental_features_enabled = false;

        // Status messages
        std::string status_message;
        float status_timer = 0.0f;
        bool status_is_error = false;

        void ensure_llm_config_loaded();
        bool save_llm_config(std::string* error = nullptr);
        bool llm_is_configured() const;
        void ensure_app_settings_loaded();
        bool save_app_settings(std::string* error = nullptr);
    };

} // namespace misty::panel
