#pragma once
#include <string>
#include <mutex>
#include <cstring>
#include <map>
#include "core/ui_registry.h"
#include "views/app_view.h"
#include "core/http_client.h"
#include "core/util.h"

namespace minidfs::panel {

    struct AuthRegisterState : public core::UIState {
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
            
            // Make HTTP POST request
            auto response = core::HttpClient::get().post(
                "http://localhost:3000/api/register",
                json_body,
                headers
            );
            
            is_submitting = false;
            
            // Handle response
            if (response.status_code == 200 || response.status_code == 201) {
                success_msg = "Account created successfully!";
                clear_inputs();
                // Switch view after successful registration
                view::switch_view(view::ViewID::Services);
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