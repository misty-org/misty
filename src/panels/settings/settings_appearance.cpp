#include "panels/settings/settings_appearance.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstring>
#include <filesystem>
#include <string>

#include "core/file_picker/file_picker.h"
#include "core/manager/font_manager.h"
#include "core/manager/theme_manager.h"
#include "core/ui/ui_layout.h"
#include "imgui.h"
#include "panels/settings/settings_components.h"

namespace misty::panel {
namespace {

namespace fs = std::filesystem;

constexpr const char* kThemeOptions[] = {"System", "Dark", "Light"};
constexpr const char* kScaleOptions[] = {"Small", "Default", "Large"};
constexpr const char* kFontSizeOptions[] = {"Small", "Default", "Large"};

struct InlineThemeField {
    const char* token;
    const char* label;
    char hex[16];
};

struct InlineThemeBuilderState {
    std::array<InlineThemeField, 12> fields = {{
        {"window_bg", "Window background", "#111113"},
        {"panel_bg", "Panel background", "#18181B"},
        {"panel_alt_bg", "Elevated panel", "#27272A"},
        {"border", "Border", "#27272A"},
        {"text", "Primary text", "#D4D4D8"},
        {"text_muted", "Muted text", "#71717A"},
        {"accent", "Accent", "#3B82F6"},
        {"accent_hover", "Accent hover", "#2563EB"},
        {"selection", "Selection", "#3B82F659"},
        {"success", "Success", "#29BB88"},
        {"warning", "Warning", "#F7A134"},
        {"error", "Error", "#EF4444"},
    }};
    std::string status_message = "Pick a preset or edit token values below.";
    bool status_is_error = false;
    bool synced_from_host = false;
};

InlineThemeBuilderState g_theme_builder_state;

char hex_digit(unsigned int value) {
    return static_cast<char>(value < 10 ? ('0' + value) : ('A' + (value - 10)));
}

void encode_hex(const float rgba[4], char out[16]) {
    const auto to_byte = [](float value) -> unsigned int {
        const float clamped = std::clamp(value, 0.0f, 1.0f);
        return static_cast<unsigned int>(clamped * 255.0f + 0.5f);
    };

    const unsigned int r = to_byte(rgba[0]);
    const unsigned int g = to_byte(rgba[1]);
    const unsigned int b = to_byte(rgba[2]);
    const unsigned int a = to_byte(rgba[3]);

    out[0] = '#';
    out[1] = hex_digit((r >> 4) & 0xF);
    out[2] = hex_digit(r & 0xF);
    out[3] = hex_digit((g >> 4) & 0xF);
    out[4] = hex_digit(g & 0xF);
    out[5] = hex_digit((b >> 4) & 0xF);
    out[6] = hex_digit(b & 0xF);
    if (a < 255) {
        out[7] = hex_digit((a >> 4) & 0xF);
        out[8] = hex_digit(a & 0xF);
        out[9] = '\0';
    } else {
        out[7] = '\0';
    }
}

int hex_value(char ch) {
    if (ch >= '0' && ch <= '9') return ch - '0';
    if (ch >= 'a' && ch <= 'f') return 10 + (ch - 'a');
    if (ch >= 'A' && ch <= 'F') return 10 + (ch - 'A');
    return -1;
}

bool parse_hex_color(const char* input, float rgba[4]) {
    if (!input || !rgba) {
        return false;
    }

    std::string value(input);
    value.erase(std::remove_if(value.begin(), value.end(), [](unsigned char ch) {
        return std::isspace(ch) != 0;
    }), value.end());
    if (!value.empty() && value.front() == '#') {
        value.erase(value.begin());
    }

    if (value.size() != 6 && value.size() != 8) {
        return false;
    }

    auto parse_byte = [&](std::size_t index) -> int {
        const int hi = hex_value(value[index]);
        const int lo = hex_value(value[index + 1]);
        return (hi < 0 || lo < 0) ? -1 : ((hi << 4) | lo);
    };

    const int r = parse_byte(0);
    const int g = parse_byte(2);
    const int b = parse_byte(4);
    const int a = value.size() == 8 ? parse_byte(6) : 255;
    if (r < 0 || g < 0 || b < 0 || a < 0) {
        return false;
    }

    rgba[0] = static_cast<float>(r) / 255.0f;
    rgba[1] = static_cast<float>(g) / 255.0f;
    rgba[2] = static_cast<float>(b) / 255.0f;
    rgba[3] = static_cast<float>(a) / 255.0f;
    return true;
}

void theme_builder_status(const std::string& message, bool is_error) {
    g_theme_builder_state.status_message = message;
    g_theme_builder_state.status_is_error = is_error;
}

void sync_theme_builder_from_host() {
    auto& manager = core::ThemeManager::get();
    for (auto& field : g_theme_builder_state.fields) {
        float rgba[4] = {0.0f, 0.0f, 0.0f, 1.0f};
        if (manager.get_color(field.token, rgba)) {
            encode_hex(rgba, field.hex);
        }
    }
    g_theme_builder_state.synced_from_host = true;
}

void apply_theme_preset(const char* preset_name, const char* label) {
    if (!core::ThemeManager::get().apply_preset(preset_name)) {
        theme_builder_status("Could not apply the requested preset.", true);
        return;
    }

    sync_theme_builder_from_host();
    theme_builder_status(std::string("Applied ") + label + ".", false);
}

void apply_theme_edits() {
    auto& manager = core::ThemeManager::get();
    for (const auto& field : g_theme_builder_state.fields) {
        float rgba[4] = {};
        if (!parse_hex_color(field.hex, rgba)) {
            theme_builder_status(std::string("Invalid color for ") + field.label + ".", true);
            return;
        }
        if (!manager.set_color(field.token, rgba)) {
            theme_builder_status(std::string("Could not apply token ") + field.label + ".", true);
            return;
        }
    }

    theme_builder_status("Applied custom theme edits.", false);
}

void ensure_custom_fonts_loaded(SettingsState& state) {
    if (state.custom_fonts_loaded) {
        return;
    }

    state.custom_fonts = core::FontManager::get().load_custom_fonts();
    state.custom_fonts_loaded = true;
}

void browse_font(SettingsState& state) {
    core::FilePickerOptions options;
    options.title = "Select Font";
    options.allowed_extensions = {"ttf", "otf"};

    const auto result = core::FilePicker::show_dialog(options);
    if (!result.has_selection()) {
        return;
    }

    const std::string path = result.paths.front();
    const std::string label = fs::path(path).stem().string();
    std::snprintf(state.custom_font_path, sizeof(state.custom_font_path), "%s", path.c_str());
    std::snprintf(state.custom_font_label, sizeof(state.custom_font_label), "%s", label.c_str());
}

void add_font_modal(SettingsState& state) {
    if (!state.show_add_font_modal) {
        return;
    }

    ImGui::OpenPopup("##add_custom_font");
    if (ImGui::BeginPopupModal("##add_custom_font", &state.show_add_font_modal, ImGuiWindowFlags_AlwaysAutoResize)) {
        ImGui::TextUnformatted("Add Custom Font");
        ImGui::Spacing();

        ImGui::TextUnformatted("Label");
        ImGui::InputText("##custom_font_label", state.custom_font_label, sizeof(state.custom_font_label));

        ImGui::TextUnformatted("Path");
        ImGui::InputText("##custom_font_path", state.custom_font_path, sizeof(state.custom_font_path));

        if (ImGui::Button("Browse...", ImVec2(96.0f, 0.0f))) {
            browse_font(state);
        }

        ImGui::Spacing();
        if (ImGui::Button("Add", ImVec2(96.0f, 0.0f))) {
            if (state.custom_font_path[0] != '\0') {
                core::CustomFontEntry entry;
                entry.label = state.custom_font_label[0] != '\0'
                    ? std::string(state.custom_font_label)
                    : fs::path(state.custom_font_path).stem().string();
                entry.path = state.custom_font_path;
                state.custom_fonts.push_back(std::move(entry));
                state.custom_fonts_dirty = true;
            }
            state.custom_font_label[0] = '\0';
            state.custom_font_path[0] = '\0';
            state.show_add_font_modal = false;
            ImGui::CloseCurrentPopup();
        }

        ImGui::SameLine();
        if (ImGui::Button("Cancel", ImVec2(96.0f, 0.0f))) {
            state.show_add_font_modal = false;
            ImGui::CloseCurrentPopup();
        }

        ImGui::EndPopup();
    }
}

void custom_font_row(SettingsState& state, int index) {
    auto& font = state.custom_fonts[index];

    UI::column(("##custom_font_row_" + std::to_string(index)).c_str(), {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(0.0f, 10.0f),
    }, [&]() {
        UI::row(("##custom_font_content_" + std::to_string(index)).c_str(), {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(16.0f, 0.0f),
            .justify = UI::Justify::Center,
        }, [&]() {
            UI::column(("##custom_font_text_" + std::to_string(index)).c_str(), {
                .width = UI::Size::fill(),
                .height = UI::Size::auto_size(),
                .gap = UI::Spacing::xy(0.0f, 4.0f),
            }, [&]() {
                UI::text({
                    .text = font.label.c_str(),
                    .width = UI::Size::fill(),
                    .color = ImVec4(0.94f, 0.95f, 0.97f, 1.0f),
                    .font = UI::TextFont::Bold,
                });
                UI::text({
                    .text = font.path.c_str(),
                    .width = UI::Size::fill(),
                    .overflow = UI::TextOverflow::Clip,
                    .color = ImVec4(0.58f, 0.60f, 0.64f, 1.0f),
                });
            });

            if (UI::button(("##remove_custom_font_" + std::to_string(index)).c_str(), {
                .label = "Remove",
                .width = UI::Size::px(96.0f),
                .height = UI::Size::px(32.0f),
                .variant = UI::ButtonVariant::Subtle,
                .rounding = 4.0f,
            })) {
                state.custom_fonts.erase(state.custom_fonts.begin() + index);
                state.custom_fonts_dirty = true;
            }
        });

        UI::divider({
            .color = kSettingsDividerColor,
        });
    });
}

void theme_section(SettingsState& state) {
    settings_section("##appearance_theme", "Theme", {}, [&]() {
        settings_row("##appearance_theme_mode", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Theme mode", "Choose whether Misty follows the system appearance or uses a fixed theme.");
        }, [&]() {
            if (settings_select_control("##appearance_theme_mode_select", &state.theme_index, kThemeOptions, 3)) {
                state.save_app_settings();
            }
        });

        settings_row("##appearance_ui_scale", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("UI scale", "Adjust overall interface scale and density.");
        }, [&]() {
            if (settings_select_control("##appearance_ui_scale_select", &state.ui_scale_index, kScaleOptions, 3)) {
                state.save_app_settings();
            }
        });
    });
}

void theme_builder_section() {
    if (!g_theme_builder_state.synced_from_host) {
        sync_theme_builder_from_host();
    }

    settings_section("##appearance_theme_builder", "Theme Builder", {}, [&]() {
        UI::text({
            .text = "Adjust Misty theme tokens inline or start from a preset like Gruvbox, Tokyo Night, or Catppuccin.",
            .width = UI::Size::px(560.0f),
            .overflow = UI::TextOverflow::Wrap,
            .color = ImVec4(0.76f, 0.78f, 0.82f, 1.0f),
        });

        UI::row("##appearance_theme_builder_presets_row_1", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(10.0f, 0.0f),
        }, [&]() {
            if (UI::button("##appearance_theme_gruvbox", {
                .label = "Apply Gruvbox",
                .width = UI::Size::px(140.0f),
                .height = UI::Size::px(34.0f),
                .variant = UI::ButtonVariant::Subtle,
                .rounding = 6.0f,
            })) {
                apply_theme_preset("gruvbox-dark", "Gruvbox Dark");
            }
            if (UI::button("##appearance_theme_tokyo_night", {
                .label = "Apply Tokyo Night",
                .width = UI::Size::px(160.0f),
                .height = UI::Size::px(34.0f),
                .variant = UI::ButtonVariant::Subtle,
                .rounding = 6.0f,
            })) {
                apply_theme_preset("tokyo-night", "Tokyo Night");
            }
            if (UI::button("##appearance_theme_catppuccin", {
                .label = "Apply Catppuccin",
                .width = UI::Size::px(160.0f),
                .height = UI::Size::px(34.0f),
                .variant = UI::ButtonVariant::Subtle,
                .rounding = 6.0f,
            })) {
                apply_theme_preset("catppuccin-mocha", "Catppuccin Mocha");
            }
        });

        UI::row("##appearance_theme_builder_presets_row_2", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(10.0f, 0.0f),
        }, [&]() {
            if (UI::button("##appearance_theme_reset_default", {
                .label = "Reset Misty Dark",
                .width = UI::Size::px(160.0f),
                .height = UI::Size::px(34.0f),
                .variant = UI::ButtonVariant::Subtle,
                .rounding = 6.0f,
            })) {
                apply_theme_preset("misty-dark", "Misty Dark");
            }
            if (UI::button("##appearance_theme_reload_current", {
                .label = "Reload Current",
                .width = UI::Size::px(140.0f),
                .height = UI::Size::px(34.0f),
                .variant = UI::ButtonVariant::Subtle,
                .rounding = 6.0f,
            })) {
                sync_theme_builder_from_host();
                theme_builder_status("Reloaded theme tokens from the current theme.", false);
            }
        });

        for (auto& field : g_theme_builder_state.fields) {
            settings_row((std::string("##appearance_theme_token_") + field.token).c_str(), {
                .start_width_pct = 0.52f,
                .show_divider = false,
                .divider_color = kSettingsDividerColor,
            }, [&]() {
                settings_row_text(field.label, field.token);
            }, [&]() {
                settings_input_control((std::string("##appearance_theme_token_input_") + field.token).c_str(),
                    field.hex, sizeof(field.hex), false);
            });
        }

        UI::row("##appearance_theme_builder_actions", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(12.0f, 0.0f),
            .align = UI::Align::Center,
        }, [&]() {
            if (UI::button("##appearance_theme_apply_edits", {
                .label = "Apply Edits",
                .width = UI::Size::px(120.0f),
                .height = UI::Size::px(34.0f),
                .variant = UI::ButtonVariant::Primary,
                .rounding = 6.0f,
            })) {
                apply_theme_edits();
            }

            UI::text({
                .text = "Hex accepts #RRGGBB or #RRGGBBAA.",
                .width = UI::Size::fill(),
                .overflow = UI::TextOverflow::Wrap,
                .color = kSettingsMutedTextColor,
            });
        });

        if (!g_theme_builder_state.status_message.empty()) {
            settings_status_text(g_theme_builder_state.status_message, g_theme_builder_state.status_is_error);
        }
    });
}

void layout_section(SettingsState& state) {
    settings_section("##appearance_layout", "Layout", {}, [&]() {
        settings_row("##appearance_compact_mode", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Compact mode", "Reduce padding and spacing in file-heavy views.");
        }, [&]() {
            if (settings_toggle_switch("##appearance_compact_mode_toggle", &state.compact_mode_enabled)) {
                state.save_app_settings();
            }
        });
    });
}

void typography_section(SettingsState& state) {
    settings_section("##appearance_typography", "Typography", {}, [&]() {
        settings_row("##appearance_font_size", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Font size", "Choose the baseline text size Misty should use.");
        }, [&]() {
            if (settings_select_control("##appearance_font_size_select", &state.font_size_index, kFontSizeOptions, 3)) {
                state.save_app_settings();
            }
        });
    });
}

void fonts_section(SettingsState& state) {
    ensure_custom_fonts_loaded(state);

    settings_section("##appearance_fonts_section", "Fonts", {}, [&]() {
        UI::text({
            .text = "Add custom fallback fonts to support filenames and text in additional languages.",
            .width = UI::Size::px(520.0f),
            .overflow = UI::TextOverflow::Wrap,
            .color = ImVec4(0.76f, 0.78f, 0.82f, 1.0f),
        });

        if (state.custom_fonts.empty()) {
            UI::text({
                .text = "No custom fonts added yet.",
                .width = UI::Size::fill(),
                .color = ImVec4(0.58f, 0.60f, 0.64f, 1.0f),
            });
        } else {
            for (int i = 0; i < static_cast<int>(state.custom_fonts.size()); ++i) {
                custom_font_row(state, i);
            }
        }

        UI::row("##appearance_fonts_actions", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(10.0f, 0.0f),
            .justify = UI::Justify::Center,
        }, [&]() {
            if (UI::button("##add_custom_font", {
                .label = "Add Font",
                .width = UI::Size::px(110.0f),
                .height = UI::Size::px(32.0f),
                .variant = UI::ButtonVariant::Subtle,
                .rounding = 4.0f,
            })) {
                state.custom_font_label[0] = '\0';
                state.custom_font_path[0] = '\0';
                state.show_add_font_modal = true;
            }

            if (UI::button("##apply_custom_fonts", {
                .label = "Apply Fonts",
                .width = UI::Size::px(120.0f),
                .height = UI::Size::px(32.0f),
                .variant = UI::ButtonVariant::Primary,
                .rounding = 4.0f,
            })) {
                std::string error;
                if (!core::FontManager::get().save_custom_fonts(state.custom_fonts, &error)) {
                    state.status_message = error;
                    state.status_is_error = true;
                } else {
                    state.save_app_settings();
                    state.custom_fonts_dirty = false;
                    core::FontManager::get().queue_reload();
                    state.status_message = "Fonts will be applied.";
                    state.status_is_error = false;
                }
                state.status_timer = 4.0f;
            }
        });

        if (!state.status_message.empty()) {
            settings_status_text(state.status_message, state.status_is_error);
        }
    });

    add_font_modal(state);
}

void media_section(SettingsState& state) {
    settings_section("##appearance_media", "Media", {}, [&]() {
        settings_row("##appearance_thumbnails", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Thumbnail previews", "Show preview-rich file rows where supported.");
        }, [&]() {
            if (settings_toggle_switch("##appearance_thumbnails_toggle", &state.thumbnail_previews_enabled)) {
                state.save_app_settings();
            }
        });

        settings_row("##appearance_motion", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Reduced motion", "Tone down motion and animated transitions.");
        }, [&]() {
            if (settings_toggle_switch("##appearance_motion_toggle", &state.reduced_motion_enabled)) {
                state.save_app_settings();
            }
        });
    });
}

} // namespace

bool appearance_tab(SettingsState& state) {
    bool clicked = settings_nav_item(
        "##settings_appearance",
        "Appearance",
        "eye-16",
        state.active_section == SettingsSection::Appearance
    );

    if (clicked) {
        state.active_section = SettingsSection::Appearance;
    }

    return clicked;
}

void appearance_content(SettingsState& state) {
    settings_page("appearance_content", "Appearance", [&]() {
        theme_section(state);
        theme_builder_section();
        layout_section(state);
        typography_section(state);
        fonts_section(state);
        media_section(state);
    }, UI::Spacing::xy(0.0f, 24.0f));
}

} // namespace misty::panel
