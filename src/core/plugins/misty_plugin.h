#pragma once

#include "misty_plugin_c_api.h"

namespace misty {

using CommandInvokeFn = MistyCommandInvokeFn;
using PanelRenderFn = MistyPanelRenderFn;
using CommandRegistration = MistyCommandReg;
using PanelRegistration = MistyPanelReg;

} // namespace misty
