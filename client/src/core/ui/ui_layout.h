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
        Bold,
        BoldLarge,
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

    static bool div(const char* id, const std::function<void()>& content);
    static bool div(const char* id, const BoxStyle& style, const std::function<void()>& content = {});

    static bool row(const char* id, const std::function<void()>& content);
    static bool row(const char* id, const BoxStyle& style, const std::function<void()>& content = {});

    static bool column(const char* id, const std::function<void()>& content);
    static bool column(const char* id, const BoxStyle& style, const std::function<void()>& content = {});

    static bool grid(const char* id, int columns, const std::function<void()>& content);
    static bool grid(
        const char* id,
        int columns,
        const BoxStyle& style,
        const std::function<void()>& content = {});

    static void spacer(float width, float height = 0.0f);
    static void text(const TextProps& props);
    static bool button(const ButtonProps& props);
    static bool button(
        const char* id,
        const ButtonProps& props,
        const std::function<void()>& content = {});
    static bool input_text(const InputTextProps& props);
};

using Mode = Layout::Mode;
using Axis = Layout::Axis;
using SizeMode = Layout::SizeMode;
using Align = Layout::Align;
using Justify = Layout::Justify;
using ButtonVariant = Layout::ButtonVariant;
using TextFont = Layout::TextFont;
using Size = Layout::Size;
using Spacing = Layout::Spacing;
using BoxStyle = Layout::BoxStyle;
using TextProps = Layout::TextProps;
using ButtonProps = Layout::ButtonProps;
using InputTextProps = Layout::InputTextProps;

inline bool div(const char* id, const std::function<void()>& content) {
    return Layout::div(id, content);
}

inline bool div(const char* id, const BoxStyle& style, const std::function<void()>& content = {}) {
    return Layout::div(id, style, content);
}

inline bool row(const char* id, const std::function<void()>& content) {
    return Layout::row(id, content);
}

inline bool row(const char* id, const BoxStyle& style, const std::function<void()>& content = {}) {
    return Layout::row(id, style, content);
}

inline bool column(const char* id, const std::function<void()>& content) {
    return Layout::column(id, content);
}

inline bool column(const char* id, const BoxStyle& style, const std::function<void()>& content = {}) {
    return Layout::column(id, style, content);
}

inline bool grid(const char* id, int columns, const std::function<void()>& content) {
    return Layout::grid(id, columns, content);
}

inline bool grid(
    const char* id,
    int columns,
    const BoxStyle& style,
    const std::function<void()>& content = {}) {
    return Layout::grid(id, columns, style, content);
}

inline void spacer(float width, float height = 0.0f) {
    Layout::spacer(width, height);
}

inline void text(const TextProps& props) {
    Layout::text(props);
}

inline bool button(const ButtonProps& props) {
    return Layout::button(props);
}

inline bool button(const char* id, const ButtonProps& props, const std::function<void()>& content = {}) {
    return Layout::button(id, props, content);
}

inline bool input_text(const InputTextProps& props) {
    return Layout::input_text(props);
}

} // namespace misty::UI
