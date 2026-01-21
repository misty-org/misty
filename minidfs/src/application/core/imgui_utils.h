#pragma once

#include "imgui.h"

namespace minidfs::core {

    class CustomStyleColor {
    public:
        CustomStyleColor(ImGuiCol idx, const ImVec4& col) {
            ImGui::PushStyleColor(idx, col);
        }
        
        ~CustomStyleColor() {
            ImGui::PopStyleColor();
        }
        
        // Non-copyable
        CustomStyleColor(const CustomStyleColor&) = delete;
        CustomStyleColor& operator=(const CustomStyleColor&) = delete;
    };

    class CustomStyleVar {
    public:
        CustomStyleVar(ImGuiStyleVar idx, float val) {
            ImGui::PushStyleVar(idx, val);
        }
        
        CustomStyleVar(ImGuiStyleVar idx, const ImVec2& val) {
            ImGui::PushStyleVar(idx, val);
        }
        
        ~CustomStyleVar() {
            ImGui::PopStyleVar();
        }
        
        CustomStyleVar(const CustomStyleVar&) = delete;
        CustomStyleVar& operator=(const CustomStyleVar&) = delete;
    };

    class CustomFont {
    public:
        CustomFont(ImFont* font) {
            if (font) {
                ImGui::PushFont(font);
                active_ = true;
            }
        }
        
        ~CustomFont() {
            if (active_) {
                ImGui::PopFont();
            }
        }
        
        CustomFont(const CustomFont&) = delete;
        CustomFont& operator=(const CustomFont&) = delete;
        
    private:
        bool active_ = false;
    };


    template<typename Func>
    inline void WithTextColor(const ImVec4& color, Func&& func) {
        CustomStyleColor style(ImGuiCol_Text, color);
        func();
    }

    // Helper to execute code with styled button colors
    struct ButtonColors {
        ImVec4 button = ImVec4(0.2f, 0.5f, 0.9f, 1.0f);
        ImVec4 hovered = ImVec4(0.3f, 0.6f, 1.0f, 1.0f);
        ImVec4 active = ImVec4(0.15f, 0.4f, 0.8f, 1.0f);
        ImVec4 text = ImVec4(1.0f, 1.0f, 1.0f, 1.0f);
        float rounding = 6.0f;
    };

    template<typename Func>
    inline void WithButtonStyle(const ButtonColors& colors, Func&& func) {
        CustomStyleVar rounding(ImGuiStyleVar_FrameRounding, colors.rounding);
        CustomStyleColor btn(ImGuiCol_Button, colors.button);
        CustomStyleColor hovered(ImGuiCol_ButtonHovered, colors.hovered);
        CustomStyleColor active(ImGuiCol_ButtonActive, colors.active);
        CustomStyleColor text(ImGuiCol_Text, colors.text);
        func();
    }

    // Predefined button color schemes
    namespace ButtonTheme {
        inline ButtonColors Primary() {
            ButtonColors colors;
            colors.button = ImVec4(0.2f, 0.5f, 0.9f, 1.0f);
            colors.hovered = ImVec4(0.3f, 0.6f, 1.0f, 1.0f);
            colors.active = ImVec4(0.15f, 0.4f, 0.8f, 1.0f);
            colors.text = ImVec4(1.0f, 1.0f, 1.0f, 1.0f);
            colors.rounding = 6.0f;
            return colors;
        }

        inline ButtonColors Success() {
            ButtonColors colors;
            colors.button = ImVec4(0.2f, 0.7f, 0.4f, 1.0f);
            colors.hovered = ImVec4(0.3f, 0.8f, 0.5f, 1.0f);
            colors.active = ImVec4(0.15f, 0.6f, 0.3f, 1.0f);
            colors.text = ImVec4(1.0f, 1.0f, 1.0f, 1.0f);
            colors.rounding = 6.0f;
            return colors;
        }

        inline ButtonColors Danger() {
            ButtonColors colors;
            colors.button = ImVec4(0.8f, 0.2f, 0.2f, 1.0f);
            colors.hovered = ImVec4(0.9f, 0.3f, 0.3f, 1.0f);
            colors.active = ImVec4(0.7f, 0.15f, 0.15f, 1.0f);
            colors.text = ImVec4(1.0f, 1.0f, 1.0f, 1.0f);
            colors.rounding = 6.0f;
            return colors;
        }
    }

    template<typename Func>
    inline void WithWindowStyle(const ImVec4& bg_color, const ImVec2& padding, Func&& func) {
        CustomStyleColor bg(ImGuiCol_WindowBg, bg_color);
        CustomStyleVar pad(ImGuiStyleVar_WindowPadding, padding);
        func();
    }

    inline bool StyledButton(const char* label, const ImVec2& size, const ButtonColors& colors) {
        bool result = false;
        WithButtonStyle(colors, [&]() {
            result = ImGui::Button(label, size);
        });
        return result;
    }

    inline void ColoredText(const ImVec4& color, const char* fmt, ...) {
        CustomStyleColor style(ImGuiCol_Text, color);
        va_list args;
        va_start(args, fmt);
        ImGui::TextV(fmt, args);
        va_end(args);
    }

    template<typename Func>
    inline void WithFontScale(float scale, Func&& func) {
        float old_scale = ImGui::GetFontSize();
        ImGui::SetWindowFontScale(scale);
        func();
        ImGui::SetWindowFontScale(1.0f); // Restore default scale
    }

}
