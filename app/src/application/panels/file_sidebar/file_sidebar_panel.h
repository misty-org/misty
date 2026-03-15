#pragma once

#include "panels/panel.h"

#include "core/ui/ui_registry.h"
#include "core/threading/worker_pool.h"
#include "dfs/client/misty_client.h"
#include <functional>
#include <vector>
#include <unordered_map>
#include <unordered_set>

#include "file_sidebar_state.h"

#include "panels/services/onedrive/onedrive_state.h"
#include "panels/services/gdrive/gdrive_state.h"
#include "panels/services/dropbox/dropbox_state.h"
#include "panels/services/icloud/icloud_state.h"
#include "panels/services/services_state.h"
#include "panels/devices/device_state.h"
#include "panels/devices/device_watcher.h"


namespace misty::panel {
    class FileSidebarPanel : public Panel {
    public:
        FileSidebarPanel(core::UIRegistry& registry, core::WorkerPool& worker_pool, std::shared_ptr<MistyClient> client);
        void render();

        void set_mount_path_provider(std::function<std::string()> provider) {
            mount_path_provider_ = provider;
        }

    private:
        void show_services_section(ServicesState& services_state, float width, float padding);
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
        std::shared_ptr<MistyClient> client_;
        std::function<std::string()> mount_path_provider_;

        // Mounted device cache — refreshed on OS mount/unmount events or manual refresh
        std::vector<MountedDevice> cached_devices_;
        DeviceWatcher device_watcher_;

        // Sidebar section collapse state
        bool local_collapsed_        = false;
        bool services_collapsed_     = false;
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

