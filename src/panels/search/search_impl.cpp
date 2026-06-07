#include "panels/search/search_impl.h"

#include <algorithm>
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

json build_search_request(const misty::panel::SearchQuery& query) {
    const misty::panel::SearchScopeValue scope = normalize_search_scope(query.depth);
    json depth = {
        {"scope", search_depth_str(scope.scope_)},
    };
    if (scope.depth_limit.has_value()) {
        depth["depth"] = *scope.depth_limit;
    }

    return json{
        {"query", query.query},
        {"path", query.path},
        {"source", search_source_str(query.source)},
        {"depth", std::move(depth)},
    };
}

misty::panel::FileSource parse_file_source(const std::string& source) {
    if (source == "REMOTE") {
        return misty::panel::FileSource::REMOTE;
    }
    return misty::panel::FileSource::LOCAL;
}

std::vector<misty::panel::SearchResult> parse_search_results(const std::string& body) {
    json parsed = json::parse(body, nullptr, false);
    if (parsed.is_discarded()) {
        throw std::runtime_error("invalid search response");
    }

    std::vector<misty::panel::SearchResult> results;
    for (const auto& item : parsed.value("items", json::array())) {
        misty::panel::SearchResult result;
        result.id = item.value("id", std::string{});
        result.name = item.value("name", std::string{});
        result.path = item.value("path", std::string{});
        result.source = parse_file_source(item.value("source", std::string("LOCAL")));
        result.is_dir = item.value("is_dir", false);
        result.kind = result.is_dir ? misty::panel::SearchResultKind::Folder
                                    : misty::panel::SearchResultKind::File;
        result.score = item.value("score", 0);
        if (!result.name.empty() && !result.path.empty()) {
            results.push_back(std::move(result));
        }
    }
    return results;
}

} // namespace

namespace misty::panel {

void SearchImpl::search(const SearchQuery& query,
    SearchCompleteCallback on_complete,
                        SearchErrorCallback on_error) {
    try {
        const std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
        if (base.empty()) {
            throw std::runtime_error("PROXY_SERVICE_URL not set");
        }
        if (query.query.empty()) {
            std::vector<SearchResult> empty;
            if (on_complete) {
                on_complete(empty);
            }
            return;
        }

        if (query.path.empty()) {
            throw std::runtime_error("search path is required");
        }

        const std::string url = base + "/api/search";
        const std::string body = build_search_request(query).dump();

        std::map<std::string, std::string> headers;
        headers["Accept"] = "application/json";
        headers["Content-Type"] = "application/json";
        const core::HttpResponse response = core::HTTPClient::get().post(
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

        std::vector<SearchResult> results = parse_search_results(response.body);
        if (on_complete) {
            on_complete(results);
        }
    } catch (const std::exception& e) {
        if (on_error) {
            on_error(e.what());
        }
    }
}

} // namespace misty::panel
