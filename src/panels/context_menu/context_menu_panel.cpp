#include "panels/context_menu/context_menu_panel.h"

#include <string>

#include "core/ui/ui_helper.h"
#include "core/ui/ui_layout.h"

namespace misty::panel {

namespace {

constexpr float kMenuWidth = 220.0f;
constexpr float kEntryHeight = 32.0f;
const ImVec4 kMenuShellColor = ImVec4(0.12f, 0.12f, 0.14f, 0.98f);
const ImVec4 kMenuBorderColor = ImVec4(0.28f, 0.28f, 0.31f, 1.0f);
const ImVec4 kPrimaryTextColor = ImVec4(0.94f, 0.94f, 0.96f, 1.0f);
const ImVec4 kSecondaryTextColor = ImVec4(0.60f, 0.60f, 0.65f, 1.0f);
const ImVec4 kDisabledTextColor = ImVec4(0.50f, 0.50f, 0.54f, 1.0f);
const ImVec4 kDangerTextColor = ImVec4(0.97f, 0.74f, 0.74f, 1.0f);
const ImVec4 kDividerColor = ImVec4(0.24f, 0.24f, 0.27f, 1.0f);

} // namespace

ContextMenuPanel::ContextMenuPanel(core::StateRegistry& registry)
    : registry_(registry) {
}

void ContextMenuPanel::render() {
    auto& state = registry_.get_state<ContextMenuState>(kContextMenuStateKey);
    if (!state.is_open || state.entries.empty()) {
        return;
    }

    ImGuiViewport* viewport = state.viewport_id != 0
        ? ImGui::FindViewportByID(state.viewport_id)
        : ImGui::GetMainViewport();
    if (viewport == nullptr) {
        viewport = ImGui::GetMainViewport();
    }
    if (viewport == nullptr) {
        return;
    }

    const ImVec2 estimated_size(
        std::max(kMenuWidth, state.menu_size.x),
        std::max(1.0f, state.menu_size.y)
    );
    const ImVec2 clamped_pos = UI::clamp_window_pos_to_viewport(state.anchor_pos, estimated_size, *viewport);

    ImGuiWindowFlags flags =
        ImGuiWindowFlags_NoTitleBar |
        ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoMove |
        ImGuiWindowFlags_NoScrollbar |
        ImGuiWindowFlags_NoSavedSettings |
        ImGuiWindowFlags_NoCollapse |
        ImGuiWindowFlags_AlwaysAutoResize |
        ImGuiWindowFlags_NoFocusOnAppearing;

    ImGui::SetNextWindowPos(clamped_pos, ImGuiCond_Always);
    ImGui::SetNextWindowViewport(viewport->ID);

    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);

    const std::uint64_t render_serial = state.request_serial;
    bool hovered = false;
    bool close_requested = false;

    if (ImGui::Begin("##context_menu_panel", nullptr, flags)) {
        hovered = ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup);
        render_menu_contents(state, close_requested, render_serial);
        const ImVec2 live_window_size = ImGui::GetWindowSize();
        const ImVec2 corrected_pos = UI::clamp_window_pos_to_viewport(state.anchor_pos, live_window_size, *viewport);
        if (corrected_pos.x != clamped_pos.x || corrected_pos.y != clamped_pos.y) {
            ImGui::SetWindowPos(corrected_pos, ImGuiCond_Always);
        }
    }
    const ImVec2 window_size = ImGui::GetWindowSize();
    ImGui::End();

    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor();
    state.menu_size = window_size;

    const bool should_close_for_click =
        ImGui::GetFrameCount() > state.opened_frame &&
        (ImGui::IsMouseClicked(ImGuiMouseButton_Left) || ImGui::IsMouseClicked(ImGuiMouseButton_Right)) &&
        !hovered;

    if ((close_requested || should_close_for_click || ImGui::IsKeyPressed(ImGuiKey_Escape)) &&
        state.request_serial == render_serial) {
        state.close();
    }
}

void ContextMenuPanel::render_menu_contents(ContextMenuState& state, bool& close_requested, std::uint64_t render_serial) {
    UI::column("##context_menu_shell", {
        .width = UI::Size::px(kMenuWidth),
        .height = UI::Size::auto_size(),
        .padding = UI::Spacing::uniform(6.0f),
        .gap = UI::Spacing::xy(0.0f, 4.0f),
        .rounding = 8.0f,
        .border = true,
        .bg_color = kMenuShellColor,
        .border_color = kMenuBorderColor,
    }, [&]() {
        for (const auto& entry : state.entries) {
            render_entry(entry, close_requested, render_serial);
        }
    });
}

void ContextMenuPanel::render_entry(const ContextMenuEntry& entry, bool& close_requested, std::uint64_t render_serial) {
    if (entry.kind == ContextMenuEntry::Kind::Separator) {
        UI::divider({
            .width = UI::Size::fill(),
            .height = UI::Size::px(1.0f),
            .margin = UI::Spacing::top_bottom(2.0f, 2.0f),
            .color = kDividerColor,
        });
        return;
    }

    const ImVec4 label_color = entry.disabled
        ? kDisabledTextColor
        : (entry.destructive ? kDangerTextColor : kPrimaryTextColor);
    const ImVec4 secondary_color = entry.disabled ? kDisabledTextColor : kSecondaryTextColor;

    if (entry.disabled) {
        ImGui::BeginDisabled();
    }

    const bool pressed = UI::button(("##context_menu_" + entry.id).c_str(), {
        .width = UI::Size::fill(),
        .height = UI::Size::px(kEntryHeight),
        .variant = entry.destructive ? UI::ButtonVariant::Danger : UI::ButtonVariant::Subtle,
        .padding = UI::Spacing::xy(10.0f, 7.0f),
        .rounding = 6.0f,
    }, [&]() {
        UI::row(("##context_menu_row_" + entry.id).c_str(), {
            .width = UI::Size::fill(),
            .height = UI::Size::fill(),
            .align = UI::Align::Center,
            .gap = UI::Spacing::xy(8.0f, 0.0f),
        }, [&]() {
            UI::text({
                .text = entry.label.c_str(),
                .width = UI::Size::fill(),
                .justify = UI::Justify::Center,
                .overflow = UI::TextOverflow::Clip,
                .color = label_color,
            });
            if (!entry.secondary_label.empty()) {
                UI::text({
                    .text = entry.secondary_label.c_str(),
                    .width = UI::Size::auto_size(),
                    .align = UI::Align::End,
                    .justify = UI::Justify::Center,
                    .overflow = UI::TextOverflow::Clip,
                    .color = secondary_color,
                    .font = UI::TextFont::Small,
                });
            }
        });
    });

    if (entry.disabled) {
        ImGui::EndDisabled();
    }

    if (pressed && !entry.disabled && entry.on_select) {
        entry.on_select();
        auto& state = registry_.get_state<ContextMenuState>(kContextMenuStateKey);
        if (state.request_serial == render_serial) {
            close_requested = true;
        }
    }
}

} // namespace misty::panel
