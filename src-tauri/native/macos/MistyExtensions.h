// SPDX-License-Identifier: MIT
#include <stdbool.h>
typedef void (*MistyExtensionReply)(void *context, const char *json);
typedef void (*MistyExtensionEvent)(const char *json);
void misty_extensions_request(const char *json, MistyExtensionReply reply, void *context);
void misty_extensions_set_events(MistyExtensionEvent callback);
// Main-thread only. The caller owns the returned retained configuration.
void *misty_extensions_configuration(void *configuration, const char *url, bool default_store);
void misty_extensions_register_tab(void *webview, const char *identifier, bool private_tab, const char *url);
void misty_extensions_tab_event(const char *identifier, const char *event);

bool misty_extensions_navigation(void *view, void *action);
bool misty_extensions_supported(void);
