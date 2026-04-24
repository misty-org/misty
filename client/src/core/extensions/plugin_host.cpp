#include "core/extensions/plugin_host.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>
#include <optional>
#include <unordered_map>
#include <utility>

#include <nlohmann/json.hpp>

#include "core/commands/command_manager.h"
#include "core/system/util.h"
#include "core/extensions/plugin_signing.h"
#include <glad/glad.h>
#include "imgui.h"
#include "panels/file_explorer/file_explorer_state.h"
#include "panels/activity/activity_state.h"
#include "panels/notification/notification_state.h"
#include "views/app_view.h"

#if defined(_WIN32)
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace fs = std::filesystem;

namespace misty::core {
namespace {

std::string trim_copy(std::string value) {
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

bool path_is_within(const fs::path& root, const fs::path& candidate) {
    std::error_code root_ec;
    std::error_code candidate_ec;
    const fs::path normalized_root = fs::weakly_canonical(root, root_ec);
    const fs::path normalized_candidate = fs::weakly_canonical(candidate, candidate_ec);
    if (root_ec || candidate_ec) {
        return false;
    }

    auto root_it = normalized_root.begin();
    auto candidate_it = normalized_candidate.begin();
    for (; root_it != normalized_root.end(); ++root_it, ++candidate_it) {
        if (candidate_it == normalized_candidate.end() || *root_it != *candidate_it) {
            return false;
        }
    }
    return true;
}

bool matches_platforms(const std::vector<std::string>& platforms, const std::string& host_os) {
    if (platforms.empty()) {
        return true;
    }
    for (const auto& platform : platforms) {
        if (to_lower(platform) == host_os) {
            return true;
        }
    }
    return false;
}

std::string view_id_to_string(view::ViewID view_id) {
    switch (view_id) {
        case view::ViewID::Auth: return "Auth";
        case view::ViewID::Login: return "Login";
        case view::ViewID::Onboarding: return "Onboarding";
        case view::ViewID::Files: return "Files";
        case view::ViewID::Settings: return "Settings";
        case view::ViewID::Workspace: return "Workspace";
        case view::ViewID::Activity: return "Activity";
        case view::ViewID::Services: return "Services";
        case view::ViewID::Extensions: return "Extensions";
        case view::ViewID::Vault: return "Vault";
        case view::ViewID::EditProfile: return "EditProfile";
        case view::ViewID::Default: return "Default";
    }
    return "Unknown";
}

class DynamicLibrary {
public:
    DynamicLibrary() = default;
    ~DynamicLibrary() { close(); }

    DynamicLibrary(const DynamicLibrary&) = delete;
    DynamicLibrary& operator=(const DynamicLibrary&) = delete;
    DynamicLibrary(DynamicLibrary&& other) noexcept
        : handle_(other.handle_) {
        other.handle_ = nullptr;
    }
    DynamicLibrary& operator=(DynamicLibrary&& other) noexcept {
        if (this == &other) {
            return *this;
        }
        close();
        handle_ = other.handle_;
        other.handle_ = nullptr;
        return *this;
    }

    bool open(const fs::path& path, std::string* error) {
        close();
#if defined(_WIN32)
        handle_ = LoadLibraryA(path.string().c_str());
        if (!handle_) {
            if (error) {
                *error = "LoadLibrary failed for plugin.";
            }
            return false;
        }
#else
        handle_ = dlopen(path.string().c_str(), RTLD_NOW | RTLD_LOCAL);
        if (!handle_) {
            if (error) {
                *error = dlerror() ? dlerror() : "dlopen failed for plugin.";
            }
            return false;
        }
#endif
        return true;
    }

    void* symbol(const char* name) const {
        if (!handle_) {
            return nullptr;
        }
#if defined(_WIN32)
        return reinterpret_cast<void*>(GetProcAddress(static_cast<HMODULE>(handle_), name));
#else
        return dlsym(handle_, name);
#endif
    }

    void close() {
        if (!handle_) {
            return;
        }
#if defined(_WIN32)
        FreeLibrary(static_cast<HMODULE>(handle_));
#else
        dlclose(handle_);
#endif
        handle_ = nullptr;
    }

private:
    void* handle_ = nullptr;
};

} // namespace

struct PluginHost::Impl {
    struct PluginCommand {
        std::string id;
        std::string title;
        std::string default_shortcut;
        misty::CommandInvokeFn invoke = nullptr;
        void* user_data = nullptr;
        std::size_t plugin_index = 0;
    };

    struct PluginPanel {
        std::string id;
        std::string title;
        misty::PanelRenderFn render = nullptr;
        void* user_data = nullptr;
        bool is_open = false;
        std::size_t plugin_index = 0;
    };

    struct LoadedPlugin {
        PluginInfo info;
        DynamicLibrary library;
        bool active = false;
    };

    struct RegistryContext {
        Impl* owner;
        std::size_t plugin_index;
    };

    UIRegistry* ui_registry = nullptr;
    std::vector<LoadedPlugin> plugins;
    std::vector<PluginCommand> commands;
    std::vector<PluginPanel> panels;
    std::unordered_map<std::string, std::size_t> plugin_index_by_id;
    std::unordered_map<std::string, std::size_t> command_index_by_id;
    std::unordered_map<std::string, std::size_t> panel_index_by_id;

    Impl() = default;

    // ----- Host API trampolines -----
    static Impl* as_impl(void* h) { return static_cast<Impl*>(h); }

    static int c_open_panel(void* h, const char* id) {
        if (!h || !id || !*id) return 0;
        return as_impl(h)->open_panel(id) ? 1 : 0;
    }
    static int c_close_panel(void* h, const char* id) {
        if (!h || !id || !*id) return 0;
        return as_impl(h)->close_panel(id) ? 1 : 0;
    }
    static int c_is_panel_open(void* h, const char* id) {
        if (!h || !id || !*id) return 0;
        return as_impl(h)->is_panel_open(id) ? 1 : 0;
    }
    static int c_invoke_command(void* h, const char* id) {
        if (!h || !id || !*id) return 0;
        return as_impl(h)->invoke_command_from_plugin(id) ? 1 : 0;
    }
    static int c_copy_current_view_id(void* h, char* buffer, std::size_t size) {
        if (!h || !buffer || size == 0) return 0;
        const std::string name = view_id_to_string(view::get_current_view_id());
        const std::size_t max_copy = std::min(size - 1, name.size());
        std::memcpy(buffer, name.data(), max_copy);
        buffer[max_copy] = '\0';
        return 1;
    }
    static void c_notify(void* h, int level, const char* title, const char* message) {
        if (!h) return;
        auto* self = as_impl(h);
        if (!self->ui_registry) return;
        const std::string sender = title ? title : "Extension";
        const std::string msg = message ? message : "";
        if (level == MISTY_NOTIFICATION_ERROR) {
            auto& activity = self->ui_registry->get_state<panel::ActivityState>("Activity");
            activity.add_entry(sender, msg, panel::ActivityEntryType::ERROR);
        } else {
            auto& notifications = self->ui_registry->get_state<panel::NotificationState>("Notifications");
            notifications.add_notification(sender + ": " + msg);
        }
    }
    static std::uint32_t c_create_texture(void* h, int width, int height,
                                          const unsigned char* rgba_pixels) {
        (void)h;
        if (width <= 0 || height <= 0 || !rgba_pixels) return 0;
        GLuint tex = 0;
        glGenTextures(1, &tex);
        if (tex == 0) return 0;
        glBindTexture(GL_TEXTURE_2D, tex);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0,
                     GL_RGBA, GL_UNSIGNED_BYTE, rgba_pixels);
        return static_cast<std::uint32_t>(tex);
    }
    static void c_destroy_texture(void* h, std::uint32_t texture_id) {
        (void)h;
        if (texture_id != 0) {
            GLuint tex = static_cast<GLuint>(texture_id);
            glDeleteTextures(1, &tex);
        }
    }
    static int c_copy_selected_file_path(void* h, char* buffer, std::size_t size) {
        if (!h || !buffer || size == 0) return 0;
        auto* self = as_impl(h);
        if (!self->ui_registry) return 0;
        std::string explorer_state_key = "Files";
        if (auto* current_view = view::ViewRegistry::get().get_current_view()) {
            explorer_state_key = current_view->active_explorer_state_key();
        }
        auto& fe_state = self->ui_registry->get_state<panel::FileExplorerState>(explorer_state_key);
        if (fe_state.selected_files.empty()) return 0;
        const std::string path = fe_state.path_for_selection(*fe_state.selected_files.begin());
        const std::size_t max_copy = std::min(size - 1, path.size());
        std::memcpy(buffer, path.data(), max_copy);
        buffer[max_copy] = '\0';
        return 1;
    }

    // ----- UI API trampolines (stateless; ImGui owns the current window) -----
    static void c_ui_text(void*, const char* t) {
        ImGui::TextUnformatted(t ? t : "");
    }
    static void c_ui_text_wrapped(void*, const char* t) {
        ImGui::TextWrapped("%s", t ? t : "");
    }
    static int c_ui_button(void*, const char* label, float width, float height) {
        return ImGui::Button(label ? label : "", ImVec2(width, height)) ? 1 : 0;
    }
    static void c_ui_same_line(void*) { ImGui::SameLine(); }
    static void c_ui_separator(void*) { ImGui::Separator(); }
    static void c_ui_spacing(void*)   { ImGui::Spacing(); }
    static void c_ui_image(void*, std::uint32_t texture_id, float width, float height) {
        if (texture_id != 0) {
            ImGui::Image(static_cast<ImTextureID>(static_cast<uintptr_t>(texture_id)),
                         ImVec2(width, height));
        }
    }
    static void c_ui_get_content_region_avail(void*, float* width, float* height) {
        ImVec2 avail = ImGui::GetContentRegionAvail();
        if (width)  *width = avail.x;
        if (height) *height = avail.y;
    }
    static int c_ui_begin_child(void*, const char* id, float width, float height, int border) {
        return ImGui::BeginChild(id ? id : "", ImVec2(width, height), border != 0) ? 1 : 0;
    }
    static void c_ui_end_child(void*) { ImGui::EndChild(); }

    // ----- Registry API trampolines -----
    static int c_register_command(void* r, const MistyCommandReg* cmd) {
        if (!r || !cmd) return 0;
        auto* ctx = static_cast<RegistryContext*>(r);
        return ctx->owner->register_command_from_plugin(ctx->plugin_index, *cmd) ? 1 : 0;
    }
    static int c_register_panel(void* r, const MistyPanelReg* panel) {
        if (!r || !panel) return 0;
        auto* ctx = static_cast<RegistryContext*>(r);
        return ctx->owner->register_panel_from_plugin(ctx->plugin_index, *panel) ? 1 : 0;
    }

    static const MistyHostApi& host_api() {
        static const MistyHostApi kApi = {
            MISTY_PLUGIN_ABI_VERSION,
            &c_open_panel, &c_close_panel, &c_is_panel_open, &c_invoke_command,
            &c_copy_current_view_id, &c_notify,
            &c_create_texture, &c_destroy_texture,
            &c_copy_selected_file_path,
        };
        return kApi;
    }
    static const MistyUiApi& ui_api() {
        static const MistyUiApi kApi = {
            MISTY_PLUGIN_ABI_VERSION,
            &c_ui_text, &c_ui_text_wrapped, &c_ui_button,
            &c_ui_same_line, &c_ui_separator, &c_ui_spacing,
            &c_ui_image, &c_ui_get_content_region_avail,
            &c_ui_begin_child, &c_ui_end_child,
        };
        return kApi;
    }
    static const MistyRegistryApi& registry_api() {
        static const MistyRegistryApi kApi = {
            MISTY_PLUGIN_ABI_VERSION,
            &c_register_command, &c_register_panel,
        };
        return kApi;
    }

    MistyInvokeContext make_invoke_context() {
        return MistyInvokeContext{ MISTY_PLUGIN_ABI_VERSION, this, &host_api() };
    }
    MistyRenderContext make_render_context() {
        return MistyRenderContext{ MISTY_PLUGIN_ABI_VERSION, this, &host_api(),
                                   nullptr, &ui_api() };
    }

    bool register_command_from_plugin(std::size_t plugin_index, const MistyCommandReg& command) {
        if (!command.id || !command.title || !command.invoke) {
            append_diagnostic(plugin_index, "Plugin attempted to register an invalid command.");
            return false;
        }
        const std::string id = trim_copy(command.id);
        const std::string title = trim_copy(command.title);
        if (id.empty() || title.empty()) {
            append_diagnostic(plugin_index,
                "Plugin attempted to register a command with an empty id or title.");
            return false;
        }
        if (command_index_by_id.contains(id)) {
            append_diagnostic(plugin_index,
                "Plugin attempted to register a duplicate command id: " + id);
            return false;
        }

        PluginCommand plugin_command;
        plugin_command.id = id;
        plugin_command.title = title;
        plugin_command.default_shortcut =
            command.default_shortcut ? command.default_shortcut : "";
        plugin_command.invoke = command.invoke;
        plugin_command.user_data = command.user_data;
        plugin_command.plugin_index = plugin_index;

        command_index_by_id[id] = commands.size();
        commands.push_back(plugin_command);
        plugins[plugin_index].info.commands.push_back(
            PluginCommandInfo{plugin_command.id, plugin_command.title,
                              plugin_command.default_shortcut});
        if (!plugin_command.default_shortcut.empty()) {
            CommandManager::get().register_runtime_command(
                plugin_command.id, plugin_command.default_shortcut);
        }
        return true;
    }

    bool register_panel_from_plugin(std::size_t plugin_index, const MistyPanelReg& panel) {
        if (!panel.id || !panel.title || !panel.render) {
            append_diagnostic(plugin_index, "Plugin attempted to register an invalid panel.");
            return false;
        }
        const std::string id = trim_copy(panel.id);
        const std::string title = trim_copy(panel.title);
        if (id.empty() || title.empty()) {
            append_diagnostic(plugin_index,
                "Plugin attempted to register a panel with an empty id or title.");
            return false;
        }
        if (panel_index_by_id.contains(id)) {
            append_diagnostic(plugin_index,
                "Plugin attempted to register a duplicate panel id: " + id);
            return false;
        }

        PluginPanel plugin_panel;
        plugin_panel.id = id;
        plugin_panel.title = title;
        plugin_panel.render = panel.render;
        plugin_panel.user_data = panel.user_data;
        plugin_panel.is_open = panel.default_open != 0;
        plugin_panel.plugin_index = plugin_index;

        panel_index_by_id[id] = panels.size();
        panels.push_back(plugin_panel);
        plugins[plugin_index].info.panels.push_back(
            PluginPanelInfo{plugin_panel.id, plugin_panel.title,
                            plugin_panel.is_open});
        return true;
    }

    bool invoke_command_from_plugin(const std::string& id) {
        if (auto* current_view = view::ViewRegistry::get().get_current_view()) {
            if (current_view->invoke_command(id)) {
                return true;
            }
        }
        const auto it = command_index_by_id.find(id);
        if (it == command_index_by_id.end()) {
            return false;
        }
        const auto& command = commands[it->second];
        if (!is_plugin_active(command.plugin_index)) {
            return false;
        }
        MistyInvokeContext ctx = make_invoke_context();
        try {
            command.invoke(&ctx, command.user_data);
        } catch (const std::exception& e) {
            fault_plugin(command.plugin_index,
                         std::string("Command callback threw an exception for ") + command.id + ": " + e.what());
            return false;
        } catch (...) {
            fault_plugin(command.plugin_index,
                         std::string("Command callback threw a non-standard exception for ") + command.id + ".");
            return false;
        }
        return true;
    }

    void append_diagnostic(std::size_t plugin_index, std::string message) {
        if (plugin_index >= plugins.size() || message.empty()) {
            return;
        }
        plugins[plugin_index].info.diagnostics.push_back(std::move(message));
    }

    bool is_plugin_active(std::size_t plugin_index) const {
        return plugin_index < plugins.size() && plugins[plugin_index].active;
    }

    void fault_plugin(std::size_t plugin_index, std::string message) {
        if (plugin_index >= plugins.size()) {
            return;
        }

        plugins[plugin_index].active = false;
        plugins[plugin_index].info.faulted = true;
        append_diagnostic(plugin_index, std::move(message));

        if (ui_registry && !plugins[plugin_index].info.diagnostics.empty()) {
            auto& activity = ui_registry->get_state<panel::ActivityState>("Activity");
            activity.add_entry("System",
                               plugins[plugin_index].info.name + " faulted and was disabled.",
                               panel::ActivityEntryType::ERROR);
        }

        for (auto& panel : panels) {
            if (panel.plugin_index == plugin_index) {
                panel.is_open = false;
            }
        }
    }

    bool open_panel(const std::string& panel_id) {
        auto it = panel_index_by_id.find(panel_id);
        if (it == panel_index_by_id.end()) {
            return false;
        }
        if (!is_plugin_active(panels[it->second].plugin_index)) {
            return false;
        }
        panels[it->second].is_open = true;
        return true;
    }

    bool close_panel(const std::string& panel_id) {
        auto it = panel_index_by_id.find(panel_id);
        if (it == panel_index_by_id.end()) {
            return false;
        }
        panels[it->second].is_open = false;
        return true;
    }

    bool is_panel_open(const std::string& panel_id) const {
        auto it = panel_index_by_id.find(panel_id);
        return it != panel_index_by_id.end() &&
               is_plugin_active(panels[it->second].plugin_index) &&
               panels[it->second].is_open;
    }
};

PluginHost& PluginHost::get() {
    static PluginHost instance;
    return instance;
}

PluginHost::PluginHost()
    : impl_(new Impl()) {
}

PluginHost::~PluginHost() {
    shutdown();
    delete impl_;
    impl_ = nullptr;
}

void PluginHost::set_ui_registry(UIRegistry* registry) {
    impl_->ui_registry = registry;
}

std::vector<std::string> PluginHost::discovery_roots() const {
    std::vector<std::string> roots;
    if (const char* home = std::getenv("HOME"); home && *home) {
        roots.push_back((fs::path(home) / "misty" / "public" / "plugins").string());
        roots.push_back((fs::path(home) / "misty" / "local" / "plugins").string());
    }
    return roots;
}

void PluginHost::discover_and_load() {
    std::vector<fs::path> roots;
    const auto root_strings = discovery_roots();
    roots.reserve(root_strings.size());
    for (const auto& root : root_strings) {
        roots.emplace_back(root);
    }
    discover_and_load(roots);
}

void PluginHost::discover_and_load(const std::vector<fs::path>& roots) {
    shutdown();
    for (std::size_t i = 0; i < roots.size(); ++i) {
        std::error_code ec;
        if (!fs::exists(roots[i], ec) || !fs::is_directory(roots[i], ec)) {
            continue;
        }

        for (const auto& entry : fs::directory_iterator(roots[i], ec)) {
            if (ec || !entry.is_directory()) {
                continue;
            }
            load_plugin_directory(entry.path(), i == 0);
        }
    }
}

bool PluginHost::load_plugin_directory(const fs::path& plugin_dir, bool bundled) {
    PluginInfo info;
    info.plugin_dir = plugin_dir.string();
    info.bundled = bundled;

    const fs::path manifest_path = plugin_dir / "manifest.json";
    info.manifest_path = manifest_path.string();

    std::error_code ec;
    if (!fs::exists(manifest_path, ec) || ec) {
        return false;
    }

    nlohmann::json json;
    try {
        std::ifstream file(manifest_path);
        file >> json;
    } catch (const std::exception& e) {
        info.diagnostics.push_back(std::string("Failed to parse manifest: ") + e.what());
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }

    info.id = trim_copy(json.value("id", std::string()));
    info.name = trim_copy(json.value("name", std::string()));
    info.version = trim_copy(json.value("version", std::string("0.0.0")));
    info.description = trim_copy(json.value("description", std::string()));
    info.author = trim_copy(json.value("author", std::string()));
    info.enabled = json.value("enabled", true);
    const int schema_version = json.value("schema_version", 0);
    const auto platforms = json_string_array(json.value("platforms", nlohmann::json::array()));

    const HostPlatform host_platform = current_host_platform();

    if (info.id.empty() || info.name.empty()) {
        info.diagnostics.push_back("Manifest must include non-empty id and name.");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }
    if (schema_version != 2) {
        info.diagnostics.push_back("This Misty build only supports plugin manifest schema_version 2.");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }
    if (impl_->plugin_index_by_id.contains(info.id)) {
        info.diagnostics.push_back("A plugin with this id is already loaded.");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }
    if (!info.enabled) {
        info.diagnostics.push_back("Plugin is disabled.");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }
    if (!matches_platforms(platforms, host_platform.os)) {
        info.diagnostics.push_back("Plugin does not match the current platform.");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }

    const auto plugin_json = json.value("plugin", nlohmann::json::object());
    const uint32_t manifest_abi = plugin_json.value("abi_version", 0u);
    if (manifest_abi != MISTY_PLUGIN_ABI_VERSION) {
        info.diagnostics.push_back("Manifest ABI version does not match Misty's plugin ABI.");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }

    const auto variants_json = plugin_json.value("variants", nlohmann::json::array());
    if (!variants_json.is_array() || variants_json.empty()) {
        info.diagnostics.push_back("Manifest is missing plugin.variants.");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }

    std::vector<ManifestVariant> variants;
    variants.reserve(variants_json.size());
    for (const auto& vj : variants_json) {
        if (!vj.is_object()) continue;
        ManifestVariant mv;
        mv.os = trim_copy(vj.value("os", std::string()));
        mv.arch = trim_copy(vj.value("arch", std::string()));
        mv.runtime = trim_copy(vj.value("runtime", std::string()));
        mv.library = trim_copy(vj.value("library", std::string()));
        mv.sha256 = trim_copy(vj.value("sha256", std::string()));
        mv.build_id = trim_copy(vj.value("build_id", std::string()));
        mv.sdk_version = trim_copy(vj.value("sdk_version", std::string()));
        variants.push_back(std::move(mv));
    }

    const auto selected_opt = select_variant(variants, host_platform);
    if (!selected_opt.has_value()) {
        info.diagnostics.push_back(
            "No plugin variant matches this host (" + host_platform.os + "-" +
            host_platform.arch + "/" + host_platform.runtime + ").");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }
    const ManifestVariant& selected = *selected_opt;

    if (selected.library.empty()) {
        info.diagnostics.push_back("Selected plugin variant is missing its library path.");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }

    fs::path library_candidate(selected.library);
    if (library_candidate.is_absolute()) {
        info.diagnostics.push_back("Variant library must be a relative path inside the plugin directory.");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }

    const fs::path resolved_library = (plugin_dir / library_candidate).lexically_normal();
    if (!path_is_within(plugin_dir, resolved_library)) {
        info.diagnostics.push_back("Variant library resolves outside the plugin directory.");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }
    if (!fs::exists(resolved_library, ec) || ec || !fs::is_regular_file(resolved_library, ec)) {
        info.diagnostics.push_back("Plugin variant library was not found.");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }

    info.library_path = resolved_library.string();

    // Public plugins (~/misty/public/plugins) must be signed and verified.
    // Local plugins (~/misty/local/plugins) are allowed to be unsigned.
    if (bundled) {
        PluginVerificationResult verification = verify_plugin_manifest(json, plugin_dir, resolved_library, selected);
        info.verified = verification.signature_verified;
        info.signer = verification.signer;
        if (!verification.has_signature) {
            info.diagnostics.push_back("Public plugins must be signed.");
        }
        for (auto& diagnostic : verification.diagnostics) {
            info.diagnostics.push_back(std::move(diagnostic));
        }
    }
    if (!info.diagnostics.empty()) {
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }

    Impl::LoadedPlugin plugin;
    plugin.info = info;
    std::string open_error;
    if (!plugin.library.open(resolved_library, &open_error)) {
        plugin.info.diagnostics.push_back(open_error.empty() ? "Failed to load plugin library." : open_error);
        impl_->plugins.push_back(std::move(plugin));
        return false;
    }

    const auto abi_fn = reinterpret_cast<MistyPluginAbiVersionFn>(plugin.library.symbol("misty_plugin_abi_version"));
    const auto register_fn = reinterpret_cast<MistyPluginRegisterFn>(plugin.library.symbol("misty_plugin_register"));
    if (!abi_fn || !register_fn) {
        plugin.info.diagnostics.push_back("Plugin library is missing required export symbols.");
        impl_->plugins.push_back(std::move(plugin));
        return false;
    }

    uint32_t exported_abi = 0;
    try {
        exported_abi = abi_fn();
    } catch (const std::exception& e) {
        plugin.info.diagnostics.push_back(std::string("Plugin ABI probe threw an exception: ") + e.what());
        impl_->plugins.push_back(std::move(plugin));
        return false;
    } catch (...) {
        plugin.info.diagnostics.push_back("Plugin ABI probe threw a non-standard exception.");
        impl_->plugins.push_back(std::move(plugin));
        return false;
    }

    if (exported_abi != MISTY_PLUGIN_ABI_VERSION) {
        plugin.info.diagnostics.push_back("Plugin export ABI does not match Misty.");
        impl_->plugins.push_back(std::move(plugin));
        return false;
    }

    const std::size_t plugin_index = impl_->plugins.size();
    impl_->plugins.push_back(std::move(plugin));
    impl_->plugin_index_by_id[impl_->plugins[plugin_index].info.id] = plugin_index;

    Impl::RegistryContext registry_ctx{impl_, plugin_index};
    MistyPluginContext plugin_ctx = {
        MISTY_PLUGIN_ABI_VERSION,
        impl_,
        &Impl::host_api(),
        &registry_ctx,
        &Impl::registry_api(),
    };

    int register_result = 0;
    try {
        register_result = register_fn(&plugin_ctx);
    } catch (const std::exception& e) {
        impl_->plugins[plugin_index].info.diagnostics.push_back(
            std::string("Plugin registration threw an exception: ") + e.what());
        return false;
    } catch (...) {
        impl_->plugins[plugin_index].info.diagnostics.push_back(
            "Plugin registration threw a non-standard exception.");
        return false;
    }

    if (register_result == 0) {
        impl_->plugins[plugin_index].info.diagnostics.push_back("Plugin registration returned failure.");
        return false;
    }

    impl_->plugins[plugin_index].info.loaded = true;
    impl_->plugins[plugin_index].active = true;
    return true;
}

void PluginHost::reload() {
    discover_and_load();
}

void PluginHost::shutdown() {
    CommandManager::get().clear_runtime_commands();
    impl_->panels.clear();
    impl_->commands.clear();
    impl_->plugin_index_by_id.clear();
    impl_->panel_index_by_id.clear();
    impl_->command_index_by_id.clear();
    impl_->plugins.clear();
}

void PluginHost::process_shortcuts() {
    MistyInvokeContext ctx = impl_->make_invoke_context();
    for (const auto& command : impl_->commands) {
        if (!impl_->is_plugin_active(command.plugin_index)) {
            continue;
        }
        if (!CommandManager::get().matches(command.id)) {
            continue;
        }
        try {
            command.invoke(&ctx, command.user_data);
        } catch (const std::exception& e) {
            impl_->fault_plugin(command.plugin_index,
                                std::string("Command callback threw an exception for ") + command.id + ": " + e.what());
        } catch (...) {
            impl_->fault_plugin(command.plugin_index,
                                std::string("Command callback threw a non-standard exception for ") + command.id + ".");
        }
    }
}

void PluginHost::render_open_panels() {
    for (auto& panel : impl_->panels) {
        if (!panel.is_open || !impl_->is_plugin_active(panel.plugin_index)) {
            continue;
        }

        bool keep_open = true;
        const std::string window_id = panel.title + "##" + panel.id;
        ImGui::SetNextWindowSize(ImVec2(480.0f, 360.0f), ImGuiCond_FirstUseEver);
        if (ImGui::Begin(window_id.c_str(), &keep_open)) {
            MistyRenderContext render_ctx = impl_->make_render_context();
            try {
                panel.render(&render_ctx, panel.user_data);
            } catch (const std::exception& e) {
                impl_->fault_plugin(panel.plugin_index,
                                    std::string("Panel render callback threw an exception for ") + panel.id + ": " + e.what());
                keep_open = false;
            } catch (...) {
                impl_->fault_plugin(panel.plugin_index,
                                    std::string("Panel render callback threw a non-standard exception for ") + panel.id + ".");
                keep_open = false;
            }
        }
        ImGui::End();
        panel.is_open = keep_open;
    }
}

bool PluginHost::invoke_command(const std::string& command_id) {
    auto it = impl_->command_index_by_id.find(command_id);
    if (it == impl_->command_index_by_id.end()) {
        return false;
    }
    const auto& command = impl_->commands[it->second];
    if (!impl_->is_plugin_active(command.plugin_index)) {
        return false;
    }
    MistyInvokeContext ctx = impl_->make_invoke_context();
    try {
        command.invoke(&ctx, command.user_data);
    } catch (const std::exception& e) {
        impl_->fault_plugin(command.plugin_index,
                            std::string("Command callback threw an exception for ") + command.id + ": " + e.what());
        return false;
    } catch (...) {
        impl_->fault_plugin(command.plugin_index,
                            std::string("Command callback threw a non-standard exception for ") + command.id + ".");
        return false;
    }
    return true;
}

bool PluginHost::open_panel(const std::string& panel_id) {
    return impl_->open_panel(panel_id);
}

bool PluginHost::close_panel(const std::string& panel_id) {
    return impl_->close_panel(panel_id);
}

bool PluginHost::open_plugin_sandbox(const std::string& plugin_dir, std::string* error) const {
    if (plugin_dir.empty()) {
        if (error) {
            *error = "Plugin directory is empty.";
        }
        return false;
    }

    fs::path helper = get_executable_path().parent_path() / "misty-plugin-sandbox";
#ifdef _WIN32
    helper += ".exe";
#endif
    if (!fs::exists(helper)) {
        if (error) {
            *error = "The Misty plugin sandbox executable was not found.";
        }
        return false;
    }

    if (!launch_detached_process(helper.string(), {"--plugin-dir", plugin_dir}, helper.parent_path().string())) {
        if (error) {
            *error = "Failed to launch the Misty plugin sandbox.";
        }
        return false;
    }

    return true;
}

std::vector<PluginInfo> PluginHost::loaded_plugins() const {
    std::vector<PluginInfo> snapshot;
    snapshot.reserve(impl_->plugins.size());

    for (const auto& plugin : impl_->plugins) {
        PluginInfo info = plugin.info;
        for (auto& panel : info.panels) {
            auto it = impl_->panel_index_by_id.find(panel.id);
            if (it != impl_->panel_index_by_id.end()) {
                panel.is_open = impl_->panels[it->second].is_open;
            }
        }
        snapshot.push_back(std::move(info));
    }

    return snapshot;
}

} // namespace misty::core
