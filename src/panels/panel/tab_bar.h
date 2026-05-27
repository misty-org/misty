#pragma once

#include <string>
#include <vector>

namespace misty::panel {
    inline constexpr float kTabBarHeight = 36.0f;

    struct TabBarItem {
        std::string id;
        std::string title;
        bool active = false;
        bool closable = false;
    };

    struct TabBarResult {
        int pressed_index = -1;
        int close_index = -1;
        bool plus_pressed = false;
    };

    TabBarResult render_tab_bar(const std::vector<TabBarItem>& items, bool show_plus = true);
}
