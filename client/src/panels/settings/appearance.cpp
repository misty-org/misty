#include "panels/settings/appearance.h"

#include <cstring>
#include <filesystem>

#include "core/file_picker/file_picker.h"
#include "core/manager/font_manager.h"
#include "core/ui/ui_layout.h"
#include "imgui.h"

namespace misty::panel {
namespace {

namespace fs = std::filesystem;

void section_label(const char* text) {
    UI::text({
        .text = text,
        .width = UI::Size::fill(),
        .color = ImVec4(0.82f, 0.84f, 0.88f, 1.0f),
        .font = UI::TextFont::Small,
    });
}

void divider(const char* id) {
    UI::div(id, {
        .width = UI::Size::fill(),
        .height = UI::Size::px(0.5f),
        .bg_color = ImVec4(0.14f, 0.16f, 0.20f, 1.0f),
    }, []() {});
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

        divider(("##custom_font_divider_" + std::to_string(index)).c_str());
    });
}

void fonts_section(SettingsState& state) {
    ensure_custom_fonts_loaded(state);

    UI::column("##appearance_fonts_section", {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(0.0f, 18.0f),
    }, [&]() {
        section_label("Fonts");
        divider("##appearance_fonts_divider");

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
                    state.custom_fonts_dirty = false;
                    core::FontManager::get().queue_reload();
                    state.status_message = "Fonts will be applied.";
                    state.status_is_error = false;
                }
                state.status_timer = 4.0f;
            }
        });

        if (!state.status_message.empty()) {
            UI::text({
                .text = state.status_message.c_str(),
                .width = UI::Size::fill(),
                .color = state.status_is_error
                    ? ImVec4(0.88f, 0.44f, 0.44f, 1.0f)
                    : ImVec4(0.55f, 0.82f, 0.64f, 1.0f),
            });
        }
    });

    add_font_modal(state);
}

} // namespace

bool appearance_tab(SettingsState& state) {
    bool clicked = UI::button("##settings_appearance", {
        .width = UI::Size::fill(),
        .height = UI::Size::px(32.0f),
        .variant = UI::ButtonVariant::Nav,
        .hover_color = ImVec4(0.2f, 0.2f, 0.2f, 1.0f),
        .selected = state.active_section == SettingsSection::Appearance,
        .padding = UI::Spacing::xy(8.0f, 8.0f),
        .rounding = 8.0f,
    }, [&]() {
        UI::text({
            .text = "Appearance",
            .width = UI::Size::fill(),
            .align = UI::Align::Start,
            .justify = UI::Justify::Center,
        });
    });

    if (clicked) {
        state.active_section = SettingsSection::Appearance;
    }

    return clicked;
}

void appearance_content(SettingsState& state) {
    UI::div("appearance_content", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .padding = UI::Spacing::xy(28.0f, 20.0f),
    }, [&]() {
        UI::column("##appearance_body", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(0.0f, 24.0f),
        }, [&]() {
            UI::text({
                .text = "Appearance",
                .width = UI::Size::fill(),
                .color = ImVec4(0.96f, 0.96f, 0.98f, 1.0f),
                .font = UI::TextFont::BoldXLarge,
            });
            fonts_section(state);
        });
    });
}

} // namespace misty::panel
