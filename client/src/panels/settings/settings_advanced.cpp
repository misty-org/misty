#include "panels/settings/settings_advanced.h"

#include <cstdio>

#include "core/manager/asset_manager.h"
#include "core/manager/font_manager.h"
#include "core/ui/ui_layout.h"
#include "imgui.h"
#include "panels/settings/settings_components.h"

namespace misty::panel {
namespace {

std::string format_mb(std::size_t bytes) {
    char buffer[64];
    std::snprintf(buffer, sizeof(buffer), "%.2f MB", static_cast<double>(bytes) / (1024.0 * 1024.0));
    return buffer;
}

void diagnostics_section(SettingsState& state) {
    settings_section("##advanced_diagnostics", "Diagnostics", {}, [&]() {
        settings_row("##advanced_debug_logging", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Debug logging", "Keep more verbose runtime details available while polishing the release.");
        }, [&]() {
            if (settings_toggle_switch("##advanced_debug_logging_toggle", &state.debug_logging_enabled)) {
                state.save_app_settings();
            }
        });

        settings_row("##advanced_experimental", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Experimental features", "Allow in-progress features to surface before they are fully settled.");
        }, [&]() {
            if (settings_toggle_switch("##advanced_experimental_toggle", &state.experimental_features_enabled)) {
                state.save_app_settings();
            }
        });
    });
}

void connection_section(SettingsState& state) {
    settings_section("##advanced_connection", "Connection", {}, [&]() {
        settings_row("##advanced_server_address", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Server address", "The gRPC address Misty uses for local file operations.");
        }, [&]() {
            if (settings_input_control("##advanced_server_address_input", state.server_address, sizeof(state.server_address))) {
                state.save_app_settings();
            }
        });

        settings_row("##advanced_mount_path", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Mount path", "The root path Misty should treat as its default mount target.");
        }, [&]() {
            if (settings_input_control("##advanced_mount_path_input", state.mount_path, sizeof(state.mount_path))) {
                state.save_app_settings();
            }
        });
    });
}

void cache_section() {
    const auto asset_stats = core::AssetManager::get().get_cache_stats();
    const auto font_stats = core::FontManager::get().get_cache_stats();
    char atlas_size[64];
    std::snprintf(atlas_size, sizeof(atlas_size), "%d x %d", font_stats.atlas_width, font_stats.atlas_height);

    settings_section("##advanced_cache", "Caches", {}, [&]() {
        settings_row("##advanced_svg_cache", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("SVG texture cache", "Current SVG icon textures held in memory.");
        }, [&]() {
            settings_value_text((std::to_string(asset_stats.svg_texture_count) + " items / " + format_mb(asset_stats.svg_texture_bytes)).c_str(), true);
        });

        settings_row("##advanced_image_cache", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Image texture cache", "Current decoded image textures held in memory.");
        }, [&]() {
            settings_value_text((std::to_string(asset_stats.image_texture_count) + " items / " + format_mb(asset_stats.image_texture_bytes)).c_str(), true);
        });

        settings_row("##advanced_font_cache", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Font cache", "Loaded font atlas and fallback glyph information.");
        }, [&]() {
            settings_value_text((std::string(atlas_size) + " / " + format_mb(font_stats.atlas_texture_bytes)).c_str(), true);
        });
    });
}

void safeguards_section(SettingsState& state) {
    settings_section("##advanced_safeguards", "Safeguards", {}, [&]() {
        settings_row("##advanced_confirm_recent", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Confirm clear recent", "Ask before clearing the recent-items list.");
        }, [&]() {
            if (settings_toggle_switch("##advanced_confirm_recent_toggle", &state.confirm_clear_recent)) {
                state.save_app_settings();
            }
        });

        settings_row("##advanced_confirm_starred", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Confirm clear starred", "Ask before clearing starred items in bulk.");
        }, [&]() {
            if (settings_toggle_switch("##advanced_confirm_starred_toggle", &state.confirm_clear_starred)) {
                state.save_app_settings();
            }
        });

        settings_row("##advanced_confirm_trash", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Confirm empty trash", "Require confirmation before emptying trash.");
        }, [&]() {
            if (settings_toggle_switch("##advanced_confirm_trash_toggle", &state.confirm_empty_trash)) {
                state.save_app_settings();
            }
        });

        settings_row("##advanced_confirm_cache", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Confirm clear cache", "Ask before clearing runtime caches and temporary data.");
        }, [&]() {
            if (settings_toggle_switch("##advanced_confirm_cache_toggle", &state.confirm_clear_cache)) {
                state.save_app_settings();
            }
        });
    });
}

} // namespace

bool advanced_tab(SettingsState& state) {
    const bool clicked = UI::button("##settings_advanced", {
        .width = UI::Size::fill(),
        .height = UI::Size::px(32.0f),
        .variant = UI::ButtonVariant::Nav,
        .hover_color = ImVec4(0.2f, 0.2f, 0.2f, 1.0f),
        .selected = state.active_section == SettingsSection::Advanced,
        .padding = UI::Spacing::xy(8.0f, 8.0f),
        .rounding = 8.0f,
    }, [&]() {
        UI::text({
            .text = "Advanced",
            .width = UI::Size::fill(),
            .align = UI::Align::Start,
            .justify = UI::Justify::Center,
        });
    });

    if (clicked) {
        state.active_section = SettingsSection::Advanced;
    }

    return clicked;
}

void advanced_content(SettingsState& state) {
    UI::div("advanced_content", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .padding = UI::Spacing::xy(28.0f, 20.0f),
    }, [&]() {
        UI::column("##advanced_body", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(0.0f, 18.0f),
        }, [&]() {
            settings_page_title("Advanced");
            diagnostics_section(state);
            connection_section(state);
            cache_section();
            safeguards_section(state);
        });
    });
}

} //namespace misty::panel
