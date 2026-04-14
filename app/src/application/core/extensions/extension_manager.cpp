#include "core/extensions/extension_manager.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <unordered_map>

#include <nlohmann/json.hpp>

#include "core/system/util.h"
#include "core/manager/env_manager.h"

namespace fs = std::filesystem;

namespace misty::core {
namespace {

std::string trim(std::string value) {
    auto not_space = [](unsigned char ch) { return !std::isspace(ch); };
    value.erase(value.begin(), std::find_if(value.begin(), value.end(), not_space));
    value.erase(std::find_if(value.rbegin(), value.rend(), not_space).base(), value.end());
    return value;
}

std::string to_lower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

std::vector<std::string> json_string_array(const nlohmann::json& value) {
    std::vector<std::string> out;
    if (!value.is_array()) {
        return out;
    }

    out.reserve(value.size());
    for (const auto& entry : value) {
        if (entry.is_string()) {
            out.push_back(entry.get<std::string>());
        }
    }
    return out;
}

std::string current_platform_name() {
#ifdef _WIN32
    return "windows";
#elif __APPLE__
    return "macos";
#elif __linux__
    return "linux";
#else
    return "unknown";
#endif
}

bool matches_platforms(const std::vector<std::string>& platforms) {
    if (platforms.empty()) {
        return true;
    }

    const std::string current = current_platform_name();
    for (const auto& platform : platforms) {
        if (to_lower(platform) == current) {
            return true;
        }
    }
    return false;
}

bool matches_mime_pattern(const std::string& pattern, const std::string& mime_type) {
    if (pattern.empty() || mime_type.empty()) {
        return false;
    }

    const std::string normalized_pattern = to_lower(pattern);
    const std::string normalized_mime = to_lower(mime_type);
    if (normalized_pattern == normalized_mime) {
        return true;
    }

    const std::size_t wildcard = normalized_pattern.find("/*");
    if (wildcard == std::string::npos) {
        return false;
    }

    const std::string prefix = normalized_pattern.substr(0, wildcard);
    return normalized_mime.rfind(prefix + "/", 0) == 0;
}

bool matches_action(const ExtensionFileAction& action, const ExtensionFileContext& file) {
    if (file.is_dir || !matches_platforms(action.platforms)) {
        return false;
    }

    const std::string file_ext = to_lower(file.extension);
    const std::string file_mime = to_lower(file.mime_type);

    const bool has_extensions = !action.extensions.empty();
    const bool has_mime_types = !action.mime_types.empty();
    if (!has_extensions && !has_mime_types) {
        return true;
    }

    bool extension_match = false;
    for (const auto& ext : action.extensions) {
        if (to_lower(ext) == file_ext) {
            extension_match = true;
            break;
        }
    }

    bool mime_match = false;
    for (const auto& pattern : action.mime_types) {
        if (matches_mime_pattern(pattern, file_mime)) {
            mime_match = true;
            break;
        }
    }

    return extension_match || mime_match;
}

std::string replace_all(std::string value, const std::string& needle, const std::string& replacement) {
    if (needle.empty()) {
        return value;
    }

    std::size_t pos = 0;
    while ((pos = value.find(needle, pos)) != std::string::npos) {
        value.replace(pos, needle.size(), replacement);
        pos += replacement.size();
    }
    return value;
}

std::string resolve_template(std::string value,
                             const MatchedExtensionAction& matched,
                             const ExtensionFileContext& file) {
    value = replace_all(value, "{file_path}", file.path);
    value = replace_all(value, "{file_name}", file.name);
    value = replace_all(value, "{file_dir}", file.parent_path);
    value = replace_all(value, "{file_ext}", file.extension);
    value = replace_all(value, "{mime_type}", file.mime_type);
    value = replace_all(value, "{extension_id}", matched.extension_id);
    value = replace_all(value, "{extension_name}", matched.extension_name);
    value = replace_all(value, "{extension_dir}", matched.extension_dir);
    value = replace_all(value, "{misty_executable_dir}", get_executable_path().parent_path().string());
    return value;
}

std::vector<std::string> split_path_env(const std::string& path_env) {
    std::vector<std::string> segments;
    if (path_env.empty()) {
        return segments;
    }

#ifdef _WIN32
    constexpr char separator = ';';
#else
    constexpr char separator = ':';
#endif

    std::size_t start = 0;
    while (start <= path_env.size()) {
        std::size_t end = path_env.find(separator, start);
        const std::string segment = end == std::string::npos
            ? path_env.substr(start)
            : path_env.substr(start, end - start);
        if (!segment.empty()) {
            segments.push_back(segment);
        }
        if (end == std::string::npos) {
            break;
        }
        start = end + 1;
    }
    return segments;
}

std::string resolve_executable(std::string executable, const std::string& extension_dir) {
    executable = trim(executable);
    if (executable.empty()) {
        return {};
    }

    fs::path candidate(executable);
    if (candidate.is_absolute() && fs::exists(candidate)) {
        return candidate.string();
    }

    if (candidate.has_parent_path()) {
        fs::path relative = fs::path(extension_dir) / candidate;
        if (fs::exists(relative)) {
            return relative.lexically_normal().string();
        }
    }

    const char* path_env = std::getenv("PATH");
    for (const auto& dir : split_path_env(path_env ? path_env : "")) {
        fs::path path_candidate = fs::path(dir) / executable;
        if (fs::exists(path_candidate)) {
            return path_candidate.string();
        }
#ifdef _WIN32
        const char* path_ext = std::getenv("PATHEXT");
        for (const auto& ext : split_path_env(path_ext ? path_ext : ".EXE;.BAT;.CMD")) {
            fs::path with_ext = fs::path(dir) / (executable + ext);
            if (fs::exists(with_ext)) {
                return with_ext.string();
            }
        }
#endif
    }

    return {};
}

InstalledExtension parse_manifest_file(const fs::path& manifest_path) {
    std::ifstream file(manifest_path);
    nlohmann::json json;
    file >> json;

    InstalledExtension extension;
    extension.id = trim(json.value("id", std::string()));
    extension.name = trim(json.value("name", std::string()));
    extension.version = trim(json.value("version", std::string("0.0.0")));
    extension.description = trim(json.value("description", std::string()));
    extension.author = trim(json.value("author", std::string()));
    extension.enabled = json.value("enabled", true);
    extension.platforms = json_string_array(json.value("platforms", nlohmann::json::array()));
    extension.manifest_path = manifest_path.string();
    extension.extension_dir = manifest_path.parent_path().string();

    for (const auto& action_json : json.value("file_actions", nlohmann::json::array())) {
        if (!action_json.is_object()) {
            continue;
        }

        ExtensionFileAction action;
        action.id = trim(action_json.value("id", std::string()));
        action.title = trim(action_json.value("title", std::string()));
        action.description = trim(action_json.value("description", std::string()));
        action.executable = trim(action_json.value("executable", std::string()));
        action.working_directory = trim(action_json.value("working_directory", std::string()));
        action.args = json_string_array(action_json.value("args", nlohmann::json::array()));
        action.extensions = json_string_array(action_json.value("extensions", nlohmann::json::array()));
        action.mime_types = json_string_array(action_json.value("mime_types", nlohmann::json::array()));
        action.platforms = json_string_array(action_json.value("platforms", nlohmann::json::array()));

        if (action.id.empty() || action.title.empty() || action.executable.empty()) {
            continue;
        }

        extension.file_actions.push_back(std::move(action));
    }

    return extension;
}

void upsert_extension(std::vector<InstalledExtension>& installed, InstalledExtension extension) {
    auto existing = std::find_if(installed.begin(), installed.end(), [&](const InstalledExtension& current) {
        return current.id == extension.id;
    });

    if (existing == installed.end()) {
        installed.push_back(std::move(extension));
        return;
    }

    *existing = std::move(extension);
}

void discover_root(std::vector<InstalledExtension>& installed, const fs::path& root, bool bundled) {
    std::error_code ec;
    if (!fs::exists(root, ec) || !fs::is_directory(root, ec)) {
        return;
    }

    for (const auto& entry : fs::directory_iterator(root, ec)) {
        if (ec || !entry.is_directory()) {
            continue;
        }

        const fs::path manifest_path = entry.path() / "manifest.json";
        if (!fs::exists(manifest_path, ec) || ec) {
            continue;
        }

        try {
            InstalledExtension extension = parse_manifest_file(manifest_path);
            extension.bundled = bundled;
            if (extension.id.empty() || extension.name.empty()) {
                continue;
            }
            if (!extension.enabled || !matches_platforms(extension.platforms)) {
                continue;
            }

            upsert_extension(installed, std::move(extension));
        } catch (...) {
        }
    }
}

} // namespace

ExtensionManager& ExtensionManager::get() {
    static ExtensionManager instance;
    return instance;
}

void ExtensionManager::reload() {
    std::lock_guard<std::mutex> lock(mu_);
    discover_extensions_locked();
}

std::vector<InstalledExtension> ExtensionManager::installed_extensions() {
    std::lock_guard<std::mutex> lock(mu_);
    load_if_needed_locked();
    return installed_extensions_;
}

std::vector<MatchedExtensionAction> ExtensionManager::matching_file_actions(const ExtensionFileContext& file) {
    std::lock_guard<std::mutex> lock(mu_);
    load_if_needed_locked();

    std::vector<MatchedExtensionAction> matches;
    for (const auto& extension : installed_extensions_) {
        for (const auto& action : extension.file_actions) {
            if (!matches_action(action, file)) {
                continue;
            }

            matches.push_back(MatchedExtensionAction{
                .extension_id = extension.id,
                .extension_name = extension.name,
                .extension_version = extension.version,
                .extension_dir = extension.extension_dir,
                .bundled = extension.bundled,
                .action = action,
            });
        }
    }

    std::sort(matches.begin(), matches.end(), [](const MatchedExtensionAction& lhs, const MatchedExtensionAction& rhs) {
        if (lhs.action.title != rhs.action.title) {
            return lhs.action.title < rhs.action.title;
        }
        return lhs.extension_name < rhs.extension_name;
    });
    return matches;
}

bool ExtensionManager::invoke_file_action(const MatchedExtensionAction& matched,
                                          const ExtensionFileContext& file,
                                          std::string* error) {
    const std::string executable_template = resolve_template(matched.action.executable, matched, file);
    const std::string executable = resolve_executable(executable_template, matched.extension_dir);
    if (executable.empty()) {
        if (error) {
            *error = "Extension executable was not found.";
        }
        return false;
    }

    std::vector<std::string> args;
    args.reserve(matched.action.args.size());
    for (const auto& arg : matched.action.args) {
        args.push_back(resolve_template(arg, matched, file));
    }

    std::string working_directory = matched.action.working_directory.empty()
        ? matched.extension_dir
        : resolve_template(matched.action.working_directory, matched, file);
    if (!working_directory.empty()) {
        fs::path cwd_path(working_directory);
        if (cwd_path.is_relative()) {
            working_directory = (fs::path(matched.extension_dir) / cwd_path).lexically_normal().string();
        }
    }

    if (!launch_detached_process(executable, args, working_directory)) {
        if (error) {
            *error = "Failed to launch extension process.";
        }
        return false;
    }

    return true;
}

std::vector<std::string> ExtensionManager::discovery_roots() const {
    std::vector<std::string> roots;
    roots.push_back((get_executable_path().parent_path() / "extensions").string());
    roots.push_back((fs::path(EnvManager::get().get_user_home_dir()) / ".misty" / "extensions").string());
    return roots;
}

void ExtensionManager::load_if_needed_locked() {
    if (loaded_) {
        return;
    }
    discover_extensions_locked();
}

void ExtensionManager::discover_extensions_locked() {
    installed_extensions_.clear();

    const auto roots = discovery_roots();
    if (!roots.empty()) {
        discover_root(installed_extensions_, roots[0], true);
    }
    if (roots.size() > 1) {
        discover_root(installed_extensions_, roots[1], false);
    }

    std::sort(installed_extensions_.begin(), installed_extensions_.end(), [](const InstalledExtension& lhs, const InstalledExtension& rhs) {
        if (lhs.bundled != rhs.bundled) {
            return lhs.bundled > rhs.bundled;
        }
        return lhs.name < rhs.name;
    });

    loaded_ = true;
}

} // namespace misty::core
