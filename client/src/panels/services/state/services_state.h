#pragma once

#include <mutex>
#include <string>
#include <vector>

#include "core/ui/ui_registry.h"

namespace misty::panel {

    struct ServiceCard {
        std::string id;
        std::string provider_id;
        std::string provider_label;
        std::string account_label;
        std::string status_label = "Connected";
        std::string logo_asset_path;
        bool connected = true;
    };

    struct ServicesHealthCard {
        std::string title = "rclone status unavailable";
        std::string version_text;
        std::string path_text;
        std::string remote_count_text;
        std::string provider_count_text;
        std::string status_heading = "Status";
        std::string status_value = "Template";
        bool is_ready = false;
    };

    class ServicesState : public core::UIState {
    public:
        ServicesState();
        ~ServicesState() = default;

        void set_search_query(const std::string& query);
        const std::string& search_query() const;

        std::vector<ServiceCard> service_cards_snapshot() const;
        std::vector<ServiceCard> filtered_service_cards() const;
        ServicesHealthCard health_card_snapshot() const;

        void on_add_service();
        void on_request_rename(const std::string& service_id);
        void on_request_disconnect(const std::string& service_id);
        void dismiss_active_dialog();
        void clear_flash_message();

        mutable std::mutex mu;
        std::vector<ServiceCard> service_cards;
        ServicesHealthCard health_card;
        bool show_add_service_modal = false;
        bool show_rename_modal = false;
        bool show_disconnect_modal = false;
        std::string pending_service_id;
        std::string flash_message;

    private:
        static bool matches_query(const ServiceCard& card, const std::string& query);
        std::string search_query_;
    };
}
