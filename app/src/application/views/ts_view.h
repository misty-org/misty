#pragma once

#include <memory>

#include "views/app_view.h"
#include "panels/setup/ts_panel.h"
#include "core/ui_registry.h"

using namespace misty::core;
using namespace misty::panel;

namespace misty::view {
    class TSView : public AppView {
    public:
        TSView(UIRegistry& ui_registry);
        ~TSView() override = default;

        void render() override;
        ViewID get_view_id() override;

    private:
        void init_panels();
    private:
        UIRegistry& ui_registry_;

        std::shared_ptr<TSPanel> ts_panel_;
    };
}
