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
                general();
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

    const std::string user_id = fallback_string(core::SessionManager::get().get_user_id(), "Unavailable");

    profile_header(state.account_display_name, state.account_email, "Photo upload - coming soon");
    if (text_input_row("Display name", state.account_display_name, sizeof(state.account_display_name), "Save changes")) {
        auto& profile = registry_.get_state<ProfileState>("Profile");
        profile.display_name = state.account_display_name;
    }
    readonly_input_row("Email", state.account_email, "Email cannot be changed.");

    settings_row("Member since", "March 12, 2026");
    settings_row("User id", user_id.c_str());

    ImGui::Dummy(ImVec2(0.0f, kSettingsFieldGap));
    group_header("S e c u r i t y");
    action_row("Password", "Reset via email link.", "Reset");
    settings_row("Two-factor authentication", "Coming soon", false, true);
    settings_row("Active sessions", "Coming soon", false, true);
}

void SettingsPanel::general() {
    content_header("General");

    group_header("A p p e a r a n c e");
    settings_row("Theme", "System");
    settings_row("Language", "English");
    settings_row("Density", "Coming soon", false, true);

    group_header("A p p");
    settings_row("Version", "v0.1.0-beta");
    settings_row("Release channel", "Stable");
    settings_row("Check for updates", "Coming soon", false, true);
    settings_row("Auto-update", "Coming soon", false, true);

    group_header("N o t i f i c a t i o n s");
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
