#include "application.h"
#include "core/commands/command_manager.h"
#include "core/manager/plugin_manager.h"
#include "core/manager/proxy_manager.h"
#include "core/manager/session_manager.h"
#include "core/manager/env_manager.h"
#include "core/manager/font_manager.h"
#include "views/files_view.h"
#include "views/register_view.h"
#include "views/login_view.h"
#include "views/onboarding_view.h"
#include "views/services_view.h"
#include "views/extensions_view.h"
#include "views/vault_view.h"
#include "views/transfers_view.h"
#include "views/activity_view.h"
#include "views/settings_view.h"
#include "panels/file_explorer/state/file_explorer_state.h"
#include "panels/navbar/navbar_state.h"
#include "panels/onboarding/onboarding_state.h"
#include "panels/onboarding/boot_loader.h"
#include "panels/settings/settings_state.h"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>

namespace {
std::string view_name(misty::view::ViewID id) {
    using misty::view::ViewID;
    switch (id) {
        case ViewID::Auth: return "Auth";
        case ViewID::Login: return "Login";
        case ViewID::Onboarding: return "Onboarding";
        case ViewID::Files: return "Files";
        case ViewID::Settings: return "Settings";
        case ViewID::Workspace: return "Workspace";
        case ViewID::Activity: return "Activity";
        case ViewID::Services: return "Services";
        case ViewID::Extensions: return "Extensions";
        case ViewID::Vault: return "Vault";
        case ViewID::Transfers: return "Transfers";
        case ViewID::Default: return "Default";
    }
    return "Unknown";
}

void append_startup_log(const std::string& line) {
    const char* home = std::getenv("HOME");
    if (!home || *home == '\0') return;
    namespace fs = std::filesystem;
    const fs::path path = fs::path(home) / "misty" / ".cache" / "misty-client.log";
    std::error_code ec;
    fs::create_directories(path.parent_path(), ec);
    std::ofstream f(path, std::ios::app);
    if (!f.is_open()) return;
    f << line << "\n";
}

bool truthy_env(const char* name) {
    const char* value = std::getenv(name);
    if (!value || *value == '\0') return false;
    const std::string v(value);
    return v == "1" || v == "true" || v == "TRUE" || v == "yes" || v == "YES" || v == "on" || v == "ON";
}

bool should_run_boot_loader() {
#ifdef MISTY_DEBUG_BUILD
    return truthy_env("MISTY_BOOT_LOADER") || truthy_env("MISTY_RUN_BOOT_LOADER");
#else
    return true;
#endif
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
        try {
            append_startup_log("startup: begin");
            init_platform();
            frame_pacer_.activate();
            append_startup_log("startup: platform initialized");
            if (should_run_boot_loader()) {
                const auto saved_size = window_size();
                set_window_size(560, 640);
                center_window();
                panel::BootLoader boot(ui_registry_, worker_pool_);
                append_startup_log("startup: boot_loader loop begin");
                while (is_running()) {
                    core::FontManager::get().apply_pending_reload();
                    prepare_frame();
                    const bool done = boot.render();
                    render_frame();
                    if (done) {
                        if (!boot.success()) {
                            append_startup_log("startup: boot_loader failed");
                            worker_pool_.shutdown();
                            cleanup();
                            return;
                        }
                        break;
                    }
                }
                append_startup_log("startup: boot_loader loop end");
                set_window_size(saved_size.first, saved_size.second);
                append_startup_log("startup: boot_loader ok");
            } else {
                append_startup_log("startup: boot_loader skipped for debug build");
            }
            core::EnvManager::get().reload();
            append_startup_log("startup: env reloaded");
            init_client();
            append_startup_log("startup: init_client ok");
            core::PluginManager::get().set_ui_registry(&ui_registry_);
            append_startup_log("startup: plugin host ui registry set");
            core::PluginManager::get().discover_and_load();
            append_startup_log("startup: plugins discovered");
            core::CommandManager::get().load();
            append_startup_log("startup: commands loaded");
            //init_file_sync();
            
            // Initialize and start background file status sync
            file_sync_service_ = std::make_unique<core::FileSyncService>(ui_registry_);
            file_sync_service_->start();
            append_startup_log("startup: file sync service started");

            init_views();
            append_startup_log("startup: views initialized");
            ui_registry_.get_state<panel::SettingsState>("Settings").ensure_app_settings_loaded();

            
        } catch (const std::exception& e) {
            std::cout << "Exception caught in Application::run: " << e.what() << std::endl;
            append_startup_log(std::string("startup: exception: ") + e.what());
            worker_pool_.shutdown();
            view::clear_views();
            cleanup();
            return;
        }
        std::cout << "Entering main loop." << std::endl;
            append_startup_log("startup: entering main loop");
        while (is_running()) {
            core::FontManager::get().apply_pending_reload();
            prepare_frame();

            if (core::CommandManager::get().matches("app.toggle_transfers")) {
                ui_registry_.get_state<panel::NavbarState>("Navbar").selected_item = view::ViewID::Transfers;
                view::switch_view(view::ViewID::Transfers);
            }
            if (core::CommandManager::get().matches("app.toggle_plugin_launcher")) {
                core::PluginManager::get().toggle_launcher();
            }

            view::render_current_view();
            errors_panel_.render();
            core::PluginManager::get().process_shortcuts();
            core::PluginManager::get().render_open_panels();
            core::PluginManager::get().render_launcher_overlay();
            core::PluginManager::get().render_active_preview_scene();
            auto& settings_state = ui_registry_.get_state<panel::SettingsState>("Settings");
            if (settings_state.frame_pacing_overlay_enabled) {
                frame_pacer_.render_debug_overlay();
            }
            render_frame();
        }
        if (file_sync_service_) {
            file_sync_service_->stop();
        }

        // Flush any unsaved state on clean exit.
        // worker_pool_ threads are still alive here so any in-flight async write
        // can finish; we also do one final synchronous save to catch anything dirty.
        auto& explorer = ui_registry_.get_state<panel::FileExplorerState>("Files");
        if (explorer.dirty_.load()) {
            explorer.save_state();
        }

        core::PluginManager::get().shutdown();
        worker_pool_.shutdown();
        view::clear_views();
        cleanup();
    }

    void Application::on_focus_lost() {
        auto& explorer = ui_registry_.get_state<panel::FileExplorerState>("Files");
        explorer.save_async(worker_pool_);
    }

    void Application::init_client() {
        client_.reset();
    }

    void Application::init_views() {
        view::register_view(view::ViewID::Files,
            std::make_unique<view::FilesView>(ui_registry_, worker_pool_));
        view::register_view(view::ViewID::Auth, std::make_unique<view::RegisterView>(ui_registry_));
        view::register_view(view::ViewID::Login, std::make_unique<view::LoginView>(ui_registry_));
        view::register_view(view::ViewID::Onboarding,
            std::make_unique<view::OnboardingView>(ui_registry_, worker_pool_));
        view::register_view_factory(view::ViewID::Services, [this]() {
            append_startup_log("startup: services view instantiated");
            return std::make_unique<view::ServicesView>(ui_registry_);
        });
        view::register_view_factory(view::ViewID::Extensions, [this]() {
            append_startup_log("startup: extensions view instantiated");
            return std::make_unique<view::ExtensionsView>(ui_registry_);
        });
        view::register_view_factory(view::ViewID::Vault, [this]() {
            append_startup_log("startup: vault view instantiated");
            return std::make_unique<view::VaultView>(ui_registry_, worker_pool_);
        });
        view::register_view_factory(view::ViewID::Transfers, [this]() {
            append_startup_log("startup: transfers view instantiated");
            return std::make_unique<view::TransfersView>(ui_registry_);
        });
        // ActivityView removed — Activity is now a modal panel in the navbar
        view::register_view_factory(view::ViewID::Settings, [this]() {
            append_startup_log("startup: settings view instantiated");
            return std::make_unique<view::SettingsView>(ui_registry_);
        });

        // Auth is guaranteed by the BootLoader — always start in FilesView.
        view::switch_view(view::ViewID::Files);
        append_startup_log("startup: initial view set to " + view_name(view::ViewID::Files));
    }
};
