#pragma once

#include "panels/panel/panel.h"

#include "core/ui/state_registry.h"
#include "core/threading/worker_pool.h"
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>
#include <unordered_map>
#include <unordered_set>

#include "panels/file_explorer/state/file_sidebar_state.h"

#include "panels/providers/remote/remote_state.h"
#include "panels/devices/device_state.h"
#include "panels/devices/device_watcher.h"
#include "panels/file_explorer/state/clipboard_state.h"
#include "panels/file_explorer/state/file_explorer_state.h"

namespace misty::panel {
    /**
     * @brief Sidebar for local shortcuts, providers, devices, creation, and uploads.
     */
    class FileSidebarPanel : public Panel {
    public:
        struct WorkspaceEntry {
            std::int16_t idx = -1;
            std::string title;
            bool active = false;
        };

        /**
         * @brief Creates a sidebar panel bound to registry state and shared workers.
         */
        FileSidebarPanel(core::StateRegistry& registry, core::WorkerPool& worker_pool);
        /**
         * @brief Renders all sidebar sections and modals.
         */
        void render();

        /**
         * @brief Sets the callback that provides the root path for mounted remotes.
         */
        void set_mount_path_provider(std::function<std::string()> provider) {
            mount_path_provider_ = provider;
        }

        /**
         * @brief Sets the callback that identifies the active file explorer state.
         */
        void set_active_explorer_state_key_provider(std::function<std::string()> provider) {
            active_explorer_state_key_provider_ = provider;
        }

        /**
         * @brief Sets the callback used when files are dropped onto sidebar destinations.
         */
        void set_file_drop_handler(
            std::function<void(const std::string& source_state_key,
                               const std::string& dest_path,
                               ClipboardOp op)> handler) {
            file_drop_handler_ = std::move(handler);
        }

        /**
         * @brief Sets the callback used when a sidebar item requests navigation.
         */
        void set_navigation_handler(std::function<void(const std::string& path)> handler) {
            navigation_handler_ = std::move(handler);
        }

        void set_workspace_entries_provider(std::function<std::vector<WorkspaceEntry>()> provider) {
            workspace_entries_provider_ = std::move(provider);
        }

        void set_workspace_select_handler(std::function<void(std::int16_t)> handler) {
            workspace_select_handler_ = std::move(handler);
        }

        void set_workspace_create_handler(std::function<void(std::string)> handler) {
            workspace_create_handler_ = std::move(handler);
        }

        void set_workspace_rename_handler(std::function<void(std::int16_t, std::string)> handler) {
            workspace_rename_handler_ = std::move(handler);
        }

        void set_workspace_delete_handler(std::function<void(std::int16_t)> handler) {
            workspace_delete_handler_ = std::move(handler);
        }

        bool workspace_dropdown_open() const {
            return workspace_dropdown_open_;
        }

    private:
        static float content_width_for(float width, float padding);
        /**
         * @brief Renders the top-level workspace switcher.
         */
        void show_workspace_dropdown(float width, float padding);
        void show_workspace_name_modal();
        void show_workspace_delete_modal();
        /**
         * @brief Starts provider list loading if the sidebar cache is empty.
         */
        void ensure_provider_entries_loaded(FileSidebarState& state);
        void refresh_provider_entries(FileSidebarState& state);
        void refresh_provider_capacity(FileSidebarState& state);
        /**
         * @brief Renders connected provider shortcuts.
         */
        void show_providers_section(FileSidebarState& state, float width, float padding);
        /**
         * @brief Renders local folder shortcuts.
         */
        void show_local_section(float width, float padding);
        /**
         * @brief Renders mounted devices and device actions.
         */
        void show_devices_section(float width, float padding);
        /**
         * @brief Renders the create/upload action section.
         */
        void show_create_new(FileSidebarState& state, float width, float padding);
        /**
         * @brief Renders the chooser modal for create/upload actions.
         */
        void show_chooser_modal(FileSidebarState& state);
        /**
         * @brief Renders the new file/folder modal.
         */
        void show_create_entry_modal(FileSidebarState& state);
        /**
         * @brief Renders the file uploader modal.
         */
        void show_uploader_modal(FileSidebarState& state);
        /**
         * @brief Renders quick access virtual-folder shortcuts.
         */
        void show_quick_access(float width, float padding);
        /**
         * @brief Renders the custom device path modal.
         */
        void show_add_device_modal();
        /**
         * @brief Renders the mounted-device rename modal.
         */
        void show_device_rename_modal();

    private:
        core::StateRegistry& registry_;
        core::WorkerPool& worker_pool_;
        std::function<std::string()> mount_path_provider_;
        std::function<std::string()> active_explorer_state_key_provider_;
        std::function<void(const std::string&, const std::string&, ClipboardOp)> file_drop_handler_;
        std::function<void(const std::string&)> navigation_handler_;
        std::function<std::vector<WorkspaceEntry>()> workspace_entries_provider_;
        std::function<void(std::int16_t)> workspace_select_handler_;
        std::function<void(std::string)> workspace_create_handler_;
        std::function<void(std::int16_t, std::string)> workspace_rename_handler_;
        std::function<void(std::int16_t)> workspace_delete_handler_;

        // Mounted device cache — refreshed on OS mount/unmount events or manual refresh
        std::vector<MountedDevice> cached_devices_;
        DeviceWatcher device_watcher_;

        // Sidebar section collapse state
        bool local_collapsed_        = false;
        bool providers_collapsed_    = false;
        bool devices_collapsed_      = false;
        bool quick_access_collapsed_ = false;

        // Device customization
        std::unordered_map<std::string, std::string> device_name_overrides_;
        std::unordered_set<std::string>              hidden_device_paths_;
        std::vector<std::string>                     custom_mount_paths_;

        // Device modal state
        bool        show_add_device_modal_ = false;
        std::string device_renaming_path_;
        char        add_device_path_buf_[512] = {};
        char        device_rename_buf_[256]   = {};

        bool show_workspace_name_modal_ = false;
        bool workspace_name_modal_is_rename_ = false;
        std::int16_t workspace_name_modal_idx_ = -1;
        char workspace_name_buf_[256] = {};
        bool show_workspace_delete_modal_ = false;
        std::int16_t workspace_delete_modal_idx_ = -1;
        std::string workspace_delete_modal_name_;
        bool workspace_dropdown_open_ = false;
    };

}
