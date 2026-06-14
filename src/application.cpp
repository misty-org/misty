#include "application.h"
#include "core/commands/command_manager.h"
#include "core/clipboard/clipboard_cache.h"
#include "core/clipboard/native_clipboard_factory.h"
#include "core/manager/plugin_manager.h"
#include "core/manager/proxy_manager.h"
#include "core/manager/env_manager.h"
#include "core/manager/font_manager.h"
#include "core/file_transfer/file_transfer.h"
#include "views/files_view.h"
#include "views/providers_view.h"
#include "views/dock_view.h"
#include "views/transfers_view.h"
#include "views/activity_view.h"
#include "views/settings_view.h"
#include "panels/file_explorer/state/file_explorer_state.h"
#include "panels/file_explorer/state/library_state.h"
#include "panels/file_explorer/operations/file_master_operations.h"
#include "panels/file_explorer/operations/file_operation_jobs.h"
#include "panels/file_explorer/operations/operation_queue_state.h"
#include "panels/clipboard/clipboard_state.h"
#include "panels/navbar/navbar_state.h"
#include "panels/settings/settings_state.h"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>

namespace {
std::string view_name(misty::view::ViewID id) {
    using misty::view::ViewID;
    switch (id) {
        case ViewID::Files: return "Files";
        case ViewID::Settings: return "Settings";
        case ViewID::Workspace: return "Workspace";
        case ViewID::Activity: return "Activity";
        case ViewID::Providers: return "Providers";
        case ViewID::Plugins: return "Plugins";
        case ViewID::Dock: return "Plugins";
        case ViewID::Transfers: return "Transfers";
        case ViewID::Default: return "Default";
    }
    return "Unknown";
}

void append_startup_log(const std::string& line) {
    const char* home = std::getenv("HOME");
    if (!home || *home == '\0') return;
    namespace fs = std::filesystem;
    const fs::path path = fs::path(home) / ".misty" / "logs" / "misty.log";
    std::error_code ec;
    fs::create_directories(path.parent_path(), ec);
    std::ofstream f(path, std::ios::app);
    if (!f.is_open()) return;
    f << line << "\n";
}

} // namespace


namespace misty {
    core::FramePacer& Application::frame_pacer() {
        return frame_pacer_;
    }

    const core::FramePacer& Application::frame_pacer() const {
        return frame_pacer_;
    }

    void Application::run() {
        auto& transfer_state = state_registry_.get_state<core::FileTransfer>("FileMasterTransfers");
        try {
            append_startup_log("startup: begin");
            init_platform();
            frame_pacer_.activate();
            append_startup_log("startup: platform initialized");
            core::EnvManager::get().reload();
            append_startup_log("startup: env reloaded");
            init_clipboard();
            append_startup_log("startup: clipboard initialized");
            init_client();
            append_startup_log("startup: init_client ok");
            core::PluginManager::get().set_state_registry(&state_registry_);
            append_startup_log("startup: plugin host ui registry set");
            core::PluginManager::get().discover_and_load();
            append_startup_log("startup: plugins discovered");
            core::CommandManager::get().load();
            append_startup_log("startup: commands loaded");

            init_views();
            append_startup_log("startup: views initialized");
            state_registry_.get_state<panel::SettingsState>("Settings").ensure_app_settings_loaded();

            
        } catch (const std::exception& e) {
            std::cout << "Exception caught in Application::run: " << e.what() << std::endl;
            append_startup_log(std::string("startup: exception: ") + e.what());
            panel::shutdown_file_transfer_worker_pool();
            if (clipboard_service_) {
                clipboard_service_->stop();
            }
            if (proxy_clipboard_client_) {
                proxy_clipboard_client_->stop();
            }
            worker_pool_.shutdown();
            view::clear_views();
            cleanup();
            return;
        }
        std::cout << "Entering main loop." << std::endl;
        bool transfer_hydration_applied = false;
        bool transfer_hydration_started = false;
        append_startup_log("startup: entering main loop");
        while (is_running()) {
            core::FontManager::get().apply_pending_reload();
            prepare_frame();

            if (transfer_hydration_started && !transfer_hydration_applied) {
                std::string hydration_error;
                if (transfer_state.poll_background_hydration(&hydration_error)) {
                    if (!hydration_error.empty()) {
                        append_startup_log("startup: transfer persistence hydration failed: " + hydration_error);
                    } else {
                        panel::rehydrate_persisted_undo_records(state_registry_);
                        panel::rehydrate_persisted_retry_operations(state_registry_);
                        panel::seed_file_operation_job_ids(state_registry_);
                        append_startup_log("startup: transfer persistence hydrated");
                    }
                    transfer_hydration_applied = true;
                }
            }

            if (core::CommandManager::get().matches("app.toggle_transfers")) {
                state_registry_.get_state<panel::NavbarState>("Navbar").selected_item = view::ViewID::Transfers;
                view::switch_view(view::ViewID::Transfers);
            }
            if (core::CommandManager::get().matches("app.toggle_plugin_launcher")) {
                core::PluginManager::get().toggle_launcher();
            }
            if (clipboard_service_ && core::CommandManager::get().matches("clipboard.publish_shared")) {
                (void)clipboard_service_->publish_current_to_shared();
            }
            if (clipboard_service_ && core::CommandManager::get().matches("clipboard.apply_shared")) {
                (void)clipboard_service_->apply_shared_to_system_async();
            }

            view::render_current_view();
            clipboard_transfer_panel_.render();
            errors_panel_.render();
            core::PluginManager::get().process_shortcuts();
            core::PluginManager::get().render_open_panels();
            core::PluginManager::get().render_launcher_overlay();
            core::PluginManager::get().render_active_preview_scene();
            auto& settings_state = state_registry_.get_state<panel::SettingsState>("Settings");
            if (settings_state.frame_pacing_overlay_enabled) {
                frame_pacer_.render_debug_overlay();
            }
            render_frame();
            if (!transfer_hydration_started) {
                transfer_state.start_background_hydration(nullptr);
                transfer_hydration_started = true;
                append_startup_log("startup: transfer persistence hydration started");
            }
        }
        persist_file_explorer_state();

        core::PluginManager::get().shutdown();
        if (clipboard_service_) {
            clipboard_service_->stop();
        }
        if (proxy_clipboard_client_) {
            proxy_clipboard_client_->stop();
        }
        panel::shutdown_file_transfer_worker_pool();
        worker_pool_.shutdown();
        view::clear_views();
        cleanup();
    }

    void Application::on_focus_lost() {
    }

    void Application::persist_file_explorer_state() {
        std::string explorer_state_key = "Files";
        if (auto* current_view = view::ViewRegistry::get().get_current_view()) {
            explorer_state_key = current_view->active_explorer_state_key();
        }

        if (!state_registry_.has_state(explorer_state_key)) {
            return;
        }

        auto& explorer = state_registry_.get_state<panel::FileExplorerState>(explorer_state_key);
        auto& library = state_registry_.get_state<panel::LibraryState>(panel::kLibraryStateKey);
        {
            std::lock_guard<std::recursive_mutex> explorer_lock(explorer.mu);
            std::lock_guard<std::mutex> library_lock(library.mu);
            if (explorer.current_path[0] != '\0') {
                library.last_opened_path = explorer.current_path;
                library.dirty = true;
            }
        }

        if (library.dirty.load(std::memory_order_relaxed)) {
            library.save();
        }
    }

    void Application::init_client() {
        client_.reset();
    }

    void Application::init_clipboard() {
        core::ClipboardCache().cleanup_expired();
        proxy_clipboard_client_ = std::make_unique<core::ProxyClipboardClient>(
            "local",
            "This Misty");
        clipboard_service_ = std::make_unique<core::ClipboardService>(
            core::create_native_clipboard(),
            proxy_clipboard_client_.get());
        clipboard_service_->set_device_identity("local", "This Misty");
        clipboard_service_->set_on_change([this](const core::ClipboardPayload& payload) {
            auto& state = state_registry_.get_state<panel::ClipboardContextState>(
                panel::kClipboardContextStateKey);
            if (payload.origin == core::ClipboardOrigin::RemoteShared) {
                state.latest_shared = payload;
            } else {
                state.local_system = payload;
            }
        });
        if (!clipboard_service_->start()) {
            append_startup_log("startup: native clipboard watcher unavailable");
        }
        proxy_clipboard_client_->start([this](const core::ClipboardPayload& payload) {
            if (clipboard_service_) {
                clipboard_service_->accept_remote_payload(payload);
            }
        });
    }

    void Application::init_views() {
        view::register_view(view::ViewID::Files,
            std::make_unique<view::FilesView>(state_registry_, worker_pool_));
        view::register_view_factory(view::ViewID::Providers, [this]() {
            append_startup_log("startup: providers view instantiated");
            return std::make_unique<view::ProvidersView>(state_registry_, worker_pool_);
        });
        view::register_view_factory(view::ViewID::Dock, [this]() {
            append_startup_log("startup: plugins view instantiated");
            return std::make_unique<view::DockView>(state_registry_);
        });
        view::register_view_factory(view::ViewID::Transfers, [this]() {
            append_startup_log("startup: transfers view instantiated");
            return std::make_unique<view::TransfersView>(state_registry_, worker_pool_);
        });
        // ActivityView removed — Activity is now a modal panel in the navbar
        view::register_view_factory(view::ViewID::Settings, [this]() {
            append_startup_log("startup: settings view instantiated");
            return std::make_unique<view::SettingsView>(state_registry_);
        });

        view::switch_view(view::ViewID::Files);
        append_startup_log("startup: initial view set to " + view_name(view::ViewID::Files));
    }
};
