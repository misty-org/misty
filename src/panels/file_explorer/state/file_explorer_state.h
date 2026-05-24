#pragma once

#include <cstring>
#include <mutex>
#include <stack>
#include <string>
#include <unordered_set>

#include "core/ui/state_registry.h"

namespace misty::panel {

/**
 * @brief Per-pane state for file explorer navigation only.
 */
struct FileExplorerState : public core::StateEntry {
    /**
     * @brief Virtual path for the Recent listing.
     */
    static constexpr const char* VIRTUAL_PATH_RECENT = "misty://recent";

    /**
     * @brief Virtual path for the Starred listing.
     */
    static constexpr const char* VIRTUAL_PATH_STARRED = "misty://starred";

    /**
     * @brief Virtual path for the Trash listing.
     */
    static constexpr const char* VIRTUAL_PATH_TRASH = "misty://trash";

    /**
     * @brief Initializes fixed-size UI buffers to empty strings.
     */
    FileExplorerState();

    char current_path[512] = "";
    char search_path[512] = "";
    std::stack<std::string> back_history;
    std::stack<std::string> forward_history;
    std::unordered_set<std::string> selected_files;
    std::mutex mu;

    /**
     * @brief Clears all pane-owned navigation state before registry release.
     */
    void clear_state();
};

}  // namespace misty::panel
