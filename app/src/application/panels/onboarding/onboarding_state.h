#pragma once
#include <string>
#include <map>
#include <cstring>
#include <filesystem>
#include <fstream>
#include "core/ui/ui_registry.h"
#include "core/net/http_client.h"
#include "core/manager/env_manager.h"
#include "core/system/util.h"

namespace misty::panel {

    struct OnboardingState : public core::UIState {

        int step = 0;

        // ── Step 1: agreements ───────────────────────────────────────────────
        bool agree_to_terms = false;

        // ── Step 2: sign-up ──────────────────────────────────────────────────
        char full_name[128]        = "";
        char email[128]            = "";
        char password[64]          = "";
        char confirm_password[64]  = "";
        bool is_submitting         = false;
        bool account_created       = false;
        std::string error_msg      = "";

        // ── Step 3: cloud connect ────────────────────────────────────────────
        bool cloud_connected            = false;
        std::string connected_provider  = "";
        bool awaiting_check             = false;  // user clicked a provider, waiting

        // ── Step 4: tour ─────────────────────────────────────────────────────
        int  tour_slide                      = 0;
        static constexpr int TOUR_SLIDE_COUNT = 3;

        // ── Helpers ──────────────────────────────────────────────────────────
        void advance() { ++step; error_msg = ""; }

        void handle_register() {
            if (strlen(full_name) == 0 || strlen(email) == 0 || strlen(password) == 0) {
                error_msg = "Please fill in all fields.";
                return;
            }
            if (strcmp(password, confirm_password) != 0) {
                error_msg = "Passwords do not match.";
                return;
            }

            is_submitting = true;
            error_msg     = "";

            std::map<std::string, std::string> fields;
            fields["name"]     = std::string(full_name);
            fields["email"]    = std::string(email);
            fields["password"] = std::string(password);
            std::string body   = core::build_json_object(fields);

            std::map<std::string, std::string> headers;
            headers["Content-Type"] = "application/json";

            std::string server_url = core::EnvManager::get().get("MISTY_SERVER_URL", "");
            if (server_url.empty()) {
                error_msg     = "MISTY_SERVER_URL is not set.";
                is_submitting = false;
                return;
            }

            auto resp = core::HTTPClient::get().post(server_url + "/register", body, headers);
            is_submitting = false;

            if (resp.status_code == 200 || resp.status_code == 201) {
                account_created = true;
                advance();          // → step 3
            } else if (resp.status_code == 400) {
                error_msg = "Invalid data: " + resp.body;
            } else if (resp.status_code == 0) {
                error_msg = "Could not connect to server.";
            } else {
                error_msg = "Registration failed ("
                          + std::to_string(resp.status_code) + "): " + resp.body;
            }
        }

        // ── Persistence flag ─────────────────────────────────────────────────
        static bool is_complete() {
            const char* home = std::getenv("HOME");
            if (!home) return false;
            return std::filesystem::exists(
                std::string(home) + "/misty/.cache/onboarding_complete");
        }

        static void mark_complete() {
            const char* home = std::getenv("HOME");
            if (!home) return;
            std::string dir = std::string(home) + "/misty/.cache";
            std::filesystem::create_directories(dir);
            std::ofstream(dir + "/onboarding_complete").close();
        }
    };

}
