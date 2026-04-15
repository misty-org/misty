#include "application.h"
#include "core/commands/command_manager.h"
#include "core/extensions/plugin_host.h"
#include "core/manager/proxy_manager.h"
#include "core/manager/session_manager.h"
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



namespace misty {
    void Application::run() {
        try {
            init_platform();
            init_client();
            core::PluginHost::get().set_ui_registry(&ui_registry_);
            core::PluginHost::get().discover_and_load();
            core::CommandManager::get().load();
            core::ProxyManager::get().ensure_running();
            //init_file_sync();
            
            // Initialize and start background file status sync
            file_sync_service_ = std::make_unique<core::FileSyncService>(ui_registry_);
            file_sync_service_->start();

            init_views();

            
        } catch (const std::exception& e) {
            std::cout << "Exception caught in Application::run: " << e.what() << std::endl;
            cleanup();
        }
        std::cout << "Entering main loop." << std::endl;
        while (is_running()) {
            prepare_frame();
            
            view::render_current_view();
            core::PluginHost::get().process_shortcuts();
            core::PluginHost::get().render_open_panels();
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
        cleanup();
    }

    void Application::on_focus_lost() {
        auto& explorer = ui_registry_.get_state<panel::FileExplorerState>("Files");
        explorer.save_async(worker_pool_);
    }

    void Application::init_client() {
        std::string mount_path, channel_address;
        std::ifstream config_file("misty.conf");
		if (config_file.is_open()) {
            std::getline(config_file, mount_path);
            std::getline(config_file, channel_address);
            config_file.close();
        } else {
            throw std::runtime_error("Failed to open mount configuration file.");
        }
        if (mount_path.empty() || channel_address.empty()) {
            throw std::runtime_error("Mount path is empty or invalid in configuration file.");
        }
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
        view::register_view(view::ViewID::Activity, std::make_unique<view::ActivityView>(ui_registry_));
        view::register_view(view::ViewID::Settings, std::make_unique<view::SettingsView>(ui_registry_));
        view::register_view(view::ViewID::EditProfile, std::make_unique<view::EditProfileView>(ui_registry_));

        if (core::SessionManager::get().is_authenticated()) {
            view::switch_view(view::ViewID::Files);
        } else if (panel::OnboardingState::is_complete()) {
            view::switch_view(view::ViewID::Login);
        } else {
            view::switch_view(view::ViewID::Onboarding);
        }
    }
};
