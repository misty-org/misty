#pragma once
#include <string>
#include <mutex>
#include <cstring>
#include <map>
#include <nlohmann/json.hpp>
#include "core/ui/ui_registry.h"
#include "views/app_view.h"
#include "core/net/http_client.h"
#include "core/manager/env_manager.h"
#include "core/manager/session_manager.h"
#include "core/system/util.h"

namespace misty::panel {

    struct AuthLoginState : public core::UIState {
        std::mutex mu;
        
        // Input Buffers
        char email[128] = "";
        char password[64] = "";

        // UI Logic State
        bool is_submitting = false;
        std::string error_msg = "";
        std::string success_msg = "";
        
        void clear_inputs() {
            memset(email, 0, sizeof(email));
            memset(password, 0, sizeof(password));
        }

        void validate_inputs() {
            if (strlen(email) == 0 || strlen(password) == 0) {
                error_msg = "Please fill in all fields";
                return;
            }
            error_msg = "";
        }

        void handle_login() {
            validate_inputs();
            if (!error_msg.empty()) {
                return;
            }
            
            is_submitting = true;
            success_msg = "";
            
            // Build JSON object using utility function
            std::map<std::string, std::string> json_fields;
            json_fields["email"] = std::string(email);
            json_fields["password"] = std::string(password);
            std::string json_body = core::build_json_object(json_fields);
            
            // Set headers
            std::map<std::string, std::string> headers;
            headers["Content-Type"] = "application/json";
            
            // Make HTTP POST request
            std::string proxy_url = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
            if (proxy_url.empty()) {
                error_msg = "PROXY_SERVICE_URL is not set";
                is_submitting = false;
                return;
            }
            auto response = core::HTTPClient::get().post(
                proxy_url + "/api/login",
                json_body,
                {.headers = headers}
            );
            
            is_submitting = false;
            
            // Handle response
            if (response.status_code == 200 || response.status_code == 201) {
                try {
                    auto json_resp = nlohmann::json::parse(response.body);

                    if (!json_resp.contains("token")) {
                        error_msg = "Login response is missing a session token";
                        return;
                    }

                    const std::string token = json_resp["token"].get<std::string>();
                    if (token.empty()) {
                        error_msg = "Login response included an empty session token";
                        return;
                    }

                    if (!core::SessionManager::get().set_tokens(token, "")) {
                        error_msg = "Login succeeded but the session could not be activated";
                        return;
                    }

                    if (json_resp.contains("id") && !json_resp["id"].get<std::string>().empty()) {
                        core::SessionManager::get().set_user_id(json_resp["id"].get<std::string>());
                    }
                    core::SessionManager::get().set_email(std::string(email));
                } catch (const std::exception& e) {
                    error_msg = std::string("Login response could not be processed: ") + e.what();
                    return;
                }
                success_msg = "Login successful!";
                clear_inputs();
                // Switch view after successful login
                view::switch_view(view::ViewID::Files);
            } else if (response.status_code == 400) {
                error_msg = "Invalid login data: " + response.body;
            } else if (response.status_code == 401) {
                error_msg = "Invalid email or password";
            } else if (response.status_code == 500) {
                error_msg = "Server error: Failed to login";
            } else if (response.status_code == 0) {
                error_msg = "Failed to connect to server. Is the proxy running?";
            } else {
                error_msg = "Login failed (Status: " + std::to_string(response.status_code) + "): " + response.body;
            }
        }
    };

}
