#define MISTY_EXTENSION_BUILD 1

#include "core/extensions/plugin_api.h"

#include <cstring>

namespace {

constexpr const char* kPanelId = "preview-manager.panel";

void open_preview_manager(const MistyHostApi* host, void*) {
    if (host && host->open_panel) {
        host->open_panel(host->context, kPanelId);
    }
}

void render_preview_manager(const MistyHostApi* host, const MistyUiApi* ui, void*) {
    if (!ui) {
        return;
    }

    ui->text("Preview Manager");
    ui->separator();
    ui->text_wrapped("This sample plugin is rendered through Misty's plugin ABI, not linked directly against Misty's C++ internals.");
    ui->spacing();

    char view_id[64] = {};
    if (host && host->copy_current_view_id && host->copy_current_view_id(host->context, view_id, sizeof(view_id))) {
        ui->text("Current Misty view:");
        ui->same_line();
        ui->text(view_id);
    }

    ui->spacing();
    ui->text_wrapped("In a real preview manager plugin, this panel would own preview-specific controls, state, and file matching logic.");
    ui->spacing();

    if (ui->button("Toast From Plugin", 160.0f, 0.0f) && host && host->notify) {
        host->notify(host->context,
                     MISTY_NOTIFICATION_SUCCESS,
                     "Preview Manager",
                     "Plugin command and panel callbacks are working.");
    }
}

} // namespace

extern "C" uint32_t misty_plugin_abi_version(void) {
    return MISTY_PLUGIN_ABI_VERSION;
}

extern "C" int misty_plugin_register(const MistyPluginRegistrarApi* registrar) {
    if (!registrar || registrar->struct_size < sizeof(MistyPluginRegistrarApi) ||
        registrar->abi_version != MISTY_PLUGIN_ABI_VERSION ||
        !registrar->register_command || !registrar->register_panel) {
        return 0;
    }

    MistyCommandRegistration command{};
    command.struct_size = sizeof(MistyCommandRegistration);
    command.id = "preview-manager.open";
    command.title = "Open Preview Manager";
    command.default_shortcut = "Primary+]";
    command.invoke = &open_preview_manager;
    if (!registrar->register_command(registrar->context, &command)) {
        return 0;
    }

    MistyPanelRegistration panel{};
    panel.struct_size = sizeof(MistyPanelRegistration);
    panel.id = kPanelId;
    panel.title = "Preview Manager";
    panel.default_open = 0;
    panel.render = &render_preview_manager;
    return registrar->register_panel(registrar->context, &panel);
}
