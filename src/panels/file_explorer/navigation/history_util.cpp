#include "panels/file_explorer/navigation/history_util.h"

#include "core/system/util.h"

#include <filesystem>

namespace fs = std::filesystem;

namespace misty::panel {

std::string normalize_history_path(const std::string& path) {
    if (path.empty() || path.rfind("misty://", 0) == 0) {
        return misty::core::strip_trailing_separators(path);
    }

    std::error_code ec;
    fs::path normalized = fs::weakly_canonical(fs::path(path), ec);
    if (ec) {
        normalized = fs::path(path).lexically_normal();
    }
    return misty::core::strip_trailing_separators(normalized.generic_string());
}

bool same_history_path(const std::string& lhs, const std::string& rhs) {
    return normalize_history_path(lhs) == normalize_history_path(rhs);
}

void push_history_path(std::stack<std::string>& history, const std::string& path) {
    if (path.empty()) {
        return;
    }
    if (!history.empty() && same_history_path(history.top(), path)) {
        return;
    }
    history.push(path);
}

}  // namespace misty::panel
