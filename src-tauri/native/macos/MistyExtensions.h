// SPDX-License-Identifier: MIT
#include <stdbool.h>
typedef void (*MistyExtensionReply)(void *context, const char *json);
typedef void (*MistyExtensionEvent)(const char *json);
// Each Space has its own extension host: its own WKWebExtensionController over
// the profile's website data store. `space` is the profile's id (`personal` or a
// generated one); requests name it in their "space" field.
void misty_extensions_request(const char *json, MistyExtensionReply reply, void *context);
void misty_extensions_set_events(MistyExtensionEvent callback);
// Main-thread only. The caller owns the returned retained configuration.
void *misty_extensions_configuration(const char *space, void *configuration, const char *url);
void misty_extensions_register_tab(const char *space, void *webview, const char *identifier, bool private_tab, const char *url);
// An empty `space` finds the host that knows the tab (a closing tab whose window is gone).
void misty_extensions_tab_event(const char *space, const char *identifier, const char *event);

// Kiri's extension transport. Kiri installs its reply handler on each compat
// host page's content controller and passes every request it admits back here.
typedef void (*MistyCompatChannelInstaller)(void *user_content_controller);
void misty_extensions_set_compat_channel(MistyCompatChannelInstaller install);
// Answers one compat request. `reply` is WebKit's reply block; it is called once.
void misty_extensions_compat_message(void *message, void *reply);

// Whether a page or extension may go to an extension page: Misty's rule, kept in Rust so it
// is the same for navigations and new windows. `tab` is empty when no tab is moving. Without
// a policy, as in the probes that link only this code, nothing is refused.
typedef bool (*MistyExtensionNavigationPolicy)(const char *tab, const char *url, const char *source);
void misty_extensions_set_navigation_policy(MistyExtensionNavigationPolicy policy);

// Routed to the Space whose host owns the view's tab.
bool misty_extensions_navigation(void *view, void *action);
bool misty_extensions_supported(void);

// What the native host's checks answer, for tests that can't run an extension.
// Whether `method` needs exactly `permission`; an empty one means any extension may call it.
bool misty_extensions_compat_requires(const char *method, const char *permission);
bool misty_extensions_download_header_allowed(const char *name);
