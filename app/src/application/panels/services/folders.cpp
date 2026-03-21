#include "services_state.h"

#include "core/manager/env_manager.h"
#include "core/net/http_client.h"
#include "core/system/util.h"

#include <nlohmann/json.hpp>

namespace misty::panel {
    void ServicesState::create_onedrive_folder(const std::string& ms_user_id,
                                               const std::string& drive_id,
                                               const std::string& parent_id,
                                               const std::string& folder_name,
                                               CreateFolderCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, ms_user_id, drive_id, parent_id, folder_name, callback]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) { callback(false, "", "PROXY_SERVICE_URL not set"); return; }
                std::string user_id = core::EnvManager::get().get("USER_ID", "");
                if (user_id.empty()) { callback(false, "", "USER_ID not set"); return; }

                std::string url = base + "/api/ms/folder/create?user_id=" + user_id
                    + "&ms_user_id=" + ms_user_id;

                nlohmann::json body;
                body["drive_id"] = drive_id;
                body["parent_id"] = parent_id;
                body["name"] = folder_name;

                std::map<std::string, std::string> headers;
                headers["Content-Type"] = "application/json";

                core::HttpResponse response = core::HTTPClient::get().post(url, body.dump(), headers);

                if (response.status_code >= 200 && response.status_code < 300) {
                    callback(true, response.body, "");
                } else {
                    callback(false, "", "HTTP " + std::to_string(response.status_code));
                }
            },
            []() {},
            [callback](const std::string& err) { callback(false, "", err); }
        );
    }

    void ServicesState::create_gdrive_folder(const std::string& gd_user_id,
                                             const std::string& parent_id,
                                             const std::string& folder_name,
                                             CreateFolderCallback callback) {
        if (!worker_pool_) return;

        worker_pool_->add(
            [this, gd_user_id, parent_id, folder_name, callback]() {
                std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                if (base.empty()) { callback(false, "", "PROXY_SERVICE_URL not set"); return; }
                std::string user_id = core::EnvManager::get().get("USER_ID", "");
                if (user_id.empty()) { callback(false, "", "USER_ID not set"); return; }

                std::string url = base + "/api/gd/folder/create?user_id=" + user_id
                    + "&gd_user_id=" + gd_user_id;

                nlohmann::json body;
                body["name"] = folder_name;
                body["parent_id"] = parent_id;

                std::map<std::string, std::string> headers;
                headers["Content-Type"] = "application/json";

                core::HttpResponse response = core::HTTPClient::get().post(url, body.dump(), headers);

                if (response.status_code >= 200 && response.status_code < 300) {
                    callback(true, response.body, "");
                } else {
                    callback(false, "", "HTTP " + std::to_string(response.status_code));
                }
            },
            []() {},
            [callback](const std::string& err) { callback(false, "", err); }
        );
    }


}
