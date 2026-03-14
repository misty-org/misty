#pragma once

#include "core/ui/state_registry.h"
#include "panels/providers/state/providers_state.h"

namespace misty::panel {

void render_connected_accounts_table(ProvidersState& state,
                                     float max_list_height);

}  // namespace misty::panel
