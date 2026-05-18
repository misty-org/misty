#include "core/manager/plugin_manager.h"

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

#include "misty_plugin.h"
#include "core/manager/asset_manager.h"
#include "core/commands/command_manager.h"
#include "core/manager/theme_manager.h"
#include "core/system/util.h"
#include "plugin_signing.h"
#include <glad/glad.h>
#include "imgui.h"
#include "imgui_internal.h"
#include "panels/panel/panel.h"
#include "panels/file_explorer/state/file_explorer_state.h"
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
        case view::ViewID::Providers: return "Providers";
        case view::ViewID::Extensions: return "Extensions";
        case view::ViewID::Vault: return "Vault";
        case view::ViewID::Transfers: return "Transfers";
        case view::ViewID::Default: return "Default";
    }
    return "Unknown";
}

std::optional<view::ViewID> view_id_from_string(const char* raw) {
    if (!raw || *raw == '\0') {
        return std::nullopt;
    }
    const std::string value = to_lower(trim_copy(raw));
    if (value == "auth") return view::ViewID::Auth;
    if (value == "login") return view::ViewID::Login;
    if (value == "onboarding") return view::ViewID::Onboarding;
    if (value == "files") return view::ViewID::Files;
    if (value == "settings") return view::ViewID::Settings;
    if (value == "workspace") return view::ViewID::Workspace;
    if (value == "activity") return view::ViewID::Activity;
    if (value == "providers") return view::ViewID::Providers;
    if (value == "extensions" || value == "plugins") return view::ViewID::Extensions;
    if (value == "vault") return view::ViewID::Vault;
    if (value == "transfers" || value == "transfer") return view::ViewID::Transfers;
    return std::nullopt;
}

using LauncherViewMask = std::uint32_t;
constexpr LauncherViewMask kLauncherViewFiles = 1u << 0;
constexpr LauncherViewMask kLauncherViewSettings = 1u << 1;
constexpr LauncherViewMask kLauncherViewProviders = 1u << 2;
constexpr LauncherViewMask kLauncherViewExtensions = 1u << 3;
constexpr LauncherViewMask kLauncherViewVault = 1u << 4;
constexpr LauncherViewMask kLauncherViewTransfers = 1u << 5;
constexpr LauncherViewMask kLauncherViewAll =
    kLauncherViewFiles |
    kLauncherViewSettings |
    kLauncherViewProviders |
    kLauncherViewExtensions |
    kLauncherViewVault |
    kLauncherViewTransfers;

struct PluginLauncherMetadata {
    LauncherViewMask allowed_views = kLauncherViewExtensions;
    bool show_in_launcher = true;
    bool requires_selected_file = false;
    std::string subtitle;
    std::string search_text;
    std::string logo_path;
    view::PluginOpenMode open_mode = view::PluginOpenMode::Tab;
};

LauncherViewMask launcher_mask_for_view(view::ViewID view_id) {
    switch (view_id) {
        case view::ViewID::Files: return kLauncherViewFiles;
        case view::ViewID::Settings: return kLauncherViewSettings;
        case view::ViewID::Providers: return kLauncherViewProviders;
        case view::ViewID::Extensions: return kLauncherViewExtensions;
        case view::ViewID::Vault: return kLauncherViewVault;
        case view::ViewID::Transfers: return kLauncherViewTransfers;
        default: return 0;
    }
}

bool launcher_mask_matches_view(LauncherViewMask mask, view::ViewID view_id) {
    return (mask & launcher_mask_for_view(view_id)) != 0;
}

void add_launcher_view_token(LauncherViewMask& mask, const std::string& token) {
    const std::string normalized = to_lower(trim_copy(token));
    if (normalized.empty()) {
        return;
    }
    if (normalized == "all" || normalized == "any" || normalized == "global") {
        mask = kLauncherViewAll;
        return;
    }
    if (normalized == "files" || normalized == "file" || normalized == "files_view" || normalized == "files panel") {
        mask |= kLauncherViewFiles;
        return;
    }
    if (normalized == "settings" || normalized == "settings_view" || normalized == "settings panel") {
        mask |= kLauncherViewSettings;
        return;
    }
    if (normalized == "providers" || normalized == "providers_view" || normalized == "providers panel") {
        mask |= kLauncherViewProviders;
        return;
    }
    if (normalized == "plugins" || normalized == "extensions" || normalized == "plugins view" || normalized == "extensions view") {
        mask |= kLauncherViewExtensions;
        return;
    }
    if (normalized == "vault" || normalized == "vault_view" || normalized == "vault panel") {
        mask |= kLauncherViewVault;
    }
}

LauncherViewMask parse_launcher_view_mask(const nlohmann::json& value) {
    LauncherViewMask mask = 0;
    if (value.is_string()) {
        add_launcher_view_token(mask, value.get<std::string>());
        return mask;
    }
    if (!value.is_array()) {
        return mask;
    }
    for (const auto& entry : value) {
        if (!entry.is_string()) {
            continue;
        }
        add_launcher_view_token(mask, entry.get<std::string>());
        if (mask == kLauncherViewAll) {
            return mask;
        }
    }
    return mask;
}

std::optional<nlohmann::json> load_json_file(const fs::path& path) {
    std::error_code ec;
    if (!fs::exists(path, ec) || ec) {
        return std::nullopt;
    }
    try {
        std::ifstream file(path);
        nlohmann::json json;
        file >> json;
        return json;
    } catch (...) {
        return std::nullopt;
    }
}

std::string join_strings(const std::vector<std::string>& items) {
    std::string out;
    for (const auto& item : items) {
        const std::string trimmed = trim_copy(item);
        if (trimmed.empty()) {
            continue;
        }
        if (!out.empty()) {
            out += '\n';
        }
        out += trimmed;
    }
    return out;
}

bool contains_phrase(const std::string& haystack, const char* needle) {
    return to_lower(haystack).find(to_lower(needle ? std::string(needle) : std::string())) != std::string::npos;
}

std::string launcher_view_label(LauncherViewMask mask) {
    if (mask == kLauncherViewAll) {
        return "Anywhere";
    }

    std::vector<std::string> labels;
    if ((mask & kLauncherViewFiles) != 0) labels.push_back("Files");
    if ((mask & kLauncherViewSettings) != 0) labels.push_back("Settings");
    if ((mask & kLauncherViewProviders) != 0) labels.push_back("Providers");
    if ((mask & kLauncherViewExtensions) != 0) labels.push_back("Plugins");
    if ((mask & kLauncherViewVault) != 0) labels.push_back("Vault");

    std::string out;
    for (size_t i = 0; i < labels.size(); ++i) {
        if (i > 0) {
            out += ", ";
        }
        out += labels[i];
    }
    return out.empty() ? "Plugins" : out;
}

PluginLauncherMetadata load_launcher_metadata(const fs::path& plugin_dir,
                                              const PluginInfo& info,
                                              const nlohmann::json& manifest_json) {
    PluginLauncherMetadata metadata;
    metadata.subtitle = info.description;
    const fs::path logo_path = plugin_dir / "assets" / "logo.svg";
    if (std::error_code ec; fs::exists(logo_path, ec) && !ec) {
        metadata.logo_path = logo_path.string();
    }

    const auto detail_json = load_json_file(plugin_dir / "plugin.json");
    std::vector<std::string> where_it_appears;
    std::vector<std::string> permissions;
    std::vector<std::string> getting_started;

    if (detail_json && detail_json->is_object()) {
        if (metadata.subtitle.empty()) {
            metadata.subtitle = trim_copy(detail_json->value("overview", std::string()));
        }
        where_it_appears = json_string_array(detail_json->value("where_it_appears", nlohmann::json::array()));
        permissions = json_string_array(detail_json->value("permissions", nlohmann::json::array()));
        getting_started = json_string_array(detail_json->value("getting_started", nlohmann::json::array()));
    }

    const auto launcher_json = [&]() -> nlohmann::json {
        if (detail_json && detail_json->is_object()) {
            const auto detail_launcher = detail_json->value("launcher", nlohmann::json::object());
            if (detail_launcher.is_object() && !detail_launcher.empty()) {
                return detail_launcher;
            }
        }
        const auto manifest_launcher = manifest_json.value("launcher", nlohmann::json::object());
        return manifest_launcher.is_object() ? manifest_launcher : nlohmann::json::object();
    }();

    LauncherViewMask allowed_views = parse_launcher_view_mask(launcher_json.value("views", nlohmann::json::array()));
    if (allowed_views == 0) {
        for (const auto& surface : where_it_appears) {
            add_launcher_view_token(allowed_views, surface);
        }
    }
    if (allowed_views == 0) {
        allowed_views = kLauncherViewExtensions;
    }
    metadata.allowed_views = allowed_views;
    metadata.show_in_launcher = launcher_json.value("show_in_launcher", true);
    metadata.requires_selected_file = launcher_json.value("requires_selected_file", false);
    const std::string open_mode = to_lower(trim_copy(launcher_json.value("open_mode", std::string("tab"))));
    if (open_mode == "inline") {
        metadata.open_mode = view::PluginOpenMode::Inline;
    } else if (open_mode == "split") {
        metadata.open_mode = view::PluginOpenMode::Split;
    } else {
        metadata.open_mode = view::PluginOpenMode::Tab;
    }

    metadata.search_text = to_lower(
        info.name + "\n" +
        info.description + "\n" +
        metadata.subtitle + "\n" +
        join_strings(where_it_appears) + "\n" +
        join_strings(permissions) + "\n" +
        join_strings(getting_started));
    return metadata;
}

fs::path launcher_usage_path() {
    const char* home = std::getenv("HOME");
    if (!home || *home == '\0') {
        return {};
    }
    return fs::path(home) / "misty" / "config" / "plugin_launcher_usage.json";
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

struct PluginManager::Impl {
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
        PluginWindowType window_type = PluginWindowType::Panel;
        float default_width = 480.0f;
        float default_height = 360.0f;
        std::size_t plugin_index = 0;
    };

    struct LoadedPlugin {
        PluginInfo info;
        DynamicLibrary library;
        bool active = false;
        PluginLauncherMetadata launcher;
    };

    struct LauncherEntry {
        std::size_t plugin_index = 0;
        bool available = false;
        int usage_count = 0;
        int search_rank = 0;
        std::string reason;
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
    std::string active_preview_scene_id;
    std::unordered_map<std::string, int> launcher_usage_counts;
    bool launcher_open = false;
    bool launcher_request_open = false;
    int launcher_selected_index = 0;

    Impl() {
        load_launcher_usage();
    }

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
    static void c_set_preview_scene(void* h, const char* scene_id) {
        if (!h) return;
        auto* self = as_impl(h);
        self->active_preview_scene_id = scene_id ? scene_id : "";
    }
    static int c_get_view_capabilities(void* h, const char* view_id, MistyViewCapabilities* out_caps) {
        if (!h || !out_caps) return 0;
        *out_caps = {};
        const auto parsed = view_id_from_string(view_id);
        if (!parsed.has_value()) {
            return 0;
        }
        view::ViewCapabilities capabilities;
        if (!view::get_view_capabilities(*parsed, &capabilities)) {
            return 0;
        }
        out_caps->tabs = capabilities.tabs ? 1 : 0;
        out_caps->split = capabilities.split ? 1 : 0;
        return 1;
    }
    static int c_open_panel_in_view(void* h, const char* panel_id, const char* view_id, int open_mode) {
        if (!h || !panel_id || !*panel_id || !view_id || !*view_id) return 0;
        const auto parsed = view_id_from_string(view_id);
        if (!parsed.has_value()) {
            return 0;
        }
        view::PluginOpenMode mode = view::PluginOpenMode::Tab;
        if (open_mode == MISTY_VIEW_OPEN_MODE_INLINE) {
            mode = view::PluginOpenMode::Inline;
        } else if (open_mode == MISTY_VIEW_OPEN_MODE_SPLIT) {
            mode = view::PluginOpenMode::Split;
        }
        return view::open_plugin_in_view(*parsed, panel_id, mode) == view::PluginOpenResult::Opened ? 1 : 0;
    }
    static int c_get_theme_color(void*, const char* token_name, float* out_rgba4) {
        if (!token_name || !out_rgba4) {
            return 0;
        }
        return ThemeManager::get().get_color(token_name, out_rgba4) ? 1 : 0;
    }
    static int c_set_theme_color(void*, const char* token_name, const float* rgba4) {
        if (!token_name || !rgba4) {
            return 0;
        }
        return ThemeManager::get().set_color(token_name, rgba4) ? 1 : 0;
    }
    static int c_apply_theme_preset(void*, const char* preset_name) {
        if (!preset_name || *preset_name == '\0') {
            return 0;
        }
        return ThemeManager::get().apply_preset(preset_name) ? 1 : 0;
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
    static int c_ui_input_text(void*, const char* label, char* buffer, std::size_t size) {
        if (!buffer || size == 0) {
            return 0;
        }
        ImGui::SetNextItemWidth(-1.0f);
        return ImGui::InputText(label ? label : "", buffer, size) ? 1 : 0;
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
            &c_copy_selected_file_path, &c_set_preview_scene,
            &c_get_view_capabilities, &c_open_panel_in_view,
            &c_get_theme_color, &c_set_theme_color, &c_apply_theme_preset,
        };
        return kApi;
    }
    static const MistyUiApi& ui_api() {
        static const MistyUiApi kApi = {
            MISTY_PLUGIN_ABI_VERSION,
            &c_ui_text, &c_ui_text_wrapped, &c_ui_button,
            &c_ui_same_line, &c_ui_separator, &c_ui_spacing,
            &c_ui_image, &c_ui_get_content_region_avail,
            &c_ui_begin_child, &c_ui_end_child, &c_ui_input_text,
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
        plugin_panel.window_type = PluginWindowType::Panel;
        plugin_panel.default_width = panel.default_width > 0.0f ? panel.default_width : 480.0f;
        plugin_panel.default_height = panel.default_height > 0.0f ? panel.default_height : 360.0f;
        plugin_panel.plugin_index = plugin_index;

        panel_index_by_id[id] = panels.size();
        panels.push_back(plugin_panel);
        plugins[plugin_index].info.panels.push_back(
            PluginPanelInfo{plugin_panel.id, plugin_panel.title,
                            plugin_panel.is_open,
                            plugin_panel.window_type,
                            plugin_panel.default_width,
                            plugin_panel.default_height});
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
        record_plugin_launch(plugins[panels[it->second].plugin_index].info.id);
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

    void open_launcher() {
        launcher_open = true;
        launcher_request_open = true;
        launcher_selected_index = 0;
    }

    void close_launcher() {
        launcher_open = false;
        launcher_request_open = false;
    }

    void toggle_launcher() {
        if (launcher_open) {
            close_launcher();
            return;
        }
        open_launcher();
    }

    void load_launcher_usage() {
        launcher_usage_counts.clear();
        const fs::path path = launcher_usage_path();
        if (path.empty()) {
            return;
        }
        const auto json = load_json_file(path);
        if (!json || !json->is_object()) {
            return;
        }
        for (auto it = json->begin(); it != json->end(); ++it) {
            if (!it.value().is_number_integer()) {
                continue;
            }
            launcher_usage_counts[it.key()] = it.value().get<int>();
        }
    }

    void save_launcher_usage() const {
        const fs::path path = launcher_usage_path();
        if (path.empty()) {
            return;
        }

        std::error_code ec;
        fs::create_directories(path.parent_path(), ec);
        if (ec) {
            return;
        }

        nlohmann::json json = nlohmann::json::object();
        for (const auto& [plugin_id, count] : launcher_usage_counts) {
            json[plugin_id] = count;
        }

        std::ofstream file(path);
        if (!file.is_open()) {
            return;
        }
        file << json.dump(2);
    }

    void record_plugin_launch(const std::string& plugin_id) {
        if (plugin_id.empty()) {
            return;
        }
        ++launcher_usage_counts[plugin_id];
        save_launcher_usage();
    }

    bool plugin_has_visible_panel(std::size_t plugin_index) const {
        return std::any_of(panels.begin(), panels.end(), [plugin_index](const PluginPanel& panel) {
            return panel.plugin_index == plugin_index;
        });
    }

    bool current_view_has_selected_file() const {
        if (!ui_registry) {
            return false;
        }
        std::string explorer_state_key = "Files";
        if (auto* current_view = view::ViewRegistry::get().get_current_view()) {
            explorer_state_key = current_view->active_explorer_state_key();
        }
        auto& explorer_state = ui_registry->get_state<panel::FileExplorerState>(explorer_state_key);
        return !explorer_state.selected_files.empty();
    }

    bool is_plugin_available_in_current_context(std::size_t plugin_index, std::string* reason) const {
        if (reason) {
            reason->clear();
        }
        if (plugin_index >= plugins.size()) {
            if (reason) {
                *reason = "Plugin is unavailable.";
            }
            return false;
        }
        const auto& plugin = plugins[plugin_index];
        if (!plugin.active || !plugin.info.loaded) {
            if (reason) {
                *reason = "Plugin is not loaded.";
            }
            return false;
        }

        const view::ViewID current_view = view::get_current_view_id();
        if (!launcher_mask_matches_view(plugin.launcher.allowed_views, current_view)) {
            if (reason) {
                *reason = "Available in " + launcher_view_label(plugin.launcher.allowed_views);
            }
            return false;
        }
        if (plugin.launcher.requires_selected_file && !current_view_has_selected_file()) {
            if (reason) {
                *reason = "Select a file first";
            }
            return false;
        }
        return true;
    }

    bool open_primary_panel_for_plugin(std::size_t plugin_index) {
        if (plugin_index >= plugins.size()) {
            return false;
        }
        const auto current_view_id = view::get_current_view_id();
        for (const auto& panel : panels) {
            if (panel.plugin_index == plugin_index) {
                const view::PluginOpenResult view_result =
                    view::open_plugin_in_view(current_view_id, panel.id, plugins[plugin_index].launcher.open_mode);
                if (view_result == view::PluginOpenResult::Opened) {
                    record_plugin_launch(plugins[plugin_index].info.id);
                    return true;
                }
                return open_panel(panel.id);
            }
        }
        return false;
    }

    std::vector<LauncherEntry> build_launcher_entries(const std::string& query) const {
        std::vector<LauncherEntry> entries;
        const std::string normalized_query = to_lower(trim_copy(query));

        for (std::size_t plugin_index = 0; plugin_index < plugins.size(); ++plugin_index) {
            const auto& plugin = plugins[plugin_index];
            if (!plugin.launcher.show_in_launcher || !plugin_has_visible_panel(plugin_index)) {
                continue;
            }

            const std::string search_text = plugin.launcher.search_text.empty()
                ? to_lower(plugin.info.name + "\n" + plugin.info.description)
                : plugin.launcher.search_text;

            int search_rank = 0;
            if (!normalized_query.empty()) {
                const std::string lowered_name = to_lower(plugin.info.name);
                const size_t name_pos = lowered_name.find(normalized_query);
                const size_t blob_pos = search_text.find(normalized_query);
                if (name_pos == std::string::npos && blob_pos == std::string::npos) {
                    continue;
                }
                if (name_pos != std::string::npos) {
                    search_rank = static_cast<int>(name_pos);
                } else {
                    search_rank = 1000 + static_cast<int>(blob_pos);
                }
            }

            LauncherEntry entry;
            entry.plugin_index = plugin_index;
            entry.available = is_plugin_available_in_current_context(plugin_index, &entry.reason);
            entry.usage_count = 0;
            if (const auto it = launcher_usage_counts.find(plugin.info.id); it != launcher_usage_counts.end()) {
                entry.usage_count = it->second;
            }
            entry.search_rank = search_rank;
            entries.push_back(std::move(entry));
        }

        std::sort(entries.begin(), entries.end(), [&](const LauncherEntry& lhs, const LauncherEntry& rhs) {
            if (lhs.available != rhs.available) {
                return lhs.available > rhs.available;
            }
            if (!normalized_query.empty() && lhs.search_rank != rhs.search_rank) {
                return lhs.search_rank < rhs.search_rank;
            }
            if (lhs.usage_count != rhs.usage_count) {
                return lhs.usage_count > rhs.usage_count;
            }
            return to_lower(plugins[lhs.plugin_index].info.name) <
                   to_lower(plugins[rhs.plugin_index].info.name);
        });
        return entries;
    }
};

PluginManager& PluginManager::get() {
    static PluginManager instance;
    return instance;
}

PluginManager::PluginManager()
    : impl_(new Impl()) {
}

PluginManager::~PluginManager() {
    shutdown();
    delete impl_;
    impl_ = nullptr;
}

void PluginManager::set_ui_registry(UIRegistry* registry) {
    impl_->ui_registry = registry;
}

std::vector<std::string> PluginManager::discovery_roots() const {
    std::vector<std::string> roots;
    if (const char* home = std::getenv("HOME"); home && *home) {
        roots.push_back((fs::path(home) / "misty" / "plugins" / "public").string());
        roots.push_back((fs::path(home) / "misty" / "plugins" / "private").string());
    }
    return roots;
}

void PluginManager::discover_and_load() {
    std::vector<fs::path> roots;
    const auto root_strings = discovery_roots();
    roots.reserve(root_strings.size());
    for (const auto& root : root_strings) {
        roots.emplace_back(root);
    }
    discover_and_load(roots);
}

void PluginManager::discover_and_load(const std::vector<fs::path>& roots) {
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

bool PluginManager::load_plugin_directory(const fs::path& plugin_dir, bool bundled) {
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
        mv.plugin_api_version = trim_copy(vj.value("plugin_api_version", std::string()));
        if (mv.plugin_api_version.empty()) {
            mv.plugin_api_version = trim_copy(vj.value("sdk_version", std::string()));
        }
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

    // Public plugins (~/misty/plugins/public) must be signed and verified.
    // Private plugins (~/misty/plugins/private) are allowed to be unsigned.
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
    plugin.launcher = load_launcher_metadata(plugin_dir, info, json);
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

void PluginManager::reload() {
    discover_and_load();
}

void PluginManager::shutdown() {
    CommandManager::get().clear_runtime_commands();
    impl_->close_launcher();
    impl_->panels.clear();
    impl_->commands.clear();
    impl_->plugin_index_by_id.clear();
    impl_->panel_index_by_id.clear();
    impl_->command_index_by_id.clear();
    impl_->plugins.clear();
}

void PluginManager::process_shortcuts() {
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

void PluginManager::render_open_panels() {
    for (auto& panel : impl_->panels) {
        if (!panel.is_open || !impl_->is_plugin_active(panel.plugin_index)) {
            continue;
        }

        bool keep_open = true;
        const std::string window_id = panel.title + "##" + panel.id;
        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoSavedSettings;
        if (ImGuiViewport* main_viewport = ImGui::GetMainViewport()) {
            ImGui::SetNextWindowViewport(main_viewport->ID);
        }

        ImGui::SetNextWindowSize(
            ImVec2(panel.default_width, panel.default_height),
            ImGuiCond_FirstUseEver);
        if (ImGui::Begin(window_id.c_str(), &keep_open, flags)) {
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

bool PluginManager::render_panel_content(const std::string& panel_id) {
    auto it = impl_->panel_index_by_id.find(panel_id);
    if (it == impl_->panel_index_by_id.end()) {
        return false;
    }

    auto& panel = impl_->panels[it->second];
    if (!impl_->is_plugin_active(panel.plugin_index)) {
        return false;
    }

    MistyRenderContext render_ctx = impl_->make_render_context();
    try {
        panel.render(&render_ctx, panel.user_data);
    } catch (const std::exception& e) {
        impl_->fault_plugin(panel.plugin_index,
                            std::string("Panel render callback threw an exception for ") + panel.id + ": " + e.what());
        return false;
    } catch (...) {
        impl_->fault_plugin(panel.plugin_index,
                            std::string("Panel render callback threw a non-standard exception for ") + panel.id + ".");
        return false;
    }
    return true;
}

void PluginManager::render_launcher_overlay() {
    if (!impl_->launcher_open) {
        return;
    }

    auto entries = impl_->build_launcher_entries("");
    entries.erase(
        std::remove_if(entries.begin(), entries.end(), [](const Impl::LauncherEntry& entry) {
            return !entry.available;
        }),
        entries.end());

    if (impl_->launcher_selected_index < 0) {
        impl_->launcher_selected_index = 0;
    }
    if (!entries.empty() &&
        impl_->launcher_selected_index >= static_cast<int>(entries.size())) {
        impl_->launcher_selected_index = static_cast<int>(entries.size()) - 1;
    }

    auto launch_entry = [&](std::size_t entry_index) {
        if (entry_index >= entries.size()) {
            return false;
        }
        const auto& entry = entries[entry_index];
        if (!entry.available) {
            return false;
        }
        if (impl_->open_primary_panel_for_plugin(entry.plugin_index)) {
            impl_->close_launcher();
            return true;
        }
        return false;
    };

    constexpr const char* kPopupId = "Plugin Launcher";
    ImGuiViewport* viewport = ImGui::GetMainViewport();
    if (impl_->launcher_request_open) {
        ImGui::OpenPopup(kPopupId);
        impl_->launcher_request_open = false;
    }

    const float item_width = 112.0f;
    const float item_height = 120.0f;
    const float item_spacing = 18.0f;
    const int column_count = std::max(1, std::min(6, static_cast<int>(entries.size())));
    const float content_width = entries.empty()
        ? 240.0f
        : (item_width * static_cast<float>(column_count)) +
            (item_spacing * static_cast<float>(std::max(0, column_count - 1)));
    const int row_count = entries.empty()
        ? 1
        : static_cast<int>((entries.size() + static_cast<std::size_t>(column_count) - 1) / static_cast<std::size_t>(column_count));
    const float content_height = entries.empty()
        ? 120.0f
        : (item_height * static_cast<float>(row_count)) +
            (item_spacing * static_cast<float>(std::max(0, row_count - 1)));
    const ImVec2 launcher_size(
        std::min(std::max(320.0f, content_width + 44.0f), viewport->WorkSize.x - 64.0f),
        std::min(std::max(180.0f, content_height + 44.0f), viewport->WorkSize.y - 120.0f));

    ImGui::SetNextWindowViewport(viewport->ID);
    ImGui::SetNextWindowPos(
        ImVec2(viewport->WorkPos.x + viewport->WorkSize.x * 0.5f,
               viewport->WorkPos.y + viewport->WorkSize.y * 0.42f),
        ImGuiCond_Appearing,
        ImVec2(0.5f, 0.5f));
    ImGui::SetNextWindowSize(launcher_size, ImGuiCond_Appearing);

    bool keep_open = true;
    const ImGuiWindowFlags flags =
        ImGuiWindowFlags_NoTitleBar |
        ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoMove |
        ImGuiWindowFlags_NoCollapse |
        ImGuiWindowFlags_NoSavedSettings;

    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(22.0f, 22.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 16.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 14.0f);
    ImGui::PushStyleColor(ImGuiCol_PopupBg, IM_COL32(18, 18, 20, 248));
    ImGui::PushStyleColor(ImGuiCol_Border, IM_COL32(50, 50, 56, 255));
    ImGui::PushStyleColor(ImGuiCol_ModalWindowDimBg, IM_COL32(0, 0, 0, 130));
    ImGui::PushStyleColor(ImGuiCol_Header, IM_COL32(44, 44, 48, 255));
    ImGui::PushStyleColor(ImGuiCol_HeaderHovered, IM_COL32(56, 56, 60, 255));
    ImGui::PushStyleColor(ImGuiCol_HeaderActive, IM_COL32(62, 62, 66, 255));

    if (ImGui::BeginPopupModal(kPopupId, nullptr, flags)) {
        if (ImGui::IsWindowFocused(ImGuiFocusedFlags_RootAndChildWindows)) {
            if (ImGui::IsKeyPressed(ImGuiKey_Escape, false)) {
                keep_open = false;
            } else if (!entries.empty()) {
                const int cols = column_count;
                const int rows = row_count;
                const int current = impl_->launcher_selected_index;
                if (ImGui::IsKeyPressed(ImGuiKey_RightArrow, false)) {
                    impl_->launcher_selected_index =
                        std::min(current + 1, static_cast<int>(entries.size()) - 1);
                } else if (ImGui::IsKeyPressed(ImGuiKey_LeftArrow, false)) {
                    impl_->launcher_selected_index = std::max(current - 1, 0);
                } else if (ImGui::IsKeyPressed(ImGuiKey_DownArrow, false)) {
                    impl_->launcher_selected_index =
                        std::min(current + cols, static_cast<int>(entries.size()) - 1);
                } else if (ImGui::IsKeyPressed(ImGuiKey_UpArrow, false)) {
                    impl_->launcher_selected_index = std::max(current - cols, 0);
                } else if (ImGui::IsKeyPressed(ImGuiKey_Enter, false)) {
                    launch_entry(static_cast<std::size_t>(impl_->launcher_selected_index));
                }
                (void)rows;
            }
        }

        if (entries.empty()) {
            ImGui::Dummy(ImVec2(0.0f, 28.0f));
            ImGui::SetCursorPosX(std::max(0.0f, (ImGui::GetWindowWidth() - ImGui::CalcTextSize("No plugins available here").x) * 0.5f));
            ImGui::TextUnformatted("No plugins available here");
            ImGui::Dummy(ImVec2(0.0f, 28.0f));
        } else {
            const float grid_width = (item_width * static_cast<float>(column_count)) +
                                     (item_spacing * static_cast<float>(std::max(0, column_count - 1)));
            const float start_x = std::max(0.0f, (ImGui::GetContentRegionAvail().x - grid_width) * 0.5f);
            ImGui::SetCursorPosX(ImGui::GetCursorPosX() + start_x);

            for (int index = 0; index < static_cast<int>(entries.size()); ++index) {
                const auto& entry = entries[static_cast<std::size_t>(index)];
                const auto& plugin = impl_->plugins[entry.plugin_index];
                if (index > 0 && index % column_count != 0) {
                    ImGui::SameLine(0.0f, item_spacing);
                }

                ImGui::PushID(plugin.info.id.c_str());
                const bool selected = index == impl_->launcher_selected_index;
                const bool pressed = ImGui::Selectable("##plugin_switcher_item", selected, 0, ImVec2(item_width, item_height));
                const ImVec2 min = ImGui::GetItemRectMin();
                const ImVec2 max = ImGui::GetItemRectMax();
                ImDrawList* draw = ImGui::GetWindowDrawList();

                const float icon_box_size = 64.0f;
                const ImVec2 icon_min(min.x + (item_width - icon_box_size) * 0.5f, min.y + 10.0f);
                const ImVec2 icon_max(icon_min.x + icon_box_size, icon_min.y + icon_box_size);
                const ImU32 icon_bg = selected ? IM_COL32(72, 72, 78, 255) : IM_COL32(34, 34, 38, 255);
                draw->AddRectFilled(icon_min, icon_max, icon_bg, 16.0f);
                draw->AddRect(icon_min, icon_max, IM_COL32(62, 62, 68, 255), 16.0f, 0, 1.0f);

                if (!plugin.launcher.logo_path.empty()) {
                    auto& icon = AssetManager::get().get_svg_texture_path(
                        plugin.launcher.logo_path,
                        static_cast<int>(icon_box_size * 1.4f),
                        true);
                    if (icon.id) {
                        const float rendered_size = 34.0f;
                        ImGui::SetCursorScreenPos(ImVec2(
                            icon_min.x + (icon_box_size - rendered_size) * 0.5f,
                            icon_min.y + (icon_box_size - rendered_size) * 0.5f));
                        ImGui::Image(icon.id, ImVec2(rendered_size, rendered_size));
                    }
                } else {
                    auto& icon = AssetManager::get().get_svg_texture("apps-16", 40);
                    if (icon.id) {
                        const float rendered_size = 26.0f;
                        ImGui::SetCursorScreenPos(ImVec2(
                            icon_min.x + (icon_box_size - rendered_size) * 0.5f,
                            icon_min.y + (icon_box_size - rendered_size) * 0.5f));
                        ImGui::Image(icon.id, ImVec2(rendered_size, rendered_size));
                    }
                }

                const std::string name = plugin.info.name;
                const ImVec2 text_size = ImGui::CalcTextSize(name.c_str());
                draw->AddText(
                    ImVec2(min.x + std::max(0.0f, (item_width - text_size.x) * 0.5f), min.y + 86.0f),
                    IM_COL32(235, 235, 240, 255),
                    name.c_str());

                if (ImGui::IsItemHovered()) {
                    impl_->launcher_selected_index = index;
                }
                if (pressed) {
                    launch_entry(static_cast<std::size_t>(index));
                }
                ImGui::PopID();

                if ((index + 1) % column_count == 0 && (index + 1) < static_cast<int>(entries.size())) {
                    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + item_spacing);
                    ImGui::SetCursorPosX(22.0f + start_x);
                }
            }
        }

        if (!keep_open) {
            ImGui::CloseCurrentPopup();
        }
        ImGui::EndPopup();
    } else if (!impl_->launcher_request_open) {
        impl_->close_launcher();
    }

    ImGui::PopStyleColor(6);
    ImGui::PopStyleVar(3);

    if (!keep_open) {
        impl_->close_launcher();
    }
}

void PluginManager::render_active_preview_scene() {
    if (impl_->active_preview_scene_id.empty()) {
        return;
    }

    const auto clear_preview_scene = [this]() {
        impl_->active_preview_scene_id.clear();
        ImGuiContext& g = *GImGui;
        if (g.OpenPopupStack.Size > 0) {
            ImGui::ClosePopupToLevel(0, true);
        }
    };

    ImGuiIO& io = ImGui::GetIO();
    if (io.KeyShift && ImGui::IsKeyPressed(ImGuiKey_Escape, false)) {
        clear_preview_scene();
        return;
    }

    if (impl_->active_preview_scene_id == "panel-preview.session-expired-modal") {
        panel::render_error_modal({
            .is_open = true,
            .modal_id = "PanelPreviewSessionExpiredModal",
            .title = "Session Expired",
            .message = "Your session has expired and could not be renewed. Please log in again to continue.",
            .confirm_label = "Log In Again",
            .icon_name = "lock-24",
            .icon_size = 32.0f,
            .dismissible = false,
            .on_confirm = [&clear_preview_scene]() {
                clear_preview_scene();
            },
        });
        return;
    }

    if (impl_->active_preview_scene_id == "panel-preview.generic-error-modal") {
        panel::render_error_modal({
            .is_open = true,
            .modal_id = "PanelPreviewGenericErrorModal",
            .title = "Could Not Complete Action",
            .message = "Something went wrong while applying your changes. Please try again in a moment.",
            .confirm_label = "OK",
            .icon_name = "alert-24",
            .icon_size = 28.0f,
            .dismissible = true,
            .on_confirm = [&clear_preview_scene]() {
                clear_preview_scene();
            },
        });
        return;
    }

    if (impl_->active_preview_scene_id == "panel-preview.destructive-confirm-modal") {
        static bool is_open = true;
        if (!is_open) {
            is_open = true;
            clear_preview_scene();
            return;
        }

        const bool confirmed = panel::render_confirm_modal({
            .is_open = &is_open,
            .modal_id = "PanelPreviewDestructiveConfirmModal",
            .title = "Delete 12 Files?",
            .message = "This action cannot be undone. Files will be removed from this device immediately.",
            .confirm_label = "Delete",
            .cancel_label = "Cancel",
            .dangerous = true,
        });
        if (confirmed || !is_open) {
            is_open = true;
            clear_preview_scene();
        }
        return;
    }

    if (impl_->active_preview_scene_id == "panel-preview.loading-modal") {
        panel::render_loading_modal({
            .is_open = true,
            .modal_id = "PanelPreviewLoadingModal",
            .title = "Syncing Workspace",
            .message = "Misty is checking remote changes and preparing your files.",
        });
        return;
    }

    ImGuiViewport* viewport = ImGui::GetMainViewport();
    ImDrawList* draw_list = ImGui::GetForegroundDrawList(viewport);
    const char* hint = "Shift+Esc exits preview";
    const ImVec2 text_size = ImGui::CalcTextSize(hint);
    const ImVec2 padding(10.0f, 8.0f);
    const ImVec2 box_size(text_size.x + padding.x * 2.0f, text_size.y + padding.y * 2.0f);
    const ImVec2 box_min(
        viewport->WorkPos.x + viewport->WorkSize.x - box_size.x - 16.0f,
        viewport->WorkPos.y + 16.0f
    );
    const ImVec2 box_max(box_min.x + box_size.x, box_min.y + box_size.y);
    draw_list->AddRectFilled(
        box_min,
        box_max,
        IM_COL32(17, 17, 19, 240),
        10.0f
    );
    draw_list->AddRect(
        box_min,
        box_max,
        IM_COL32(39, 39, 42, 255),
        10.0f
    );
    draw_list->AddText(
        ImVec2(box_min.x + padding.x, box_min.y + padding.y),
        IM_COL32(212, 212, 216, 255),
        hint
    );
}

bool PluginManager::invoke_command(const std::string& command_id) {
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

bool PluginManager::open_panel(const std::string& panel_id) {
    return impl_->open_panel(panel_id);
}

bool PluginManager::close_panel(const std::string& panel_id) {
    return impl_->close_panel(panel_id);
}

void PluginManager::open_launcher() {
    impl_->open_launcher();
}

void PluginManager::close_launcher() {
    impl_->close_launcher();
}

void PluginManager::toggle_launcher() {
    impl_->toggle_launcher();
}

bool PluginManager::open_plugin_sandbox(const std::string& plugin_dir, std::string* error) const {
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

std::vector<PluginInfo> PluginManager::loaded_plugins() const {
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
