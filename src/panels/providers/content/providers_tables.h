#pragma once

#include "core/ui/state_registry.h"
#include "panels/providers/state/providers_state.h"

namespace misty::panel {

void render_providers_workspace(core::StateRegistry& registry,
                                ProvidersState& state,
                                float max_height);

}  // namespace misty::panel
