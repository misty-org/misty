#include "panels/plugins/plugins_panel.h"

#include <algorithm>

#include "core/ui/ui_layout.h"
#include "core/ui/ui_style.h"
#include "imgui.h"
#include "panels/settings/settings_components.h"

namespace misty::panel {

namespace {

constexpr float kSidebarMinWidth = 220.0f;
constexpr float kSidebarMaxWidth = 360.0f;
constexpr float kSidebarDefaultWidth = 180.0f;
constexpr float kContentMinWidth = 320.0f;
constexpr float kSplitterWidth = 8.0f;

constexpr PluginsContentProps kPluginsContentProps{
    .title = "Plugins",
    .body = "Use the search bar and sections on the left to shape the plugin list once cards are wired up.",
};

void page(const PluginsContentProps& props, const std::function<void()>& content) {
    UI::div("plugins_content_page", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
    }, [&]() {
        UI::column("plugins_content_page_body", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = kSettingsPageGap,
        }, [&]() {
            UI::text({
                .text = props.title,
                .width = UI::Size::fill(),
                .color = kSettingsHeaderTextColor,
                .font = UI::TextFont::BoldXLarge,
            });
            if (content) {
                content();
            }
        });
    });
}

bool SectionHeader(const char* id, const char* label, bool collapsed, float width) {
    const ImVec2 cursor = ImGui::GetCursorScreenPos();
    const float height = ImGui::GetTextLineHeight() + 4.0f;

    const bool clicked = ImGui::InvisibleButton(id, ImVec2(width, height));
    const bool hovered = ImGui::IsItemHovered();

    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    draw_list->AddText(
        ImVec2(cursor.x + 4.0f, cursor.y + 2.0f),
        IM_COL32(178, 178, 178, 255),
        label
    );

    if (hovered) {
        const float text_width = ImGui::CalcTextSize(label).x;
        const float triangle_x = cursor.x + 4.0f + text_width + 6.0f;
        const float mid_y = cursor.y + height * 0.5f;
        const ImU32 triangle_color = IM_COL32(160, 160, 160, 220);

        if (collapsed) {
            draw_list->AddTriangleFilled(
                ImVec2(triangle_x, mid_y - 4.0f),
                ImVec2(triangle_x, mid_y + 4.0f),
                ImVec2(triangle_x + 7.0f, mid_y),
                triangle_color
            );
        } else {
            draw_list->AddTriangleFilled(
                ImVec2(triangle_x - 4.0f, mid_y - 2.0f),
                ImVec2(triangle_x + 4.0f, mid_y - 2.0f),
                ImVec2(triangle_x, mid_y + 4.0f),
                triangle_color
            );
        }
    }

    return clicked;
}

} // namespace

PluginsPanel::PluginsPanel(core::UIRegistry&) {
    sidebar_width_ = kSidebarDefaultWidth;
    sidebar_drag_start_width_ = kSidebarDefaultWidth;
}

float PluginsPanel::sidebarMaxWidth(float shell_width) const {
    return std::max(
        kSidebarMinWidth,
        std::min(kSidebarMaxWidth, shell_width - kContentMinWidth - kSplitterWidth)
    );
}

void PluginsPanel::updateSidebarWidth(float max_sidebar_width) {
    sidebar_width_ = std::clamp(sidebar_width_, kSidebarMinWidth, max_sidebar_width);
    if (!sidebar_resizing_) {
        return;
    }

    if (ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
        const float dragged_width = sidebar_drag_start_width_ +
            (ImGui::GetIO().MousePos.x - sidebar_drag_start_mouse_x_);
        sidebar_width_ = std::clamp(dragged_width, kSidebarMinWidth, max_sidebar_width);
        return;
    }

    sidebar_resizing_ = false;
}

void PluginsPanel::shell() {
    UI::row("##plugins_shell", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::fill(),
    }, [&]() {
        sidebar();
        splitter();
        content(kPluginsContentProps);
    });
}

void PluginsPanel::sidebar() {
    UI::div("##plugins_sidebar", {
        .mode = UI::Mode::ChildWindow,
        .width = UI::Size::px(sidebar_width_),
        .height = UI::Size::fill(),
        .padding = kSettingsSidebarPadding,
        .gap = UI::Spacing::xy(0.0f, 12.0f),
    }, [&]() {
        UI::input_text({
            .label = "##plugins_search",
            .buffer = search_query_,
            .buffer_size = sizeof(search_query_),
            .hint = "Search plugins...",
            .width = UI::Size::fill(),
            .height = UI::Size::px(kSettingsControlHeight),
            .padding = UI::Spacing::xy(10.0f, 8.0f),
            .rounding = 6.0f,
            .bg_color = kSettingsControlBgColor,
            .border_color = kSettingsControlBorderColor,
            .text_color = kSettingsControlTextColor,
        });
        section({
            .id = "marketplace_hdr",
            .label = "Marketplace",
            .collapsed = &marketplace_collapsed_,
        });

        UI::divider({
            .color = kSettingsDividerColor,
        });
        section({
            .id = "installed_hdr",
            .label = "Installed",
            .collapsed = &installed_collapsed_,
        });
    });
}

void PluginsPanel::section(const PluginsSectionProps& props) {
    if (!props.collapsed) {
        return;
    }

    UI::div((std::string(props.id) + "_header").c_str(), {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::px(ImGui::GetTextLineHeight() + 4.0f),
    }, [&]() {
        UI::raw([&]() {
            const float section_width = ImGui::GetContentRegionAvail().x;
            if (SectionHeader(props.id, props.label, *props.collapsed, section_width)) {
                *props.collapsed = !*props.collapsed;
            }
        });
    });

    if (*props.collapsed) {
        return;
    }

    UI::div((std::string(props.id) + "_body").c_str(), {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .padding = UI::Spacing::xy(4.0f, 2.0f),
    }, [&]() {
        UI::text({
            .text = props.placeholder,
            .width = UI::Size::fill(),
            .color = kSettingsMutedTextColor,
        });
    });
}

void PluginsPanel::splitter() {
    UI::div("##plugins_divider", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::px(kSplitterWidth),
        .height = UI::Size::fill(),
    }, [&]() {
        const ImVec2 splitter_pos = ImGui::GetCursorScreenPos();
        const ImVec2 splitter_size(
            kSplitterWidth,
            std::max(1.0f, ImGui::GetContentRegionAvail().y)
        );
        ImGui::InvisibleButton("##plugins_splitter_hit", splitter_size);

        const bool hovered = ImGui::IsItemHovered();
        if (hovered || sidebar_resizing_) {
            ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeEW);
        }
        if (hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
            sidebar_resizing_ = true;
            sidebar_drag_start_width_ = sidebar_width_;
            sidebar_drag_start_mouse_x_ = ImGui::GetIO().MousePos.x;
        }

        ImDrawList* draw_list = ImGui::GetWindowDrawList();
        const float line_width = hovered || sidebar_resizing_ ? 2.0f : 1.0f;
        const float line_x = splitter_pos.x + (kSplitterWidth - line_width) * 0.5f;
        const ImU32 line_color = hovered || sidebar_resizing_
            ? ImGui::ColorConvertFloat4ToU32(ImVec4(0.72f, 0.72f, 0.74f, 0.85f))
            : ImGui::ColorConvertFloat4ToU32(ImVec4(0.22f, 0.22f, 0.24f, 1.0f));
        draw_list->AddRectFilled(
            ImVec2(line_x, splitter_pos.y),
            ImVec2(line_x + line_width, splitter_pos.y + splitter_size.y),
            line_color
        );
    });
}

void PluginsPanel::content(const PluginsContentProps& props) {
    UI::WithStyle([&](UI::StyleScope& style) {
        style.var(ImGuiStyleVar_ScrollbarSize, 8.0f);

        UI::div("##plugins_content", {
            .mode = UI::Mode::ChildWindow,
            .width = UI::Size::fill(),
            .height = UI::Size::fill(),
            .window_flags = ImGuiWindowFlags_AlwaysVerticalScrollbar,
            .padding = kSettingsShellPadding,
        }, [&]() {
            page(props, [&]() {
                UI::text({
                    .text = props.body,
                    .width = UI::Size::px(520.0f),
                    .overflow = UI::TextOverflow::Wrap,
                    .color = kSettingsBodyTextColor,
                });
            });
        });
    });
}

void PluginsPanel::render() {
    constexpr ImGuiWindowFlags flags =
        ImGuiWindowFlags_NoTitleBar |
        ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoMove |
        ImGuiWindowFlags_NoCollapse;

    UI::WithWindowStyle({
        .bg_color = ImVec4(0.12f, 0.12f, 0.12f, 1.0f),
    }, [&]() {
        if (ImGui::Begin("Plugins", nullptr, flags)) {
            updateSidebarWidth(sidebarMaxWidth(ImGui::GetContentRegionAvail().x));
            shell();
        }
        ImGui::End();
    });
}

} // namespace misty::panel
