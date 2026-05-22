#pragma once

#include <string>
#include <vector>

#include "core/ui/ui_registry.h"
#include "panels/file_explorer/state/file_listings_state.h"

namespace misty::panel {

/**
 * @brief Clipboard operation type for copy/cut workflows.
 */
enum class ClipboardOp { NONE, COPY, CUT };

/**
 * @brief Shared clipboard state for all file-explorer panes and tabs.
 */
struct ClipboardState : public core::UIState {
    ClipboardOp op = ClipboardOp::NONE;
    std::vector<std::string> paths;
    std::vector<FileItem> items;

    /**
     * @brief Returns true when a copy or cut payload is available.
     */
    bool has_content() const;

    /**
     * @brief Clears all clipboard paths, items, and pending operation state.
     */
    void clear();
};

}  // namespace misty::panel
