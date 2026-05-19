#pragma once

#include "panels/panel/panel.h"

#include "core/ui/ui_registry.h"
#include "core/threading/worker_pool.h"
#include <functional>
#include <memory>
#include <vector>
#include <unordered_map>
#include <unordered_set>

#include "panels/file_explorer/state/file_sidebar_state.h"

#include "panels/providers/remote/remote_state.h"
#include "panels/devices/device_state.h"
#include "panels/devices/device_watcher.h"
#include "panels/file_explorer/state/file_explorer_state.h"

namespace misty::panel {
    class FileSidebarPanel : public Panel {
    public:
        FileSidebarPanel(core::UIRegistry& registry, core::WorkerPool& worker_pool);
        void render();

        void set_mount_path_provider(std::function<std::string()> provider) {
            mount_path_provider_ = provider;
        }

        void set_active_explorer_state_key_provider(std::function<std::string()> provider) {
            active_explorer_state_key_provider_ = provider;
        }

        void set_file_drop_handler(
            std::function<void(const std::string& source_state_key,
                               const std::string& dest_path,
                               ClipboardOp op)> handler) {
            file_drop_handler_ = std::move(handler);
        }

    private:
        void ensure_provider_entries_loaded(FileSidebarState& state);
        void show_providers_section(FileSidebarState& state, float width, float padding);
        void show_local_section(float width, float padding);
        void show_devices_section(float width, float padding);
        void show_create_new(FileSidebarState& state, float width, float padding);
        void show_chooser_modal(FileSidebarState& state);
        void show_create_entry_modal(FileSidebarState& state);
        void show_uploader_modal(FileSidebarState& state);
        void show_upload_progress_modal(FileSidebarState& state);
        void start_next_upload(FileSidebarState& state);
        void show_quick_access(float width, float padding);
        void show_add_device_modal();
        void show_device_rename_modal();

    private:
        core::UIRegistry& registry_;
        core::WorkerPool& worker_pool_;
        std::function<std::string()> mount_path_provider_;
        std::function<std::string()> active_explorer_state_key_provider_;
        std::function<void(const std::string&, const std::string&, ClipboardOp)> file_drop_handler_;

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
    };

}
