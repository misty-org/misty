#include "panels/search/search_impl.h"

#include <algorithm>
#include <chrono>
#include <thread>
#include <stdexcept>
#include <utility>

#include <nlohmann/json.hpp>

#include "core/manager/env_manager.h"
#include "core/net/http_client.h"

using json = nlohmann::json;

namespace {

std::string search_source_str(misty::panel::SearchSource source) {
    switch (source) {
        case misty::panel::SearchSource::LOCAL:
            return "LOCAL";
        case misty::panel::SearchSource::REMOTE:
            return "REMOTE";
        case misty::panel::SearchSource::ALL:
            return "ALL";
    }
    return "LOCAL";
}

std::string search_depth_str(misty::panel::SearchDepth depth) {
    switch (depth) {
        case misty::panel::SearchDepth::CWD:
            return "CWD";
        case misty::panel::SearchDepth::DEPTH:
            return "DEPTH";
        case misty::panel::SearchDepth::SYSTEM:
            return "SYSTEM";
        case misty::panel::SearchDepth::WORKSPACE:
            return "WORKSPACE";
    }
    return "CWD";
}

misty::panel::SearchScopeValue normalize_search_scope(const misty::panel::SearchScope& scope) {
    switch (scope.scope_) {
        case misty::panel::SearchDepth::CWD:
            return {misty::panel::SearchDepth::CWD, 0};
        case misty::panel::SearchDepth::DEPTH:
            return {misty::panel::SearchDepth::DEPTH, std::max(0, scope.depth_)};
        case misty::panel::SearchDepth::SYSTEM:
            return {misty::panel::SearchDepth::SYSTEM, std::nullopt};
        case misty::panel::SearchDepth::WORKSPACE:
            return {misty::panel::SearchDepth::WORKSPACE, std::nullopt};
    }
    return {misty::panel::SearchDepth::CWD, 0};
}

json build_search_request_json(const misty::panel::SearchQuery& query) {
    const misty::panel::SearchScopeValue scope = normalize_search_scope(query.depth);
    json depth = {
        {"scope", search_depth_str(scope.scope_)},
    };
    if (scope.depth_limit.has_value()) {
        depth["depth"] = *scope.depth_limit;
    }

    json request = json{
        {"query", query.query},
        {"path", query.path},
        {"source", search_source_str(query.source)},
        {"depth", std::move(depth)},
        {"allow_cached", query.allow_cached},
        {"refresh_in_background", query.refresh_in_background},
    };
    if (!query.request_id.empty()) {
        request["request_id"] = query.request_id;
    }
    return request;
}

misty::panel::FileSource parse_file_source(const std::string& source) {
    if (source == "REMOTE") {
        return misty::panel::FileSource::REMOTE;
    }
    return misty::panel::FileSource::LOCAL;
}

misty::panel::SearchResponse parse_search_response(const std::string& body) {
    json parsed = json::parse(body, nullptr, false);
    if (parsed.is_discarded()) {
        throw std::runtime_error("invalid search response");
    }

    misty::panel::SearchResponse response;
    response.is_cached = parsed.value("is_cached", false);
    response.refresh_in_progress = parsed.value("refresh_in_progress", false);
    response.updated = parsed.value("updated", false);
    response.updated_at = parsed.value("updated_at", std::string{});
    response.request_id = parsed.value("request_id", std::string{});

    for (const auto& remote : parsed.value("remote_statuses", json::array())) {
        misty::panel::SearchRemoteStatus status;
        status.remote_id = remote.value("remote_id", std::string{});
        status.provider_id = remote.value("provider_id", std::string{});
        status.account_id = remote.value("account_id", std::string{});
        status.status = remote.value("status", std::string{});
        status.error = remote.value("error", std::string{});
        status.stale = remote.value("stale", false);
        status.refreshing = remote.value("refreshing", false);
        response.remote_statuses.push_back(std::move(status));
    }

    for (const auto& item : parsed.value("items", json::array())) {
        misty::panel::SearchResult result;
        result.id = item.value("id", std::string{});
        result.name = item.value("name", std::string{});
        result.path = item.value("path", std::string{});
        result.subtitle = item.value("subtitle", std::string{});
        result.badge = item.value("badge", std::string{});
        result.provider_id = item.value("provider_id", std::string{});
        result.account_id = item.value("account_id", std::string{});
        result.remote_id = item.value("remote_id", std::string{});
        result.remote_path = item.value("remote_path", std::string{});
        result.source = parse_file_source(item.value("source", std::string("LOCAL")));
        result.is_dir = item.value("is_dir", false);
        result.kind = result.is_dir ? misty::panel::SearchResultKind::Folder
                                    : misty::panel::SearchResultKind::File;
        result.score = item.value("score", 0);
        if (!result.name.empty() && !result.path.empty()) {
            response.results.push_back(std::move(result));
        }
    }
    return response;
}

misty::panel::SearchResponse perform_search_request(const misty::panel::SearchQuery& query) {
    const std::string base = misty::core::EnvManager::get().get("PROXY_SERVICE_URL", "");
    if (base.empty()) {
        throw std::runtime_error("PROXY_SERVICE_URL not set");
    }
    if (query.path.empty()) {
        throw std::runtime_error("search path is required");
    }

    const std::string url = base + "/api/search";
    const std::string body = build_search_request_json(query).dump();

    std::map<std::string, std::string> headers;
    headers["Accept"] = "application/json";
    headers["Content-Type"] = "application/json";
    const misty::core::HttpResponse response = misty::core::HTTPClient::get().post(
        url,
        body,
        {.headers = headers, .timeouts = {1L, 3L}}
    );
    if (response.status_code < 200 || response.status_code >= 300) {
        throw std::runtime_error(
            response.body.empty()
                ? "search request failed with HTTP " + std::to_string(response.status_code)
                : response.body);
    }

    return parse_search_response(response.body);
}

} // namespace

namespace misty::panel {

std::string SearchImpl::build_request_body(const SearchQuery& query) {
    return build_search_request_json(query).dump();
}

SearchResponse SearchImpl::parse_response_body(const std::string& body) {
    return parse_search_response(body);
}

void SearchImpl::search(const SearchQuery& query,
    SearchCompleteCallback on_complete,
                        SearchErrorCallback on_error,
                        SearchUpdateCallback on_update) {
    try {
        if (query.query.empty()) {
            SearchResponse empty;
            if (on_complete) {
                on_complete(empty);
            }
            return;
        }

        SearchResponse initial = perform_search_request(query);
        if (on_complete) {
            on_complete(initial);
        }

        if (!initial.refresh_in_progress ||
            initial.request_id.empty() ||
            !query.refresh_in_background ||
            query.source == SearchSource::LOCAL) {
            return;
        }

        SearchQuery refresh_query = query;
        refresh_query.request_id = initial.request_id;
        SearchResponse latest = initial;
        for (int attempt = 0; attempt < 12; ++attempt) {
            std::this_thread::sleep_for(std::chrono::milliseconds(250));
            SearchResponse refreshed = perform_search_request(refresh_query);
            const bool changed = refreshed.updated ||
                                 refreshed.updated_at != latest.updated_at ||
                                 refreshed.results.size() != latest.results.size() ||
                                 refreshed.refresh_in_progress != latest.refresh_in_progress;
            latest = refreshed;
            refresh_query.request_id = refreshed.request_id.empty()
                ? refresh_query.request_id
                : refreshed.request_id;
            if (changed && on_update) {
                on_update(refreshed);
            }
            if (!refreshed.refresh_in_progress) {
                break;
            }
        }
    } catch (const std::exception& e) {
        if (on_error) {
            on_error(e.what());
        }
    }
}

} // namespace misty::panel
