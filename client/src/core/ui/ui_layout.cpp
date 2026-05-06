#include "core/ui/ui_layout.h"

#include <algorithm>
#include <vector>

#include "core/manager/asset_manager.h"
#include "core/ui/ui_style.h"

namespace misty::UI {

namespace {

enum class FrameKind {
    Flex,
    Grid,
};

struct Frame {
    FrameKind kind = FrameKind::Flex;
    Layout::Axis axis = Layout::Axis::Column;
    ImVec2 content_min{0.0f, 0.0f};
    ImVec2 content_max{0.0f, 0.0f};
    ImVec2 cursor{0.0f, 0.0f};
    Layout::Spacing gap{};
    int columns = 1;
    int current_column = 0;
    float grid_unit_width = 0.0f;
    float row_height = 0.0f;
    bool has_items = false;
};

struct Placement {
    ImVec2 pos{0.0f, 0.0f};
    ImVec2 size{0.0f, 0.0f};
    ImVec2 flow_size{0.0f, 0.0f};
    int span = 1;
};

struct BoxScope {
    bool use_child = false;
    Placement placement{};
    ImVec2 content_min{0.0f, 0.0f};
    ImVec2 content_max{0.0f, 0.0f};
};

std::vector<Frame>& frame_stack() {
    static std::vector<Frame> frames;
    return frames;
}

Frame* current_frame() {
    auto& frames = frame_stack();
    return frames.empty() ? nullptr : &frames.back();
}

float clamp_nonnegative(float value) {
    return std::max(0.0f, value);
}

float resolve_axis_size(const Layout::Size& size, float available) {
    switch (size.mode) {
        case Layout::SizeMode::Pixels:
            return clamp_nonnegative(size.value);
        case Layout::SizeMode::Fill:
            return clamp_nonnegative(available);
        case Layout::SizeMode::Percent:
            return clamp_nonnegative(available * size.value);
        case Layout::SizeMode::Auto:
        default:
            return 1.0f;
    }
}

float aligned_offset(float available, float item_size, Layout::Align align, float margin) {
    const float extra = clamp_nonnegative(available - item_size - margin * 2.0f);
    switch (align) {
        case Layout::Align::Center:
            return margin + extra * 0.5f;
        case Layout::Align::End:
            return margin + extra;
        case Layout::Align::Stretch:
        case Layout::Align::Start:
        default:
            return margin;
    }
}

float justified_offset(float available, float item_size, Layout::Justify justify, float margin) {
    const float extra = clamp_nonnegative(available - item_size - margin * 2.0f);
    switch (justify) {
        case Layout::Justify::Center:
            return margin + extra * 0.5f;
        case Layout::Justify::End:
            return margin + extra;
        case Layout::Justify::Start:
        default:
            return margin;
    }
}

Placement place_in_root(const Layout::BoxStyle& style) {
    Placement placement;
    const ImVec2 root_pos = ImGui::GetCursorScreenPos();
    const ImVec2 avail = ImGui::GetContentRegionAvail();
    const float width_avail = clamp_nonnegative(avail.x - style.margin.x * 2.0f);
    const float height_avail = clamp_nonnegative(avail.y - style.margin.y * 2.0f);

    placement.size.x = resolve_axis_size(style.width, width_avail);
    placement.size.y = resolve_axis_size(style.height, height_avail);

    if (style.align == Layout::Align::Stretch &&
        (style.width.mode == Layout::SizeMode::Auto || style.width.mode == Layout::SizeMode::Fill)) {
        placement.size.x = width_avail;
    }

    placement.pos.x = root_pos.x + aligned_offset(avail.x, placement.size.x, style.align, style.margin.x);
    placement.pos.y = root_pos.y + justified_offset(avail.y, placement.size.y, style.justify, style.margin.y);
    placement.flow_size = ImVec2(
        placement.size.x + style.margin.x * 2.0f,
        placement.size.y + style.margin.y * 2.0f
    );
    return placement;
}

void wrap_grid_row(Frame& frame) {
    frame.cursor.x = frame.content_min.x;
    frame.cursor.y += frame.row_height + frame.gap.y;
    frame.current_column = 0;
    frame.row_height = 0.0f;
    frame.has_items = false;
}

Placement place_in_grid(Frame& frame, const Layout::BoxStyle& style) {
    Placement placement;
    placement.span = std::clamp(style.span, 1, std::max(1, frame.columns));

    if (frame.current_column > 0 && frame.current_column + placement.span > frame.columns) {
        wrap_grid_row(frame);
    }

    const ImVec2 cell_origin = frame.cursor;
    const float span_width =
        frame.grid_unit_width * static_cast<float>(placement.span) +
        frame.gap.x * static_cast<float>(placement.span - 1);
    const float width_avail = clamp_nonnegative(span_width - style.margin.x * 2.0f);
    const float height_avail = clamp_nonnegative(frame.content_max.y - cell_origin.y - style.margin.y * 2.0f);

    placement.size.x =
        (style.width.mode == Layout::SizeMode::Auto || style.width.mode == Layout::SizeMode::Fill)
            ? width_avail
            : resolve_axis_size(style.width, width_avail);
    placement.size.y = resolve_axis_size(style.height, height_avail);
    placement.pos = ImVec2(cell_origin.x + style.margin.x, cell_origin.y + style.margin.y);
    placement.flow_size = ImVec2(
        span_width + style.margin.x * 2.0f,
        placement.size.y + style.margin.y * 2.0f
    );
    return placement;
}

Placement place_in_flex(Frame& frame, const Layout::BoxStyle& style) {
    Placement placement;
    placement.pos = frame.cursor;

    if (frame.has_items) {
        if (frame.axis == Layout::Axis::Row) {
            placement.pos.x += frame.gap.x;
        } else {
            placement.pos.y += frame.gap.y;
        }
    }

    const ImVec2 available(
        frame.content_max.x - placement.pos.x,
        frame.content_max.y - placement.pos.y
    );
    const float width_avail = clamp_nonnegative(available.x - style.margin.x * 2.0f);
    const float height_avail = clamp_nonnegative(available.y - style.margin.y * 2.0f);

    placement.size.x = resolve_axis_size(style.width, width_avail);
    placement.size.y = resolve_axis_size(style.height, height_avail);

    if (frame.axis == Layout::Axis::Row) {
        if (style.align == Layout::Align::Stretch &&
            (style.height.mode == Layout::SizeMode::Auto || style.height.mode == Layout::SizeMode::Fill)) {
            placement.size.y = height_avail;
        }

        placement.pos.x += justified_offset(available.x, placement.size.x, style.justify, style.margin.x);
        placement.pos.y += aligned_offset(available.y, placement.size.y, style.align, style.margin.y);
    } else {
        if (style.align == Layout::Align::Stretch &&
            (style.width.mode == Layout::SizeMode::Auto || style.width.mode == Layout::SizeMode::Fill)) {
            placement.size.x = width_avail;
        }

        placement.pos.x += aligned_offset(available.x, placement.size.x, style.align, style.margin.x);
        placement.pos.y += justified_offset(available.y, placement.size.y, style.justify, style.margin.y);
    }

    placement.flow_size = ImVec2(
        placement.size.x + style.margin.x * 2.0f,
        placement.size.y + style.margin.y * 2.0f
    );
    return placement;
}

Placement compute_placement(const Layout::BoxStyle& style) {
    Frame* frame = current_frame();
    if (!frame) {
        return place_in_root(style);
    }
    if (frame->kind == FrameKind::Grid) {
        return place_in_grid(*frame, style);
    }
    return place_in_flex(*frame, style);
}

void advance_parent(const Layout::BoxStyle& style, const Placement& placement, const ImVec2& actual_size) {
    Frame* frame = current_frame();
    if (!frame) {
        return;
    }

    const ImVec2 occupied_size(
        actual_size.x + style.margin.x * 2.0f,
        actual_size.y + style.margin.y * 2.0f
    );

    if (frame->kind == FrameKind::Grid) {
        frame->row_height = std::max(frame->row_height, occupied_size.y);
        frame->current_column += placement.span;
        if (frame->current_column >= frame->columns) {
            wrap_grid_row(*frame);
        } else {
            frame->cursor = ImVec2(
                frame->cursor.x + placement.flow_size.x + frame->gap.x,
                frame->cursor.y
            );
            frame->has_items = true;
        }
        return;
    }

    if (frame->axis == Layout::Axis::Row) {
        frame->cursor = ImVec2(placement.pos.x + actual_size.x + style.margin.x, frame->cursor.y);
    } else {
        frame->cursor = ImVec2(frame->cursor.x, placement.pos.y + actual_size.y + style.margin.y);
    }
    frame->has_items = true;
}

bool should_use_child_window(const Layout::BoxStyle& style) {
    if (style.mode == Layout::Mode::ChildWindow) {
        return true;
    }
    if (style.mode == Layout::Mode::LayoutOnly) {
        return false;
    }

    return style.border ||
           style.rounding > 0.0f ||
           style.bg_color.w > 0.0f ||
           style.border_color.w > 0.0f ||
           style.padding.x > 0.0f ||
           style.padding.y > 0.0f ||
           style.child_flags != ImGuiChildFlags_None ||
           style.window_flags != ImGuiWindowFlags_None;
}

BoxScope begin_scope(const char* id, const Layout::BoxStyle& style) {
    BoxScope scope;
    scope.placement = compute_placement(style);
    scope.use_child = should_use_child_window(style);

    if (scope.use_child) {
        ImGuiChildFlags child_flags = style.child_flags;
        if (style.border) {
            child_flags |= ImGuiChildFlags_Borders;
        }
        if (style.padding.x > 0.0f || style.padding.y > 0.0f) {
            child_flags |= ImGuiChildFlags_AlwaysUseWindowPadding;
        }
        if (style.width.mode == Layout::SizeMode::Auto) {
            child_flags |= ImGuiChildFlags_AutoResizeX;
        }
        if (style.height.mode == Layout::SizeMode::Auto) {
            child_flags |= ImGuiChildFlags_AutoResizeY;
        }

        ImGui::SetCursorScreenPos(scope.placement.pos);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(style.padding.x, style.padding.y));
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, style.rounding);
        ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, style.border ? 1.0f : 0.0f);
        int pushed_colors = 0;
        if (style.bg_color.w > 0.0f) {
            ImGui::PushStyleColor(ImGuiCol_ChildBg, style.bg_color);
            ++pushed_colors;
        }
        if (style.border_color.w > 0.0f) {
            ImGui::PushStyleColor(ImGuiCol_Border, style.border_color);
            ++pushed_colors;
        }
        ImGui::BeginChild(id, scope.placement.size, child_flags, style.window_flags);
        scope.content_min = ImGui::GetCursorScreenPos();
        const ImVec2 content_avail = ImGui::GetContentRegionAvail();
        scope.content_max = ImVec2(
            scope.content_min.x + content_avail.x,
            scope.content_min.y + content_avail.y
        );
        if (pushed_colors > 0) {
            ImGui::PopStyleColor(pushed_colors);
        }
        ImGui::PopStyleVar(3);
        return scope;
    }

    ImGui::SetCursorScreenPos(scope.placement.pos);
    scope.content_min = ImVec2(
        scope.placement.pos.x + style.padding.x,
        scope.placement.pos.y + style.padding.y
    );
    scope.content_max = ImVec2(
        scope.placement.pos.x + std::max(0.0f, scope.placement.size.x - style.padding.x),
        scope.placement.pos.y + std::max(0.0f, scope.placement.size.y - style.padding.y)
    );

    if (style.bg_color.w > 0.0f || style.border || style.border_color.w > 0.0f) {
        ImDrawList* draw_list = ImGui::GetWindowDrawList();
        const ImU32 bg = ImGui::ColorConvertFloat4ToU32(style.bg_color);
        const ImU32 border = ImGui::ColorConvertFloat4ToU32(
            style.border_color.w > 0.0f ? style.border_color : ImVec4(1.0f, 1.0f, 1.0f, 0.0f)
        );
        if (style.bg_color.w > 0.0f) {
            draw_list->AddRectFilled(
                scope.placement.pos,
                ImVec2(
                    scope.placement.pos.x + scope.placement.size.x,
                    scope.placement.pos.y + scope.placement.size.y
                ),
                bg,
                style.rounding
            );
        }
        if (style.border || style.border_color.w > 0.0f) {
            draw_list->AddRect(
                scope.placement.pos,
                ImVec2(
                    scope.placement.pos.x + scope.placement.size.x,
                    scope.placement.pos.y + scope.placement.size.y
                ),
                border,
                style.rounding
            );
        }
    }

    ImGui::SetCursorScreenPos(scope.content_min);
    return scope;
}

ImVec2 end_scope(const Layout::BoxStyle& style, const BoxScope& scope) {
    if (scope.use_child) {
        ImGui::EndChild();
        return ImGui::GetItemRectSize();
    }

    ImVec2 actual_size = scope.placement.size;
    const ImVec2 cursor = ImGui::GetCursorScreenPos();
    if (style.width.mode == Layout::SizeMode::Auto) {
        actual_size.x = std::max(1.0f, cursor.x - scope.placement.pos.x + style.padding.x);
    }
    if (style.height.mode == Layout::SizeMode::Auto) {
        actual_size.y = std::max(1.0f, cursor.y - scope.placement.pos.y + style.padding.y);
    }
    ImGui::SetCursorScreenPos(scope.placement.pos);
    ImGui::Dummy(actual_size);
    return ImGui::GetItemRectSize();
}

bool begin_box(
    FrameKind kind,
    Layout::Axis axis,
    int columns,
    const char* id,
    const Layout::BoxStyle& style,
    const std::function<void()>& content) {
    const BoxScope scope = begin_scope(id, style);
    if (content) {
        Frame frame;
        frame.kind = kind;
        frame.axis = axis;
        frame.content_min = scope.content_min;
        frame.content_max = scope.content_max;
        frame.cursor = scope.content_min;
        frame.gap = style.gap;
        frame.columns = std::max(1, columns);
        if (kind == FrameKind::Grid) {
            const float total_gap = style.gap.x * static_cast<float>(frame.columns - 1);
            frame.grid_unit_width = clamp_nonnegative(
                (frame.content_max.x - frame.content_min.x - total_gap) / static_cast<float>(frame.columns)
            );
        }

        frame_stack().push_back(frame);
        content();
        frame_stack().pop_back();
    }
    const ImVec2 actual_size = end_scope(style, scope);
    advance_parent(style, scope.placement, actual_size);
    return true;
}

ImVec2 resolve_widget_size(
    const Layout::Size& width,
    const Layout::Size& height,
    const ImVec2& available,
    float natural_width,
    float natural_height) {
    ImVec2 size(0.0f, 0.0f);

    if (width.mode == Layout::SizeMode::Auto) {
        size.x = natural_width;
    } else {
        size.x = resolve_axis_size(width, available.x);
    }

    if (height.mode == Layout::SizeMode::Auto) {
        size.y = natural_height;
    } else {
        size.y = resolve_axis_size(height, available.y);
    }

    return size;
}

ImVec2 current_available_size() {
    Frame* frame = current_frame();
    if (!frame) {
        return ImGui::GetContentRegionAvail();
    }

    return ImVec2(
        clamp_nonnegative(frame->content_max.x - frame->cursor.x),
        clamp_nonnegative(frame->content_max.y - frame->cursor.y)
    );
}

void advance_frame_after_item() {
    Frame* frame = current_frame();
    if (!frame) {
        return;
    }

    const ImVec2 rect_min = ImGui::GetItemRectMin();
    const ImVec2 rect_size = ImGui::GetItemRectSize();

    switch (frame->kind) {
        case FrameKind::Flex:
            if (frame->axis == Layout::Axis::Row) {
                frame->cursor = ImVec2(rect_min.x + rect_size.x + frame->gap.x, frame->cursor.y);
            } else {
                frame->cursor = ImVec2(frame->cursor.x, rect_min.y + rect_size.y + frame->gap.y);
            }
            break;
        case FrameKind::Grid:
            frame->cursor = ImVec2(rect_min.x + rect_size.x + frame->gap.x, frame->cursor.y);
            break;
    }
}

ImFont* font_for_text(Layout::TextFont font) {
    switch (font) {
        case Layout::TextFont::Small:
            return ::misty::core::AssetManager::get().get_font(::misty::core::FontID::ROBOTO_SMALL);
        case Layout::TextFont::Large:
            return ::misty::core::AssetManager::get().get_font(::misty::core::FontID::ROBOTO_LARGE);
        case Layout::TextFont::XLarge:
            return ::misty::core::AssetManager::get().get_font(::misty::core::FontID::ROBOTO_XLARGE);
        case Layout::TextFont::Bold:
            return ::misty::core::AssetManager::get().get_font(::misty::core::FontID::ROBOTO_BOLD);
        case Layout::TextFont::BoldLarge:
            return ::misty::core::AssetManager::get().get_font(::misty::core::FontID::ROBOTO_BOLD_LARGE);
        case Layout::TextFont::BoldXLarge:
            return ::misty::core::AssetManager::get().get_font(::misty::core::FontID::ROBOTO_BOLD_XLARGE);
        case Layout::TextFont::Default:
        default:
            return nullptr;
    }
}

void justify_widget_cursor(const ImVec2& size, Layout::Justify justify) {
    if (justify == Layout::Justify::Start) {
        return;
    }

    const ImVec2 avail = current_available_size();
    const float extra = clamp_nonnegative(avail.y - size.y);
    float offset = 0.0f;

    if (justify == Layout::Justify::Center) {
        offset = extra * 0.5f;
    } else if (justify == Layout::Justify::End) {
        offset = extra;
    }

    if (offset > 0.0f) {
        ImGui::SetCursorPosY(ImGui::GetCursorPosY() + offset);
    }
}

void align_widget_cursor(const ImVec2& size, Layout::Align align) {
    if (align == Layout::Align::Start || align == Layout::Align::Stretch) {
        return;
    }

    const ImVec2 avail = current_available_size();
    const float extra = clamp_nonnegative(avail.x - size.x);
    float offset = 0.0f;

    if (align == Layout::Align::Center) {
        offset = extra * 0.5f;
    } else if (align == Layout::Align::End) {
        offset = extra;
    }

    if (offset > 0.0f) {
        ImGui::SetCursorPosX(ImGui::GetCursorPosX() + offset);
    }
}

struct ButtonStyle {
    ImVec4 button = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
    ImVec4 hovered = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
    ImVec4 active = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
    ImVec4 text = ImVec4(1.0f, 1.0f, 1.0f, 1.0f);
    float rounding = 8.0f;
};

ButtonStyle button_style_for_variant(const Layout::ButtonProps& props) {
    ButtonStyle colors;
    colors.rounding = props.rounding;

    switch (props.variant) {
        case Layout::ButtonVariant::Primary:
            colors.button = ImVec4(0.957f, 0.957f, 0.961f, 1.0f);
            colors.hovered = ImVec4(0.898f, 0.906f, 0.922f, 1.0f);
            colors.active = ImVec4(0.820f, 0.835f, 0.859f, 1.0f);
            colors.text = ImVec4(0.07f, 0.07f, 0.07f, 1.0f);
            return colors;
        case Layout::ButtonVariant::Danger:
            colors.button = ImVec4(0.8f, 0.2f, 0.2f, 1.0f);
            colors.hovered = ImVec4(0.9f, 0.3f, 0.3f, 1.0f);
            colors.active = ImVec4(0.7f, 0.15f, 0.15f, 1.0f);
            colors.text = ImVec4(1.0f, 1.0f, 1.0f, 1.0f);
            return colors;
        case Layout::ButtonVariant::Subtle:
            colors.button = ImVec4(0.18f, 0.18f, 0.20f, 0.55f);
            colors.hovered = ImVec4(0.22f, 0.22f, 0.24f, 0.80f);
            colors.active = ImVec4(0.16f, 0.16f, 0.18f, 1.0f);
            colors.text = ImVec4(0.92f, 0.92f, 0.94f, 1.0f);
            return colors;
        case Layout::ButtonVariant::Nav:
            if (props.selected) {
                colors.button = ImVec4(0.22f, 0.22f, 0.24f, 1.0f);
                colors.hovered = ImVec4(0.24f, 0.24f, 0.27f, 1.0f);
                colors.active = ImVec4(0.18f, 0.18f, 0.20f, 1.0f);
                colors.text = ImVec4(1.0f, 1.0f, 1.0f, 1.0f);
            } else {
                colors.button = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
                colors.hovered = ImVec4(0.18f, 0.18f, 0.20f, 1.0f);
                colors.active = ImVec4(0.16f, 0.16f, 0.18f, 1.0f);
                colors.text = ImVec4(0.68f, 0.68f, 0.68f, 1.0f);
            }
            return colors;
        case Layout::ButtonVariant::Default:
        default:
            break;
    }

    if (props.button_color.w > 0.0f) {
        colors.button = props.button_color;
    }
    if (props.hover_color.w > 0.0f) {
        colors.hovered = props.hover_color;
    }
    if (props.active_color.w > 0.0f) {
        colors.active = props.active_color;
    }
    if (props.text_color.w > 0.0f) {
        colors.text = props.text_color;
    }

    return colors;
}

} // namespace

bool div(const char* id, const BoxStyle& style, const std::function<void()>& content) {
    return begin_box(FrameKind::Flex, Layout::Axis::Column, 1, id, style, content);
}

bool row(const char* id, const BoxStyle& style, const std::function<void()>& content) {
    return begin_box(FrameKind::Flex, Layout::Axis::Row, 1, id, style, content);
}

bool column(const char* id, const BoxStyle& style, const std::function<void()>& content) {
    return begin_box(FrameKind::Flex, Layout::Axis::Column, 1, id, style, content);
}

bool grid(const char* id, int columns, const BoxStyle& style, const std::function<void()>& content) {
    return begin_box(FrameKind::Grid, Layout::Axis::Row, columns, id, style, content);
}

void spacer(float width, float height) {
    Frame* frame = current_frame();
    if (!frame) {
        ImGui::Dummy(ImVec2(width, height));
        return;
    }

    const BoxStyle style{
        .width = Layout::Size::px(width),
        .height = Layout::Size::px(height),
    };
    const Placement placement = compute_placement(style);
    ImGui::SetCursorScreenPos(placement.pos);
    ImGui::Dummy(ImVec2(width, height));
    advance_parent(style, placement, ImGui::GetItemRectSize());
}

void text(const TextProps& props) {
    ImFont* font = font_for_text(props.font);
    if (font) {
        ImGui::PushFont(font);
    }

    const ImVec2 avail = current_available_size();
    const TextOverflow overflow = props.wrapped ? TextOverflow::Wrap : props.overflow;
    const float wrap_width = props.width.mode == Layout::SizeMode::Auto
        ? avail.x
        : std::max(1.0f, resolve_axis_size(props.width, avail.x));

    ImVec2 natural_text_size = ImGui::CalcTextSize(props.text);
    if (overflow == TextOverflow::Wrap) {
        natural_text_size = ImGui::CalcTextSize(props.text, nullptr, false, wrap_width);
    }

    float natural_width = natural_text_size.x;
    float natural_height = natural_text_size.y;
    if (overflow == TextOverflow::Wrap && props.width.mode != Layout::SizeMode::Auto) {
        natural_width = wrap_width;
    }

    const ImVec2 size = resolve_widget_size(props.width, props.height, avail, natural_width, natural_height);
    justify_widget_cursor(size, props.justify);
    align_widget_cursor(size, props.align);

    if (props.color.w > 0.0f) {
        CustomStyleColor text_color(ImGuiCol_Text, props.color);
        if (overflow == TextOverflow::Wrap) {
            ImGui::PushTextWrapPos(ImGui::GetCursorScreenPos().x + (size.x > 0.0f ? size.x : avail.x));
            ImGui::TextUnformatted(props.text);
            ImGui::PopTextWrapPos();
        } else if (overflow == TextOverflow::Clip) {
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            const ImVec2 min = ImGui::GetCursorScreenPos();
            const ImVec2 max(min.x + size.x, min.y + size.y);
            draw_list->PushClipRect(min, max, true);
            draw_list->AddText(min, ImGui::ColorConvertFloat4ToU32(props.color), props.text);
            draw_list->PopClipRect();
            ImGui::Dummy(size);
        } else {
            ImGui::TextUnformatted(props.text);
        }
    } else if (overflow == TextOverflow::Wrap) {
        ImGui::PushTextWrapPos(ImGui::GetCursorScreenPos().x + (size.x > 0.0f ? size.x : avail.x));
        ImGui::TextUnformatted(props.text);
        ImGui::PopTextWrapPos();
    } else if (overflow == TextOverflow::Clip) {
        ImDrawList* draw_list = ImGui::GetWindowDrawList();
        const ImVec2 min = ImGui::GetCursorScreenPos();
        const ImVec2 max(min.x + size.x, min.y + size.y);
        draw_list->PushClipRect(min, max, true);
        draw_list->AddText(min, ImGui::GetColorU32(ImGuiCol_Text), props.text);
        draw_list->PopClipRect();
        ImGui::Dummy(size);
    } else {
        ImGui::TextUnformatted(props.text);
    }

    if (font) {
        ImGui::PopFont();
    }

    advance_frame_after_item();
}

bool button(const char* id, const ButtonProps& props, const std::function<void()>& content) {
    const bool has_content = static_cast<bool>(content);
    const ImVec2 avail = current_available_size();
    const float natural_width = (!has_content && props.label[0] != '\0')
        ? ImGui::CalcTextSize(props.label).x + ImGui::GetStyle().FramePadding.x * 2.0f
        : avail.x;
    const float natural_height = ImGui::GetFrameHeight();
    const Size width = props.align == Align::Stretch && props.width.mode == SizeMode::Auto
        ? Size::fill()
        : props.width;
    ImVec2 size = resolve_widget_size(width, props.height, avail, natural_width, natural_height);
    if (size.x <= 0.0f) {
        size.x = std::max(1.0f, natural_width);
    }
    if (size.y <= 0.0f) {
        size.y = ImGui::GetFrameHeight();
    }

    justify_widget_cursor(size, props.justify);
    align_widget_cursor(size, props.align);

    if (!has_content) {
        if (props.variant == ButtonVariant::Default) {
            return ImGui::Button(props.label, size);
        }

        bool pressed = false;
        const ButtonStyle colors = button_style_for_variant(props);
        WithStyle([&](StyleScope& style) {
            style.var(ImGuiStyleVar_FrameRounding, colors.rounding);
            style.color(ImGuiCol_Button, colors.button);
            style.color(ImGuiCol_ButtonHovered, colors.hovered);
            style.color(ImGuiCol_ButtonActive, colors.active);
            style.color(ImGuiCol_Text, colors.text);
            pressed = ImGui::Button(props.label, size);
        });
        advance_frame_after_item();
        return pressed;
    }

    const ButtonStyle colors = button_style_for_variant(props);
    bool pressed = ImGui::InvisibleButton(id, size);
    const ImVec2 post_button_cursor = ImGui::GetCursorScreenPos();
    const bool hovered = ImGui::IsItemHovered();
    const bool active = ImGui::IsItemActive();
    const ImVec2 rect_min = ImGui::GetItemRectMin();
    const ImVec2 rect_max = ImGui::GetItemRectMax();

    ImVec4 bg_color = colors.button;
    if (active) {
        bg_color = colors.active;
    } else if (hovered) {
        bg_color = colors.hovered;
    }

    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    draw_list->AddRectFilled(rect_min, rect_max, ImGui::ColorConvertFloat4ToU32(bg_color), colors.rounding);

    const ImVec2 frame_padding = ImGui::GetStyle().FramePadding;
    const ImVec2 content_min(rect_min.x + frame_padding.x, rect_min.y + frame_padding.y);
    const ImVec2 content_max(rect_max.x - frame_padding.x, rect_max.y - frame_padding.y);

    Frame frame;
    frame.kind = FrameKind::Flex;
    frame.axis = Layout::Axis::Column;
    frame.content_min = content_min;
    frame.content_max = content_max;
    frame.cursor = content_min;

    ImGui::SetCursorScreenPos(content_min);
    if (props.text_color.w > 0.0f || props.variant != ButtonVariant::Default || props.selected) {
        CustomStyleColor text_color(ImGuiCol_Text, colors.text);
        frame_stack().push_back(frame);
        content();
        frame_stack().pop_back();
    } else {
        frame_stack().push_back(frame);
        content();
        frame_stack().pop_back();
    }

    ImGui::SetCursorScreenPos(post_button_cursor);
    ImGui::Dummy(ImVec2(0.0f, 0.0f));
    advance_frame_after_item();
    return pressed;
}

bool input_text(const InputTextProps& props) {
    if (!props.buffer || props.buffer_size == 0) {
        return false;
    }

    const ImVec2 avail = current_available_size();
    const Size width = props.align == Align::Stretch && props.width.mode == SizeMode::Auto
        ? Size::fill()
        : props.width;
    const ImVec2 size = resolve_widget_size(width, props.height, avail, avail.x, ImGui::GetFrameHeight());
    justify_widget_cursor(size, props.justify);
    align_widget_cursor(size, props.align);

    if (size.x > 0.0f) {
        ImGui::SetNextItemWidth(size.x);
    }

    if (props.hint && props.hint[0] != '\0') {
        const bool changed = ImGui::InputTextWithHint(
            props.label,
            props.hint,
            props.buffer,
            props.buffer_size,
            props.flags
        );
        advance_frame_after_item();
        return changed;
    }

    const bool changed = ImGui::InputText(props.label, props.buffer, props.buffer_size, props.flags);
    advance_frame_after_item();
    return changed;
}

} // namespace misty::UI
