#include "panels/settings/settings_general.h"

#include <cstdlib>
#include <filesystem>
#include <string>

#include "core/manager/asset_manager.h"
#include "core/manager/env_manager.h"
#include "core/manager/session_manager.h"
#include "core/ui/ui_layout.h"
#include "imgui.h"
#include "panels/settings/settings_components.h"

namespace UI = misty::UI;

namespace {
    namespace fs = std::filesystem;

    constexpr ImVec4 kHeaderTextColor = ImVec4(0.96f, 0.96f, 0.98f, 1.0f);
    constexpr ImVec4 kBodyTextColor = ImVec4(0.76f, 0.78f, 0.82f, 1.0f);
    constexpr ImVec4 kMutedTextColor = ImVec4(0.58f, 0.60f, 0.64f, 1.0f);
    constexpr ImVec4 kDividerColor = ImVec4(0.2f, 0.2f, 0.2f, 1.0f);
    constexpr ImVec4 kSuccessTextColor = ImVec4(0.55f, 0.82f, 0.64f, 1.0f);
    constexpr ImVec4 kControlBgColor = ImVec4(0.10f, 0.11f, 0.13f, 1.0f);
    constexpr ImVec4 kControlBorderColor = ImVec4(0.18f, 0.19f, 0.22f, 1.0f);
    constexpr ImVec4 kControlTextColor = ImVec4(0.92f, 0.92f, 0.94f, 1.0f);
    constexpr float kControlWidth = 220.0f;
    constexpr float kControlHeight = 36.0f;
    constexpr float kSelectControlHeight = 32.0f;
    constexpr float kDetailValueWidth = 360.0f;
    constexpr float kIconButtonSize = 28.0f;
    constexpr float kCopyValueGap = 10.0f;
    constexpr float kCopyValueTextWidth = kDetailValueWidth - kIconButtonSize - kCopyValueGap;

    constexpr const char* kStartupViewOptions[] = {"Files", "Providers", "Activity"};
    constexpr const char* kReleaseChannelOptions[] = {"Stable"};
    constexpr const char* kDefaultFileActionOptions[] = {"Open", "Preview", "Show Details"};
    constexpr const char* kTransferBehaviorOptions[] = {"Ask Every Time", "Use Default Location"};

    bool toggle_switch_icon(const char* id, bool* value) {
        if (!value) {
            return false;
        }

        auto& icon = misty::core::AssetManager::get().get_svg_texture(
            *value ? "toggle-on-24" : "toggle-off-24",
            52,
            30
        );

        const bool pressed = UI::image_button(id, {
            .texture_id = icon.id,
            .width = UI::Size::px(52.0f),
            .height = UI::Size::px(30.0f),
            .align = UI::Align::End,
            .button_color = ImVec4(0, 0, 0, 0),
            .hover_color = ImVec4(0, 0, 0, 0),
            .active_color = ImVec4(0, 0, 0, 0),
            .tint_color = ImVec4(1, 1, 1, 1),
            .border_color = ImVec4(0, 0, 0, 0),
        });
        if (pressed) {
            *value = !*value;
        }
        return pressed;
    }

    bool copy_icon_button(const char* id, const std::string& value) {
        auto& icon = misty::core::AssetManager::get().get_svg_texture("copy-16", 16);
        const bool pressed = UI::image_button(id, {
            .texture_id = icon.id,
            .width = UI::Size::px(kIconButtonSize),
            .height = UI::Size::px(kIconButtonSize),
            .align = UI::Align::Start,
            .button_color = ImVec4(0, 0, 0, 0),
            .hover_color = ImVec4(1, 1, 1, 0.06f),
            .active_color = ImVec4(1, 1, 1, 0.10f),
            .tint_color = ImVec4(0.88f, 0.89f, 0.92f, 1.0f),
            .border_color = ImVec4(0, 0, 0, 0),
            .rounding = 6.0f,
        });
        if (pressed) {
            ImGui::SetClipboardText(value.c_str());
        }
        return pressed;
    }

    void row_text(const char* label, const char* description) {
        UI::column((std::string(label) + "_text").c_str(), {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(0.0f, 4.0f),
        }, [&]() {
            UI::text({
                .text = label,
                .width = UI::Size::fill(),
                .color = kHeaderTextColor,
            });
            UI::text({
                .text = description,
                .width = UI::Size::fill(),
                .overflow = UI::TextOverflow::Wrap,
                .color = kMutedTextColor,
            });
        });
    }

    void value_text(const char* value, bool muted = false) {
        UI::text({
            .text = value,
            .width = UI::Size::auto_size(),
            .align = UI::Align::End,
            .color = muted ? kMutedTextColor : kHeaderTextColor,
        });
    }

    void control_slot(const char* id, float height, const std::function<void()>& content) {
        UI::div(id, {
            .width = UI::Size::px(kControlWidth),
            .height = UI::Size::px(height),
            .align = UI::Align::End,
            .justify = UI::Justify::Start,
        }, [&]() {
            if (content) {
                content();
            }
        });
    }

    bool combo_control(const char* id, int* index, const char* const* options, int count) {
        bool changed = false;
        control_slot((std::string(id) + "_slot").c_str(), kSelectControlHeight, [&]() {
            changed = UI::select({
                .label = id,
                .selected_index = index,
                .options = options,
                .option_count = count,
                .width = UI::Size::fill(),
                .height = UI::Size::px(kSelectControlHeight),
                .padding = UI::Spacing::xy(10.0f, 6.0f),
                .rounding = 6.0f,
                .bg_color = kControlBgColor,
                .border_color = kControlBorderColor,
                .text_color = kControlTextColor,
            });
        });
        return changed;
    }

    bool text_input_control(const char* id, char* buffer, size_t buffer_size, bool read_only = false) {
        bool changed = false;
        control_slot((std::string(id) + "_slot").c_str(), kControlHeight, [&]() {
            changed = UI::input_text({
                .label = id,
                .buffer = buffer,
                .buffer_size = buffer_size,
                .width = UI::Size::fill(),
                .height = UI::Size::px(kControlHeight),
                .padding = UI::Spacing::xy(10.0f, 8.0f),
                .rounding = 6.0f,
                .bg_color = kControlBgColor,
                .border_color = kControlBorderColor,
                .text_color = kControlTextColor,
                .flags = read_only ? ImGuiInputTextFlags_ReadOnly : ImGuiInputTextFlags_None,
            });
        });
        return changed;
    }

    void copyable_value_row(const char* id, const char* label, const char* description, const std::string& value) {
        misty::panel::settings_row(id, {
            .start_width_pct = 0.52f,
            .end_width = UI::Size::px(kDetailValueWidth),
            .show_divider = true,
            .divider_color = kDividerColor,
        }, [&]() {
            row_text(label, description);
        }, [&]() {
            UI::row((std::string(id) + "_actions").c_str(), {
                .width = UI::Size::fill(),
                .height = UI::Size::px(kIconButtonSize),
                .align = UI::Align::Start,
                .gap = UI::Spacing::xy(kCopyValueGap, 0.0f),
            }, [&]() {
                UI::text({
                    .text = value.c_str(),
                    .width = UI::Size::px(kCopyValueTextWidth),
                    .align = UI::Align::Start,
                    .justify = UI::Justify::Center,
                    .overflow = UI::TextOverflow::Clip,
                    .color = kHeaderTextColor,
                });
                copy_icon_button((std::string(id) + "_copy").c_str(), value);
            });
        });
    }

    std::string app_version_label() {
        return "v0.1.0-beta";
    }

    std::string build_info_label() {
#ifdef MISTY_DEBUG_BUILD
        const char* config = "Debug";
#else
        const char* config = "Release";
#endif

#if defined(_WIN32)
        const char* platform = "Windows";
#elif defined(__APPLE__)
        const char* platform = "macOS";
#elif defined(__linux__)
        const char* platform = "Linux";
#else
        const char* platform = "Unknown";
#endif

        return std::string(config) + " build on " + platform;
    }

    std::string proxy_status_label() {
        auto& session = misty::core::SessionManager::get();
        if (session.is_proxy_available()) {
            return "Running";
        }

        const std::string message = session.get_proxy_status_message();
        if (message.empty()) {
            return "Unavailable";
        }
        return "Unavailable: " + message;
    }

    std::string config_path_label() {
        const std::string home = misty::core::EnvManager::get().get_user_home_dir();
        if (home.empty()) {
            return "Unavailable";
        }
        return (fs::path(home) / ".misty" / "config").string();
    }

    std::string data_path_label() {
        const std::string home = misty::core::EnvManager::get().get_user_home_dir();
        if (home.empty()) {
            return "Unavailable";
        }
        return (fs::path(home) / ".misty").string();
    }

    void startup_section(misty::panel::SettingsState& state) {
        misty::panel::settings_section("##general_startup", "Startup", {
            .title_font = UI::TextFont::BoldLarge,
            .title_color = kHeaderTextColor,
            .divider_color = kDividerColor,
        }, [&]() {
            misty::panel::settings_row("##general_startup_default_view", {
                .start_width_pct = 0.52f,
                .divider_color = kDividerColor,
            }, [&]() {
                row_text("Default landing view", "Choose which screen Misty should open first.");
            }, [&]() {
                if (combo_control(
                    "##general_startup_default_view_combo",
                    &state.startup_view_index,
                    kStartupViewOptions,
                    3
                )) {
                    state.save_app_settings();
                }
            });

            misty::panel::settings_row("##general_startup_reopen_session", {
                .start_width_pct = 0.52f,
                .divider_color = kDividerColor,
            }, [&]() {
                row_text("Reopen last session", "Restore the last location and context when Misty launches.");
            }, [&]() {
                if (toggle_switch_icon("##general_startup_reopen_session_toggle", &state.reopen_last_session)) {
                    state.save_app_settings();
                }
            });

            misty::panel::settings_row("##general_startup_launch_login", {
                .start_width_pct = 0.52f,
                .show_divider = false,
                .divider_color = kDividerColor,
            }, [&]() {
                row_text("Launch on login", "Start Misty automatically when you sign in to this device.");
            }, [&]() {
                if (toggle_switch_icon("##general_startup_launch_login_toggle", &state.launch_on_login)) {
                    state.save_app_settings();
                }
            });
        });
    }

    void updates_section(misty::panel::SettingsState& state) {
        misty::panel::settings_section("##general_updates", "Updates", {
            .title_font = UI::TextFont::BoldLarge,
            .title_color = kHeaderTextColor,
            .divider_color = kDividerColor,
        }, [&]() {
            misty::panel::settings_row("##general_updates_release_channel", {
                .start_width_pct = 0.52f,
                .divider_color = kDividerColor,
            }, [&]() {
                row_text("Release channel", "Choose which update track this installation should follow.");
            }, [&]() {
                if (combo_control(
                    "##general_updates_release_channel_combo",
                    &state.release_channel_index,
                    kReleaseChannelOptions,
                    1
                )) {
                    state.save_app_settings();
                }
            });

            misty::panel::settings_row("##general_updates_auto_update", {
                .start_width_pct = 0.52f,
                .divider_color = kDividerColor,
            }, [&]() {
                row_text("Auto-update", "Download and apply updates automatically when available.");
            }, [&]() {
                if (toggle_switch_icon("##general_updates_auto_update_toggle", &state.auto_update_enabled)) {
                    state.save_app_settings();
                }
            });

            misty::panel::settings_row("##general_updates_check_now", {
                .start_width_pct = 0.52f,
                .show_divider = false,
                .divider_color = kDividerColor,
            }, [&]() {
                row_text("Check for updates", "Run an explicit update check right now.");
            }, [&]() {
                UI::column("##general_updates_check_now_action_stack", {
                    .width = UI::Size::px(kControlWidth),
                    .height = UI::Size::auto_size(),
                    .align = UI::Align::End,
                    .gap = UI::Spacing::xy(0.0f, 6.0f),
                }, [&]() {
                    const std::string button_label = state.update_available
                        ? std::string("Update ") + state.available_version_label
                        : "Check now";

                    control_slot("##general_updates_check_now_slot", kControlHeight, [&]() {
                        if (UI::button("##general_updates_check_now_button", {
                            .label = button_label.c_str(),
                            .width = UI::Size::fill(),
                            .height = UI::Size::px(kControlHeight),
                            .padding = UI::Spacing::xy(12.0f, 8.0f),
                            .align = UI::Align::End,
                            .variant = UI::ButtonVariant::Subtle,
                            .rounding = 6.0f,
                        })) {
                            state.last_update_check_label = "Just now";
                            if (state.update_available) {
                                state.status_message = std::string("Ready to install ") + state.available_version_label + ".";
                            } else {
                                state.status_message = "Misty is up to date.";
                            }
                            state.status_is_error = false;
                            state.status_timer = 4.0f;
                            state.save_app_settings();
                        }
                    });

                    UI::column("##general_updates_last_checked_inline", {
                        .width = UI::Size::fill(),
                        .height = UI::Size::auto_size(),
                        .gap = UI::Spacing::xy(0.0f, 2.0f),
                        .align = UI::Align::End,
                    }, [&]() {
                        UI::text({
                            .text = state.last_update_check_label.c_str(),
                            .width = UI::Size::fill(),
                            .align = UI::Align::End,
                            .color = state.last_update_check_label == "Never checked"
                                ? kMutedTextColor
                                : kHeaderTextColor,
                        });
                        UI::text({
                            .text = "Last checked",
                            .width = UI::Size::fill(),
                            .align = UI::Align::End,
                            .color = kMutedTextColor,
                            .font = UI::TextFont::Small,
                        });
                    });
                });
            });
        });
    }

    void behavior_section(misty::panel::SettingsState& state) {
        misty::panel::settings_section("##general_behavior", "Behavior", {
            .title_font = UI::TextFont::BoldLarge,
            .title_color = kHeaderTextColor,
            .divider_color = kDividerColor,
        }, [&]() {
            misty::panel::settings_row("##general_behavior_confirm_destructive", {
                .start_width_pct = 0.52f,
                .divider_color = kDividerColor,
            }, [&]() {
                row_text("Confirm destructive actions", "Ask before delete, empty trash, and other irreversible actions.");
            }, [&]() {
                if (toggle_switch_icon(
                    "##general_behavior_confirm_destructive_toggle",
                    &state.confirm_destructive_actions
                )) {
                    state.save_app_settings();
                }
            });

            misty::panel::settings_row("##general_behavior_default_action", {
                .start_width_pct = 0.52f,
                .divider_color = kDividerColor,
            }, [&]() {
                row_text("Default file action", "Choose what a primary file interaction should do.");
            }, [&]() {
                if (combo_control(
                    "##general_behavior_default_action_combo",
                    &state.default_file_action_index,
                    kDefaultFileActionOptions,
                    3
                )) {
                    state.save_app_settings();
                }
            });

            misty::panel::settings_row("##general_behavior_open_links", {
                .start_width_pct = 0.52f,
                .divider_color = kDividerColor,
            }, [&]() {
                row_text("Open links externally", "Send external links to the system browser instead of handling them in-app.");
            }, [&]() {
                if (toggle_switch_icon("##general_behavior_open_links_toggle", &state.open_links_externally)) {
                    state.save_app_settings();
                }
            });
        });
    }

    void system_section() {
        const std::string proxy_url = misty::core::EnvManager::get().get("PROXY_SERVICE_URL", "Not configured");

        misty::panel::settings_section("##general_system", "System", {
            .title_font = UI::TextFont::BoldLarge,
            .title_color = kHeaderTextColor,
            .divider_color = kDividerColor,
        }, [&]() {
            misty::panel::settings_row("##general_system_proxy_status", {
                .start_width_pct = 0.52f,
                .divider_color = kDividerColor,
            }, [&]() {
                row_text("Proxy status", "Shows whether the local Misty proxy is currently reachable.");
            }, [&]() {
                const std::string status = proxy_status_label();
                UI::text({
                    .text = status.c_str(),
                    .width = UI::Size::auto_size(),
                    .align = UI::Align::End,
                    .color = misty::core::SessionManager::get().is_proxy_available()
                        ? kSuccessTextColor
                        : kHeaderTextColor,
                });
            });

            copyable_value_row(
                "##general_system_proxy_url",
                "Proxy URL",
                "The configured local proxy endpoint Misty uses for provider requests.",
                proxy_url
            );

            misty::panel::settings_row("##general_system_version", {
                .start_width_pct = 0.52f,
                .divider_color = kDividerColor,
            }, [&]() {
                row_text("App version", "The installed Misty build version.");
            }, [&]() {
                const std::string version = app_version_label();
                value_text(version.c_str());
            });

            misty::panel::settings_row("##general_system_build_info", {
                .start_width_pct = 0.52f,
                .divider_color = kDividerColor,
            }, [&]() {
                row_text("Build info", "Helpful runtime details for troubleshooting and support.");
            }, [&]() {
                const std::string info = build_info_label();
                value_text(info.c_str(), true);
            });

            copyable_value_row(
                "##general_system_config_path",
                "Config path",
                "Where Misty stores local configuration files on this device.",
                config_path_label()
            );

            copyable_value_row(
                "##general_system_data_path",
                "Data path",
                "Where Misty stores local app data on this device.",
                data_path_label()
            );
        });
    }

    void defaults_section(misty::panel::SettingsState& state) {
        misty::panel::settings_section("##general_defaults", "Defaults", {
            .title_font = UI::TextFont::BoldLarge,
            .title_color = kHeaderTextColor,
            .divider_color = kDividerColor,
        }, [&]() {
            misty::panel::settings_row("##general_defaults_workspace_root", {
                .start_width_pct = 0.52f,
                .divider_color = kDividerColor,
            }, [&]() {
                row_text("Preferred workspace root", "Choose the default starting location for file browsing.");
            }, [&]() {
                if (text_input_control(
                    "##general_defaults_workspace_root_input",
                    state.preferred_workspace_root,
                    sizeof(state.preferred_workspace_root)
                )) {
                    state.save_app_settings();
                }
            });

            misty::panel::settings_row("##general_defaults_mount_path", {
                .start_width_pct = 0.52f,
                .divider_color = kDividerColor,
            }, [&]() {
                row_text("Mount path", "Set the default Misty mount location used for local file access.");
            }, [&]() {
                if (text_input_control(
                    "##general_defaults_mount_path_input",
                    state.mount_path,
                    sizeof(state.mount_path)
                )) {
                    state.save_app_settings();
                }
            });

            misty::panel::settings_row("##general_defaults_transfer_behavior", {
                .start_width_pct = 0.52f,
                .show_divider = false,
                .divider_color = kDividerColor,
            }, [&]() {
                row_text("Default transfer behavior", "Choose how copy and download flows should behave by default.");
            }, [&]() {
                if (combo_control(
                    "##general_defaults_transfer_behavior_combo",
                    &state.default_transfer_behavior_index,
                    kTransferBehaviorOptions,
                    2
                )) {
                    state.save_app_settings();
                }
            });
        });
    }
} // namespace

namespace misty::panel {

bool general_tab(SettingsState& state) {
    bool clicked = settings_nav_item(
        "##settings_general",
        "General",
        "stack-16",
        state.active_section == SettingsSection::General
    );

    if (clicked) {
        state.active_section = SettingsSection::General;
    }

    return clicked;
}

void general_content(SettingsState& state) {
    settings_page("general_content", "General", [&]() {
        startup_section(state);
        updates_section(state);
        behavior_section(state);
        system_section();
        defaults_section(state);

        if (!state.status_message.empty()) {
            UI::text({
                .text = state.status_message.c_str(),
                .width = UI::Size::fill(),
                .overflow = UI::TextOverflow::Wrap,
                .color = state.status_is_error
                    ? ImVec4(0.88f, 0.44f, 0.44f, 1.0f)
                    : kSuccessTextColor,
            });
        } else {
            UI::text({
                .text = "General settings control startup, updates, system info, and file-manager defaults.",
                .width = UI::Size::px(520.0f),
                .overflow = UI::TextOverflow::Wrap,
                .color = kBodyTextColor,
            });
        }
    });
}

} // namespace misty::panel
