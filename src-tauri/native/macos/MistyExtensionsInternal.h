// SPDX-License-Identifier: MIT
// Declarations shared by the extension host's implementation files.
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import "MistyExtensionNativeMessaging.h"

static inline NSError *ExtensionError(NSString *message) {
    return [NSError errorWithDomain:@"MistyExtensions" code:1 userInfo:@{NSLocalizedDescriptionKey:message}];
}
static inline NSString *ExtensionJSON(id value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil];
    return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"null";
}
typedef void (^Reply)(NSDictionary *);

@class MistyExtensionHost, MistyExtensionWindow;
API_AVAILABLE(macos(15.4))
@interface MistyExtensionTab : NSObject <WKWebExtensionTab>
@property NSString *identifier;
@property (weak) WKWebView *view;
@property (weak) MistyExtensionHost *host;
@property MistyExtensionWindow *window;
@property (weak) MistyExtensionTab *parent;
@property BOOL selected;
@property BOOL muted;
@property BOOL audible;
@property NSUInteger position;
@property NSURL *logicalURL;
@property NSString *logicalTitle;
@property NSString *configuredOrigin;
@property NSURLRequest *pendingNavigation;
@end

API_AVAILABLE(macos(15.4))
@interface MistyExtensionWindow : NSObject <WKWebExtensionWindow>
@property (weak) NSWindow *native;
@property (weak) MistyExtensionHost *host;
@property BOOL privateWindow;
/// A popup window an extension opened for its own page (windows.create type "popup").
@property BOOL popupWindow;
@property NSString *identifier;
@end

API_AVAILABLE(macos(15.4))
@interface MistyExtensionHost : NSObject <WKWebExtensionControllerDelegate, WKScriptMessageHandler, WKNavigationDelegate>
/// The Space this host belongs to. Every event it raises names it.
@property NSString *space;
@property NSString *account;
@property NSString *controllerIdentifier;
@property WKWebExtensionController *controller;
@property WKWebsiteDataStore *store;
@property NSMutableDictionary<NSString *, WKWebExtensionContext *> *contexts;
@property NSMutableDictionary<NSString *, NSDictionary *> *descriptors;
@property NSMutableDictionary<NSString *, NSString *> *loadTokens;
@property NSMutableDictionary<NSString *, MistyExtensionTab *> *tabs;
@property NSMutableDictionary<NSString *, MistyExtensionWindow *> *windows;
@property NSMutableDictionary<NSString *, WKWebView *> *bridges;
@property NSMutableDictionary<NSString *, WKWebView *> *compatViews;
@property NSMutableDictionary<NSString *, id> *compatReplies;
@property NSMutableDictionary<NSString *, id> *pending;
@property NSMutableDictionary<NSString *, id> *openRequests;
@property NSMutableDictionary<NSString *, NSString *> *openingTabs;
@property NSMutableArray<NSWindow *> *optionsWindows;
@property NSMutableArray<NSWindow *> *popupWindows;
@property NSMutableDictionary<NSString *, NSMutableArray<NSTask *> *> *nativeTasks;
@property NSMutableDictionary<NSString *, NSMutableArray<MistyExtensionNativeMessaging *> *> *nativeConnections;
@property NSString *activeTab;
@property NSString *popupTab;
@property NSMutableSet<NSString *> *restored;
@property NSRect popupAnchor;
@property (weak) NSView *popupParent;
/// Navigation and UI delegate of this host's extension popup windows.
@property id popupWindowDelegate;
- (void)event:(NSString *)kind data:(NSDictionary *)data;
/// Makes the Space's controller once, over the Space's store. A host never
/// rebuilds it; the host is freed with the Space's last window instead.
- (void)startWithStore:(WKWebsiteDataStore *)store;
/// Unloads everything and forgets the account; the host can be configured again.
- (void)shutdown;
- (void)load:(NSDictionary *)descriptor reply:(Reply)reply;
- (void)unload:(NSString *)identifier;
- (void)registerOpenTab:(MistyExtensionTab *)tab;
@end

/// The operations Misty's app sends a host. Implemented in MistyExtensionRequests.m.
API_AVAILABLE(macos(15.4))
@interface MistyExtensionHost (Requests)
- (void)request:(NSDictionary *)request reply:(Reply)reply;
@end

/// WebKit delegate callbacks and the notifications a host observes.
/// Implemented in MistyExtensionDelegate.m.
API_AVAILABLE(macos(15.4))
@interface MistyExtensionHost (Delegate)
- (void)permissionsRemoved:(NSNotification *)notification;
- (void)runtimeErrors:(NSNotification *)notification;
- (void)popupClosed:(NSNotification *)notification;
- (void)windowFocused:(NSNotification *)notification;
- (void)openTabURL:(NSURL *)url private:(BOOL)privateTab options:(NSDictionary *)options complete:(void (^)(MistyExtensionTab *,NSError *))done;
@end

/// Firefox APIs the system runtime lacks, served through a hidden page per
/// extension. Implemented in MistyExtensionCompat.m.
API_AVAILABLE(macos(15.4))
@interface MistyExtensionHost (Compat)
- (void)startCompat:(NSString *)identifier context:(WKWebExtensionContext *)context;
- (void)stopCompat:(NSString *)identifier;
- (BOOL)isCompatNavigation:(WKWebView *)view url:(NSURL *)url;
- (void)compatMessage:(WKScriptMessage *)message reply:(void (^)(id, NSString *))reply;
/// Handles compat-reply and compat-event operations; returns NO for others.
- (BOOL)compatRequest:(NSDictionary *)request reply:(Reply)reply;
/// Sends an extension API event to one extension, if its grants allow it.
- (void)deliverCompatEvent:(NSString *)event args:(NSArray *)args to:(NSString *)identifier;
@end

/// The native work behind compatibility requests. Implemented in
/// MistyExtensionCompatActions.m.
API_AVAILABLE(macos(15.4))
@interface MistyExtensionHost (CompatActions)
- (NSDictionary *)detectLanguage:(id)text;
/// Removes website data from the browsing profile's store, then calls `complete`.
- (void)removeWebsiteData:(NSDictionary *)options types:(NSDictionary *)types complete:(void (^)(void))complete;
/// Returns an error message on failure.
- (NSString *)moveTab:(id)request context:(WKWebExtensionContext *)context;
- (MistyExtensionTab *)locateTab:(id)request context:(WKWebExtensionContext *)context;
/// The stored script's package path, or nil.
- (NSString *)writeUserScript:(id)code identifier:(NSString *)identifier;
- (NSString *)idleState:(id)threshold;
/// Returns an error message on failure.
- (NSString *)startDownload:(id)options context:(WKWebExtensionContext *)context;
/// The extension page that receives an OAuth redirect to `url`, if it is one.
- (NSURL *)identityRedirect:(NSURL *)url;
@end

/// Native popup windows for extension pages. Implemented in MistyExtensionPopupWindows.m.
API_AVAILABLE(macos(15.4))
@interface MistyExtensionHost (PopupWindows)
/// Opens a popup-type window for one of the extension's own pages. Returns NO,
/// without calling `done`, for any other window, which Misty's workspace opens.
- (BOOL)openPopupWindow:(WKWebExtensionWindowConfiguration *)configuration context:(WKWebExtensionContext *)context done:(void (^)(id<WKWebExtensionWindow>, NSError *))done;
@end

/// Extension notifications through UNUserNotificationCenter, so clicks and
/// buttons reach the extension. Implemented in MistyExtensionNotifications.m.
API_AVAILABLE(macos(15.4))
@interface MistyExtensionHost (Notifications)
/// Returns NO when notifications cannot be shown natively (an unbundled build),
/// so the request falls back to Misty's app notifications.
- (BOOL)handleNotification:(NSString *)method args:(NSArray *)args identifier:(NSString *)identifier reply:(void (^)(id, NSString *))reply;
@end

/// The live host of a Space, if its window is open.
API_AVAILABLE(macos(15.4)) MistyExtensionHost *MistyExtensionHostForSpace(NSString *space);

/// Sets WebKit's page-level mute. The same private call backs Misty's own tab
/// mute control; it is skipped when unavailable.
void MistySetPageMuted(WKWebView *view, BOOL muted);
