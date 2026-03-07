#include "panels/providers/providers_panel.h"

#include "panels/providers/cards/provider_cards_util.h"
#include "core/ui/ui_layout.h"
#include "imgui.h"

#include <string>

namespace misty::panel {
    namespace UI = misty::UI;

    namespace {
        constexpr ImVec4 kCardBg = ImVec4(0.16f, 0.18f, 0.20f, 1.0f);
        constexpr ImVec4 kBorder = ImVec4(0.24f, 0.27f, 0.30f, 1.0f);
        constexpr ImVec4 kText = ImVec4(0.94f, 0.95f, 0.97f, 1.0f);
        constexpr ImVec4 kMuted = ImVec4(0.62f, 0.66f, 0.70f, 1.0f);
    }

    void ProvidersPanel::show_health_card(const ProvidersHealthCard& health) {
        UI::row("providers_status_row", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .align = UI::Align::Center,
            .gap = UI::Spacing::xy(12.0f, 0.0f),
        }, [&]() {
            UI::text({
                .text = "Status",
                .width = UI::Size::auto_size(),
                .color = kMuted,
            });

            UI::raw([&]() {
                draw_provider_health_status_icon(health.is_ready);
            });

            UI::text({
                .text = health.status_value.c_str(),
                .width = UI::Size::auto_size(),
                .color = health.is_ready ? ImVec4(0.48f, 0.86f, 0.59f, 1.0f) : ImVec4(0.96f, 0.48f, 0.48f, 1.0f),
            });
        });

        std::string details;
        auto append_detail = [&](const std::string& value) {
            if (value.empty()) {
                return;
            }
            if (!details.empty()) {
                details += "  •  ";
            }
            details += value;
        };
        append_detail(health.port_text);
        append_detail(health.uptime_text);
        append_detail(health.provider_count_text);
        append_detail(health.remote_count_text);

        if (!details.empty()) {
            UI::text({
                .text = details.c_str(),
                .width = UI::Size::fill(),
                .color = kMuted,
                .overflow = UI::TextOverflow::Wrap,
            });
        }

        UI::divider({
            .width = UI::Size::fill(),
            .height = UI::Size::px(1.0f),
            .margin = UI::Spacing::top_bottom(18.0f, 0.0f),
            .color = kBorder,
        });
    }

    void ProvidersPanel::show_provider_card(ProvidersState& state, const ProviderCard& card, float card_width) {
        constexpr float kCardHeight = 300.0f;
        constexpr float kFooterButtonHeight = 42.0f;
        constexpr float kFooterTopGap = 18.0f;
        constexpr float kFooterBottomPadding = 4.0f;
        constexpr float kLogoSize = 46.0f;

        ImGui::PushID(card.id.c_str());
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 14.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(20.0f, 18.0f));
        ImGui::PushStyleColor(ImGuiCol_ChildBg, kCardBg);
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

        if (ImGui::BeginChild("##provider_card", ImVec2(card_width, kCardHeight), true,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
            draw_provider_logo(card, kLogoSize);
            ImGui::SameLine(0.0f, 14.0f);
            ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 6.0f);

            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.15f);
            ImGui::TextUnformatted(card.provider_label.c_str());
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::Dummy(ImVec2(0.0f, 12.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            if (!card.account_label.empty()) {
                ImGui::TextUnformatted(card.account_label.c_str());
            } else {
                ImGui::TextUnformatted("Template account");
            }
            ImGui::PopStyleColor();

            ImGui::Dummy(ImVec2(0.0f, 12.0f));
            draw_provider_status_badge(card);

            const float content_bottom = ImGui::GetWindowContentRegionMax().y;
            const float min_button_y = ImGui::GetCursorPosY() + kFooterTopGap + 6.0f;
            const float button_y = std::max(
                min_button_y,
                content_bottom - kFooterButtonHeight - kFooterBottomPadding
            );
            const float separator_y = std::max(ImGui::GetCursorPosY() + 14.0f, button_y - kFooterTopGap);

            ImGui::SetCursorPosY(separator_y);
            ImGui::Separator();
            ImGui::SetCursorPosY(button_y);

            const float button_width = (ImGui::GetContentRegionAvail().x - 12.0f) * 0.5f;
            const char* primary_label = card.needs_reconnect ? "Reconnect" : (card.unavailable ? "Configure" : "Rename");
            if (provider_outline_button(primary_label, ImVec2(button_width, kFooterButtonHeight))) {
                if (card.needs_reconnect) {
                    state.on_request_reconnect(card.id);
                } else if (card.unavailable) {
                    state.on_request_repair(card.id);
                } else {
                    state.on_request_rename(card.id);
                }
            }
            ImGui::SameLine(0.0f, 12.0f);
            if (provider_outline_button("Disconnect", ImVec2(button_width, kFooterButtonHeight))) {
                state.on_request_disconnect(card.id);
            }
        }

        ImGui::EndChild();
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(2);
        ImGui::PopID();
    }

    void ProvidersPanel::show_empty_state(bool filtered, bool loading) {
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 14.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(24.0f, 24.0f));
        ImGui::PushStyleColor(ImGuiCol_ChildBg, kCardBg);
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

        if (ImGui::BeginChild("##providers_empty_state", ImVec2(0.0f, 180.0f), true,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.1f);
            if (loading) {
                ImGui::TextUnformatted("Loading providers...");
            } else {
                ImGui::TextUnformatted(filtered ? "No matching providers" : "No providers connected yet");
            }
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            if (loading) {
                ImGui::TextWrapped("Misty is trying to fetch connected providers and available provider workflows.");
            } else if (filtered) {
                ImGui::TextWrapped("Try a different search term or clear the filter to see all connected providers.");
            } else {
                ImGui::TextWrapped("No providers are connected yet. Use Add Provider to start an rclone-backed setup flow.");
            }
            ImGui::PopStyleColor();
        }

        ImGui::EndChild();
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(2);
    }
}
