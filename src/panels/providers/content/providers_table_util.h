#pragma once

#include <string>

#include "panels/providers/state/providers_state.h"

namespace misty::panel::providers_content {

std::string provider_secondary_label(const ProviderCard& card);
const char* provider_status_text(const ProviderCard& card);
std::string provider_details_text(const ProviderCard& card);

}  // namespace misty::panel::providers_content
