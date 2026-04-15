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
#include "imgui.h"
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
        MistyCommandInvokeFn invoke = nullptr;
        void* user_data = nullptr;
        std::size_t plugin_index = 0;
    };

    struct PluginPanel {
        std::string id;
        std::string title;
        MistyPanelRenderFn render = nullptr;
        void* user_data = nullptr;
        bool is_open = false;
        std::size_t plugin_index = 0;
    };

    struct LoadedPlugin {
        PluginInfo info;
        DynamicLibrary library;
        bool active = false;
    };

    UIRegistry* ui_registry = nullptr;
    std::vector<LoadedPlugin> plugins;
    std::vector<PluginCommand> commands;
    std::vector<PluginPanel> panels;
    std::unordered_map<std::string, std::size_t> plugin_index_by_id;
    std::unordered_map<std::string, std::size_t> command_index_by_id;
    std::unordered_map<std::string, std::size_t> panel_index_by_id;

    MistyHostApi host_api{};
    MistyUiApi ui_api{};

    Impl() {
        host_api.struct_size = sizeof(MistyHostApi);
        host_api.abi_version = MISTY_PLUGIN_ABI_VERSION;
        host_api.context = this;
        host_api.open_panel = &Impl::host_open_panel;
        host_api.close_panel = &Impl::host_close_panel;
        host_api.is_panel_open = &Impl::host_is_panel_open;
        host_api.copy_current_view_id = &Impl::host_copy_current_view_id;
        host_api.notify = &Impl::host_notify;

        ui_api.struct_size = sizeof(MistyUiApi);
        ui_api.abi_version = MISTY_PLUGIN_ABI_VERSION;
        ui_api.text = &Impl::ui_text;
        ui_api.text_wrapped = &Impl::ui_text_wrapped;
        ui_api.button = &Impl::ui_button;
        ui_api.same_line = &Impl::ui_same_line;
        ui_api.separator = &Impl::ui_separator;
        ui_api.spacing = &Impl::ui_spacing;
    }

    static int host_open_panel(void* context, const char* panel_id) {
        if (!context || !panel_id || !*panel_id) {
            return 0;
        }
        return static_cast<Impl*>(context)->open_panel(panel_id) ? 1 : 0;
    }

    static int host_close_panel(void* context, const char* panel_id) {
        if (!context || !panel_id || !*panel_id) {
            return 0;
        }
        return static_cast<Impl*>(context)->close_panel(panel_id) ? 1 : 0;
    }

    static int host_is_panel_open(void* context, const char* panel_id) {
        if (!context || !panel_id || !*panel_id) {
            return 0;
        }
        return static_cast<Impl*>(context)->is_panel_open(panel_id) ? 1 : 0;
    }

    static int host_copy_current_view_id(void* context, char* buffer, size_t buffer_size) {
        if (!context || !buffer || buffer_size == 0) {
            return 0;
        }
        const std::string name = view_id_to_string(view::get_current_view_id());
        const std::size_t max_copy = std::min(buffer_size - 1, name.size());
        std::memcpy(buffer, name.data(), max_copy);
        buffer[max_copy] = '\0';
        return 1;
    }

    static int host_notify(void* context,
                           MistyNotificationLevel level,
                           const char* title,
                           const char* message) {
        if (!context) {
            return 0;
        }

        auto* impl = static_cast<Impl*>(context);
        if (!impl->ui_registry) {
            return 1;
        }

        panel::NotificationType notification_type = panel::NotificationType::INFO;
        switch (level) {
            case MISTY_NOTIFICATION_SUCCESS:
                notification_type = panel::NotificationType::SUCCESS;
                break;
            case MISTY_NOTIFICATION_ERROR:
                notification_type = panel::NotificationType::ERROR;
                break;
            case MISTY_NOTIFICATION_INFO:
            default:
                notification_type = panel::NotificationType::INFO;
                break;
        }

        auto& notifications = impl->ui_registry->get_state<panel::NotificationState>("Notifications");
        notifications.add_notification(title ? title : "Extension",
                                       message ? message : "",
                                       notification_type);
        return 1;
    }

    static void ui_text(const char* text) {
        ImGui::TextUnformatted(text ? text : "");
    }

    static void ui_text_wrapped(const char* text) {
        ImGui::TextWrapped("%s", text ? text : "");
    }

    static int ui_button(const char* label, float width, float height) {
        return ImGui::Button(label ? label : "", ImVec2(width, height)) ? 1 : 0;
    }

    static void ui_same_line() {
        ImGui::SameLine();
    }

    static void ui_separator() {
        ImGui::Separator();
    }

    static void ui_spacing() {
        ImGui::Spacing();
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
            auto& notifications = ui_registry->get_state<panel::NotificationState>("Notifications");
            notifications.add_notification("Plugin Disabled",
                                           plugins[plugin_index].info.name + " faulted and was disabled.",
                                           panel::NotificationType::ERROR);
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
    roots.push_back((get_executable_path().parent_path() / "plugins").string());
    if (const char* home = std::getenv("HOME"); home && *home) {
        roots.push_back((fs::path(home) / ".misty" / "plugins").string());
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
    const int schema_version = json.value("schema_version", 1);
    const auto platforms = json_string_array(json.value("platforms", nlohmann::json::array()));

    if (info.id.empty() || info.name.empty()) {
        info.diagnostics.push_back("Manifest must include non-empty id and name.");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }
    if (schema_version != 1) {
        info.diagnostics.push_back("Only manifest schema_version 1 is supported for plugins.");
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
    if (!matches_platforms(platforms)) {
        info.diagnostics.push_back("Plugin does not match the current platform.");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }

    const auto plugin_json = json.value("plugin", nlohmann::json::object());
    const std::string library_rel = trim_copy(plugin_json.value("library", std::string()));
    const uint32_t manifest_abi = plugin_json.value("abi_version", 0u);

    if (library_rel.empty()) {
        info.diagnostics.push_back("Manifest is missing plugin.library.");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }
    if (manifest_abi != MISTY_PLUGIN_ABI_VERSION) {
        info.diagnostics.push_back("Manifest ABI version does not match Misty's plugin ABI.");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }

    fs::path library_candidate(library_rel);
    if (library_candidate.is_absolute()) {
        info.diagnostics.push_back("plugin.library must be a relative path inside the plugin directory.");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }

    const fs::path resolved_library = (plugin_dir / library_candidate).lexically_normal();
    if (!path_is_within(plugin_dir, resolved_library)) {
        info.diagnostics.push_back("plugin.library resolves outside the plugin directory.");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }
    if (!fs::exists(resolved_library, ec) || ec || !fs::is_regular_file(resolved_library, ec)) {
        info.diagnostics.push_back("Plugin library was not found.");
        impl_->plugins.push_back({std::move(info), {}});
        return false;
    }

    info.library_path = resolved_library.string();

    PluginVerificationResult verification = verify_plugin_manifest(json, plugin_dir, resolved_library);
    info.verified = verification.signature_verified;
    info.signer = verification.signer;
    if (plugin_requires_signature() && !verification.has_signature) {
        info.diagnostics.push_back("This Misty build requires signed plugins. Unsigned plugins are rejected.");
    }
    for (auto& diagnostic : verification.diagnostics) {
        info.diagnostics.push_back(std::move(diagnostic));
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

    struct RegistrarContext {
        Impl* impl = nullptr;
        std::size_t plugin_index = 0;
    } registrar_context{impl_, plugin_index};

    MistyPluginRegistrarApi registrar{};
    registrar.struct_size = sizeof(MistyPluginRegistrarApi);
    registrar.abi_version = MISTY_PLUGIN_ABI_VERSION;
    registrar.context = &registrar_context;
    registrar.register_command = [](void* context, const MistyCommandRegistration* command) -> int {
        auto* registrar_ctx = static_cast<RegistrarContext*>(context);
        if (!registrar_ctx || !command || command->struct_size < sizeof(MistyCommandRegistration) ||
            !command->id || !command->title || !command->invoke) {
            if (registrar_ctx) {
                registrar_ctx->impl->append_diagnostic(registrar_ctx->plugin_index,
                                                       "Plugin attempted to register an invalid command.");
            }
            return 0;
        }

        const std::string id = trim_copy(command->id);
        const std::string title = trim_copy(command->title);
        if (id.empty() || title.empty()) {
            registrar_ctx->impl->append_diagnostic(registrar_ctx->plugin_index,
                                                   "Plugin attempted to register a command with an empty id or title.");
            return 0;
        }
        if (registrar_ctx->impl->command_index_by_id.contains(id)) {
            registrar_ctx->impl->append_diagnostic(registrar_ctx->plugin_index,
                                                   "Plugin attempted to register a duplicate command id: " + id);
            return 0;
        }

        Impl::PluginCommand plugin_command;
        plugin_command.id = id;
        plugin_command.title = title;
        plugin_command.default_shortcut = command->default_shortcut ? command->default_shortcut : "";
        plugin_command.invoke = command->invoke;
        plugin_command.user_data = command->user_data;
        plugin_command.plugin_index = registrar_ctx->plugin_index;

        registrar_ctx->impl->command_index_by_id[id] = registrar_ctx->impl->commands.size();
        registrar_ctx->impl->commands.push_back(plugin_command);
        registrar_ctx->impl->plugins[registrar_ctx->plugin_index].info.commands.push_back(
            PluginCommandInfo{plugin_command.id, plugin_command.title, plugin_command.default_shortcut});
        if (!plugin_command.default_shortcut.empty()) {
            CommandManager::get().register_runtime_command(plugin_command.id, plugin_command.default_shortcut);
        }
        return 1;
    };
    registrar.register_panel = [](void* context, const MistyPanelRegistration* panel) -> int {
        auto* registrar_ctx = static_cast<RegistrarContext*>(context);
        if (!registrar_ctx || !panel || panel->struct_size < sizeof(MistyPanelRegistration) ||
            !panel->id || !panel->title || !panel->render) {
            if (registrar_ctx) {
                registrar_ctx->impl->append_diagnostic(registrar_ctx->plugin_index,
                                                       "Plugin attempted to register an invalid panel.");
            }
            return 0;
        }

        const std::string id = trim_copy(panel->id);
        const std::string title = trim_copy(panel->title);
        if (id.empty() || title.empty()) {
            registrar_ctx->impl->append_diagnostic(registrar_ctx->plugin_index,
                                                   "Plugin attempted to register a panel with an empty id or title.");
            return 0;
        }
        if (registrar_ctx->impl->panel_index_by_id.contains(id)) {
            registrar_ctx->impl->append_diagnostic(registrar_ctx->plugin_index,
                                                   "Plugin attempted to register a duplicate panel id: " + id);
            return 0;
        }

        Impl::PluginPanel plugin_panel;
        plugin_panel.id = id;
        plugin_panel.title = title;
        plugin_panel.render = panel->render;
        plugin_panel.user_data = panel->user_data;
        plugin_panel.is_open = panel->default_open != 0;
        plugin_panel.plugin_index = registrar_ctx->plugin_index;

        registrar_ctx->impl->panel_index_by_id[id] = registrar_ctx->impl->panels.size();
        registrar_ctx->impl->panels.push_back(plugin_panel);
        registrar_ctx->impl->plugins[registrar_ctx->plugin_index].info.panels.push_back(
            PluginPanelInfo{plugin_panel.id, plugin_panel.title, plugin_panel.is_open});
        return 1;
    };

    int register_result = 0;
    try {
        register_result = register_fn(&registrar);
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
    for (const auto& command : impl_->commands) {
        if (!impl_->is_plugin_active(command.plugin_index)) {
            continue;
        }
        if (!CommandManager::get().matches(command.id)) {
            continue;
        }
        try {
            command.invoke(&impl_->host_api, command.user_data);
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
            try {
                panel.render(&impl_->host_api, &impl_->ui_api, panel.user_data);
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
    try {
        command.invoke(&impl_->host_api, command.user_data);
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
