#pragma once

#include <mutex>
#include <string>
#include <vector>

namespace misty::core {

struct ExtensionFileContext {
    std::string path;
    std::string name;
    std::string parent_path;
    std::string extension;
    std::string mime_type;
    bool is_dir = false;
};

struct ExtensionFileAction {
    std::string id;
    std::string title;
    std::string description;
    std::string executable;
    std::string working_directory;
    std::vector<std::string> args;
    std::vector<std::string> extensions;
    std::vector<std::string> mime_types;
    std::vector<std::string> platforms;
};

struct InstalledExtension {
    std::string id;
    std::string name;
    std::string version;
    std::string description;
    std::string author;
    std::string manifest_path;
    std::string extension_dir;
    bool bundled = false;
    bool enabled = true;
    std::vector<std::string> platforms;
    std::vector<ExtensionFileAction> file_actions;
};

struct MatchedExtensionAction {
    std::string extension_id;
    std::string extension_name;
    std::string extension_version;
    std::string extension_dir;
    bool bundled = false;
    ExtensionFileAction action;
};

class ExtensionManager {
public:
    static ExtensionManager& get();

    void reload();
    std::vector<InstalledExtension> installed_extensions();
    std::vector<MatchedExtensionAction> matching_file_actions(const ExtensionFileContext& file);
    bool invoke_file_action(const MatchedExtensionAction& matched,
                            const ExtensionFileContext& file,
                            std::string* error = nullptr);
    std::vector<std::string> discovery_roots() const;

private:
    ExtensionManager() = default;
    ~ExtensionManager() = default;
    ExtensionManager(const ExtensionManager&) = delete;
    ExtensionManager& operator=(const ExtensionManager&) = delete;

    void load_if_needed_locked();
    void discover_extensions_locked();

    std::vector<InstalledExtension> installed_extensions_;
    bool loaded_ = false;
    std::mutex mu_;
};

} // namespace misty::core
