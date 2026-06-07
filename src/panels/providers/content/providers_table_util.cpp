#include "panels/providers/content/providers_table_util.h"

namespace misty::panel::providers_content {
std::string provider_secondary_label(const ProviderCard& card) {
    return card.account_label.empty() ? card.id : card.account_label;
}

const char* provider_status_text(const ProviderCard& card) {
    return card.needs_reconnect ? "Reconnect" : "Connected";
}

std::string provider_details_text(const ProviderCard& card) {
    if (card.status_label.empty() || card.status_label == "Connected") {
        return "--";
    }
    return card.status_label;
}

}  // namespace misty::panel::providers_content
