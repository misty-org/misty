#include "panels/settings/components.h"

#include <string>

#include "core/ui/ui_layout.h"

namespace UI = misty::UI;

namespace {

constexpr ImVec4 kSettingsTextColor = ImVec4(0.96f, 0.96f, 0.98f, 1.0f);
constexpr ImVec4 kSettingsDividerColor = ImVec4(0.2f, 0.2f, 0.2f, 1.0f);
constexpr float kSettingsEndColumnWidth = 220.0f;

} // namespace

namespace misty::panel {

void settings_row(
    const char* id,
    const std::function<void()>& start_content,
    const std::function<void()>& end_content,
    bool show_divider) {
    UI::column(id, {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(0.0f, 0.0f),
    }, [&]() {
        const std::string table_id = std::string(id) + "_table";
        const std::string start_id = std::string(id) + "_start";
        const std::string end_id = std::string(id) + "_end";
        if (ImGui::BeginTable(table_id.c_str(), 2, ImGuiTableFlags_SizingStretchProp)) {
            ImGui::TableSetupColumn("start", ImGuiTableColumnFlags_WidthStretch, 1.0f);
            ImGui::TableSetupColumn("end", ImGuiTableColumnFlags_WidthFixed, kSettingsEndColumnWidth);
            ImGui::TableNextRow();

            ImGui::TableSetColumnIndex(0);
            UI::raw([&]() {
                UI::div(start_id.c_str(), {
                    .mode = UI::Mode::LayoutOnly,
                    .width = UI::Size::fill(),
                    .height = UI::Size::auto_size(),
                }, [&]() {
                    if (start_content) {
                        start_content();
                    }
                });
            });

            ImGui::TableSetColumnIndex(1);
            UI::raw([&]() {
                UI::div(end_id.c_str(), {
                    .mode = UI::Mode::LayoutOnly,
                    .width = UI::Size::fill(),
                    .height = UI::Size::auto_size(),
                }, [&]() {
                    if (end_content) {
                        end_content();
                    }
                });
            });

            ImGui::EndTable();
        }

        if (show_divider) {
            UI::divider({
                .margin = UI::Spacing::xy(0.0f, 8.0f),
                .color = kSettingsDividerColor,
            });
        }
    });
}

void settings_section(
    const char* id,
    const char* title,
    const std::function<void()>& content) {
    UI::column(id, {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(0.0f, 0.0f),
    }, [&]() {
        UI::text({
            .text = title,
            .width = UI::Size::fill(),
            .color = kSettingsTextColor,
        });
        UI::divider({
            .margin = UI::Spacing::xy(0.0f, 8.0f),
            .color = kSettingsDividerColor,
        });
        content();
    });
}

} // namespace misty::panel
