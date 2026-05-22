#pragma once

#include "panels/settings/settings_state.h"

namespace misty::panel {

bool sync_tab(SettingsState& state);
void sync_content(SettingsState& state);

} //namespace misty::panel
