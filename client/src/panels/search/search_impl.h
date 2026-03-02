#pragma once

#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "panels/file_explorer/file_explorer_state.h"

namespace misty::panel {

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
        FileSource source = FileSource::LOCAL;
        bool is_dir = false;
        int score = 0;
    };

    struct SearchQuery {
        std::string query;
        std::string path;
        SearchScope depth = SearchScope::cwd();
        SearchSource source = SearchSource::LOCAL;
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
