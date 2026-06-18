#pragma once

#include <cstddef>
#include <functional>
#include <vector>

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
        Ellipsis,
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
        float left = 0.0f;
        float right = 0.0f;
        float top = 0.0f;
        float bottom = 0.0f;

        static constexpr Spacing uniform(float value) { return {value, value, value, value}; }
        static constexpr Spacing xy(float x, float y) { return {x, x, y, y}; }
        static constexpr Spacing left_right(float left, float right) { return {left, right, 0.0f, 0.0f}; }
        static constexpr Spacing top_bottom(float top, float bottom) { return {0.0f, 0.0f, top, bottom}; }
        static constexpr Spacing sides(float left, float right, float top, float bottom) {
            return {left, right, top, bottom};
        }
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
        Spacing padding = {};
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
        Spacing padding = {};
        Align align = Align::Stretch;
        Justify justify = Justify::Start;
        float rounding = 8.0f;
        ImVec4 bg_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        ImVec4 border_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        ImVec4 text_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        ImGuiInputTextFlags flags = ImGuiInputTextFlags_None;
    };

    struct SelectProps {
        const char* label = "";
        int* selected_index = nullptr;
        const char* const* options = nullptr;
        int option_count = 0;
        Size width = Size::fill();
        Size height = Size::auto_size();
        Spacing padding = {};
        Align align = Align::Stretch;
        Justify justify = Justify::Start;
        float rounding = 8.0f;
        ImVec4 bg_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        ImVec4 border_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        ImVec4 text_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
    };

    struct DividerProps {
        Size width = Size::fill();
        Size height = Size::px(1.0f);
        Spacing margin = {};
        Align align = Align::Stretch;
        Justify justify = Justify::Start;
        ImVec4 color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        float rounding = 0.0f;
    };

    struct ImageProps {
        ImTextureID texture_id = 0;
        Size width = Size::auto_size();
        Size height = Size::auto_size();
        Align align = Align::Start;
        Justify justify = Justify::Start;
        ImVec4 tint_color = ImVec4(1.0f, 1.0f, 1.0f, 1.0f);
        ImVec4 border_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
    };

    struct ImageButtonProps {
        ImTextureID texture_id = 0;
        Size width = Size::auto_size();
        Size height = Size::auto_size();
        Spacing padding = {};
        Align align = Align::Start;
        Justify justify = Justify::Start;
        float rounding = 0.0f;
        ImVec4 button_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        ImVec4 hover_color = ImVec4(1.0f, 1.0f, 1.0f, 0.08f);
        ImVec4 active_color = ImVec4(1.0f, 1.0f, 1.0f, 0.12f);
        ImVec4 tint_color = ImVec4(1.0f, 1.0f, 1.0f, 1.0f);
        ImVec4 border_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
    };

    struct TableColumnProps {
        const char* label = "";
        float width = 0.0f;
        ImGuiTableColumnFlags flags = ImGuiTableColumnFlags_None;
        float header_padding_x = 0.0f;
    };

    struct TableProps {
        std::vector<TableColumnProps> columns;
        Size width = Size::fill();
        Size height = Size::auto_size();
        float inner_width = 0.0f;
        ImVec2 cell_padding = ImVec2(8.0f, 6.0f);
        int freeze_columns = 0;
        int freeze_rows = 1;
        ImGuiTableFlags flags = ImGuiTableFlags_None;
        ImVec4 header_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        ImVec4 header_hovered_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        ImVec4 header_active_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        bool override_table_border_light = false;
        ImVec4 table_border_light_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        bool override_table_border_strong = false;
        ImVec4 table_border_strong_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        bool draw_header_separators = false;
        ImVec4 header_separator_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        ImVec4 header_bottom_border_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
        bool disable_default_context_menu = false;
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
using SelectProps = Layout::SelectProps;
using DividerProps = Layout::DividerProps;
using ImageProps = Layout::ImageProps;
using ImageButtonProps = Layout::ImageButtonProps;
using TableColumnProps = Layout::TableColumnProps;
using TableProps = Layout::TableProps;

bool div(const char* id, const BoxStyle& style, const std::function<void()>& content = {});

bool row(const char* id, const BoxStyle& style, const std::function<void()>& content = {});

bool column(const char* id, const BoxStyle& style, const std::function<void()>& content = {});

bool grid(const char* id, int columns, const BoxStyle& style, const std::function<void()>& content = {});

ImVec2 available_size();
void raw(const std::function<void()>& content);
void spacer(float width, float height = 0.0f);
void divider(const DividerProps& props = {});
void text(const TextProps& props);
void image(const ImageProps& props);
bool button(const char* id, const ButtonProps& props, const std::function<void()>& content = {});
bool image_button(const char* id, const ImageButtonProps& props);
bool input_text(const InputTextProps& props);
bool select(const SelectProps& props);
bool table(const char* id, const TableProps& props, const std::function<void(ImGuiTableSortSpecs*)>& content = {});

} // namespace misty::UI
