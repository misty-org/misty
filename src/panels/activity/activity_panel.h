#pragma once

#include "core/ui/state_registry.h"
#include "panels/panel/panel.h"
#include "activity_state.h"

namespace misty::panel {

    class ActivityPanel : public Panel {
    public:
        ActivityPanel(core::StateRegistry& registry);
        ~ActivityPanel() override = default;

        void render() override;

    private:
        enum class Filter {
            All,
            Unread,
            Transfers,
        };

        void render_entry(const ActivityEntry& entry);
        void render_empty_state();
        std::string format_timestamp(std::chrono::system_clock::time_point tp);

        core::StateRegistry& registry_;
        Filter filter_ = Filter::All;

        static constexpr float POPUP_W = 420.0f;
        static constexpr float POPUP_H = 440.0f;
    };

}
