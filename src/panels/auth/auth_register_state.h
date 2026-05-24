#pragma once
#include <string>
#include <mutex>
#include <cstring>
#include <map>
#include <nlohmann/json.hpp>
#include "core/ui/state_registry.h"
#include "views/app_view.h"
#include "core/net/http_client.h"
#include "core/manager/env_manager.h"
#include "core/manager/session_manager.h"
#include "core/system/util.h"

namespace misty::panel {

    struct AuthRegisterState : public core::StateEntry {
        std::mutex mu;
        
        char full_name[128] = "";
        char email[128] = "";
        char password[64] = "";
        char confirm_password[64] = "";
        bool agree_to_terms = false;

        bool is_submitting = false;
        std::string error_msg = "";
        std::string success_msg = "";
        
        const std::string terms_of_service_path = "assets/terms_of_service.html";
        
        void clear_inputs() {
            memset(full_name, 0, sizeof(full_name));
            memset(email, 0, sizeof(email));
            memset(password, 0, sizeof(password));
            memset(confirm_password, 0, sizeof(confirm_password));
            agree_to_terms = false;
        }

        void validate_inputs() {
            if (strlen(full_name) == 0 || strlen(email) == 0 || strlen(password) == 0) {
                error_msg = "Please fill in all fields";
                return;
            }
            if (strcmp(password, confirm_password) != 0) {
                error_msg = "Passwords do not match";
                return;
            }
            if (!agree_to_terms) {
                error_msg = "Please agree to the Terms of Service";
                return;
            }
            error_msg = "";
        }

        void handle_create_account() {
            validate_inputs();
            if (!error_msg.empty()) {
                return;
            }
            
            is_submitting = true;
            success_msg = "";
            
            // Build JSON object using utility function
            std::map<std::string, std::string> json_fields;
            json_fields["name"] = std::string(full_name);
            json_fields["email"] = std::string(email);
            json_fields["password"] = std::string(password);
            std::string json_body = core::build_json_object(json_fields);
            
            // Set headers
            std::map<std::string, std::string> headers;
            headers["Content-Type"] = "application/json";
            
            std::string proxy_url = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
            if (proxy_url.empty()) {
                error_msg = "PROXY_SERVICE_URL is not set";
                is_submitting = false;
                return;
            }
            auto response = core::HTTPClient::get().post(
                proxy_url + "/api/register",
                json_body,
                {.headers = headers}
            );
            
            is_submitting = false;
            
            // Handle response
            if (response.status_code == 200 || response.status_code == 201) {
                try {
                    auto json_resp = nlohmann::json::parse(response.body);
                    const std::string token = json_resp.value("token", std::string{});
                    if (token.empty()) {
                        error_msg = "Registration response is missing a session token";
                        return;
                    }
                    if (!core::SessionManager::get().set_tokens(token, "")) {
                        error_msg = "Account created but the session could not be activated";
                        return;
                    }
                    if (json_resp.contains("id") && !json_resp["id"].get<std::string>().empty()) {
                        core::SessionManager::get().set_user_id(json_resp["id"].get<std::string>());
                    }
                    core::SessionManager::get().set_email(std::string(email));
                } catch (const std::exception& e) {
                    error_msg = std::string("Registration response could not be processed: ") + e.what();
                    return;
                }
                success_msg = "Account created successfully!";
                clear_inputs();
                // Switch view after successful registration
                view::switch_view(view::ViewID::Files);
            } else if (response.status_code == 400) {
                error_msg = "Invalid registration data: " + response.body;
            } else if (response.status_code == 500) {
                error_msg = "Server error: Failed to create user";
            } else if (response.status_code == 0) {
                error_msg = "Failed to connect to server. Is the proxy running?";
            } else {
                error_msg = "Registration failed (Status: " + std::to_string(response.status_code) + "): " + response.body;
            }
        }
    };

}
