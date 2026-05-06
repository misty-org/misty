#include "panels/settings/advanced.h"

#include <cstdio>

#include "core/manager/asset_manager.h"
#include "core/manager/font_manager.h"
#include "core/ui/ui_layout.h"
#include "imgui.h"

namespace misty::panel {
namespace {

std::string format_mb(std::size_t bytes) {
    char buffer[64];
    std::snprintf(
        buffer,
        sizeof(buffer),
        "%.2f MB",
        static_cast<double>(bytes) / (1024.0 * 1024.0)
    );
    return buffer;
}

void stat_line(const char* label, const std::string& value) {
    const std::string line = std::string(label) + ": " + value;
    UI::text({
        .text = line.c_str(),
        .width = UI::Size::fill(),
        .color = ImVec4(0.76f, 0.78f, 0.82f, 1.0f),
    });
}

void subsection_title(const char* text) {
    UI::text({
        .text = text,
        .width = UI::Size::fill(),
        .color = ImVec4(0.94f, 0.95f, 0.97f, 1.0f),
        .font = UI::TextFont::Bold,
    });
}

void divider(const char* id) {
    UI::div(id, {
        .width = UI::Size::fill(),
        .height = UI::Size::px(1.0f),
        .bg_color = ImVec4(0.16f, 0.18f, 0.22f, 1.0f),
    }, []() {});
}

void texture_stats() {
    const auto stats = core::AssetManager::get().get_cache_stats();

    UI::column("##advanced_texture_stats", {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(0.0f, 10.0f),
    }, [&]() {
        subsection_title("Texture Cache");
        divider("##advanced_texture_divider");
        stat_line("SVG textures", std::to_string(stats.svg_texture_count));
        stat_line("SVG bytes", format_mb(stats.svg_texture_bytes));
        stat_line("Image textures", std::to_string(stats.image_texture_count));
        stat_line("Image bytes", format_mb(stats.image_texture_bytes));
    });
}

void font_stats() {
    const auto stats = core::FontManager::get().get_cache_stats();
    char atlas_size[64];
    std::snprintf(atlas_size, sizeof(atlas_size), "%d x %d", stats.atlas_width, stats.atlas_height);

    UI::column("##advanced_font_stats", {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(0.0f, 10.0f),
    }, [&]() {
        subsection_title("Font Cache");
        divider("##advanced_font_divider");
        stat_line("Loaded fonts", std::to_string(stats.font_count));
        stat_line("Custom fallbacks", std::to_string(stats.custom_font_count));
        stat_line("Atlas size", atlas_size);
        stat_line("Atlas bytes", format_mb(stats.atlas_texture_bytes));
        stat_line("Glyph count", std::to_string(stats.glyph_count));
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
    (void)state;

    UI::div("advanced_content", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .padding = UI::Spacing::xy(28.0f, 20.0f),
    }, [&]() {
        UI::column("##advanced_body", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(0.0f, 20.0f),
        }, [&]() {
            UI::text({
                .text = "Advanced",
                .width = UI::Size::fill(),
                .color = ImVec4(0.96f, 0.96f, 0.98f, 1.0f),
                .font = UI::TextFont::BoldXLarge,
            });
            texture_stats();
            font_stats();
        });
    });
}

} //namespace misty::panel
