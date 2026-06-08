#pragma once

#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "panels/file_explorer/state/file_explorer_state.h"

namespace misty::panel {

    enum class FileSource {
        LOCAL,
        REMOTE
    };

    enum class SearchResultKind {
        File,
        Folder,
        Location,
        Command,
    };

    enum class SearchTypeFilter {
        Any,
        File,
        Folder,
    };

    enum SearchSource {
        LOCAL,
        REMOTE,
        ALL
    };

    enum SearchDepth {
        CWD, //we always start from the current working directory
        DEPTH,
        SYSTEM,
        WORKSPACE,
    };

    struct SearchScope {
        SearchDepth scope_ = SearchDepth::CWD;
        int depth_ = 0;

        static SearchScope cwd() {
            return { SearchDepth::CWD, 0 };
        }
        static SearchScope depth(int d) {
            return { SearchDepth::DEPTH, d };
        }
        static SearchScope system() {
            return { SearchDepth::SYSTEM, 0};
        }
        static SearchScope workspace() {
            return { SearchDepth::WORKSPACE, 0 };
        }
    };

    struct SearchScopeValue {
        SearchDepth scope_ = SearchDepth::CWD;
        std::optional<int> depth_limit;
    };

    struct SearchResult {
        std::string id;
        std::string name;
        std::string path;
        std::string subtitle;
        std::string badge;
        std::string command_id;
        std::string provider_id;
        std::string account_id;
        std::string remote_id;
        std::string remote_path;
        FileSource source = FileSource::LOCAL;
        SearchResultKind kind = SearchResultKind::File;
        bool is_dir = false;
        int score = 0;
    };

    struct SearchRemoteStatus {
        std::string remote_id;
        std::string provider_id;
        std::string account_id;
        std::string status;
        std::string error;
        bool stale = false;
        bool refreshing = false;
    };

    struct SearchResponse {
        std::vector<SearchResult> results;
        std::vector<SearchRemoteStatus> remote_statuses;
        bool is_cached = false;
        bool refresh_in_progress = false;
        bool updated = false;
        std::string updated_at;
        std::string request_id;
    };

    struct SearchQuery {
        std::string raw_query;
        std::string query;
        std::string path;
        SearchScope depth = SearchScope::cwd();
        SearchSource source = SearchSource::LOCAL;
        SearchTypeFilter type_filter = SearchTypeFilter::Any;
        std::string name_filter;
        std::string ext_filter;
        std::string size_filter;
        std::string mtime_filter;
        bool commands_only = false;
        bool allow_cached = true;
        bool refresh_in_background = true;
        std::string request_id;
    };

    using SearchCompleteCallback = std::function<void(SearchResponse& response)>;
    using SearchUpdateCallback = std::function<void(SearchResponse& response)>;
    using SearchErrorCallback = std::function<void(const std::string& error)>;

    class SearchImpl {
    public:
        SearchImpl() = default;
        ~SearchImpl() = default;

        static std::string build_request_body(const SearchQuery& query);
        static SearchResponse parse_response_body(const std::string& body);

        void search(const SearchQuery& query,
            SearchCompleteCallback on_complete = {},
            SearchErrorCallback on_error = {},
            SearchUpdateCallback on_update = {});
    };
} //namespace misty::panel
