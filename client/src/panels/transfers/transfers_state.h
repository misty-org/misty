#pragma once

#include "core/file_transfer/file_transfer.h"
#include "core/ui/ui_registry.h"

namespace misty::panel {

inline constexpr const char* kTransfersStateKey = "Transfers";

class TransfersState : public core::UIState {
public:
    void set_filter(core::FileTransferFilter filter) { filter_ = filter; }
    core::FileTransferFilter filter() const { return filter_; }

private:
    core::FileTransferFilter filter_ = core::FileTransferFilter::Active;
};

}  // namespace misty::panel
