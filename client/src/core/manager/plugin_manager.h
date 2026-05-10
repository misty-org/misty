#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include "core/ui/ui_registry.h"

namespace misty::core {

struct PluginCommandInfo {
    std::string id;
    std::string title;
    std::string default_shortcut;
};

struct PluginPanelInfo {
    std::string id;
    std::string title;
    bool is_open = false;
};

struct PluginInfo {
    std::string id;
    std::string name;
    std::string version;
    std::string description;
    std::string author;
    std::string manifest_path;
    std::string plugin_dir;
    std::string library_path;
    bool bundled = false;
    bool enabled = true;
    bool loaded = false;
    bool faulted = false;
    bool verified = false;
    std::string signer;
    std::vector<PluginCommandInfo> commands;
    std::vector<PluginPanelInfo> panels;
    std::vector<std::string> diagnostics;
};

class PluginManager {
public:
    static PluginManager& get();

    void set_ui_registry(UIRegistry* registry);
    void discover_and_load();
    void discover_and_load(const std::vector<std::filesystem::path>& roots);
    bool load_plugin_directory(const std::filesystem::path& plugin_dir, bool bundled);
    void reload();
    void shutdown();

    void process_shortcuts();
    void render_open_panels();
    void render_active_preview_scene();
    bool invoke_command(const std::string& command_id);
    bool open_panel(const std::string& panel_id);
    bool close_panel(const std::string& panel_id);
    bool open_plugin_sandbox(const std::string& plugin_dir, std::string* error = nullptr) const;

    std::vector<std::string> discovery_roots() const;
    std::vector<PluginInfo> loaded_plugins() const;

private:
    PluginManager();
    ~PluginManager();
    PluginManager(const PluginManager&) = delete;
    PluginManager& operator=(const PluginManager&) = delete;

    struct Impl;
    Impl* impl_;
};

} // namespace misty::core
