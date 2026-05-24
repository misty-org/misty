#pragma once

#include "panels/panel/panel.h"
#include "core/ui/state_registry.h"
#include "auth_login_state.h"
#include "core/ui/svg_loader.h"

using namespace misty::core;

namespace misty::panel {
    class AuthLoginPanel : public panel::Panel {
    public:
        AuthLoginPanel(StateRegistry& registry);
        ~AuthLoginPanel() override = default;
        void render() override;

    private:
        void show_header();
        void show_form_fields(AuthLoginState& state);
        void show_login_button(AuthLoginState& state);
        void show_signup_link();
    private:
        StateRegistry& registry_;
    };
}
