#include "application.h"
#include "core/commands/command_manager.h"
#include "core/plugins/plugin_host.h"
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
#include "views/activity_view.h"
#include "views/settings_view.h"
#include "views/edit_profile_view.h"
#include "panels/file_explorer/file_explorer_state.h"
#include "panels/onboarding/onboarding_state.h"
#include "panels/onboarding/boot_loader.h"
#include "panels/transfers/transfer_window_state.h"

#include <cstdlib>
#include <filesystem>
#include <fstream>

namespace {
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
    void Application::run() {
        try {
            append_startup_log("startup: begin");
            init_platform();
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
            core::PluginHost::get().set_ui_registry(&ui_registry_);
            append_startup_log("startup: plugin host ui registry set");
            core::PluginHost::get().discover_and_load();
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
            transfer_window_panel_ = std::make_unique<panel::TransferWindowPanel>(ui_registry_);

            
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
                ui_registry_.get_state<panel::TransferWindowState>(
                    panel::kTransferWindowStateKey).toggle();
            }

            view::render_current_view();
            errors_panel_.render();
            core::PluginHost::get().process_shortcuts();
            core::PluginHost::get().render_open_panels();
            if (transfer_window_panel_) {
                transfer_window_panel_->render();
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

        core::PluginHost::get().shutdown();
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
            std::make_unique<view::FilesView>(ui_registry_, worker_pool_, client_));
        view::register_view(view::ViewID::Auth, std::make_unique<view::RegisterView>(ui_registry_));
        view::register_view(view::ViewID::Login, std::make_unique<view::LoginView>(ui_registry_));
        view::register_view(view::ViewID::Onboarding,
            std::make_unique<view::OnboardingView>(ui_registry_, worker_pool_));
        view::register_view(view::ViewID::Services, std::make_unique<view::ServicesView>(ui_registry_));
        view::register_view(view::ViewID::Extensions, std::make_unique<view::ExtensionsView>(ui_registry_));
        view::register_view(view::ViewID::Vault,
            std::make_unique<view::VaultView>(ui_registry_, worker_pool_));
        // ActivityView removed — Activity is now a modal panel in the navbar
        view::register_view(view::ViewID::Settings, std::make_unique<view::SettingsView>(ui_registry_));
        view::register_view(view::ViewID::EditProfile, std::make_unique<view::EditProfileView>(ui_registry_));

        // Auth is guaranteed by the BootLoader — always start in FilesView.
        view::switch_view(view::ViewID::Files);
    }
};
