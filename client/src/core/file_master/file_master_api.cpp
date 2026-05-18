#include "core/file_master/file_master_api.h"

#include "core/manager/env_manager.h"
#include "core/manager/session_manager.h"
#include "core/net/http_client.h"

namespace misty::core {

HttpResponse list_remote_call(const FileMasterProps& props) {
    const std::string proxy_service_url = EnvManager::get().get("PROXY_SERVICE_URL", "");
    if (proxy_service_url.empty()) return HttpResponse{500, "PROXY_SERVICE_URL not set", {}};

    const FileMasterRemoteContext& context =
        !props.remote_source.empty() ? props.remote_source : props.remote_dest;

    const std::string url = proxy_service_url +
        "/api/remote/file/list?remote=" + url_encode(context.remote_name) +
        "&path=" + url_encode(context.remote_path);
    auto headers = SessionManager::get().get_auth_headers();
    headers["Accept"] = "application/json";

    const HttpResponse response = HTTPClient::get().get(url, {.headers = headers});
    if (response.status_code < 200 || response.status_code >= 300) {
        if (!response.body.empty()) {
            return HttpResponse{response.status_code, response.body, response.headers};
        }
        if (response.status_code > 0) {
            return HttpResponse{response.status_code, "remote list request failed (HTTP " + std::to_string(response.status_code) + ")", {}};
        }
        return HttpResponse{response.status_code, "remote list request failed", {}};
    }

    return HttpResponse{response.status_code, response.body, response.headers};
}

} // namespace misty::core
