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
        FileSource source = FileSource::LOCAL;
        SearchResultKind kind = SearchResultKind::File;
        bool is_dir = false;
        int score = 0;
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
    };

    using SearchCompleteCallback = std::function<void(std::vector<SearchResult>& results)>;
    using SearchErrorCallback = std::function<void(const std::string& error)>;

    class SearchImpl {
    public:
        SearchImpl() = default;
        ~SearchImpl() = default;

        void search(const SearchQuery& query,
            SearchCompleteCallback on_complete = {},
            SearchErrorCallback on_error = {});
    };
} //namespace misty::panel
