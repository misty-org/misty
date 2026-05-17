#include "panels/services/state/services_state.h"

#include <algorithm>
#include <cctype>

namespace misty::panel {
    namespace {
        std::string lowercase_copy(const std::string& value) {
            std::string lowered = value;
            std::transform(lowered.begin(), lowered.end(), lowered.begin(), [](unsigned char c) {
                return static_cast<char>(std::tolower(c));
            });
            return lowered;
        }
    }

    ServicesState::ServicesState() {
        health_card.path_text = "Waiting for proxy-backed service wiring.";
        health_card.remote_count_text = "0 connected services";
        health_card.provider_count_text = "0 providers available";
    }

    void ServicesState::set_search_query(const std::string& query) {
        std::lock_guard<std::mutex> lock(mu);
        search_query_ = query;
    }

    const std::string& ServicesState::search_query() const {
        return search_query_;
    }

    std::vector<ServiceCard> ServicesState::service_cards_snapshot() const {
        std::lock_guard<std::mutex> lock(mu);
        return service_cards;
    }

    std::vector<ServiceCard> ServicesState::filtered_service_cards() const {
        std::lock_guard<std::mutex> lock(mu);

        std::vector<ServiceCard> filtered;
        filtered.reserve(service_cards.size());
        for (const auto& card : service_cards) {
            if (matches_query(card, search_query_)) {
                filtered.push_back(card);
            }
        }
        return filtered;
    }

    ServicesHealthCard ServicesState::health_card_snapshot() const {
        std::lock_guard<std::mutex> lock(mu);
        return health_card;
    }

    void ServicesState::on_add_service() {
        std::lock_guard<std::mutex> lock(mu);
        show_add_service_modal = true;
        show_rename_modal = false;
        show_disconnect_modal = false;
        pending_service_id.clear();
        flash_message = "Add Service is a template placeholder. Wire the new proxy flow here.";
    }

    void ServicesState::on_request_rename(const std::string& service_id) {
        std::lock_guard<std::mutex> lock(mu);
        show_add_service_modal = false;
        show_rename_modal = true;
        show_disconnect_modal = false;
        pending_service_id = service_id;
        flash_message = "Rename is a template placeholder. Connect the new service editor here.";
    }

    void ServicesState::on_request_disconnect(const std::string& service_id) {
        std::lock_guard<std::mutex> lock(mu);
        show_add_service_modal = false;
        show_rename_modal = false;
        show_disconnect_modal = true;
        pending_service_id = service_id;
        flash_message = "Disconnect is a template placeholder. Connect the new proxy removal flow here.";
    }

    void ServicesState::dismiss_active_dialog() {
        std::lock_guard<std::mutex> lock(mu);
        show_add_service_modal = false;
        show_rename_modal = false;
        show_disconnect_modal = false;
        pending_service_id.clear();
    }

    void ServicesState::clear_flash_message() {
        std::lock_guard<std::mutex> lock(mu);
        flash_message.clear();
    }

    bool ServicesState::matches_query(const ServiceCard& card, const std::string& query) {
        if (query.empty()) {
            return true;
        }

        const std::string lowered_query = lowercase_copy(query);
        const std::string haystack = lowercase_copy(
            card.provider_label + " " + card.account_label + " " + card.status_label + " " + card.id);
        return haystack.find(lowered_query) != std::string::npos;
    }
}
