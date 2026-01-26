#pragma once

#include <memory>

#include "views/app_view.h"
#include "panels/services/services_panel.h"
#include "panels/navbar/navbar_panel.h"
#include "core/ui_registry.h"

namespace minidfs::view {
    class ServicesView : public AppView {
    public:
        ServicesView(UIRegistry& ui_registry);
        ~ServicesView() override = default;

        void render() override;
        ViewID get_view_id() override;

    private:
        void init_panels();

    private:
        UIRegistry& ui_registry_;
        std::shared_ptr<panel::NavbarPanel> navbar_panel_;
        std::shared_ptr<panel::ServicesPanel> services_panel_;
    };
}
