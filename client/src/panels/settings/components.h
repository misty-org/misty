#pragma once

#include <functional>

namespace misty::panel {

void settings_section(
    const char* id,
    const char* title,
    const std::function<void()>& content);

void settings_row(
    const char* id,
    const std::function<void()>& start_content,
    const std::function<void()>& end_content,
    bool show_divider = true);

} // namespace misty::panel
