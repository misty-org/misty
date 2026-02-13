#include "application.h"
#include "views/main_view.h"
#include "views/register_view.h"
#include "views/login_view.h"
#include "views/services_view.h"
#include "views/activity_view.h"
#include "views/settings_view.h"
#include "views/edit_profile_view.h"



namespace misty {
    void Application::run() {
        try {
            init_platform();
            init_client();
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
            render_frame();
        }
        if (file_sync_service_) {
            file_sync_service_->stop();
        }
        cleanup();
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

    void Application::init_file_sync() {
        if (!client_) {
            throw std::runtime_error("Client not initialized before initializing FileSync.");
        }

        #ifdef _WIN32
            file_sync_ = std::make_unique<misty::FileSyncWin32>(client_);
        #elif defined(__APPLE__)
            file_sync_ = std::make_unique<misty::FileSyncMac>(client_);
        #else
            file_sync_ = std::make_unique<misty::FileSyncLinux>(client_);
        #endif

        file_sync_->init_sync_resources();
        file_sync_->start_sync();
    }

    void Application::init_views() {

        view::register_view(view::ViewID::FileExplorer,
            std::make_unique<view::MainView>(ui_registry_, worker_pool_, client_));
        view::register_view(view::ViewID::Auth, std::make_unique<view::RegisterView>(ui_registry_));
        view::register_view(view::ViewID::Login, std::make_unique<view::LoginView>(ui_registry_));
        view::register_view(view::ViewID::Services, std::make_unique<view::ServicesView>(ui_registry_));
        view::register_view(view::ViewID::Activity, std::make_unique<view::ActivityView>(ui_registry_));
        view::register_view(view::ViewID::Settings, std::make_unique<view::SettingsView>(ui_registry_));
        view::register_view(view::ViewID::EditProfile, std::make_unique<view::EditProfileView>(ui_registry_));
        view::switch_view(view::ViewID::FileExplorer);
    }
};