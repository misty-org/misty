#pragma once

#include "core/file_transfer/file_transfer.h"
#include "panels/transfers/content/transfers_content_util.h"
#include "panels/transfers/state/transfers_state.h"

namespace misty::panel {

enum class TransfersToolbarAction {
    None,
    ToggleFilters,
    DeleteSelected,
    DeleteAll,
};

TransfersToolbarAction render_transfers_toolbar(TransfersState& state,
                                                const transfers_content::TransferCounts& counts);

}  // namespace misty::panel
