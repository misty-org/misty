#include "panels/settings/settings_appearance.h"

#include <cstring>
#include <filesystem>

#include "core/file_picker/file_picker.h"
#include "core/manager/font_manager.h"
#include "core/ui/ui_layout.h"
#include "imgui.h"
#include "panels/settings/settings_components.h"

namespace misty::panel {
namespace {

namespace fs = std::filesystem;

constexpr const char* kThemeOptions[] = {"System", "Dark", "Light"};
constexpr const char* kScaleOptions[] = {"Small", "Default", "Large"};
constexpr const char* kFontSizeOptions[] = {"Small", "Default", "Large"};

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
        layout_section(state);
        typography_section(state);
        fonts_section(state);
        media_section(state);
    }, UI::Spacing::xy(0.0f, 24.0f));
}

} // namespace misty::panel
