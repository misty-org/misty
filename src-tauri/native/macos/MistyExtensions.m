// SPDX-License-Identifier: MIT
#import "MistyExtensions.h"
#import "MistyExtensionsInternal.h"

static MistyExtensionEvent emitEvent;
void misty_extensions_set_events(MistyExtensionEvent callback) { emitEvent = callback; }

@implementation MistyExtensionHost
- (instancetype)init {
    if ((self = [super init])) {
        _loadTokens = [NSMutableDictionary dictionary];
        _restored = [NSMutableSet set];
        _contexts = [NSMutableDictionary dictionary]; _descriptors = [NSMutableDictionary dictionary];
        _windows = [NSMutableDictionary dictionary];
        _tabs = [NSMutableDictionary dictionary]; _bridges = [NSMutableDictionary dictionary];
        _pending = [NSMutableDictionary dictionary]; _optionsWindows = [NSMutableArray array]; _popupWindows = [NSMutableArray array];
        _openRequests = [NSMutableDictionary dictionary]; _openingTabs = [NSMutableDictionary dictionary];
        _nativeTasks = [NSMutableDictionary dictionary];
        _nativeConnections = [NSMutableDictionary dictionary];
        _compatViews = [NSMutableDictionary dictionary]; _compatReplies = [NSMutableDictionary dictionary];
        [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(permissionsRemoved:) name:WKWebExtensionContextGrantedPermissionsWereRemovedNotification object:nil];
        [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(permissionsRemoved:) name:WKWebExtensionContextGrantedPermissionMatchPatternsWereRemovedNotification object:nil];
        [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(runtimeErrors:) name:WKWebExtensionContextErrorsDidUpdateNotification object:nil];
        [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(popupClosed:) name:NSPopoverDidCloseNotification object:nil];
        [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(windowFocused:) name:NSWindowDidBecomeKeyNotification object:nil];
    }
    return self;
}
- (void)event:(NSString *)kind data:(NSDictionary *)data {
    if (!emitEvent || !self.account) return;
    NSMutableDictionary *event = [data mutableCopy]; event[@"kind"] = kind; event[@"account"] = self.account; event[@"space"] = self.space;
    emitEvent(ExtensionJSON(event).UTF8String);
}
- (void)registerOpenTab:(MistyExtensionTab *)tab {
    if (!tab.window) return;
    // An adapter can predate a context (restoration, installation, or a native
    // view replacement). Merely returning it from tabsForWebExtensionContext:
    // or actionForTab: does not make it an open tab in that context. WebKit's
    // message routing requires an open tab, even when tabs.query and the popup
    // can already see its URL. These notifications are idempotent; do not
    // close/reopen the tab, which would change its extension-visible identity.
    [self.controller didOpenWindow:tab.window];
    [self.controller didOpenTab:tab];
}
- (void)startWithStore:(WKWebsiteDataStore *)store {
    if (!self.account || self.controller) return;
    self.store = store;
    NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:self.controllerIdentifier];
    WKWebExtensionControllerConfiguration *config = [WKWebExtensionControllerConfiguration configurationWithIdentifier:uuid];
    // Background pages and extension tabs use this store: the Space's own.
    config.defaultWebsiteDataStore = store;
    self.controller = [[WKWebExtensionController alloc] initWithConfiguration:config];
    self.controller.delegate = self;
}
- (void)shutdown {
    for (void (^pending)(BOOL) in self.pending.allValues) pending(NO);
    for (void (^pending)(MistyExtensionTab *,NSError *) in self.openRequests.allValues) pending(nil,ExtensionError(@"The account changed."));
    for (void (^pending)(id,NSString *) in self.compatReplies.allValues) pending(nil,@"The account changed.");
    [self.compatReplies removeAllObjects];
    [self.openRequests removeAllObjects]; [self.openingTabs removeAllObjects];
    for (NSString *key in self.contexts.allKeys) [self unload:key];
    for (NSWindow *window in self.optionsWindows) [window close];
    for (NSWindow *window in [self.popupWindows copy]) [window close];
    [self.optionsWindows removeAllObjects]; [self.popupWindows removeAllObjects]; [self.descriptors removeAllObjects];
    [self.loadTokens removeAllObjects]; [self.restored removeAllObjects]; [self.tabs removeAllObjects]; [self.windows removeAllObjects]; [self.pending removeAllObjects];
    self.activeTab = nil; self.popupTab = nil;
    self.controller = nil; self.store = nil; self.account = nil;
}
- (void)unload:(NSString *)identifier {
    [self.loadTokens removeObjectForKey:identifier];
    [self.restored removeObject:identifier];
    WKWebExtensionContext *context = self.contexts[identifier];
    [self.contexts removeObjectForKey:identifier];
    [[context actionForTab:nil] closePopup];
    for (MistyExtensionTab *tab in self.tabs.allValues) [[context actionForTab:tab] closePopup];
    [self.bridges[identifier].configuration.userContentController removeScriptMessageHandlerForName:@"mistyExtensionSync"];
    [self.bridges removeObjectForKey:identifier];
    [self stopCompat:identifier];
    for (NSTask *task in self.nativeTasks[identifier]) if (task.running) [task terminate];
    [self.nativeTasks removeObjectForKey:identifier];
    for (MistyExtensionNativeMessaging *connection in self.nativeConnections[identifier]) [connection stop];
    [self.nativeConnections removeObjectForKey:identifier];
    if (context) [self.controller unloadExtensionContext:context error:nil];
    [self.contexts removeObjectForKey:identifier];
}
- (void)load:(NSDictionary *)descriptor reply:(Reply)reply {
    NSString *identifier = descriptor[@"id"], *account = self.account;
    if (!self.controller) { reply(@{@"error":@"This Space's extension host isn't ready."}); return; }
    WKWebExtensionContext *existing=self.contexts[identifier];
    NSDictionary *previous=self.descriptors[identifier];
    if (existing && ([previous[@"permissions"] containsObject:@"storage"] == [descriptor[@"permissions"] containsObject:@"storage"]) && [previous[@"runtimePath"] isEqual:descriptor[@"runtimePath"]] && [previous[@"guid"] isEqual:descriptor[@"guid"]]) {
        for (NSString *permission in previous[@"permissions"]) if (![descriptor[@"permissions"] containsObject:permission]) [existing setPermissionStatus:WKWebExtensionContextPermissionStatusDeniedExplicitly forPermission:permission];
        for (NSString *permission in descriptor[@"permissions"]) [existing setPermissionStatus:WKWebExtensionContextPermissionStatusGrantedExplicitly forPermission:permission];
        for (NSString *pattern in previous[@"hosts"]) if (![descriptor[@"hosts"] containsObject:pattern]) {
            WKWebExtensionMatchPattern *match=[[WKWebExtensionMatchPattern alloc] initWithString:pattern error:nil];
            if (match) [existing setPermissionStatus:WKWebExtensionContextPermissionStatusDeniedExplicitly forMatchPattern:match];
        }
        for (NSString *pattern in descriptor[@"hosts"]) {
            WKWebExtensionMatchPattern *match=[[WKWebExtensionMatchPattern alloc] initWithString:pattern error:nil];
            if (match) [existing setPermissionStatus:WKWebExtensionContextPermissionStatusGrantedExplicitly forMatchPattern:match];
        }
        existing.hasAccessToPrivateData=[descriptor[@"privateAccess"] boolValue] && ![existing.webExtension.manifest[@"incognito"] isEqual:@"not_allowed"];
        if (![descriptor[@"permissions"] containsObject:@"nativeMessaging"]) { for (MistyExtensionNativeMessaging *connection in self.nativeConnections[identifier]) [connection stop]; [self.nativeConnections removeObjectForKey:identifier]; }
        if (!existing.hasAccessToPrivateData) for (MistyExtensionTab *tab in self.tabs.allValues) if (tab.window.privateWindow) [[existing actionForTab:tab] closePopup];
        self.descriptors[identifier]=descriptor;
        [self event:@"changed" data:@{@"id":identifier}];
        // Re-announce a live bridge after control changes without restarting the
        // extension's background or invalidating permission completion handlers.
        if (self.bridges[identifier]) [self.bridges[identifier] evaluateJavaScript:@"browser.storage.sync.get(null).then(values => window.webkit.messageHandlers.mistyExtensionSync.postMessage({kind:'sync-ready',values})); void 0" completionHandler:nil];
        reply(@{@"loaded":@YES}); return;
    }
    NSString *loadToken=NSUUID.UUID.UUIDString; self.loadTokens[identifier]=loadToken;
    NSURL *root = [NSURL fileURLWithPath:descriptor[@"runtimePath"] isDirectory:YES];
    [WKWebExtension extensionWithResourceBaseURL:root completionHandler:^(WKWebExtension *extension, NSError *error) {
        if (![account isEqual:self.account] || ![self.loadTokens[identifier] isEqual:loadToken]) { reply(@{@"error":@"The account changed."}); return; }
        if (error || !extension) { reply(@{@"error":error.localizedDescription ?: @"The extension could not load."}); return; }
        [self unload:identifier];
        WKWebExtensionContext *context = [[WKWebExtensionContext alloc] initForExtension:extension];
        context.uniqueIdentifier = descriptor[@"guid"];
        context.baseURL = [NSURL URLWithString:[NSString stringWithFormat:@"webkit-extension://%@/", descriptor[@"origin"]]];
        context.hasAccessToPrivateData = [descriptor[@"privateAccess"] boolValue] && ![extension.manifest[@"incognito"] isEqual:@"not_allowed"];
        // MISTY_INSPECT_EXTENSIONS=1 shows each extension's background and popup in
        // Safari's Develop menu, to see why one fails. Off otherwise.
        context.inspectable = [NSProcessInfo.processInfo.environment[@"MISTY_INSPECT_EXTENSIONS"] isEqual:@"1"];
        // identity, management and sidebarAction come from the compatibility layer.
        context.unsupportedAPIs = [NSSet setWithArray:@[@"browser.debugger", @"browser.sidePanel"]];
        for (NSString *permission in descriptor[@"permissions"]) [context setPermissionStatus:WKWebExtensionContextPermissionStatusGrantedExplicitly forPermission:permission];
        for (NSString *pattern in descriptor[@"hosts"]) {
            WKWebExtensionMatchPattern *match = [[WKWebExtensionMatchPattern alloc] initWithString:pattern error:nil];
            if (match) [context setPermissionStatus:WKWebExtensionContextPermissionStatusGrantedExplicitly forMatchPattern:match];
        }
        NSError *loadError;
        if (![self.controller loadExtensionContext:context error:&loadError]) { reply(@{@"error":loadError.localizedDescription ?: @"The extension runtime rejected this package."}); return; }
        self.contexts[identifier] = context; self.descriptors[identifier] = descriptor;
        // WebKit wakes a background that isn't persistent only for events it saw the
        // extension register, and remembers those across launches. Starting it now lets
        // one that never ran here (or ran an older package) register its listeners.
        if (context.webExtension.hasBackgroundContent) {
            [context loadBackgroundContentWithCompletionHandler:^(NSError *failure) {
                if (failure) [self event:@"background-error" data:@{@"id":identifier, @"detail":failure.localizedDescription ?: @""}];
            }];
        }
        for (MistyExtensionTab *tab in self.tabs.allValues) [self registerOpenTab:tab];
        [self startCompat:identifier context:context];
        if ([context hasPermission:@"storage"]) {
            WKWebViewConfiguration *config = context.webViewConfiguration;
            // Context configurations can share a user-content controller. Give
            // this privileged bridge its own handler namespace and scripts.
            config.userContentController = [WKUserContentController new];
            [config.userContentController addScriptMessageHandler:self name:@"mistyExtensionSync"];
            WKWebView *bridge = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 1, 1) configuration:config];
            bridge.navigationDelegate = self;
            self.bridges[identifier] = bridge;
            [bridge loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@"__misty_sync__/bridge.html" relativeToURL:context.baseURL]]];
        }
        if (!self.bridges[identifier]) [self.restored addObject:identifier];
        [self event:@"changed" data:@{@"id":identifier}];
        reply(@{@"loaded":@YES, @"errors":[extension.errors valueForKey:@"localizedDescription"] ?: @[]});
    }];
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if (!message.frameInfo.isMainFrame || ![message.body isKindOfClass:NSDictionary.class]) return;
    for (NSString *identifier in self.bridges) {
        if (self.bridges[identifier] != message.webView) continue;
        NSURL *expected = [NSURL URLWithString:@"__misty_sync__/bridge.html" relativeToURL:self.contexts[identifier].baseURL];
        if (![message.frameInfo.request.URL.absoluteString isEqual:expected.absoluteString]) return;
        NSDictionary *body = message.body;
        if ([@[@"sync-ready", @"sync-change", @"sync-error"] containsObject:body[@"kind"]])
            [self event:body[@"kind"] data:@{@"id":identifier,@"session":self.descriptors[identifier][@"session"] ?: @0, @"payload":body}];
        return;
    }
}
@end
