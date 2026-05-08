#include "panels/settings/settings_shortcuts.h"

#include <cfloat>
#include <cstdio>
#include <cstring>

#include "core/commands/command_manager.h"
#include "core/ui/ui_layout.h"
#include "imgui.h"
#include "panels/settings/settings_components.h"

namespace misty::panel {
namespace {

constexpr const char* kKeymapOptions[] = {"System", "VS Code", "Finder"};

void load_shortcut_editor_entries(SettingsState& state) {
    state.shortcut_editor_entries.clear();

    const auto bindings = core::CommandManager::get().list_shortcuts();
    state.shortcut_editor_entries.reserve(bindings.size());
    for (const auto& [command_id, shortcut] : bindings) {
        ShortcutEditorEntry entry;
        entry.command_id = command_id;
        entry.saved_value = shortcut;
        std::snprintf(entry.edit_value.data(), entry.edit_value.size(), "%s", shortcut.c_str());
        state.shortcut_editor_entries.push_back(std::move(entry));
    }

    state.shortcut_editor_loaded = true;
}

bool shortcut_editor_is_dirty(const SettingsState& state) {
    for (const auto& entry : state.shortcut_editor_entries) {
        if (entry.saved_value != entry.edit_value.data()) {
            return true;
        }
    }
    return false;
}

void reset_shortcut_editor(SettingsState& state) {
    const auto bindings = core::CommandManager::get().list_shortcuts();
    for (auto& entry : state.shortcut_editor_entries) {
        const auto it = std::find_if(bindings.begin(), bindings.end(), [&](const auto& binding) {
            return binding.first == entry.command_id;
        });
        const std::string value = it != bindings.end() ? it->second : "";
        entry.saved_value = value;
        std::snprintf(entry.edit_value.data(), entry.edit_value.size(), "%s", value.c_str());
    }
}

void navigation_section(SettingsState& state) {
    settings_section("##shortcuts_navigation", "Navigation", {}, [&]() {
        settings_row("##shortcuts_hints", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Show shortcut hints", "Display shortcut hints in tooltips and menus where helpful.");
        }, [&]() {
            if (settings_toggle_switch("##shortcuts_hints_toggle", &state.shortcut_hints_enabled)) {
                state.save_app_settings();
            }
        });
    });
}

void customization_section(SettingsState& state) {
    settings_section("##shortcuts_customization", "Customization", {}, [&]() {
        settings_row("##shortcuts_keymap", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Keymap preset", "Choose the shortcut style that feels most natural on this device.");
        }, [&]() {
            if (settings_select_control("##shortcuts_keymap_select", &state.keymap_index, kKeymapOptions, 3)) {
                state.save_app_settings();
            }
        });

        settings_row("##shortcuts_custom", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Enable custom shortcuts", "Reserve room for per-command remapping as the shortcut editor lands.");
        }, [&]() {
            if (settings_toggle_switch("##shortcuts_custom_toggle", &state.custom_shortcuts_enabled)) {
                state.save_app_settings();
            }
        });
    });
}

void reference_section(SettingsState& state) {
    settings_section("##shortcuts_reference", "Reference", {}, [&]() {
        settings_row_text("Available shortcuts", "Review the active bindings Misty has loaded so shortcut behavior is easy to test.");

        if (!state.shortcut_editor_loaded) {
            load_shortcut_editor_entries(state);
        }

        const bool dirty = shortcut_editor_is_dirty(state);

        settings_row("##shortcuts_reference_header", {
            .start_width_pct = 0.52f,
            .show_divider = true,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            UI::div("##shortcuts_reference_header_command", {
                .mode = UI::Mode::LayoutOnly,
                .width = UI::Size::fill(),
                .height = UI::Size::auto_size(),
                .padding = UI::Spacing::xy(0.0f, 12.0f),
            }, [&]() {
                UI::text({
                    .text = "Command",
                    .width = UI::Size::fill(),
                    .color = kSettingsHeaderTextColor,
                });
            });
        }, [&]() {
            UI::div("##shortcuts_reference_header_shortcut", {
                .mode = UI::Mode::LayoutOnly,
                .width = UI::Size::fill(),
                .height = UI::Size::auto_size(),
                .padding = UI::Spacing::xy(0.0f, 12.0f),
            }, [&]() {
                UI::text({
                    .text = "Shortcut",
                    .width = UI::Size::fill(),
                    .color = kSettingsHeaderTextColor,
                });
            });
        });

        for (std::size_t index = 0; index < state.shortcut_editor_entries.size(); ++index) {
            auto& entry = state.shortcut_editor_entries[index];
            const std::string row_id = "##shortcuts_reference_row_" + std::to_string(index);
            const std::string command_id = row_id + "_command";
            const std::string value_id = row_id + "_value";
            const std::string input_id = "##shortcut_value_" + entry.command_id;

            settings_row(row_id.c_str(), {
                .start_width_pct = 0.52f,
                .show_divider = index + 1 < state.shortcut_editor_entries.size(),
                .divider_color = kSettingsDividerColor,
            }, [&]() {
                UI::div(command_id.c_str(), {
                    .mode = UI::Mode::LayoutOnly,
                    .width = UI::Size::fill(),
                    .height = UI::Size::auto_size(),
                    .padding = UI::Spacing::xy(0.0f, 5.0f),
                }, [&]() {
                    UI::text({
                        .text = entry.command_id.c_str(),
                        .width = UI::Size::fill(),
                        .color = kSettingsHeaderTextColor,
                        .overflow = UI::TextOverflow::Wrap,
                    });
                });
            }, [&]() {
                UI::div(value_id.c_str(), {
                    .mode = UI::Mode::LayoutOnly,
                    .width = UI::Size::fill(),
                    .height = UI::Size::auto_size(),
                }, [&]() {
                    UI::input_text({
                        .label = input_id.c_str(),
                        .buffer = entry.edit_value.data(),
                        .buffer_size = entry.edit_value.size(),
                        .width = UI::Size::fill(),
                        .height = UI::Size::px(kSettingsControlHeight),
                        .padding = UI::Spacing::xy(10.0f, 8.0f),
                        .rounding = 6.0f,
                        .bg_color = kSettingsControlBgColor,
                        .border_color = kSettingsControlBorderColor,
                        .text_color = kSettingsControlTextColor,
                    });
                });
            });
        }

        ImGui::Spacing();
        ImGui::BeginDisabled(!dirty);
        if (ImGui::Button("Save Changes", ImVec2(140.0f, 0.0f))) {
            std::vector<std::pair<std::string, std::string>> bindings;
            bindings.reserve(state.shortcut_editor_entries.size());

            bool invalid_entry = false;
            for (const auto& entry : state.shortcut_editor_entries) {
                const std::string value = entry.edit_value.data();
                if (value.empty()) {
                    state.status_message = "Shortcut values cannot be empty.";
                    state.status_is_error = true;
                    invalid_entry = true;
                    break;
                }
                bindings.emplace_back(entry.command_id, value);
            }

            if (!invalid_entry) {
                std::string error;
                if (!core::CommandManager::get().save_shortcuts(bindings, &error)) {
                    state.status_message = error.empty() ? "Failed to save shortcuts." : error;
                    state.status_is_error = true;
                } else {
                    reset_shortcut_editor(state);
                    state.status_message = "Shortcut changes saved.";
                    state.status_is_error = false;
                }
            }
        }
        ImGui::EndDisabled();

        ImGui::SameLine();
        if (ImGui::Button("Reset", ImVec2(100.0f, 0.0f))) {
            reset_shortcut_editor(state);
            state.status_message = "Shortcut edits reset.";
            state.status_is_error = false;
        }

        if (!state.status_message.empty()) {
            ImGui::Spacing();
            settings_status_text(state.status_message, state.status_is_error);
        }
    });
}

} // namespace

bool shortcuts_tab(SettingsState& state) {
    const bool clicked = settings_nav_item(
        "##settings_shortcuts",
        "Shortcuts",
        "rows-16",
        state.active_section == SettingsSection::Shortcuts
    );

    if (clicked) {
        state.active_section = SettingsSection::Shortcuts;
    }

    return clicked;
}

void shortcuts_content(SettingsState& state) {
    settings_page("shortcuts_content", "Shortcuts", [&]() {
        navigation_section(state);
        customization_section(state);
        reference_section(state);
    });
}

} // namespace misty::panel
