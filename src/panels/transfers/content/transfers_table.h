#pragma once

#include <vector>

#include "core/file_transfer/file_transfer.h"

namespace misty::panel {

void render_transfers_table(const std::vector<core::FileTransferRecord>& rows,
                            float height);

}  // namespace misty::panel
