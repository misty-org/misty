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

// Kiri's extension transport. Kiri installs its reply handler on each compat
// host page's content controller and passes every request it admits back here.
typedef void (*MistyCompatChannelInstaller)(void *user_content_controller);
void misty_extensions_set_compat_channel(MistyCompatChannelInstaller install);
// Answers one compat request. `reply` is WebKit's reply block; it is called once.
void misty_extensions_compat_message(void *message, void *reply);

bool misty_extensions_navigation(void *view, void *action);
bool misty_extensions_supported(void);
