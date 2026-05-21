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
#include "views/providers_view.h"
#include "views/extensions_view.h"
#include "views/vault_view.h"
#include "views/transfers_view.h"
#include "views/activity_view.h"
#include "views/settings_view.h"
#include "panels/file_explorer/state/file_explorer_state.h"
#include "panels/file_explorer/state/library_state.h"
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
        case ViewID::Auth: return "Auth";
        case ViewID::Login: return "Login";
        case ViewID::Files: return "Files";
        case ViewID::Settings: return "Settings";
        case ViewID::Workspace: return "Workspace";
        case ViewID::Activity: return "Activity";
        case ViewID::Providers: return "Providers";
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
    const fs::path path = fs::path(home) / ".misty" / ".cache" / "misty-client.log";
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
        try {
            append_startup_log("startup: begin");
            init_platform();
            frame_pacer_.activate();
            append_startup_log("startup: platform initialized");
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
        persist_file_explorer_state();

        core::PluginManager::get().shutdown();
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

        if (!ui_registry_.has_state(explorer_state_key)) {
            return;
        }

        auto& explorer = ui_registry_.get_state<panel::FileExplorerState>(explorer_state_key);
        auto& library = ui_registry_.get_state<panel::LibraryState>(panel::kLibraryStateKey);
        {
            std::lock_guard<std::mutex> explorer_lock(explorer.mu);
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

    void Application::init_views() {
        view::register_view(view::ViewID::Files,
            std::make_unique<view::FilesView>(ui_registry_, worker_pool_));
        view::register_view(view::ViewID::Auth, std::make_unique<view::RegisterView>(ui_registry_));
        view::register_view(view::ViewID::Login, std::make_unique<view::LoginView>(ui_registry_));
        view::register_view_factory(view::ViewID::Providers, [this]() {
            append_startup_log("startup: providers view instantiated");
            return std::make_unique<view::ProvidersView>(ui_registry_, worker_pool_);
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

        view::switch_view(view::ViewID::Files);
        append_startup_log("startup: initial view set to " + view_name(view::ViewID::Files));
    }
};
