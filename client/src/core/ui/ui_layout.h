#pragma once

#include <cstddef>
#include <functional>

#include "imgui.h"

namespace misty::UI {

class Layout {
public:
    enum class Mode {
        Auto,
        LayoutOnly,
        ChildWindow,
    };

    enum class Axis {
        Row,
        Column,
    };

    enum class SizeMode {
        Auto,
        Pixels,
        Fill,
        Percent,
    };

    enum class Align {
        Start,
        Center,
        End,
        Stretch,
    };

    enum class Justify {
        Start,
        Center,
        End,
    };

    enum class ButtonVariant {
        Default,
        Subtle,
        Primary,
        Danger,
        Nav,
    };

    enum class TextFont {
        Default,
        Small,
        Large,
        XLarge,
        Bold,
        BoldLarge,
        BoldXLarge,
    };

    enum class TextOverflow {
        Visible,
        Wrap,
        Clip,
    };

    struct Size {
        SizeMode mode = SizeMode::Auto;
        float value = 0.0f;

        static constexpr Size auto_size() { return {SizeMode::Auto, 0.0f}; }
        static constexpr Size px(float value) { return {SizeMode::Pixels, value}; }
        static constexpr Size fill() { return {SizeMode::Fill, 1.0f}; }
        static constexpr Size pct(float value) { return {SizeMode::Percent, value}; }
    };

    struct Spacing {
        float x = 0.0f;
        float y = 0.0f;

        static constexpr Spacing uniform(float value) { return {value, value}; }
        static constexpr Spacing xy(float x, float y) { return {x, y}; }
    };

    struct BoxStyle {
        Mode mode = Mode::Auto;
        Size width = Size::fill();
        Size height = Size::auto_size();
        Spacing margin = {};
        Spacing padding = {};
        Spacing gap = {};
        Align align = Align::Start;
        Justify justify = Justify::Start;
        int span = 1;
        bool border = false;
        float rounding = 0.0f;
        ImVec4 bg_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        ImVec4 border_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        ImGuiChildFlags child_flags = ImGuiChildFlags_None;
        ImGuiWindowFlags window_flags = ImGuiWindowFlags_None;
    };

    struct TextProps {
        const char* text = "";
        Size width = Size::auto_size();
        Size height = Size::auto_size();
        Align align = Align::Start;
        Justify justify = Justify::Start;
        bool wrapped = false;
        TextOverflow overflow = TextOverflow::Visible;
        ImVec4 color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        TextFont font = TextFont::Default;
    };

    struct ButtonProps {
        const char* label = "";
        Size width = Size::auto_size();
        Size height = Size::auto_size();
        Align align = Align::Start;
        Justify justify = Justify::Start;
        ButtonVariant variant = ButtonVariant::Default;
        bool selected = false;
        float rounding = 8.0f;
        ImVec4 button_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        ImVec4 hover_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        ImVec4 active_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        ImVec4 text_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
    };

    struct InputTextProps {
        const char* label = "";
        char* buffer = nullptr;
        size_t buffer_size = 0;
        const char* hint = nullptr;
        Size width = Size::fill();
        Size height = Size::auto_size();
        Align align = Align::Stretch;
        Justify justify = Justify::Start;
        ImGuiInputTextFlags flags = ImGuiInputTextFlags_None;
    };

};

using Mode = Layout::Mode;
using Axis = Layout::Axis;
using SizeMode = Layout::SizeMode;
using Align = Layout::Align;
using Justify = Layout::Justify;
using ButtonVariant = Layout::ButtonVariant;
using TextFont = Layout::TextFont;
using TextOverflow = Layout::TextOverflow;
using Size = Layout::Size;
using Spacing = Layout::Spacing;
using BoxStyle = Layout::BoxStyle;
using TextProps = Layout::TextProps;
using ButtonProps = Layout::ButtonProps;
using InputTextProps = Layout::InputTextProps;

bool div(const char* id, const BoxStyle& style, const std::function<void()>& content = {});

bool row(const char* id, const BoxStyle& style, const std::function<void()>& content = {});

bool column(const char* id, const BoxStyle& style, const std::function<void()>& content = {});

bool grid(const char* id, int columns, const BoxStyle& style, const std::function<void()>& content = {});

void spacer(float width, float height = 0.0f);
void text(const TextProps& props);
bool button(const char* id, const ButtonProps& props, const std::function<void()>& content = {});
bool input_text(const InputTextProps& props);

} // namespace misty::UI
