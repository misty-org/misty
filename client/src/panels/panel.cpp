#include "panel.h"

#include "core/commands/command_manager.h"
#include "core/ui/ui.h"
#include "imgui.h"
#include <cstdarg>
#include <cstdio>

namespace misty::panel {
    namespace {
        struct ButtonStyle {
            ImVec4 button;
            ImVec4 hovered;
            ImVec4 active;
            ImVec4 text;
            float rounding;
        };

        ButtonStyle primary_button_style() {
            return {
                ImVec4(0.957f, 0.957f, 0.961f, 1.0f),
                ImVec4(0.898f, 0.906f, 0.922f, 1.0f),
                ImVec4(0.820f, 0.835f, 0.859f, 1.0f),
                ImVec4(0.07f, 0.07f, 0.07f, 1.0f),
                8.0f,
            };
        }

        ButtonStyle danger_button_style() {
            return {
                ImVec4(0.8f, 0.2f, 0.2f, 1.0f),
                ImVec4(0.9f, 0.3f, 0.3f, 1.0f),
                ImVec4(0.7f, 0.15f, 0.15f, 1.0f),
                ImVec4(1.0f, 1.0f, 1.0f, 1.0f),
                6.0f,
            };
        }

        bool styled_button(const char* label, const ImVec2& size, const ButtonStyle& style) {
            bool pressed = false;
            misty::UI::WithStyle([&](misty::UI::StyleScope& scoped) {
                scoped.var(ImGuiStyleVar_FrameRounding, style.rounding);
                scoped.color(ImGuiCol_Button, style.button);
                scoped.color(ImGuiCol_ButtonHovered, style.hovered);
                scoped.color(ImGuiCol_ButtonActive, style.active);
                scoped.color(ImGuiCol_Text, style.text);
                pressed = ImGui::Button(label, size);
            });
            return pressed;
        }

        void text_colored(const ImVec4& color, const char* fmt, ...) {
            char buffer[1024];
            va_list args;
            va_start(args, fmt);
            std::vsnprintf(buffer, sizeof(buffer), fmt, args);
            va_end(args);

            misty::UI::WithTextColor(color, [&]() {
                ImGui::TextUnformatted(buffer);
            });
        }
    }

    void Panel::show_error_modal(std::string& error_msg, const char* modal_id) {
        if (!error_msg.empty()) {
            ImGui::OpenPopup(modal_id);
        }
        
        ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
        if (ImGui::BeginPopupModal(modal_id, nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
            ImGui::TextColored(ImVec4(1.0f, 0.4f, 0.4f, 1.0f), "Error");
            ImGui::Separator();
            ImGui::TextWrapped("%s", error_msg.c_str());
            ImGui::Spacing();

            float button_width = 120.0f;
            float window_width = ImGui::GetWindowWidth();
            float button_x = (window_width - button_width) * 0.5f;
            ImGui::SetCursorPosX(button_x);

            if (ImGui::Button("OK", ImVec2(button_width, 0)) ||
                core::CommandManager::get().matches("modal.confirm") ||
                core::CommandManager::get().matches("modal.cancel")) {
                error_msg = "";
                ImGui::CloseCurrentPopup();
            }
            ImGui::EndPopup();
        }
    }

    bool Panel::show_confirm_modal(const ConfirmModalProps& props) {
        if (props.is_open == nullptr) {
            return false;
        }

        bool confirmed = false;
        bool& is_open = *props.is_open;
        if (is_open) {
            ImGui::OpenPopup(props.modal_id);
        }

        ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
        if (ImGui::BeginPopupModal(props.modal_id, nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
            text_colored(ImVec4(0.96f, 0.96f, 0.97f, 1.0f), "%s", props.title);
            ImGui::Separator();
            ImGui::TextWrapped("%s", props.message);
            ImGui::Spacing();

            const float button_width = 120.0f;
            const float gap = 10.0f;
            const float total_width = button_width * 2.0f + gap;
            ImGui::SetCursorPosX(std::max(0.0f, (ImGui::GetWindowWidth() - total_width) * 0.5f));

            if (ImGui::Button(props.cancel_label, ImVec2(button_width, 0.0f)) ||
                core::CommandManager::get().matches("modal.cancel")) {
                is_open = false;
                ImGui::CloseCurrentPopup();
            }

            ImGui::SameLine(0.0f, gap);
            const ButtonStyle confirm_style = props.dangerous ? danger_button_style() : primary_button_style();
            if (styled_button(props.confirm_label, ImVec2(button_width, 0.0f), confirm_style) ||
                core::CommandManager::get().matches("modal.confirm")) {
                confirmed = true;
                is_open = false;
                ImGui::CloseCurrentPopup();
            }

            ImGui::EndPopup();
        }

        return confirmed;
    }

    bool Panel::show_empty_state(const EmptyStateProps& props) {
        bool action_pressed = false;
        misty::UI::WithStyle([&](misty::UI::StyleScope& style) {
            style.var(ImGuiStyleVar_ChildRounding, 14.0f);
            style.var(ImGuiStyleVar_ChildBorderSize, 1.0f);
            style.var(ImGuiStyleVar_WindowPadding, ImVec2(20.0f, 18.0f));
            style.color(ImGuiCol_ChildBg, ImVec4(0.14f, 0.14f, 0.16f, 1.0f));
            style.color(ImGuiCol_Border, ImVec4(0.22f, 0.22f, 0.24f, 1.0f));

            if (ImGui::BeginChild("##panel_empty_state",
                                  props.min_size,
                                  ImGuiChildFlags_Borders,
                                  ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
                misty::UI::WithFontScale(1.1f, [&]() {
                    text_colored(ImVec4(0.96f, 0.96f, 0.97f, 1.0f), "%s", props.title);
                });
                ImGui::Spacing();
                text_colored(ImVec4(0.60f, 0.60f, 0.64f, 1.0f), "%s", props.message);

                if (props.action_label && props.action_label[0] != '\0') {
                    ImGui::Spacing();
                    ImGui::Spacing();
                    action_pressed = styled_button(props.action_label, ImVec2(0.0f, 0.0f), primary_button_style());
                }
            }
            ImGui::EndChild();
        });

        return action_pressed;
    }

    void Panel::show_loading_modal(const LoadingModalProps& props) {
        if (props.is_open) {
            ImGui::OpenPopup(props.modal_id);
        }

        ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(320.0f, 260.0f), ImGuiCond_Appearing);
        if (ImGui::BeginPopupModal(props.modal_id, nullptr,
                                   ImGuiWindowFlags_NoResize |
                                   ImGuiWindowFlags_NoMove |
                                   ImGuiWindowFlags_NoCollapse)) {
            const ImVec2 window_pos = ImGui::GetWindowPos();
            const ImVec2 window_size = ImGui::GetWindowSize();
            misty::UI::DrawMistyLoadingAnimation(
                ImVec2(window_pos.x + 24.0f, window_pos.y + 24.0f),
                ImVec2(window_pos.x + window_size.x - 24.0f, window_pos.y + 170.0f),
                104.0f,
                IM_COL32(15, 15, 18, 0)
            );

            ImGui::SetCursorPosY(176.0f);
            misty::UI::WithFontScale(1.12f, [&]() {
                text_colored(ImVec4(0.96f, 0.96f, 0.97f, 1.0f), "%s", props.title);
            });
            ImGui::Spacing();
            text_colored(ImVec4(0.68f, 0.68f, 0.72f, 1.0f), "%s", props.message);

            ImGui::EndPopup();
        }
    }
}
