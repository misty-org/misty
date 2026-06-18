#pragma once

#include <optional>
#include <string>
#include <vector>

#include "panels/providers/state/providers_state.h"

namespace misty::panel {
    struct ProviderDialogText {
        std::string title;
        std::string intro;
        std::string primary_button_label;
    };

    const ProviderWorkflow* selected_provider_workflow(
        const std::vector<ProviderWorkflow>& workflows,
        const std::string& provider_type
    );

    std::string provider_parameter_value(const ActiveProviderConfigSession& session, const std::string& key);
    std::string provider_choice_label(const ProviderChoice& choice);
    std::string provider_preview_label(const ProviderOption& option, const std::string& value);
    ProviderDialogText provider_dialog_text(const ActiveProviderConfigSession& session);

    void render_provider_option_editor(
        ProvidersState& state,
        const ProviderOption& option,
        const ActiveProviderConfigSession& session
    );

    void show_provider_placeholder_popup(
        ProvidersState& state,
        bool open,
        const char* popup_name,
        const char* title
    );

    void show_provider_rename_popup(ProvidersState& state);
    void show_provider_details_popup(ProvidersState& state);
    void show_provider_disconnect_popup(ProvidersState& state, bool open);
}
