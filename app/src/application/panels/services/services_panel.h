#pragma once

#include "panels/panel.h"
#include "core/ui/ui_registry.h"
#include "services_state.h"

using namespace misty::core;

namespace misty::panel {
    class ServicesPanel : public Panel {
    public:
        ServicesPanel(UIRegistry& registry);
        ~ServicesPanel() override = default;
        void render() override;

    private:
        void show_header();
        void show_cloud_section(ServicesState& state);
        void show_tab_bar();
        void show_onedrive_tab(ServicesState& state);
        void show_gdrive_tab(ServicesState& state);
        void show_add_account_card(const char* label, bool& show_modal);
        void try_same_line_or_wrap(int cards_drawn);

        void show_ms_login_modal(ServicesState& state);
        void show_onedrive_profile_card(ServicesState& state, const std::string& ms_user_id);

        // OneDrive card UI sub-views (state lives in ServicesState)
        void show_onedrive_card_header(bool is_connected);
        void show_onedrive_card_profile(const OneDriveCardState& card, const std::string& ms_user_id);
        void show_onedrive_card_actions(ServicesState& state, const std::string& ms_user_id, bool is_connected);

        // Google Drive card UI
        void show_gd_login_modal(ServicesState& state);
        void show_gdrive_profile_card(ServicesState& state, const std::string& gd_user_id);
        void show_gdrive_card_header(bool is_connected);
        void show_gdrive_card_profile(const GDriveCardState& card, const std::string& gd_user_id);
        void show_gdrive_card_actions(ServicesState& state, const std::string& gd_user_id, bool is_connected);

        // Dropbox card UI
        void show_dropbox_tab(ServicesState& state);
        void show_dbx_login_modal(ServicesState& state);
        void show_dropbox_profile_card(ServicesState& state, const std::string& dbx_user_id);
        void show_dropbox_card_header(bool is_connected);
        void show_dropbox_card_profile(const DropboxCardState& card, const std::string& dbx_user_id);
        void show_dropbox_card_actions(ServicesState& state, const std::string& dbx_user_id, bool is_connected);

        // iCloud card UI
        void show_icloud_tab(ServicesState& state);
        void show_icl_login_modal(ServicesState& state);
        void show_icloud_profile_card(ServicesState& state, const std::string& email);
        void show_icloud_card_header(bool is_connected);
        void show_icloud_card_profile(const ICloudCardState& card, const std::string& email);
        void show_icloud_card_actions(ServicesState& state, const std::string& email, bool is_connected);

        void show_loading_overlay();

    private:
        static constexpr float kCardWidth = 300.0f;
        static constexpr float kCardSpacing = 12.0f;
        UIRegistry& registry_;
        int active_tab_ = 0; // 0 = OneDrive, 1 = Google Drive, 2 = Dropbox, 3 = iCloud

        char icl_email_buf_[256] = {};
        char icl_password_buf_[256] = {};
        char icl_2fa_buf_[16] = {};
    };
}
