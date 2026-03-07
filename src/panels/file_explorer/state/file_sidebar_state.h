#pragma once

#include "core/ui/ui_registry.h"
#include <string>
#include <vector>
#include <mutex>

namespace misty::panel {

    /**
     * @brief Lightweight provider entry used by the file explorer sidebar.
     */
    struct SidebarProviderEntry {
        std::string provider_folder;
        std::string remote_name;
        std::string label;
    };

    /**
     * @brief UI and worker state owned by the file explorer sidebar.
     */
    struct FileSidebarState : public core::UIState {
        // Input Buffers: For "New File" or "New Folder" modals
        char name_buffer[256] = "";

        bool show_chooser_modal = false;
        bool show_create_entry_modal = false;
        bool show_uploader_modal = false;
        bool create_is_dir = false;

        // Action Feedback
        bool is_performing_action = false;
        std::string status_message = "";

        // Lightweight provider navigation state. This is intentionally separate
        // from ProvidersState so the file sidebar can hydrate without opening
        // or initializing the full Providers view.
        bool providers_loaded = false;
        bool providers_loading = false;
        std::string providers_error;
        std::vector<SidebarProviderEntry> provider_entries;
        std::mutex providers_mutex;
    };

    /**
     * @brief Creates an empty file at the requested path.
     */
    void create_file(const std::string& file_path);
}
