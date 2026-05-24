#pragma once

#include <string>
#include <vector>

#include "panels/providers/state/providers_state.h"

namespace misty::panel {
    bool is_onedrive_provider_type(const std::string& value);
    bool status_needs_onedrive_drive_repair(const ProviderRemoteStatus* status);
    std::vector<ProviderOption> onedrive_drive_repair_options();
    std::vector<ProviderOption> onedrive_visible_drive_repair_options(const ActiveProviderConfigSession& session);
    void show_onedrive_drive_repair_dialog(ProvidersState& state);
}
