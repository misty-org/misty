#pragma once

#include <vector>

#include "core/threading/worker_pool.h"
#include "core/file_transfer/file_transfer.h"
#include "core/ui/state_registry.h"

namespace misty::panel {

void render_transfers_table(core::StateRegistry& registry,
                            core::WorkerPool& worker_pool,
                            const std::vector<core::FileTransferRecord>& rows,
                            float height);

}  // namespace misty::panel
