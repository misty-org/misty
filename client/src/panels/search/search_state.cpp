#include "panels/search/search_state.h"

#include <cstring>

namespace misty::panel {

SearchState::SearchState() {
    std::memset(query_buf, 0, sizeof(query_buf));
}

} // namespace misty::panel
