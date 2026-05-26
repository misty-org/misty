#include "panels/context_menu/context_menu_panel.h"

#include <string>

#include "core/ui/ui_helper.h"
#include "core/ui/ui_layout.h"

namespace misty::panel {

namespace {

constexpr float kMenuWidth = 220.0f;
constexpr float kEntryHeight = 32.0f;
constexpr float kMenuPadding = 6.0f;
constexpr float kEntryGap = 4.0f;
constexpr float kSeparatorHeight = 5.0f;
const ImVec4 kMenuShellColor = ImVec4(0.12f, 0.12f, 0.14f, 0.98f);
const ImVec4 kMenuBorderColor = ImVec4(0.28f, 0.28f, 0.31f, 1.0f);
const ImVec4 kPrimaryTextColor = ImVec4(0.94f, 0.94f, 0.96f, 1.0f);
const ImVec4 kSecondaryTextColor = ImVec4(0.60f, 0.60f, 0.65f, 1.0f);
const ImVec4 kDisabledTextColor = ImVec4(0.50f, 0.50f, 0.54f, 1.0f);
const ImVec4 kDangerTextColor = ImVec4(0.97f, 0.74f, 0.74f, 1.0f);
const ImVec4 kDividerColor = ImVec4(0.24f, 0.24f, 0.27f, 1.0f);

float menu_height(const std::vector<ContextMenuEntry>& entries) {
    float height = kMenuPadding * 2.0f;
    bool first = true;
    for (const auto& entry : entries) {
        if (!first) {
            height += kEntryGap;
        }
        height += entry.kind == ContextMenuEntry::Kind::Separator ? kSeparatorHeight : kEntryHeight;
        first = false;
    }
    return std::max(1.0f, height);
}

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

    const ImVec2 estimated_size(kMenuWidth, menu_height(state.entries));
    const ImVec2 clamped_pos = UI::clamp_window_pos_to_viewport(state.anchor_pos, estimated_size, *viewport);

    ImGuiWindowFlags flags =
        ImGuiWindowFlags_NoTitleBar |
        ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoMove |
        ImGuiWindowFlags_NoScrollbar |
        ImGuiWindowFlags_NoSavedSettings |
        ImGuiWindowFlags_NoCollapse |
        ImGuiWindowFlags_NoDocking;

    ImGui::SetNextWindowPos(clamped_pos, ImGuiCond_Always);
    ImGui::SetNextWindowSize(estimated_size, ImGuiCond_Always);
    ImGui::SetNextWindowViewport(viewport->ID);

    ImGui::PushStyleColor(ImGuiCol_WindowBg, kMenuShellColor);
    ImGui::PushStyleColor(ImGuiCol_Border, kMenuBorderColor);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(kMenuPadding, kMenuPadding));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 1.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
    ImGui::SetNextWindowFocus();

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

    ImGui::PopStyleVar(3);
    ImGui::PopStyleColor(2);
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
    bool first = true;
    for (const auto& entry : state.entries) {
        if (!first) {
            ImGui::Dummy(ImVec2(0.0f, kEntryGap));
        }
        render_entry(entry, close_requested, render_serial);
        first = false;
    }
}

void ContextMenuPanel::render_entry(const ContextMenuEntry& entry, bool& close_requested, std::uint64_t render_serial) {
    if (entry.kind == ContextMenuEntry::Kind::Separator) {
        const ImVec2 pos = ImGui::GetCursorScreenPos();
        const float width = ImGui::GetContentRegionAvail().x;
        const float y = pos.y + kSeparatorHeight * 0.5f;
        ImGui::GetWindowDrawList()->AddLine(
            ImVec2(pos.x, y),
            ImVec2(pos.x + width, y),
            ImGui::ColorConvertFloat4ToU32(kDividerColor),
            1.0f);
        ImGui::Dummy(ImVec2(width, kSeparatorHeight));
        return;
    }

    const ImVec4 label_color = entry.disabled
        ? kDisabledTextColor
        : (entry.destructive ? kDangerTextColor : kPrimaryTextColor);
    const ImVec4 secondary_color = entry.disabled ? kDisabledTextColor : kSecondaryTextColor;

    if (entry.disabled) {
        ImGui::BeginDisabled();
    }

    const ImVec2 pos = ImGui::GetCursorScreenPos();
    const ImVec2 size(ImGui::GetContentRegionAvail().x, kEntryHeight);
    const bool pressed = ImGui::InvisibleButton(("##context_menu_" + entry.id).c_str(), size);
    const bool hovered = ImGui::IsItemHovered();
    const bool active = ImGui::IsItemActive();

    if (!entry.disabled && (hovered || active)) {
        const ImU32 hover_color = active ? IM_COL32(255, 255, 255, 34) : IM_COL32(255, 255, 255, 22);
        ImGui::GetWindowDrawList()->AddRectFilled(
            pos,
            ImVec2(pos.x + size.x, pos.y + size.y),
            hover_color,
            6.0f);
    }

    const float text_y = pos.y + (kEntryHeight - ImGui::GetTextLineHeight()) * 0.5f;
    ImGui::GetWindowDrawList()->AddText(
        ImVec2(pos.x + 10.0f, text_y),
        ImGui::ColorConvertFloat4ToU32(label_color),
        entry.label.c_str());
    if (!entry.secondary_label.empty()) {
        const ImVec2 secondary_size = ImGui::CalcTextSize(entry.secondary_label.c_str());
        ImGui::GetWindowDrawList()->AddText(
            ImVec2(pos.x + size.x - secondary_size.x - 10.0f, text_y),
            ImGui::ColorConvertFloat4ToU32(secondary_color),
            entry.secondary_label.c_str());
    }

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
