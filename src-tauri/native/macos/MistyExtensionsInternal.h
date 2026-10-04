// SPDX-License-Identifier: MIT
// Declarations shared by the extension host's implementation files.
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import "MistyExtensionNativeMessaging.h"

static inline NSError *ExtensionError(NSString *message) {
    return [NSError errorWithDomain:@"MistyExtensions" code:1 userInfo:@{NSLocalizedDescriptionKey:message}];
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
@property NSString *identifier;
@end

API_AVAILABLE(macos(15.4))
@interface MistyExtensionHost : NSObject <WKWebExtensionControllerDelegate, WKScriptMessageHandler, WKNavigationDelegate>
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
@property NSMutableDictionary<NSString *, NSMutableArray<NSTask *> *> *nativeTasks;
@property NSMutableDictionary<NSString *, NSMutableArray<MistyExtensionNativeMessaging *> *> *nativeConnections;
@property NSString *activeTab;
@property NSString *popupTab;
@property NSMutableSet<NSString *> *restored;
@property NSRect popupAnchor;
@property (weak) NSView *popupParent;
- (void)event:(NSString *)kind data:(NSDictionary *)data;
- (void)request:(NSDictionary *)request reply:(Reply)reply;
- (void)configureStore:(WKWebsiteDataStore *)store;
- (void)load:(NSDictionary *)descriptor reply:(Reply)reply;
- (void)unload:(NSString *)identifier;
- (void)registerOpenTab:(MistyExtensionTab *)tab;
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
/// The extension page that receives an OAuth redirect to `url`, if it is one.
- (NSURL *)identityRedirect:(NSURL *)url;
/// Sends an extension API event to one extension, if its grants allow it.
- (void)deliverCompatEvent:(NSString *)event args:(NSArray *)args to:(NSString *)identifier;
@end

/// Extension notifications through UNUserNotificationCenter, so clicks and
/// buttons reach the extension. Implemented in MistyExtensionNotifications.m.
API_AVAILABLE(macos(15.4))
@interface MistyExtensionHost (Notifications)
/// Returns NO when notifications cannot be shown natively (an unbundled build),
/// so the request falls back to Misty's app notifications.
- (BOOL)handleNotification:(NSString *)method args:(NSArray *)args identifier:(NSString *)identifier reply:(void (^)(id, NSString *))reply;
@end

/// Sets WebKit's page-level mute. The same private call backs Misty's own tab
/// mute control; it is skipped when unavailable.
void MistySetPageMuted(WKWebView *view, BOOL muted);
