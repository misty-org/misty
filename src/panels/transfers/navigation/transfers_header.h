#pragma once

#include "panels/transfers/content/transfers_content_util.h"

namespace misty::panel {

void render_transfers_header(const transfers_content::TransferCounts& counts, bool& clear_finished);

}  // namespace misty::panel
