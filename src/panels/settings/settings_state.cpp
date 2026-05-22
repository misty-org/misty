#include "panels/settings/settings_state.h"

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>

#include <nlohmann/json.hpp>

#include "core/manager/settings_manager.h"

namespace misty::panel {
namespace {

namespace fs = std::filesystem;
using json = nlohmann::json;

fs::path llm_config_path() {
    const char* home = std::getenv("HOME");
    if (!home || *home == '\0') {
        return {};
    }
    return fs::path(home) / ".misty" / "config" / "llm.json";
}

template <size_t N>
void copy_string(char (&dest)[N], const std::string& value) {
    std::snprintf(dest, N, "%s", value.c_str());
}

json make_font_array(const std::vector<core::CustomFontEntry>& fonts) {
    json data = json::array();
    for (const auto& font : fonts) {
        data.push_back({
            {"label", font.label},
            {"path", font.path},
        });
    }
    return data;
}

} // namespace

void SettingsState::ensure_app_settings_loaded() {
    if (app_settings_loaded) {
        return;
    }

    json settings = core::load_settings_document();

    const json general = settings.value("general", json::object());
    startup_view_index = general.value("startup_view_index", startup_view_index);
    reopen_last_session = general.value("reopen_last_session", reopen_last_session);
    launch_on_login = general.value("launch_on_login", launch_on_login);
    auto_update_enabled = general.value("auto_update_enabled", auto_update_enabled);
    release_channel_index = general.value("release_channel_index", release_channel_index);
    update_available = general.value("update_available", update_available);
    copy_string(available_version_label, general.value("available_version_label", std::string(available_version_label)));
    confirm_destructive_actions = general.value("confirm_destructive_actions", confirm_destructive_actions);
    default_file_action_index = general.value("default_file_action_index", default_file_action_index);
    open_links_externally = general.value("open_links_externally", open_links_externally);
    copy_string(
        preferred_workspace_root,
        general.value("preferred_workspace_root", std::string(preferred_workspace_root))
    );
    default_transfer_behavior_index =
        general.value("default_transfer_behavior_index", default_transfer_behavior_index);
    last_update_check_label = general.value("last_update_check_label", last_update_check_label);

    const json appearance = settings.value("appearance", json::object());
    theme_index = appearance.value("theme_index", theme_index);
    compact_mode_enabled = appearance.value("compact_mode_enabled", compact_mode_enabled);
    reduced_motion_enabled = appearance.value("reduced_motion_enabled", reduced_motion_enabled);
    thumbnail_previews_enabled = appearance.value("thumbnail_previews_enabled", thumbnail_previews_enabled);
    ui_scale_index = appearance.value("ui_scale_index", ui_scale_index);
    font_size_index = appearance.value("font_size_index", font_size_index);
    custom_fonts = core::FontManager::get().load_custom_fonts();
    custom_fonts_loaded = true;
    custom_fonts_dirty = false;

    const json account = settings.value("account", json::object());
    copy_string(account_email, account.value("email", std::string(account_email)));
    copy_string(subscription_plan_label, account.value("subscription_plan_label", std::string(subscription_plan_label)));
    connected_provider_count = account.value("connected_provider_count", connected_provider_count);

    const json privacy = settings.value("privacy", json::object());
    local_processing_only = privacy.value("local_processing_only", local_processing_only);
    export_data_enabled = privacy.value("export_data_enabled", export_data_enabled);
    diagnostics_sharing_enabled = privacy.value("diagnostics_sharing_enabled", diagnostics_sharing_enabled);

    const json sync = settings.value("sync", json::object());
    auto_sync_enabled = sync.value("auto_sync_enabled", auto_sync_enabled);
    sync_on_launch_enabled = sync.value("sync_on_launch_enabled", sync_on_launch_enabled);
    sync_on_quit_enabled = sync.value("sync_on_quit_enabled", sync_on_quit_enabled);
    allow_metered_sync = sync.value("allow_metered_sync", allow_metered_sync);
    conflict_resolution_index = sync.value("conflict_resolution_index", conflict_resolution_index);
    version_history_enabled = sync.value("version_history_enabled", version_history_enabled);

    const json notifications = settings.value("notifications", json::object());
    desktop_notifications_enabled = notifications.value("desktop_notifications_enabled", desktop_notifications_enabled);
    in_app_notifications_enabled = notifications.value("in_app_notifications_enabled", in_app_notifications_enabled);
    sound_notifications_enabled = notifications.value("sound_notifications_enabled", sound_notifications_enabled);
    badge_count_enabled = notifications.value("badge_count_enabled", badge_count_enabled);
    quiet_hours_enabled = notifications.value("quiet_hours_enabled", quiet_hours_enabled);
    digest_notifications_enabled = notifications.value("digest_notifications_enabled", digest_notifications_enabled);

    const json shortcuts = settings.value("shortcuts", json::object());
    keymap_index = shortcuts.value("keymap_index", keymap_index);
    custom_shortcuts_enabled = shortcuts.value("custom_shortcuts_enabled", custom_shortcuts_enabled);
    shortcut_hints_enabled = shortcuts.value("shortcut_hints_enabled", shortcut_hints_enabled);

    const json advanced = settings.value("advanced", json::object());
    copy_string(server_address, advanced.value("server_address", std::string(server_address)));
    copy_string(mount_path, advanced.value("mount_path", std::string(mount_path)));
    confirm_clear_recent = advanced.value("confirm_clear_recent", confirm_clear_recent);
    confirm_clear_starred = advanced.value("confirm_clear_starred", confirm_clear_starred);
    confirm_empty_trash = advanced.value("confirm_empty_trash", confirm_empty_trash);
    confirm_clear_cache = advanced.value("confirm_clear_cache", confirm_clear_cache);
    debug_logging_enabled = advanced.value("debug_logging_enabled", debug_logging_enabled);
    frame_pacing_overlay_enabled = advanced.value("frame_pacing_overlay_enabled", frame_pacing_overlay_enabled);
    experimental_features_enabled = advanced.value("experimental_features_enabled", experimental_features_enabled);

    const json ai = settings.value("ai", json::object());
    copy_string(llm_api_url, ai.value("api_url", std::string(llm_api_url)));
    copy_string(llm_model, ai.value("model", std::string(llm_model)));
    copy_string(llm_api_key, ai.value("api_key", std::string(llm_api_key)));
    llm_config_loaded = true;

    if (llm_model[0] == '\0' || llm_api_key[0] == '\0') {
        ensure_llm_config_loaded();
    }

    app_settings_loaded = true;
    save_app_settings();
}

bool SettingsState::save_app_settings(std::string* error) {
    return core::update_settings_document([&](json& settings) {
        settings["schema_version"] = 1;
        const json existing_appearance = settings.value("appearance", json::object());
        const json existing_custom_theme = existing_appearance.value("custom_theme", json::object());
        settings["general"] = {
            {"startup_view_index", startup_view_index},
            {"reopen_last_session", reopen_last_session},
            {"launch_on_login", launch_on_login},
            {"auto_update_enabled", auto_update_enabled},
            {"release_channel_index", release_channel_index},
            {"update_available", update_available},
            {"available_version_label", std::string(available_version_label)},
            {"confirm_destructive_actions", confirm_destructive_actions},
            {"default_file_action_index", default_file_action_index},
            {"open_links_externally", open_links_externally},
            {"preferred_workspace_root", std::string(preferred_workspace_root)},
            {"default_transfer_behavior_index", default_transfer_behavior_index},
            {"last_update_check_label", last_update_check_label},
        };

        settings["appearance"] = {
            {"theme_index", theme_index},
            {"compact_mode_enabled", compact_mode_enabled},
            {"reduced_motion_enabled", reduced_motion_enabled},
            {"thumbnail_previews_enabled", thumbnail_previews_enabled},
            {"ui_scale_index", ui_scale_index},
            {"font_size_index", font_size_index},
            {"custom_fonts", make_font_array(custom_fonts)},
        };
        if (existing_custom_theme.is_object() && !existing_custom_theme.empty()) {
            settings["appearance"]["custom_theme"] = existing_custom_theme;
        }

        settings["account"] = {
            {"email", std::string(account_email)},
            {"subscription_plan_label", std::string(subscription_plan_label)},
            {"connected_provider_count", connected_provider_count},
        };

        settings["privacy"] = {
            {"data_stays_local", true},
            {"local_processing_only", local_processing_only},
            {"export_data_enabled", export_data_enabled},
            {"diagnostics_sharing_enabled", diagnostics_sharing_enabled},
        };

        settings["sync"] = {
            {"auto_sync_enabled", auto_sync_enabled},
            {"sync_on_launch_enabled", sync_on_launch_enabled},
            {"sync_on_quit_enabled", sync_on_quit_enabled},
            {"allow_metered_sync", allow_metered_sync},
            {"conflict_resolution_index", conflict_resolution_index},
            {"version_history_enabled", version_history_enabled},
        };

        settings["notifications"] = {
            {"desktop_notifications_enabled", desktop_notifications_enabled},
            {"in_app_notifications_enabled", in_app_notifications_enabled},
            {"sound_notifications_enabled", sound_notifications_enabled},
            {"badge_count_enabled", badge_count_enabled},
            {"quiet_hours_enabled", quiet_hours_enabled},
            {"digest_notifications_enabled", digest_notifications_enabled},
        };

        settings["shortcuts"] = {
            {"keymap_index", keymap_index},
            {"custom_shortcuts_enabled", custom_shortcuts_enabled},
            {"shortcut_hints_enabled", shortcut_hints_enabled},
        };

        settings["advanced"] = {
            {"server_address", std::string(server_address)},
            {"mount_path", std::string(mount_path)},
            {"confirm_clear_recent", confirm_clear_recent},
            {"confirm_clear_starred", confirm_clear_starred},
            {"confirm_empty_trash", confirm_empty_trash},
            {"confirm_clear_cache", confirm_clear_cache},
            {"debug_logging_enabled", debug_logging_enabled},
            {"frame_pacing_overlay_enabled", frame_pacing_overlay_enabled},
            {"experimental_features_enabled", experimental_features_enabled},
        };

        settings["ai"] = {
            {"api_url", std::string(llm_api_url)},
            {"model", std::string(llm_model)},
            {"api_key", std::string(llm_api_key)},
        };
    }, error);
}

void SettingsState::ensure_llm_config_loaded() {
    if (llm_config_loaded) {
        return;
    }

    const fs::path path = llm_config_path();
    if (!path.empty() && fs::exists(path)) {
        try {
            std::ifstream file(path);
            json data = json::parse(file);

            const std::string api_url = data.value("api_url", std::string(llm_api_url));
            const std::string model = data.value("model", std::string(llm_model));
            const std::string api_key = data.value("api_key", std::string(llm_api_key));

            copy_string(llm_api_url, api_url);
            copy_string(llm_model, model);
            copy_string(llm_api_key, api_key);

            std::string error;
            save_app_settings(&error);

            std::error_code ec;
            fs::remove(path, ec);
        } catch (...) {
        }
    }

    llm_config_loaded = true;
}

bool SettingsState::save_llm_config(std::string* error) {
    llm_config_loaded = true;
    return save_app_settings(error);
}

bool SettingsState::llm_is_configured() const {
    return llm_api_url[0] != '\0' && llm_model[0] != '\0' && llm_api_key[0] != '\0';
}

} // namespace misty::panel
