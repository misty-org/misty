#pragma once

#include "core/ui/ui_animate.h"
#include "imgui.h"

namespace misty::UI {

    struct WindowStyleProps {
        ImVec4 bg_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        ImVec2 padding = ImVec2(0.0f, 0.0f);
    };

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

    template<typename Func>
    inline void WithWindowStyle(const WindowStyleProps& props, Func&& func) {
        CustomStyleColor bg(ImGuiCol_WindowBg, props.bg_color);
        CustomStyleVar pad(ImGuiStyleVar_WindowPadding, props.padding);
        func();
    }

    template<typename Func>
    inline void WithFontScale(float scale, Func&& func) {
        ImGui::SetWindowFontScale(scale);
        func();
        ImGui::SetWindowFontScale(1.0f); // Restore default scale
    }

    template<typename Func>
    inline void WithFont(ImFont* font, Func&& func) {
        CustomFont custom_font(font);
        func();
    }


    class StyleScope {
    public:
        StyleScope() = default;
        StyleScope(const StyleScope&) = delete;
        StyleScope& operator=(const StyleScope&) = delete;

        void var(ImGuiStyleVar idx, float value) {
            ImGui::PushStyleVar(idx, value);
            ++vars_;
        }

        void var(ImGuiStyleVar idx, const ImVec2& value) {
            ImGui::PushStyleVar(idx, value);
            ++vars_;
        }

        void color(ImGuiCol idx, const ImVec4& value) {
            ImGui::PushStyleColor(idx, value);
            ++colors_;
        }

        ~StyleScope() {
            if (colors_ > 0) ImGui::PopStyleColor(colors_);
            if (vars_ > 0) ImGui::PopStyleVar(vars_);
        }
    private:
        int vars_ = 0;
        int colors_ = 0;
    };

    template<typename Func>
    inline void WithStyle(Func&& func) {
        StyleScope style;
        func(style);
    }
}
