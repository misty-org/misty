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
        void render_entry(const ActivityEntry& entry);
        std::string format_timestamp(std::chrono::system_clock::time_point tp);

        core::StateRegistry& registry_;

        static constexpr float POPUP_W = 400.0f;
        static constexpr float POPUP_H = 480.0f;
    };

}
