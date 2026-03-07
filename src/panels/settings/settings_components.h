#pragma once

#include <functional>

#include "core/ui/ui_layout.h"

namespace misty::panel {

struct SettingsSectionProps {
    misty::UI::TextFont title_font = misty::UI::TextFont::BoldLarge;
    ImVec4 title_color = ImVec4(0.96f, 0.96f, 0.98f, 1.0f);
    ImVec4 divider_color = ImVec4(0.2f, 0.2f, 0.2f, 1.0f);
    misty::UI::Spacing gap = misty::UI::Spacing::xy(0.0f, 8.0f);
};

struct SettingsRowProps {
    float start_width_pct = 0.5f;
    misty::UI::Size end_width = misty::UI::Size::fill();
    bool show_divider = true;
    ImVec4 divider_color = ImVec4(0.2f, 0.2f, 0.2f, 1.0f);
};

inline constexpr ImVec4 kSettingsHeaderTextColor = ImVec4(0.96f, 0.96f, 0.98f, 1.0f);
inline constexpr ImVec4 kSettingsBodyTextColor = ImVec4(0.76f, 0.78f, 0.82f, 1.0f);
inline constexpr ImVec4 kSettingsMutedTextColor = ImVec4(0.58f, 0.60f, 0.64f, 1.0f);
inline constexpr ImVec4 kSettingsDividerColor = ImVec4(0.2f, 0.2f, 0.2f, 1.0f);
inline constexpr ImVec4 kSettingsSuccessTextColor = ImVec4(0.55f, 0.82f, 0.64f, 1.0f);
inline constexpr ImVec4 kSettingsControlBgColor = ImVec4(0.10f, 0.11f, 0.13f, 1.0f);
inline constexpr ImVec4 kSettingsControlBorderColor = ImVec4(0.18f, 0.19f, 0.22f, 1.0f);
inline constexpr ImVec4 kSettingsControlTextColor = ImVec4(0.92f, 0.92f, 0.94f, 1.0f);
inline constexpr float kSettingsControlWidth = 220.0f;
inline constexpr float kSettingsControlHeight = 36.0f;
inline constexpr float kSettingsSelectControlHeight = 32.0f;
inline constexpr float kSettingsContentWidth = 720.0f;
inline constexpr misty::UI::Spacing kSettingsShellPadding = misty::UI::Spacing::xy(28.0f, 20.0f);
inline constexpr misty::UI::Spacing kSettingsSidebarPadding = misty::UI::Spacing::xy(20.0f, 20.0f);
inline constexpr misty::UI::Spacing kSettingsPagePadding = misty::UI::Spacing::xy(0.0f, 0.0f);
inline constexpr misty::UI::Spacing kSettingsPageGap = misty::UI::Spacing::xy(0.0f, 18.0f);

void settings_page_title(const char* text);
void settings_page(
    const char* id,
    const char* title,
    const std::function<void()>& content,
    misty::UI::Spacing gap = kSettingsPageGap);
void settings_row_text(const char* label, const char* description);
void settings_value_text(const char* value, bool muted = false);
bool settings_toggle_switch(const char* id, bool* value);
bool settings_select_control(const char* id, int* index, const char* const* options, int count);
bool settings_input_control(const char* id, char* buffer, size_t buffer_size, bool read_only = false);
bool settings_nav_item(const char* id, const char* label, const char* icon_name, bool selected);
void settings_status_text(const std::string& message, bool is_error);

void settings_section(
    const char* id,
    const char* title,
    const SettingsSectionProps& props,
    const std::function<void()>& content);

void settings_row(
    const char* id,
    const SettingsRowProps& props,
    const std::function<void()>& start_content,
    const std::function<void()>& end_content);

} // namespace misty::panel
