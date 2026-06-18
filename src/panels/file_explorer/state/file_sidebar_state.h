#pragma once

#include "core/ui/state_registry.h"
#include <chrono>
#include <string>
#include <vector>
#include <mutex>
#include <unordered_set>

namespace misty::panel {

    /**
     * @brief Lightweight provider entry used by the file explorer sidebar.
     */
    struct SidebarProviderEntry {
        std::string provider_folder;
        std::string remote_name;
        std::string label;
        std::uint64_t total_bytes = 0;
        std::uint64_t free_bytes = 0;
        std::uint64_t used_bytes = 0;
        bool capacity_known = false;
    };

    /**
     * @brief UI and worker state owned by the file explorer sidebar.
     */
    struct FileSidebarState : public core::StateEntry {
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
        bool providers_capacity_loaded = false;
        bool providers_capacity_loading = false;
        std::chrono::steady_clock::time_point providers_last_refresh_at{};
        std::string providers_error;
        std::vector<SidebarProviderEntry> provider_entries;
        std::mutex providers_mutex;

        // Lightweight quick access customization.
        std::vector<std::string> pinned_quick_access_paths;
        std::unordered_set<std::string> pinned_quick_access_seen;
        bool preferences_loaded = false;
    };

    /**
     * @brief Creates an empty file at the requested path.
     */
    void create_file(const std::string& file_path);

    /**
     * @brief Returns a stable normalized key for pinned quick access paths.
     */
    std::string normalize_quick_access_pin_path(const std::string& path);
    /**
     * @brief Loads persisted quick access pins once.
     */
    void load_sidebar_preferences(FileSidebarState& state);
    /**
     * @brief Saves persisted quick access pins.
     */
    void save_sidebar_preferences(const FileSidebarState& state);
    /**
     * @brief Pins a directory into Quick access.
     */
    bool pin_quick_access_path(FileSidebarState& state, const std::string& path);
    /**
     * @brief Removes a directory from Quick access pins.
     */
    bool unpin_quick_access_path(FileSidebarState& state, const std::string& path);
}
