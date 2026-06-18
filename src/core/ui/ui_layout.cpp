#include "core/ui/ui_layout.h"

#include <algorithm>
#include <string>
#include <vector>

#include "core/manager/font_manager.h"
#include "core/ui/ui_style.h"
#include "imgui_internal.h"

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
    ImVec2 measured_max{0.0f, 0.0f};
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

float spacing_axis_x(const Layout::Spacing& spacing) {
    return spacing.left;
}

float spacing_axis_y(const Layout::Spacing& spacing) {
    return spacing.top;
}

float spacing_total_x(const Layout::Spacing& spacing) {
    return spacing.left + spacing.right;
}

float spacing_total_y(const Layout::Spacing& spacing) {
    return spacing.top + spacing.bottom;
}

std::string ellipsize_text(const char* text, float max_width) {
    if (text == nullptr || text[0] == '\0' || max_width <= 0.0f) {
        return {};
    }

    const std::string value(text);
    if (ImGui::CalcTextSize(value.c_str()).x <= max_width) {
        return value;
    }

    constexpr const char* kEllipsis = "...";
    const float ellipsis_width = ImGui::CalcTextSize(kEllipsis).x;
    if (ellipsis_width > max_width) {
        return {};
    }

    std::size_t keep = value.size();
    while (keep > 0) {
        std::string candidate = value.substr(0, keep) + kEllipsis;
        if (ImGui::CalcTextSize(candidate.c_str()).x <= max_width) {
            return candidate;
        }
        --keep;
    }
    return kEllipsis;
}

ImVec2 spacing_to_imgui_padding(const Layout::Spacing& spacing) {
    return ImVec2(
        std::max(spacing.left, spacing.right),
        std::max(spacing.top, spacing.bottom)
    );
}

float resolve_axis_size(const Layout::Size& size, float available) {
    switch (size.mode) {
        case Layout::SizeMode::Pixels:
            return clamp_nonnegative(std::min(size.value, available));
        case Layout::SizeMode::Fill:
            return clamp_nonnegative(available);
        case Layout::SizeMode::Percent:
            return clamp_nonnegative(available * size.value);
        case Layout::SizeMode::Auto:
        default:
            return 1.0f;
    }
}

float resolve_box_axis_size(const Layout::Size& size, float available) {
    switch (size.mode) {
        case Layout::SizeMode::Auto:
            // Let auto-sized layout containers measure against the real space they can use.
            // end_scope() shrinks them back down to their actual rendered content size.
            return clamp_nonnegative(available);
        default:
            return resolve_axis_size(size, available);
    }
}

float aligned_offset(float available, float item_size, Layout::Align align, float leading, float trailing) {
    const float extra = clamp_nonnegative(available - item_size - leading - trailing);
    switch (align) {
        case Layout::Align::Center:
            return leading + extra * 0.5f;
        case Layout::Align::End:
            return leading + extra;
        case Layout::Align::Stretch:
        case Layout::Align::Start:
        default:
            return leading;
    }
}

float justified_offset(float available, float item_size, Layout::Justify justify, float leading, float trailing) {
    const float extra = clamp_nonnegative(available - item_size - leading - trailing);
    switch (justify) {
        case Layout::Justify::Center:
            return leading + extra * 0.5f;
        case Layout::Justify::End:
            return leading + extra;
        case Layout::Justify::Start:
        default:
            return leading;
    }
}

Placement place_in_root(const Layout::BoxStyle& style) {
    Placement placement;
    const ImVec2 root_pos = ImGui::GetCursorScreenPos();
    const ImVec2 avail = ImGui::GetContentRegionAvail();
    const float width_avail = clamp_nonnegative(avail.x - spacing_total_x(style.margin));
    const float height_avail = clamp_nonnegative(avail.y - spacing_total_y(style.margin));

    placement.size.x = resolve_box_axis_size(style.width, width_avail);
    placement.size.y = resolve_box_axis_size(style.height, height_avail);

    if (style.align == Layout::Align::Stretch &&
        (style.width.mode == Layout::SizeMode::Auto || style.width.mode == Layout::SizeMode::Fill)) {
        placement.size.x = width_avail;
    }

    placement.pos.x = root_pos.x + aligned_offset(
        avail.x,
        placement.size.x,
        style.align,
        style.margin.left,
        style.margin.right
    );
    placement.pos.y = root_pos.y + justified_offset(
        avail.y,
        placement.size.y,
        style.justify,
        style.margin.top,
        style.margin.bottom
    );
    placement.flow_size = ImVec2(
        placement.size.x + spacing_total_x(style.margin),
        placement.size.y + spacing_total_y(style.margin)
    );
    return placement;
}

void wrap_grid_row(Frame& frame) {
    frame.cursor.x = frame.content_min.x;
    frame.cursor.y += frame.row_height + spacing_axis_y(frame.gap);
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
        spacing_axis_x(frame.gap) * static_cast<float>(placement.span - 1);
    const float width_avail = clamp_nonnegative(span_width - spacing_total_x(style.margin));
    const float height_avail = clamp_nonnegative(frame.content_max.y - cell_origin.y - spacing_total_y(style.margin));

    placement.size.x =
        (style.width.mode == Layout::SizeMode::Auto || style.width.mode == Layout::SizeMode::Fill)
            ? width_avail
            : resolve_box_axis_size(style.width, width_avail);
    placement.size.y = resolve_box_axis_size(style.height, height_avail);
    placement.pos = ImVec2(cell_origin.x + style.margin.left, cell_origin.y + style.margin.top);
    placement.flow_size = ImVec2(
        span_width + spacing_total_x(style.margin),
        placement.size.y + spacing_total_y(style.margin)
    );
    return placement;
}

Placement place_in_flex(Frame& frame, const Layout::BoxStyle& style) {
    Placement placement;
    placement.pos = frame.cursor;

    if (frame.has_items) {
        if (frame.axis == Layout::Axis::Row) {
            placement.pos.x += spacing_axis_x(frame.gap);
        } else {
            placement.pos.y += spacing_axis_y(frame.gap);
        }
    }

    const ImVec2 available(
        frame.content_max.x - placement.pos.x,
        frame.content_max.y - placement.pos.y
    );
    const float width_avail = clamp_nonnegative(available.x - spacing_total_x(style.margin));
    const float height_avail = clamp_nonnegative(available.y - spacing_total_y(style.margin));

    placement.size.x = resolve_box_axis_size(style.width, width_avail);
    placement.size.y = resolve_box_axis_size(style.height, height_avail);

    if (frame.axis == Layout::Axis::Row) {
        if (style.align == Layout::Align::Stretch &&
            (style.height.mode == Layout::SizeMode::Auto || style.height.mode == Layout::SizeMode::Fill)) {
            placement.size.y = height_avail;
        }

        placement.pos.x += justified_offset(
            available.x,
            placement.size.x,
            style.justify,
            style.margin.left,
            style.margin.right
        );
        placement.pos.y += aligned_offset(
            available.y,
            placement.size.y,
            style.align,
            style.margin.top,
            style.margin.bottom
        );
    } else {
        if (style.align == Layout::Align::Stretch &&
            (style.width.mode == Layout::SizeMode::Auto || style.width.mode == Layout::SizeMode::Fill)) {
            placement.size.x = width_avail;
        }

        placement.pos.x += aligned_offset(
            available.x,
            placement.size.x,
            style.align,
            style.margin.left,
            style.margin.right
        );
        placement.pos.y += justified_offset(
            available.y,
            placement.size.y,
            style.justify,
            style.margin.top,
            style.margin.bottom
        );
    }

    placement.flow_size = ImVec2(
        placement.size.x + spacing_total_x(style.margin),
        placement.size.y + spacing_total_y(style.margin)
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

    frame->measured_max.x = std::max(frame->measured_max.x, placement.pos.x + actual_size.x + style.margin.right);
    frame->measured_max.y = std::max(frame->measured_max.y, placement.pos.y + actual_size.y + style.margin.bottom);

    const ImVec2 occupied_size(
        actual_size.x + spacing_total_x(style.margin),
        actual_size.y + spacing_total_y(style.margin)
    );

    if (frame->kind == FrameKind::Grid) {
        frame->row_height = std::max(frame->row_height, occupied_size.y);
        frame->current_column += placement.span;
        if (frame->current_column >= frame->columns) {
            wrap_grid_row(*frame);
        } else {
            frame->cursor = ImVec2(
                frame->cursor.x + placement.flow_size.x + spacing_axis_x(frame->gap),
                frame->cursor.y
            );
            frame->has_items = true;
        }
        return;
    }

    if (frame->axis == Layout::Axis::Row) {
        frame->cursor = ImVec2(placement.pos.x + actual_size.x + style.margin.right, frame->cursor.y);
    } else {
        frame->cursor = ImVec2(frame->cursor.x, placement.pos.y + actual_size.y + style.margin.bottom);
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
           spacing_total_x(style.padding) > 0.0f ||
           spacing_total_y(style.padding) > 0.0f ||
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
        if (style.width.mode == Layout::SizeMode::Auto) {
            child_flags |= ImGuiChildFlags_AutoResizeX;
        }
        if (style.height.mode == Layout::SizeMode::Auto) {
            child_flags |= ImGuiChildFlags_AutoResizeY;
        }

        const bool use_native_child_padding =
            (child_flags & ImGuiChildFlags_AlwaysUseWindowPadding) != 0 &&
            style.padding.left == style.padding.right &&
            style.padding.top == style.padding.bottom;
        const ImVec2 child_window_padding =
            use_native_child_padding ? spacing_to_imgui_padding(style.padding) : ImVec2(0.0f, 0.0f);

        ImGui::SetCursorScreenPos(scope.placement.pos);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, child_window_padding);
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
        const ImVec2 child_origin = ImGui::GetCursorScreenPos();
        const ImVec2 child_origin_local = ImGui::GetCursorPos();
        const ImVec2 content_avail = ImGui::GetContentRegionAvail();
        if (use_native_child_padding) {
            scope.content_min = child_origin;
            scope.content_max = ImVec2(
                scope.content_min.x + std::max(0.0f, content_avail.x),
                scope.content_min.y + std::max(0.0f, content_avail.y)
            );
        } else {
            const ImVec2 padded_cursor_local(
                child_origin_local.x + style.padding.left,
                child_origin_local.y + style.padding.top
            );
            ImGui::SetCursorPos(padded_cursor_local);
            scope.content_min = ImGui::GetCursorScreenPos();
            scope.content_max = ImVec2(
                scope.content_min.x + std::max(0.0f, content_avail.x - spacing_total_x(style.padding)),
                scope.content_min.y + std::max(0.0f, content_avail.y - spacing_total_y(style.padding))
            );
        }
        if (pushed_colors > 0) {
            ImGui::PopStyleColor(pushed_colors);
        }
        ImGui::PopStyleVar(3);
        return scope;
    }

    ImGui::SetCursorScreenPos(scope.placement.pos);
    scope.content_min = ImVec2(
        scope.placement.pos.x + style.padding.left,
        scope.placement.pos.y + style.padding.top
    );
    scope.content_max = ImVec2(
        scope.placement.pos.x + std::max(0.0f, scope.placement.size.x - style.padding.right),
        scope.placement.pos.y + std::max(0.0f, scope.placement.size.y - style.padding.bottom)
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

ImVec2 end_scope(const Layout::BoxStyle& style, const BoxScope& scope, const ImVec2* measured_max = nullptr) {
    if (scope.use_child) {
        ImGui::EndChild();
        return ImGui::GetItemRectSize();
    }

    ImVec2 actual_size = scope.placement.size;
    const ImVec2 cursor = measured_max ? *measured_max : ImGui::GetCursorScreenPos();
    if (style.width.mode == Layout::SizeMode::Auto) {
        actual_size.x = std::max(1.0f, cursor.x - scope.placement.pos.x + style.padding.right);
    }
    if (style.height.mode == Layout::SizeMode::Auto) {
        actual_size.y = std::max(1.0f, cursor.y - scope.placement.pos.y + style.padding.bottom);
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
    ImVec2 measured_max = scope.content_min;
    if (content) {
        Frame frame;
        frame.kind = kind;
        frame.axis = axis;
        frame.content_min = scope.content_min;
        frame.content_max = scope.content_max;
        frame.cursor = scope.content_min;
        frame.measured_max = scope.content_min;
        frame.gap = style.gap;
        frame.columns = std::max(1, columns);
        if (kind == FrameKind::Grid) {
            const float total_gap = spacing_axis_x(style.gap) * static_cast<float>(frame.columns - 1);
            frame.grid_unit_width = clamp_nonnegative(
                (frame.content_max.x - frame.content_min.x - total_gap) / static_cast<float>(frame.columns)
            );
        }

        frame_stack().push_back(frame);
        content();
        measured_max = frame_stack().back().measured_max;
        frame_stack().pop_back();
    }
    const ImVec2 actual_size = end_scope(style, scope, &measured_max);
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
    } else if (width.mode == Layout::SizeMode::Pixels) {
        size.x = clamp_nonnegative(width.value);
    } else {
        size.x = resolve_axis_size(width, available.x);
    }

    if (height.mode == Layout::SizeMode::Auto) {
        size.y = natural_height;
    } else if (height.mode == Layout::SizeMode::Pixels) {
        size.y = clamp_nonnegative(height.value);
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
    frame->measured_max.x = std::max(frame->measured_max.x, rect_min.x + rect_size.x);
    frame->measured_max.y = std::max(frame->measured_max.y, rect_min.y + rect_size.y);

    switch (frame->kind) {
        case FrameKind::Flex:
            if (frame->axis == Layout::Axis::Row) {
                frame->cursor = ImVec2(rect_min.x + rect_size.x + spacing_axis_x(frame->gap), frame->cursor.y);
            } else {
                frame->cursor = ImVec2(frame->cursor.x, rect_min.y + rect_size.y + spacing_axis_y(frame->gap));
            }
            break;
        case FrameKind::Grid:
            frame->cursor = ImVec2(rect_min.x + rect_size.x + spacing_axis_x(frame->gap), frame->cursor.y);
            break;
    }
}

ImFont* font_for_text(Layout::TextFont font) {
    switch (font) {
        case Layout::TextFont::Small:
            return ::misty::core::FontManager::get().get_font(::misty::core::FontID::ROBOTO_SMALL);
        case Layout::TextFont::Large:
            return ::misty::core::FontManager::get().get_font(::misty::core::FontID::ROBOTO_LARGE);
        case Layout::TextFont::XLarge:
            return ::misty::core::FontManager::get().get_font(::misty::core::FontID::ROBOTO_XLARGE);
        case Layout::TextFont::Bold:
            return ::misty::core::FontManager::get().get_font(::misty::core::FontID::ROBOTO_BOLD);
        case Layout::TextFont::BoldLarge:
            return ::misty::core::FontManager::get().get_font(::misty::core::FontID::ROBOTO_BOLD_LARGE);
        case Layout::TextFont::BoldXLarge:
            return ::misty::core::FontManager::get().get_font(::misty::core::FontID::ROBOTO_BOLD_XLARGE);
        case Layout::TextFont::Default:
        default:
            return nullptr;
    }
}

void position_widget_cursor(const ImVec2& size, Layout::Align align, Layout::Justify justify) {
    const ImVec2 avail = current_available_size();
    const ImVec2 base = current_frame() ? current_frame()->cursor : ImGui::GetCursorScreenPos();
    float offset_x = 0.0f;
    float offset_y = 0.0f;

    const float extra_y = clamp_nonnegative(avail.y - size.y);
    if (justify == Layout::Justify::Center) {
        offset_y = extra_y * 0.5f;
    } else if (justify == Layout::Justify::End) {
        offset_y = extra_y;
    }

    if (align == Layout::Align::Center) {
        offset_x = clamp_nonnegative(avail.x - size.x) * 0.5f;
    } else if (align == Layout::Align::End) {
        offset_x = clamp_nonnegative(avail.x - size.x);
    }

    ImGui::SetCursorScreenPos(ImVec2(base.x + offset_x, base.y + offset_y));
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

ImVec2 available_size() {
    return current_available_size();
}

void raw(const std::function<void()>& content) {
    auto& frames = frame_stack();
    std::vector<Frame> saved_frames = std::move(frames);
    frames.clear();
    if (content) {
        content();
    }
    frames = std::move(saved_frames);
}

bool table(const char* id, const TableProps& props, const std::function<void(ImGuiTableSortSpecs*)>& content) {
    if (props.columns.empty()) {
        return false;
    }

    const ImVec2 avail = current_available_size();
    const ImVec2 size(
        props.width.mode == Layout::SizeMode::Auto ? 0.0f : resolve_axis_size(props.width, avail.x),
        props.height.mode == Layout::SizeMode::Auto ? 0.0f : resolve_axis_size(props.height, avail.y)
    );

    int color_count = 0;
    if (props.header_color.w > 0.0f) {
        ImGui::PushStyleColor(ImGuiCol_Header, props.header_color);
        ++color_count;
    }
    if (props.header_hovered_color.w > 0.0f) {
        ImGui::PushStyleColor(ImGuiCol_HeaderHovered, props.header_hovered_color);
        ++color_count;
    }
    if (props.header_active_color.w > 0.0f) {
        ImGui::PushStyleColor(ImGuiCol_HeaderActive, props.header_active_color);
        ++color_count;
    }
    if (props.override_table_border_light) {
        ImGui::PushStyleColor(ImGuiCol_TableBorderLight, props.table_border_light_color);
        ++color_count;
    }
    if (props.override_table_border_strong) {
        ImGui::PushStyleColor(ImGuiCol_TableBorderStrong, props.table_border_strong_color);
        ++color_count;
    }

    ImGui::PushStyleVar(ImGuiStyleVar_CellPadding, props.cell_padding);
    const bool opened = ImGui::BeginTable(
        id,
        static_cast<int>(props.columns.size()),
        props.flags,
        size,
        props.inner_width
    );
    if (opened) {
        if (props.disable_default_context_menu) {
            if (ImGuiTable* table = ImGui::GetCurrentTable()) {
                table->DisableDefaultContextMenu = true;
            }
        }

        if (props.freeze_columns > 0 || props.freeze_rows > 0) {
            ImGui::TableSetupScrollFreeze(props.freeze_columns, props.freeze_rows);
        }

        for (const auto& column : props.columns) {
            ImGui::TableSetupColumn(column.label, column.flags, column.width);
        }

        ImGui::TableNextRow(ImGuiTableRowFlags_Headers);
        struct HeaderRect {
            ImVec2 min;
            ImVec2 max;
        };
        std::vector<HeaderRect> header_rects;
        if (props.draw_header_separators) {
            header_rects.reserve(props.columns.size());
        }
        for (int column_index = 0; column_index < static_cast<int>(props.columns.size()); ++column_index) {
            ImGui::TableSetColumnIndex(column_index);
            if (props.columns[column_index].header_padding_x > 0.0f) {
                ImGui::SetCursorPosX(ImGui::GetCursorPosX() + props.columns[column_index].header_padding_x);
            }
            ImGui::TableHeader(props.columns[column_index].label);
            if (props.draw_header_separators) {
                header_rects.push_back(HeaderRect{
                    .min = ImGui::GetItemRectMin(),
                    .max = ImGui::GetItemRectMax(),
                });
            }
        }

        if (props.draw_header_separators && !header_rects.empty()) {
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            const float top_y = header_rects.front().min.y;
            const float bottom_y = header_rects.front().max.y;
            for (std::size_t index = 0; index + 1 < header_rects.size(); ++index) {
                draw_list->AddLine(ImVec2(header_rects[index].max.x, top_y),
                                   ImVec2(header_rects[index].max.x, bottom_y),
                                   ImGui::ColorConvertFloat4ToU32(props.header_separator_color),
                                   1.0f);
            }
            draw_list->AddLine(ImVec2(header_rects.front().min.x, bottom_y - 1.0f),
                               ImVec2(header_rects.back().max.x, bottom_y - 1.0f),
                               ImGui::ColorConvertFloat4ToU32(props.header_bottom_border_color),
                               1.0f);
        }

        if (content) {
            content(ImGui::TableGetSortSpecs());
        }
        ImGui::EndTable();
    }
    ImGui::PopStyleVar();
    if (color_count > 0) {
        ImGui::PopStyleColor(color_count);
    }
    return opened;
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

void divider(const DividerProps& props) {
    BoxStyle style;
    style.width = props.width;
    style.height = props.height;
    style.margin = props.margin;
    style.align = props.align;
    style.justify = props.justify;

    const Placement placement = compute_placement(style);
    const ImVec2 size(
        std::max(1.0f, placement.size.x),
        std::max(1.0f, placement.size.y)
    );

    ImGui::SetCursorScreenPos(placement.pos);
    ImGui::Dummy(size);

    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    const ImVec4 divider_color = props.color.w > 0.0f
        ? props.color
        : ImGui::GetStyleColorVec4(ImGuiCol_Border);
    draw_list->AddRectFilled(
        placement.pos,
        ImVec2(placement.pos.x + size.x, placement.pos.y + size.y),
        ImGui::ColorConvertFloat4ToU32(divider_color),
        props.rounding
    );

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
    position_widget_cursor(size, props.align, props.justify);
    const ImVec2 origin = ImGui::GetCursorScreenPos();
    const float wrap_local_pos_x =
        ImGui::GetCursorPosX() + (size.x > 0.0f ? size.x : avail.x);
    const float inner_offset_x = [&]() {
        if (props.width.mode == Layout::SizeMode::Auto || overflow == TextOverflow::Wrap) {
            return 0.0f;
        }

        const float extra = clamp_nonnegative(size.x - natural_text_size.x);
        if (props.align == Align::Center) {
            return extra * 0.5f;
        }
        if (props.align == Align::End) {
            return extra;
        }
        return 0.0f;
    }();
    const ImVec2 text_pos(origin.x + inner_offset_x, origin.y);

    if (props.color.w > 0.0f) {
        CustomStyleColor text_color(ImGuiCol_Text, props.color);
        if (overflow == TextOverflow::Wrap) {
            ImGui::PushTextWrapPos(wrap_local_pos_x);
            ImGui::TextUnformatted(props.text);
            ImGui::PopTextWrapPos();
        } else if (overflow == TextOverflow::Clip || overflow == TextOverflow::Ellipsis) {
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            const ImVec2 min = origin;
            const ImVec2 max(origin.x + size.x, origin.y + size.y);
            const std::string display_text = overflow == TextOverflow::Ellipsis
                ? ellipsize_text(props.text, size.x)
                : std::string(props.text ? props.text : "");
            draw_list->PushClipRect(min, max, true);
            draw_list->AddText(text_pos, ImGui::ColorConvertFloat4ToU32(props.color), display_text.c_str());
            draw_list->PopClipRect();
            ImGui::Dummy(size);
        } else {
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            draw_list->AddText(text_pos, ImGui::ColorConvertFloat4ToU32(props.color), props.text);
            ImGui::Dummy(size);
        }
    } else if (overflow == TextOverflow::Wrap) {
        ImGui::PushTextWrapPos(wrap_local_pos_x);
        ImGui::TextUnformatted(props.text);
        ImGui::PopTextWrapPos();
    } else if (overflow == TextOverflow::Clip || overflow == TextOverflow::Ellipsis) {
        ImDrawList* draw_list = ImGui::GetWindowDrawList();
        const ImVec2 min = origin;
        const ImVec2 max(origin.x + size.x, origin.y + size.y);
        const std::string display_text = overflow == TextOverflow::Ellipsis
            ? ellipsize_text(props.text, size.x)
            : std::string(props.text ? props.text : "");
        draw_list->PushClipRect(min, max, true);
        draw_list->AddText(text_pos, ImGui::GetColorU32(ImGuiCol_Text), display_text.c_str());
        draw_list->PopClipRect();
        ImGui::Dummy(size);
    } else {
        ImDrawList* draw_list = ImGui::GetWindowDrawList();
        draw_list->AddText(text_pos, ImGui::GetColorU32(ImGuiCol_Text), props.text);
        ImGui::Dummy(size);
    }

    if (font) {
        ImGui::PopFont();
    }

    advance_frame_after_item();
}

void image(const ImageProps& props) {
    if (!props.texture_id) {
        return;
    }

    const ImVec2 avail = current_available_size();
    const float natural_width = props.width.mode == SizeMode::Auto ? 16.0f : 0.0f;
    const float natural_height = props.height.mode == SizeMode::Auto ? 16.0f : 0.0f;
    ImVec2 size = resolve_widget_size(props.width, props.height, avail, natural_width, natural_height);
    if (size.x <= 0.0f) {
        size.x = natural_width;
    }
    if (size.y <= 0.0f) {
        size.y = natural_height;
    }

    position_widget_cursor(size, props.align, props.justify);
    ImGui::Image(props.texture_id, size, ImVec2(0, 0), ImVec2(1, 1), props.tint_color, props.border_color);
    advance_frame_after_item();
}

bool button(const char* id, const ButtonProps& props, const std::function<void()>& content) {
    const bool has_content = static_cast<bool>(content);
    const ImVec2 avail = current_available_size();
    const ImVec2 frame_padding = (spacing_total_x(props.padding) > 0.0f || spacing_total_y(props.padding) > 0.0f)
        ? spacing_to_imgui_padding(props.padding)
        : ImGui::GetStyle().FramePadding;
    const float natural_width = (!has_content && props.label[0] != '\0')
        ? ImGui::CalcTextSize(props.label).x + frame_padding.x * 2.0f
        : avail.x;
    const float natural_height = std::max(ImGui::GetTextLineHeight() + frame_padding.y * 2.0f, ImGui::GetFrameHeight());
    const Size width = props.align == Align::Stretch && props.width.mode == SizeMode::Auto
        ? Size::fill()
        : props.width;
    ImVec2 size = resolve_widget_size(width, props.height, avail, natural_width, natural_height);
    if (size.x <= 0.0f) {
        size.x = std::max(1.0f, natural_width);
    }
    if (size.y <= 0.0f) {
        size.y = natural_height;
    }

    position_widget_cursor(size, props.align, props.justify);

    if (!has_content) {
        if (props.variant == ButtonVariant::Default) {
            return ImGui::Button(props.label, size);
        }

        bool pressed = false;
        const ButtonStyle colors = button_style_for_variant(props);
        WithStyle([&](StyleScope& style) {
            style.var(ImGuiStyleVar_FrameRounding, colors.rounding);
            style.var(ImGuiStyleVar_FramePadding, frame_padding);
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

    const Layout::Spacing content_padding = (spacing_total_x(props.padding) > 0.0f || spacing_total_y(props.padding) > 0.0f)
        ? props.padding
        : Layout::Spacing::xy(frame_padding.x, frame_padding.y);
    const ImVec2 content_min(rect_min.x + content_padding.left, rect_min.y + content_padding.top);
    const ImVec2 content_max(rect_max.x - content_padding.right, rect_max.y - content_padding.bottom);

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

bool image_button(const char* id, const ImageButtonProps& props) {
    if (!props.texture_id) {
        return false;
    }

    const ImVec2 avail = current_available_size();
    const ImVec2 frame_padding = spacing_to_imgui_padding(props.padding);
    const float natural_width = props.width.mode == SizeMode::Auto ? 52.0f : 0.0f;
    const float natural_height = props.height.mode == SizeMode::Auto ? 30.0f : 0.0f;
    const Size width = props.align == Align::Stretch && props.width.mode == SizeMode::Auto
        ? Size::fill()
        : props.width;
    ImVec2 size = resolve_widget_size(width, props.height, avail, natural_width, natural_height);
    if (size.x <= 0.0f) {
        size.x = natural_width;
    }
    if (size.y <= 0.0f) {
        size.y = natural_height;
    }

    position_widget_cursor(size, props.align, props.justify);

    bool pressed = false;
    WithStyle([&](StyleScope& style) {
        style.var(ImGuiStyleVar_FrameRounding, props.rounding);
        style.var(ImGuiStyleVar_FramePadding, frame_padding);
        style.var(ImGuiStyleVar_FrameBorderSize, 0.0f);
        style.color(ImGuiCol_Button, props.button_color);
        style.color(ImGuiCol_ButtonHovered, props.hover_color);
        style.color(ImGuiCol_ButtonActive, props.active_color);
        pressed = ImGui::ImageButton(id, props.texture_id, size, ImVec2(0, 0), ImVec2(1, 1), props.border_color, props.tint_color);
    });

    advance_frame_after_item();
    return pressed;
}

bool input_text(const InputTextProps& props) {
    if (!props.buffer || props.buffer_size == 0) {
        return false;
    }

    const ImVec2 avail = current_available_size();
    const ImVec2 frame_padding = (spacing_total_x(props.padding) > 0.0f || spacing_total_y(props.padding) > 0.0f)
        ? spacing_to_imgui_padding(props.padding)
        : ImGui::GetStyle().FramePadding;
    const Size width = props.align == Align::Stretch && props.width.mode == SizeMode::Auto
        ? Size::fill()
        : props.width;
    const float natural_height = std::max(ImGui::GetTextLineHeight() + frame_padding.y * 2.0f, ImGui::GetFrameHeight());
    const ImVec2 size = resolve_widget_size(width, props.height, avail, avail.x, natural_height);
    position_widget_cursor(size, props.align, props.justify);

    if (size.x > 0.0f) {
        ImGui::SetNextItemWidth(size.x);
    }

    bool changed = false;
    WithStyle([&](StyleScope& style) {
        style.var(ImGuiStyleVar_FrameRounding, props.rounding);
        style.var(ImGuiStyleVar_FramePadding, frame_padding);
        if (props.bg_color.w > 0.0f) {
            style.color(ImGuiCol_FrameBg, props.bg_color);
        }
        if (props.border_color.w > 0.0f) {
            style.color(ImGuiCol_Border, props.border_color);
        }
        if (props.text_color.w > 0.0f) {
            style.color(ImGuiCol_Text, props.text_color);
        }

        if (props.hint && props.hint[0] != '\0') {
            changed = ImGui::InputTextWithHint(
                props.label,
                props.hint,
                props.buffer,
                props.buffer_size,
                props.flags
            );
        } else {
            changed = ImGui::InputText(props.label, props.buffer, props.buffer_size, props.flags);
        }
    });

    advance_frame_after_item();
    return changed;
}

bool select(const SelectProps& props) {
    if (!props.selected_index || !props.options || props.option_count <= 0) {
        return false;
    }

    const ImVec2 avail = current_available_size();
    const ImVec2 frame_padding = (spacing_total_x(props.padding) > 0.0f || spacing_total_y(props.padding) > 0.0f)
        ? spacing_to_imgui_padding(props.padding)
        : ImGui::GetStyle().FramePadding;
    const Size width = props.align == Align::Stretch && props.width.mode == SizeMode::Auto
        ? Size::fill()
        : props.width;
    const float natural_height = std::max(ImGui::GetTextLineHeight() + frame_padding.y * 2.0f, ImGui::GetFrameHeight());
    const ImVec2 size = resolve_widget_size(width, props.height, avail, avail.x, natural_height);

    position_widget_cursor(size, props.align, props.justify);

    if (size.x > 0.0f) {
        ImGui::SetNextItemWidth(size.x);
    }

    const int safe_index = std::clamp(*props.selected_index, 0, props.option_count - 1);
    const char* preview = props.options[safe_index];
    bool changed = false;
    const ImVec2 popup_item_padding(frame_padding.x + 2.0f, frame_padding.y + 4.0f);

    WithStyle([&](StyleScope& style) {
        style.var(ImGuiStyleVar_FrameRounding, props.rounding);
        style.var(ImGuiStyleVar_FramePadding, frame_padding);
        if (props.bg_color.w > 0.0f) {
            style.color(ImGuiCol_FrameBg, props.bg_color);
        }
        if (props.border_color.w > 0.0f) {
            style.color(ImGuiCol_Border, props.border_color);
        }
        if (props.text_color.w > 0.0f) {
            style.color(ImGuiCol_Text, props.text_color);
        }

        if (ImGui::BeginCombo(props.label, preview)) {
            WithStyle([&](StyleScope& popup_style) {
                popup_style.var(ImGuiStyleVar_FramePadding, popup_item_padding);
            for (int i = 0; i < props.option_count; ++i) {
                const bool selected = *props.selected_index == i;
                if (ImGui::Selectable(props.options[i], selected)) {
                    *props.selected_index = i;
                    changed = true;
                }
                if (selected) {
                    ImGui::SetItemDefaultFocus();
                }
            }
            });
            ImGui::EndCombo();
        }
    });

    advance_frame_after_item();
    return changed;
}

} // namespace misty::UI
