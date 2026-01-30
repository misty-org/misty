#pragma once

#include <memory>

#include "views/app_view.h"
#include "panels/auth/auth_login_panel.h"
#include "core/ui_registry.h"

using namespace misty::core;
using namespace misty::panel;

namespace misty::view {
    class LoginView : public AppView {
    public:
        LoginView(UIRegistry& ui_registry);
        ~LoginView() override = default;

        void render() override;
        ViewID get_view_id() override;

    private:
        void init_panels();
    private:
        UIRegistry& ui_registry_;

        std::shared_ptr<AuthLoginPanel> auth_login_panel_;
    };
}
