#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <utility>
#include <vector>

#include "core/ui/state_registry.h"
#include "imgui.h"

namespace misty::panel {

inline constexpr const char* kContextMenuStateKey = "ContextMenu";

struct ContextMenuEntry {
    enum class Kind {
        Action,
        Separator,
    };

    Kind kind = Kind::Action;
    std::string id;
    std::string label;
    std::string secondary_label;
    bool disabled = false;
    bool destructive = false;
    std::function<void()> on_select;

    static ContextMenuEntry separator();
};

struct ContextMenuRequest {
    std::string source_key;
    ImVec2 anchor_pos = ImVec2(0.0f, 0.0f);
    ImGuiID viewport_id = 0;
    std::vector<ContextMenuEntry> entries;
};

struct ContextMenuState : public core::StateEntry {
    bool is_open = false;
    ImVec2 anchor_pos = ImVec2(0.0f, 0.0f);
    ImVec2 menu_size = ImVec2(220.0f, 0.0f);
    ImGuiID viewport_id = 0;
    std::string source_key;
    std::vector<ContextMenuEntry> entries;
    std::int32_t opened_frame = -1;
    std::uint64_t request_serial = 0;

    void open(ContextMenuRequest request);

    void close();
};

} // namespace misty::panel
