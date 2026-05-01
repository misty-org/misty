#include "panels/settings/settings_panel.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <system_error>

#include "core/commands/command_manager.h"
#include "core/manager/env_manager.h"
#include "core/manager/session_manager.h"
#include "core/system/util.h"
#include "core/ui/imgui_utils.h"
#include "imgui.h"
#include "panels/file_explorer/file_explorer_state.h"
#include "panels/profile/profile_state.h"
#include "panels/services/services_state.h"
#include "panels/vault/vault_state.h"
#include "views/app_view.h"

namespace fs = std::filesystem;

namespace {
    constexpr float kSettingsContentMaxWidth = 760.0f;
    constexpr float kSettingsRowHeight = 54.0f;
    constexpr float kSettingsActionRowHeight = 68.0f;
    constexpr float kSettingsToggleRowHeight = 72.0f;
    constexpr float kSettingsHeaderHeight = 82.0f;
    constexpr float kSettingsGroupHeight = 36.0f;
    constexpr float kSettingsValueWidth = 240.0f;
    constexpr float kSettingsActionWidth = 156.0f;
    constexpr float kSettingsColumnGap = 24.0f;
    constexpr float kSettingsFieldGap = 18.0f;
    constexpr float kSettingsFrameRounding = 8.0f;
    constexpr ImVec2 kSettingsFramePadding(14.0f, 9.0f);

    std::string fallback_string(const std::string& value, const char* fallback) {
        return value.empty() ? std::string(fallback) : value;
    }

    float settings_content_width() {
        return std::min(kSettingsContentMaxWidth, ImGui::GetContentRegionAvail().x);
    }
}

namespace misty::panel {

SettingsPanel::SettingsPanel(core::UIRegistry& registry)
    : registry_(registry) {}

void SettingsPanel::render() {
    auto& state = registry_.get_state<SettingsState>("Settings");

    constexpr float kSidebarPaddingX = 12.0f;
    constexpr float kSidebarPaddingY = 12.0f;
    constexpr float kContentPaddingX = 42.0f;
    constexpr float kContentPaddingY = 26.0f;
    constexpr float kContentGap = 34.0f;

    constexpr ImGuiWindowFlags flags =
        ImGuiWindowFlags_NoTitleBar |   
        ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoMove |
        ImGuiWindowFlags_NoCollapse;

    core::WithWindowStyle(ImVec4(0.12f, 0.12f, 0.12f, 1.0f), ImVec2(5.0f, 5.0f), [&]() {
        if (ImGui::Begin("SettingsPanel", nullptr, flags)) {
            const float total_h = ImGui::GetContentRegionAvail().y;
            const float total_w = ImGui::GetContentRegionAvail().x;
            const float sidebar_w = 228.0f;
            const float content_w = std::max(0.0f, total_w - sidebar_w - kContentGap);

            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(kSidebarPaddingX, kSidebarPaddingY));
            ImGui::BeginChild("##settings_sidebar", ImVec2(sidebar_w, 0.0f), ImGuiChildFlags_AlwaysUseWindowPadding);
            sidebar(state, sidebar_w);
            ImGui::EndChild();
            ImGui::PopStyleVar();

            divider(total_h);

            ImGui::SameLine(0.0f, kContentGap);
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(kContentPaddingX, kContentPaddingY));
            ImGui::BeginChild("##settings_content", ImVec2(content_w, 0.0f), ImGuiChildFlags_AlwaysUseWindowPadding);
            if (state.active_section == SettingsSection::General) {
                general(state);
            } else if (state.active_section == SettingsSection::Account) {
                account(state);
            }
            ImGui::EndChild();
            ImGui::PopStyleVar();
        }
        ImGui::End();
    });
}

void SettingsPanel::sidebar(SettingsState& state, float width) {
    const float row_width = 0.8f * width;
    const ImVec2 row_padding(8.0f, 6.0f);
    const float row_height = ImGui::GetTextLineHeight() + row_padding.y * 2.0f;

    core::WithStyle([&](core::StyleScope& style) {
        style.color(ImGuiCol_Text, ImVec4(0.56f, 0.56f, 0.56f, 1.0f));

        ImGui::BeginChild(
            "##settings_sidebar_title",
            ImVec2(row_width, row_height),
            false
        );
        ImGui::SetCursorPos(ImVec2(
            ImGui::GetCursorPosX() + row_padding.x,
            ImGui::GetCursorPosY() + row_padding.y
        ));
        ImGui::TextUnformatted("Settings");
        ImGui::EndChild();
    });

    section_button(SettingsSection::General, state, {"General", row_width});
    section_button(SettingsSection::Account, state, {"Account", row_width});
}

void SettingsPanel::section_button(SettingsSection section, SettingsState& state, const core::ButtonFields& fields) {
    const bool selected = state.active_section == section;
    
    core::WithStyle([&](core::StyleScope& style) {
        style.var(ImGuiStyleVar_FrameRounding, 6.0f);
        style.var(ImGuiStyleVar_FramePadding, ImVec2(8.0f, 6.0f));
        style.var(ImGuiStyleVar_ButtonTextAlign, ImVec2(0.0f, 0.5f));

        if (selected) {
            style.color(ImGuiCol_Button, ImVec4(0.22f, 0.22f, 0.24f, 1.0f));
            style.color(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
        } else {
            style.color(ImGuiCol_Button, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
            style.color(ImGuiCol_Text, ImVec4(0.68f, 0.68f, 0.68f, 1.0f));
        }
        style.color(ImGuiCol_ButtonHovered, ImVec4(0.18f, 0.18f, 0.20f, 1.0f));
        style.color(ImGuiCol_ButtonActive, ImVec4(0.16f, 0.16f, 0.18f, 1.0f));

        if (ImGui::Button(fields.label, ImVec2(fields.width, 0.0f))) {
            state.active_section = section;
        }
    });
}

void SettingsPanel::divider(float height) {
    ImGui::SameLine(0.0f, 0.0f);
    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 p = ImGui::GetCursorScreenPos();
    dl->AddLine(ImVec2(p.x, p.y),
        ImVec2(p.x, p.y + height),
        IM_COL32(60, 60, 60, 255), 1.0f);
}

void SettingsPanel::account(SettingsState& state) {
    if (!state.account_buffers_initialized) {
        const std::string email = core::SessionManager::get().get_email();
        const std::string name = email.empty() ? "User" : email.substr(0, email.find('@'));
        std::snprintf(state.account_display_name, sizeof(state.account_display_name), "%s", name.c_str());
        std::snprintf(state.account_email, sizeof(state.account_email), "%s", fallback_string(email, "Unavailable").c_str());
        state.account_buffers_initialized = true;
    }

    content_header("Account");
    status_message(state);
    profile_header(state.account_display_name, state.account_email, "Manage your account details.");
    if (text_input_row("Display name", state.account_display_name, sizeof(state.account_display_name), "Save changes")) {
        auto& profile = registry_.get_state<ProfileState>("Profile");
        profile.display_name = state.account_display_name;
        state.status_message = "Display name updated.";
        state.status_timer = 3.0f;
        state.status_is_error = false;
    }
    readonly_input_row("Email", state.account_email, "Email cannot be changed.");

    ImGui::Dummy(ImVec2(0.0f, kSettingsFieldGap));
    group_header("Security");
    if (action_row("Password", "Send a reset link to your account email.", "Reset")) {
        state.status_message = "Password reset is not available in the desktop client yet.";
        state.status_timer = 4.0f;
        state.status_is_error = false;
    }
    if (action_row("Session", "Sign out of this device.", "Sign out")) {
        core::SessionManager::get().clear_token();
        view::switch_view(view::ViewID::Login);
    }
}

void SettingsPanel::general(SettingsState& state) {
    content_header("General");
    status_message(state);

    group_header("Appearance");
    if (theme_row(state)) {
        state.status_message = "Theme preference updated.";
        state.status_timer = 3.0f;
        state.status_is_error = false;
    }

    group_header("Sync");
    if (toggle_row("Auto sync", "Keep cloud changes syncing automatically.", &state.auto_sync_enabled)) {
        state.status_message = state.auto_sync_enabled ? "Auto sync enabled." : "Auto sync paused.";
        state.status_timer = 3.0f;
        state.status_is_error = false;
    }

    group_header("App");
    settings_row("Version", "v0.1.0-beta");
}

void SettingsPanel::profile_header(const char* display_name, const char* email, const char* note) {
    const ImVec2 start = ImGui::GetCursorScreenPos();
    const float content_width = settings_content_width();
    ImGui::Dummy(ImVec2(content_width, kSettingsHeaderHeight));

    ImDrawList* dl = ImGui::GetWindowDrawList();
    const float avatar_size = 58.0f;
    const float radius = avatar_size * 0.5f;
    const ImVec2 center(start.x + radius, start.y + kSettingsHeaderHeight * 0.5f);

    dl->AddCircleFilled(center, radius, IM_COL32(28, 28, 31, 255), 64);
    dl->AddCircle(center, radius, IM_COL32(48, 48, 52, 255), 64, 1.5f);

    const char initial = (display_name && display_name[0]) ? static_cast<char>(std::toupper(static_cast<unsigned char>(display_name[0]))) : '?';
    char initial_text[2] = {initial, '\0'};
    const ImVec2 initial_size = ImGui::CalcTextSize(initial_text);
    dl->AddText(ImVec2(center.x - initial_size.x * 0.5f, center.y - initial_size.y * 0.5f),
                IM_COL32(255, 255, 255, 255), initial_text);

    ImGui::SetCursorScreenPos(ImVec2(start.x + avatar_size + kSettingsColumnGap, start.y + 8.0f));
    core::WithStyle([&](core::StyleScope& style) {
        style.color(ImGuiCol_Text, ImVec4(0.96f, 0.96f, 0.96f, 1.0f));
        core::WithFontScale(1.18f, [&]() {
            ImGui::TextUnformatted(display_name);
        });
    });
    core::WithStyle([&](core::StyleScope& style) {
        style.color(ImGuiCol_Text, ImVec4(0.78f, 0.78f, 0.82f, 1.0f));
        ImGui::TextUnformatted(email);
    });
    core::WithStyle([&](core::StyleScope& style) {
        style.color(ImGuiCol_Text, ImVec4(0.45f, 0.45f, 0.49f, 1.0f));
        ImGui::TextUnformatted(note);
    });

    ImGui::SetCursorScreenPos(ImVec2(start.x, start.y + kSettingsHeaderHeight));
}

bool SettingsPanel::text_input_row(const char* label,
                                   char* buffer,
                                   std::size_t buffer_size,
                                   const char* action_label) {
    bool pressed = false;
    const float content_width = settings_content_width();
    const float button_width = action_label ? kSettingsActionWidth : 0.0f;
    const float gap = action_label ? kSettingsColumnGap : 0.0f;
    const float input_width = std::max(120.0f, content_width - button_width - gap);

    ImGui::PushID(label);
    {
        core::WithStyle([&](core::StyleScope& style) {
            style.color(ImGuiCol_Text, ImVec4(0.82f, 0.82f, 0.86f, 1.0f));
            ImGui::TextUnformatted(label);
        });
        ImGui::Dummy(ImVec2(0.0f, 6.0f));

        core::WithStyle([&](core::StyleScope& style) {
            style.var(ImGuiStyleVar_FrameRounding, kSettingsFrameRounding);
            style.var(ImGuiStyleVar_FramePadding, kSettingsFramePadding);
            style.color(ImGuiCol_FrameBg, ImVec4(0.05f, 0.055f, 0.06f, 1.0f));
            style.color(ImGuiCol_FrameBgHovered, ImVec4(0.06f, 0.065f, 0.07f, 1.0f));
            style.color(ImGuiCol_FrameBgActive, ImVec4(0.065f, 0.07f, 0.075f, 1.0f));
            style.color(ImGuiCol_Border, ImVec4(0.36f, 0.36f, 0.38f, 1.0f));
            style.color(ImGuiCol_Text, ImVec4(0.96f, 0.96f, 0.96f, 1.0f));
            ImGui::SetNextItemWidth(input_width);
            ImGui::InputText("##text_input", buffer, buffer_size);
        });

        if (action_label) {
            ImGui::SameLine(0.0f, gap);
            core::WithStyle([&](core::StyleScope& style) {
                style.var(ImGuiStyleVar_FrameRounding, kSettingsFrameRounding);
                style.var(ImGuiStyleVar_FramePadding, kSettingsFramePadding);
                style.color(ImGuiCol_Button, ImVec4(0.52f, 0.52f, 0.52f, 1.0f));
                style.color(ImGuiCol_ButtonHovered, ImVec4(0.62f, 0.62f, 0.62f, 1.0f));
                style.color(ImGuiCol_ButtonActive, ImVec4(0.44f, 0.44f, 0.44f, 1.0f));
                style.color(ImGuiCol_Text, ImVec4(0.02f, 0.02f, 0.02f, 1.0f));
                pressed = ImGui::Button(action_label, ImVec2(button_width, 0.0f));
            });
        }
    }
    ImGui::PopID();

    ImGui::Dummy(ImVec2(0.0f, kSettingsFieldGap));
    return pressed;
}

void SettingsPanel::readonly_input_row(const char* label, const char* value, const char* helper) {
    char buffer[512];
    std::snprintf(buffer, sizeof(buffer), "%s", value ? value : "");

    ImGui::PushID(label);
    core::WithStyle([&](core::StyleScope& style) {
        style.color(ImGuiCol_Text, ImVec4(0.82f, 0.82f, 0.86f, 1.0f));
        ImGui::TextUnformatted(label);
    });
    ImGui::Dummy(ImVec2(0.0f, 6.0f));

    core::WithStyle([&](core::StyleScope& style) {
        style.var(ImGuiStyleVar_FrameRounding, kSettingsFrameRounding);
        style.var(ImGuiStyleVar_FramePadding, kSettingsFramePadding);
        style.color(ImGuiCol_FrameBg, ImVec4(0.045f, 0.05f, 0.055f, 1.0f));
        style.color(ImGuiCol_Border, ImVec4(0.18f, 0.18f, 0.20f, 1.0f));
        style.color(ImGuiCol_Text, ImVec4(0.78f, 0.78f, 0.82f, 1.0f));
        ImGui::SetNextItemWidth(settings_content_width());
        ImGui::InputText("##readonly_input", buffer, sizeof(buffer), ImGuiInputTextFlags_ReadOnly);
    });

    if (helper && helper[0]) {
        core::WithStyle([&](core::StyleScope& style) {
            style.color(ImGuiCol_Text, ImVec4(0.52f, 0.52f, 0.56f, 1.0f));
            ImGui::TextUnformatted(helper);
        });
    }
    ImGui::PopID();
    ImGui::Dummy(ImVec2(0.0f, kSettingsFieldGap));
}

void SettingsPanel::content_header(const char* title) {
    core::WithStyle([&](core::StyleScope& style) {
        style.color(ImGuiCol_Text, ImVec4(0.96f, 0.96f, 0.96f, 1.0f));
        core::WithFontScale(1.55f, [&]() {
            ImGui::TextUnformatted(title);
        });
    });
    ImGui::Dummy(ImVec2(0.0f, 28.0f));
}

void SettingsPanel::group_header(const char* title) {
    core::WithStyle([&](core::StyleScope& style) {
        style.color(ImGuiCol_Text, ImVec4(0.78f, 0.78f, 0.82f, 1.0f));
        ImGui::TextUnformatted(title);
    });

    ImVec2 p = ImGui::GetCursorScreenPos();
    const float width = settings_content_width();
    ImGui::GetWindowDrawList()->AddLine(
        ImVec2(p.x, p.y + 20.0f),
        ImVec2(p.x + width, p.y + 20.0f),
        IM_COL32(42, 42, 45, 255),
        1.0f
    );
    ImGui::Dummy(ImVec2(width, kSettingsGroupHeight));
}

void SettingsPanel::status_message(SettingsState& state) {
    if (state.status_timer <= 0.0f || state.status_message.empty()) {
        return;
    }

    state.status_timer = std::max(0.0f, state.status_timer - ImGui::GetIO().DeltaTime);
    if (state.status_timer <= 0.0f) {
        state.status_message.clear();
        state.status_is_error = false;
        return;
    }

    core::WithStyle([&](core::StyleScope& style) {
        style.color(ImGuiCol_Text, state.status_is_error
            ? ImVec4(0.92f, 0.52f, 0.52f, 1.0f)
            : ImVec4(0.60f, 0.82f, 0.64f, 1.0f));
        ImGui::TextWrapped("%s", state.status_message.c_str());
    });
    ImGui::Dummy(ImVec2(0.0f, 18.0f));
}

bool SettingsPanel::action_row(const char* label,
                               const char* subtitle,
                               const char* action_label,
                               bool enabled) {
    bool pressed = false;
    const float row_height = kSettingsActionRowHeight;
    const float action_width = kSettingsActionWidth;
    const ImVec2 start = ImGui::GetCursorScreenPos();
    const float width = settings_content_width();
    ImGui::Dummy(ImVec2(width, row_height));

    const ImVec4 main_color = enabled
        ? ImVec4(0.96f, 0.96f, 0.96f, 1.0f)
        : ImVec4(0.36f, 0.36f, 0.39f, 1.0f);
    const ImVec4 sub_color = enabled
        ? ImVec4(0.76f, 0.76f, 0.80f, 1.0f)
        : ImVec4(0.42f, 0.42f, 0.45f, 1.0f);

    ImGui::SetCursorScreenPos(ImVec2(start.x, start.y + 13.0f));
    core::WithStyle([&](core::StyleScope& style) {
        style.color(ImGuiCol_Text, main_color);
        ImGui::TextUnformatted(label);
    });
    core::WithStyle([&](core::StyleScope& style) {
        style.color(ImGuiCol_Text, sub_color);
        ImGui::TextUnformatted(subtitle);
    });

    ImGui::SetCursorScreenPos(ImVec2(start.x + width - action_width, start.y + 21.0f));
    if (enabled) {
        core::WithStyle([&](core::StyleScope& style) {
            style.color(ImGuiCol_Text, ImVec4(0.82f, 0.82f, 0.86f, 1.0f));
            pressed = ImGui::Button(action_label, ImVec2(action_width, 0.0f));
        });
    } else {
        core::WithStyle([&](core::StyleScope& style) {
            style.color(ImGuiCol_Text, ImVec4(0.42f, 0.42f, 0.45f, 1.0f));
            ImGui::TextUnformatted(action_label);
        });
    }

    ImGui::GetWindowDrawList()->AddLine(
        ImVec2(start.x, start.y + row_height),
        ImVec2(start.x + width, start.y + row_height),
        IM_COL32(32, 32, 35, 255),
        1.0f
    );
    ImGui::SetCursorScreenPos(ImVec2(start.x, start.y + row_height));
    return pressed;
}

bool SettingsPanel::toggle_row(const char* label,
                               const char* subtitle,
                               bool* value) {
    bool changed = false;
    const float row_height = kSettingsToggleRowHeight;
    const float toggle_width = 68.0f;
    const float toggle_height = 30.0f;
    const ImVec2 start = ImGui::GetCursorScreenPos();
    const float width = settings_content_width();
    ImGui::Dummy(ImVec2(width, row_height));

    ImGui::SetCursorScreenPos(ImVec2(start.x, start.y + 13.0f));
    core::WithStyle([&](core::StyleScope& style) {
        style.color(ImGuiCol_Text, ImVec4(0.96f, 0.96f, 0.96f, 1.0f));
        ImGui::TextUnformatted(label);
    });
    core::WithStyle([&](core::StyleScope& style) {
        style.color(ImGuiCol_Text, ImVec4(0.76f, 0.76f, 0.80f, 1.0f));
        ImGui::TextUnformatted(subtitle);
    });

    const ImVec2 toggle_pos(start.x + width - toggle_width, start.y + (row_height - toggle_height) * 0.5f);
    ImGui::SetCursorScreenPos(toggle_pos);
    ImGui::PushID(label);
    if (ImGui::InvisibleButton("##toggle", ImVec2(toggle_width, toggle_height))) {
        *value = !*value;
        changed = true;
    }

    ImDrawList* dl = ImGui::GetWindowDrawList();
    const ImU32 track_color = *value ? IM_COL32(78, 141, 255, 255) : IM_COL32(62, 62, 66, 255);
    const ImU32 knob_color = IM_COL32(245, 245, 245, 255);
    dl->AddRectFilled(toggle_pos,
                      ImVec2(toggle_pos.x + toggle_width, toggle_pos.y + toggle_height),
                      track_color,
                      toggle_height * 0.5f);

    const float knob_radius = toggle_height * 0.5f - 4.0f;
    const float knob_center_x = *value
        ? toggle_pos.x + toggle_width - toggle_height * 0.5f
        : toggle_pos.x + toggle_height * 0.5f;
    dl->AddCircleFilled(ImVec2(knob_center_x, toggle_pos.y + toggle_height * 0.5f), knob_radius, knob_color, 24);
    ImGui::PopID();

    ImGui::GetWindowDrawList()->AddLine(
        ImVec2(start.x, start.y + row_height),
        ImVec2(start.x + width, start.y + row_height),
        IM_COL32(32, 32, 35, 255),
        1.0f
    );
    ImGui::SetCursorScreenPos(ImVec2(start.x, start.y + row_height));
    return changed;
}

bool SettingsPanel::theme_row(SettingsState& state) {
    bool changed = false;
    static constexpr const char* kThemeLabels[] = {"System", "Dark", "Light"};
    static constexpr int kThemeCount = static_cast<int>(sizeof(kThemeLabels) / sizeof(kThemeLabels[0]));

    const float row_height = 72.0f;
    const float segment_width = 94.0f;
    const float segment_height = 34.0f;
    const float segment_gap = 8.0f;
    const float control_width = kThemeCount * segment_width + (kThemeCount - 1) * segment_gap;

    const ImVec2 start = ImGui::GetCursorScreenPos();
    const float width = settings_content_width();
    ImGui::Dummy(ImVec2(width, row_height));

    ImGui::SetCursorScreenPos(ImVec2(start.x, start.y + 13.0f));
    core::WithStyle([&](core::StyleScope& style) {
        style.color(ImGuiCol_Text, ImVec4(0.96f, 0.96f, 0.96f, 1.0f));
        ImGui::TextUnformatted("Theme");
    });
    core::WithStyle([&](core::StyleScope& style) {
        style.color(ImGuiCol_Text, ImVec4(0.76f, 0.76f, 0.80f, 1.0f));
        ImGui::TextUnformatted("Choose how the app should look.");
    });

    float x = start.x + width - control_width;
    const float y = start.y + (row_height - segment_height) * 0.5f;
    for (int i = 0; i < kThemeCount; ++i) {
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        ImGui::PushID(i);
        const bool selected = state.theme_index == i;
        core::WithStyle([&](core::StyleScope& style) {
            style.var(ImGuiStyleVar_FrameRounding, 8.0f);
            style.var(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 8.0f));
            style.color(ImGuiCol_Button, selected ? ImVec4(0.30f, 0.38f, 0.52f, 1.0f) : ImVec4(0.14f, 0.14f, 0.16f, 1.0f));
            style.color(ImGuiCol_ButtonHovered, selected ? ImVec4(0.34f, 0.42f, 0.56f, 1.0f) : ImVec4(0.18f, 0.18f, 0.21f, 1.0f));
            style.color(ImGuiCol_ButtonActive, ImVec4(0.22f, 0.29f, 0.42f, 1.0f));
            style.color(ImGuiCol_Text, ImVec4(0.96f, 0.96f, 0.96f, 1.0f));
            if (ImGui::Button(kThemeLabels[i], ImVec2(segment_width, segment_height))) {
                state.theme_index = i;
                changed = true;
            }
        });
        ImGui::PopID();
        x += segment_width + segment_gap;
    }

    ImGui::GetWindowDrawList()->AddLine(
        ImVec2(start.x, start.y + row_height),
        ImVec2(start.x + width, start.y + row_height),
        IM_COL32(32, 32, 35, 255),
        1.0f
    );
    ImGui::SetCursorScreenPos(ImVec2(start.x, start.y + row_height));
    return changed;
}

void SettingsPanel::settings_row(const char* label,
                                 const char* value,
                                 bool enabled,
                                 bool muted_value) {
    const float row_height = kSettingsRowHeight;
    const float value_width = kSettingsValueWidth;
    const float text_y = 15.0f;

    const ImVec2 start = ImGui::GetCursorScreenPos();
    const float width = settings_content_width();
    const float right_x = start.x + std::max(0.0f, width - value_width);
    ImGui::Dummy(ImVec2(width, row_height));

    const ImVec4 label_color = enabled
        ? ImVec4(0.82f, 0.82f, 0.86f, 1.0f)
        : ImVec4(0.36f, 0.36f, 0.39f, 1.0f);
    const ImVec4 value_color = enabled
        ? ImVec4(0.96f, 0.96f, 0.96f, 1.0f)
        : ImVec4(0.42f, 0.42f, 0.45f, 1.0f);

    ImGui::SetCursorScreenPos(ImVec2(start.x, start.y + text_y));
    core::WithStyle([&](core::StyleScope& style) {
        style.color(ImGuiCol_Text, label_color);
        ImGui::TextUnformatted(label);
    });

    ImGui::SetCursorScreenPos(ImVec2(right_x, start.y + text_y));
    core::WithStyle([&](core::StyleScope& style) {
        style.color(ImGuiCol_Text, value_color);
        if (muted_value) {
            core::WithFontScale(0.98f, [&]() {
                ImGui::TextUnformatted(value);
            });
        } else {
            ImGui::TextUnformatted(value);
        }
    });

    ImGui::GetWindowDrawList()->AddLine(
        ImVec2(start.x, start.y + row_height),
        ImVec2(start.x + width, start.y + row_height),
        IM_COL32(32, 32, 35, 255),
        1.0f
    );
    ImGui::SetCursorScreenPos(ImVec2(start.x, start.y + row_height));
}


}
