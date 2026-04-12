#pragma once

#include <cfloat>
#include <cmath>

#include "core/manager/asset_manager.h"
#include "imgui.h"

namespace misty::core {

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
        ImVec4 button  = ImVec4(0.957f, 0.957f, 0.961f, 1.0f); // zinc-100 white
        ImVec4 hovered = ImVec4(0.898f, 0.906f, 0.922f, 1.0f); // gray-200
        ImVec4 active  = ImVec4(0.820f, 0.835f, 0.859f, 1.0f); // gray-300
        ImVec4 text    = ImVec4(0.07f,  0.07f,  0.07f,  1.0f); // near-black
        float rounding = 8.0f;
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
            // White CTA — matches website's bg-zinc-100 text-black button
            ButtonColors colors;
            colors.button  = ImVec4(0.957f, 0.957f, 0.961f, 1.0f); // zinc-100
            colors.hovered = ImVec4(0.898f, 0.906f, 0.922f, 1.0f); // gray-200
            colors.active  = ImVec4(0.820f, 0.835f, 0.859f, 1.0f); // gray-300
            colors.text    = ImVec4(0.07f,  0.07f,  0.07f,  1.0f); // near-black
            colors.rounding = 8.0f;
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

    inline float FillWidth() {
        return -FLT_MIN;
    }

    inline float AvailableWidth(float reserve = 0.0f) {
        return (ImGui::GetContentRegionAvail().x > reserve)
            ? (ImGui::GetContentRegionAvail().x - reserve)
            : 1.0f;
    }

    inline void ColoredText(const ImVec4& color, const char* fmt, ...) {
        CustomStyleColor style(ImGuiCol_Text, color);
        va_list args;
        va_start(args, fmt);
        ImGui::TextV(fmt, args);
        va_end(args);
    }

    inline void DrawMistyLoadingAnimation(const ImVec2& min,
                                          const ImVec2& max,
                                          float sprite_size = 128.0f,
                                          ImU32 overlay_color = IM_COL32(15, 15, 18, 160)) {
        static constexpr int   COLS       = 10;
        static constexpr int   ROWS       = 5;
        static constexpr int   TOTAL      = COLS * ROWS;
        static constexpr float FRAME_RATE = 20.0f;

        auto& sprite = AssetManager::get().get_image_texture("assets/misty_sprite.png");
        ImDrawList* dl = ImGui::GetWindowDrawList();
        dl->AddRectFilled(min, max, overlay_color);

        int frame = static_cast<int>(ImGui::GetTime() * FRAME_RATE) % TOTAL;
        int col = frame % COLS;
        int row = frame / COLS;

        float uv_w = 1.0f / COLS;
        float uv_h = 1.0f / ROWS;
        ImVec2 uv0(col * uv_w, row * uv_h);
        ImVec2 uv1((col + 1) * uv_w, (row + 1) * uv_h);

        float t = static_cast<float>(ImGui::GetTime());
        float bob = std::sin(t * 3.0f) * 6.0f;

        float cx = min.x + (max.x - min.x) * 0.5f;
        float cy = min.y + (max.y - min.y) * 0.5f + bob;
        float half = sprite_size * 0.5f;

        dl->AddImage(
            (ImTextureID)(intptr_t)sprite.id,
            ImVec2(cx - half, cy - half),
            ImVec2(cx + half, cy + half),
            uv0, uv1
        );
    }

    template<typename Func>
    inline void WithFontScale(float scale, Func&& func) {
        float old_scale = ImGui::GetFontSize();
        ImGui::SetWindowFontScale(scale);
        func();
        ImGui::SetWindowFontScale(1.0f); // Restore default scale
    }

}
