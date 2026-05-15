#pragma once

#include "core/file_master/file_master_types.h"
#include "core/ui/ui_registry.h"

namespace misty::panel {

inline constexpr const char* kExplorerTransferUiStateKey = "ExplorerTransfers";

class ExplorerTransferUiState : public core::UIState {
public:
    void open() { is_open_ = true; }
    void close() { is_open_ = false; }
    void toggle() { is_open_ = !is_open_; }

    bool is_open() const { return is_open_; }

    void set_filter(core::FileTransferFilter filter) { filter_ = filter; }
    core::FileTransferFilter filter() const { return filter_; }

private:
    bool is_open_ = false;
    core::FileTransferFilter filter_ = core::FileTransferFilter::Active;
};

}  // namespace misty::panel
