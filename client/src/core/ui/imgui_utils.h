#pragma once

#include <cfloat>
#include <cmath>

#include "core/manager/asset_manager.h"
#include "core/ui/svg_loader.h"
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

        auto& sprite = AssetManager::get().get_image_texture("assets/animations/misty_sprite.png");
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

    struct ButtonFields {
        const char* label = "";
        float width;
    };

    enum class IconButtonAlignH {
        Left,
        Center,
        Right
    };

    enum class IconButtonAlignV {
        Top,
        Center,
        Bottom
    };

    inline void IconText(const SVGTexture& icon,
                         float icon_display_size,
                         const char* text,
                         float x_offset,
                         float y_offset) {
        ImGui::Image(icon.id, ImVec2(icon_display_size, icon_display_size));
        ImGui::SameLine();
        float current_x = ImGui::GetCursorPosX();
        float current_y = ImGui::GetCursorPosY();
        ImGui::SetCursorPos(ImVec2(current_x + x_offset, current_y + y_offset));
        ImGui::Text("%s", text);
    }

    inline bool IconButton(const char* id,
                           const SVGTexture& icon,
                           const char* label,
                           const ImVec2& button_size,
                           ImFont* font = nullptr,
                           float icon_size = 16.0f,
                           IconButtonAlignH align_h = IconButtonAlignH::Left,
                           IconButtonAlignV align_v = IconButtonAlignV::Center) {
        ImGui::PushID(id);

        ImVec2 backup_pos = ImGui::GetCursorScreenPos();
        const ImGuiStyle& style = ImGui::GetStyle();

        if (font) ImGui::PushFont(font);
        bool pressed = ImGui::Button("##btn", button_size);
        if (font) ImGui::PopFont();

        ImVec2 icon_pos = backup_pos;
        float icon_text_spacing = 8.0f;
        float total_content_width = icon_size + icon_text_spacing + ImGui::CalcTextSize(label).x;

        switch (align_h) {
            case IconButtonAlignH::Left:
                icon_pos.x += style.FramePadding.x;
                break;
            case IconButtonAlignH::Center:
                icon_pos.x += (button_size.x - total_content_width) * 0.5f;
                break;
            case IconButtonAlignH::Right:
                icon_pos.x += button_size.x - total_content_width - style.FramePadding.x;
                break;
        }

        switch (align_v) {
            case IconButtonAlignV::Top:
                icon_pos.y += style.FramePadding.y;
                break;
            case IconButtonAlignV::Center:
                icon_pos.y += (button_size.y - icon_size) * 0.5f;
                break;
            case IconButtonAlignV::Bottom:
                icon_pos.y += button_size.y - icon_size - style.FramePadding.y;
                break;
        }

        ImGui::SetCursorScreenPos(icon_pos);
        ImGui::Image(icon.id, { icon_size, icon_size });

        if (font) ImGui::PushFont(font);
        ImVec2 txt_size = ImGui::CalcTextSize(label);
        ImVec2 txt_pos = backup_pos;

        switch (align_h) {
            case IconButtonAlignH::Left:
            case IconButtonAlignH::Center:
            case IconButtonAlignH::Right:
                txt_pos.x = icon_pos.x + icon_size + icon_text_spacing;
                break;
        }

        switch (align_v) {
            case IconButtonAlignV::Top:
                txt_pos.y += style.FramePadding.y;
                break;
            case IconButtonAlignV::Center:
                txt_pos.y += (button_size.y - txt_size.y) * 0.5f;
                break;
            case IconButtonAlignV::Bottom:
                txt_pos.y += button_size.y - txt_size.y - style.FramePadding.y;
                break;
        }

        ImGui::SetCursorScreenPos(txt_pos);
        ImGui::TextUnformatted(label);
        if (font) ImGui::PopFont();

        ImGui::SetCursorScreenPos(backup_pos);
        ImGui::Dummy(button_size);

        ImGui::PopID();
        return pressed;
    }

    inline bool TextInput(const char* label,
                          char* buf,
                          size_t buf_size,
                          ImGuiInputTextFlags flags = 0) {
        ImGui::PushID(label);
        ImGui::TextUnformatted(label);
        ImGui::SameLine();
        bool changed = ImGui::InputText("##input", buf, buf_size, flags);
        ImGui::PopID();
        return changed;
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
