#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#if defined(_WIN32)
#if defined(MISTY_EXTENSION_BUILD)
#define MISTY_EXTENSION_EXPORT __declspec(dllexport)
#else
#define MISTY_EXTENSION_EXPORT
#endif
#else
#define MISTY_EXTENSION_EXPORT __attribute__((visibility("default")))
#endif

#define MISTY_PLUGIN_ABI_VERSION 1u

typedef enum MistyNotificationLevel {
    MISTY_NOTIFICATION_INFO = 0,
    MISTY_NOTIFICATION_SUCCESS = 1,
    MISTY_NOTIFICATION_ERROR = 2,
} MistyNotificationLevel;

typedef struct MistyHostApi MistyHostApi;
typedef struct MistyUiApi MistyUiApi;
typedef struct MistyPluginRegistrarApi MistyPluginRegistrarApi;

typedef void (*MistyCommandInvokeFn)(const MistyHostApi* host, void* user_data);
typedef void (*MistyPanelRenderFn)(const MistyHostApi* host,
                                   const MistyUiApi* ui,
                                   void* user_data);

typedef struct MistyCommandRegistration {
    uint32_t struct_size;
    const char* id;
    const char* title;
    const char* default_shortcut;
    MistyCommandInvokeFn invoke;
    void* user_data;
} MistyCommandRegistration;

typedef struct MistyPanelRegistration {
    uint32_t struct_size;
    const char* id;
    const char* title;
    int default_open;
    MistyPanelRenderFn render;
    void* user_data;
} MistyPanelRegistration;

struct MistyHostApi {
    uint32_t struct_size;
    uint32_t abi_version;
    void* context;
    int (*open_panel)(void* context, const char* panel_id);
    int (*close_panel)(void* context, const char* panel_id);
    int (*is_panel_open)(void* context, const char* panel_id);
    int (*copy_current_view_id)(void* context, char* buffer, size_t buffer_size);
    int (*notify)(void* context,
                  MistyNotificationLevel level,
                  const char* title,
                  const char* message);
};

struct MistyUiApi {
    uint32_t struct_size;
    uint32_t abi_version;
    void (*text)(const char* text);
    void (*text_wrapped)(const char* text);
    int (*button)(const char* label, float width, float height);
    void (*same_line)();
    void (*separator)();
    void (*spacing)();
};

struct MistyPluginRegistrarApi {
    uint32_t struct_size;
    uint32_t abi_version;
    void* context;
    int (*register_command)(void* context, const MistyCommandRegistration* command);
    int (*register_panel)(void* context, const MistyPanelRegistration* panel);
};

typedef uint32_t (*MistyPluginAbiVersionFn)();
typedef int (*MistyPluginRegisterFn)(const MistyPluginRegistrarApi* registrar);

MISTY_EXTENSION_EXPORT uint32_t misty_plugin_abi_version(void);
MISTY_EXTENSION_EXPORT int misty_plugin_register(const MistyPluginRegistrarApi* registrar);

#ifdef __cplusplus
}
#endif
