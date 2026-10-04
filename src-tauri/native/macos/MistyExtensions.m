// SPDX-License-Identifier: MIT
#import "MistyExtensions.h"
#import "MistyExtensionsInternal.h"

static MistyExtensionEvent emitEvent;
static NSString *JSON(id value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil];
    return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"null";
}

API_AVAILABLE(macos(15.4)) static MistyExtensionHost *host;

@implementation MistyExtensionHost
- (instancetype)init {
    if ((self = [super init])) {
        _loadTokens = [NSMutableDictionary dictionary];
        _restored = [NSMutableSet set];
        _contexts = [NSMutableDictionary dictionary]; _descriptors = [NSMutableDictionary dictionary];
        _windows = [NSMutableDictionary dictionary];
        _tabs = [NSMutableDictionary dictionary]; _bridges = [NSMutableDictionary dictionary];
        _pending = [NSMutableDictionary dictionary]; _optionsWindows = [NSMutableArray array];
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
    NSMutableDictionary *event = [data mutableCopy]; event[@"kind"] = kind; event[@"account"] = self.account;
    emitEvent(JSON(event).UTF8String);
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
- (void)configureStore:(WKWebsiteDataStore *)store {
    if (!self.account) return;
    if (self.controller && (self.store == store || (self.store.identifier && [self.store.identifier isEqual:store.identifier]))) return;
    NSArray *descriptors = self.descriptors.allValues;
    for (NSString *key in self.contexts.allKeys) [self unload:key];
    self.store = store;
    NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:self.controllerIdentifier];
    WKWebExtensionControllerConfiguration *config = [WKWebExtensionControllerConfiguration configurationWithIdentifier:uuid];
    config.defaultWebsiteDataStore = store;
    self.controller = [[WKWebExtensionController alloc] initWithConfiguration:config];
    self.controller.delegate = self;
    for (NSDictionary *descriptor in descriptors) [self load:descriptor reply:^(NSDictionary *result) { (void)result; }];
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
    if (!self.controller) [self configureStore:self.store ?: [WKWebsiteDataStore nonPersistentDataStore]];
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
- (void)request:(NSDictionary *)request reply:(Reply)reply {
    NSString *operation = request[@"operation"], *identifier = request[@"id"];
    if ([operation isEqual:@"configure"]) {
        NSString *account = request[@"account"];
        if (![account isEqual:self.account]) {
            if (!account.length && self.account) [self event:@"runtime-reset" data:@{}];
            for (void (^pending)(BOOL) in self.pending.allValues) pending(NO);
            for (void (^pending)(MistyExtensionTab *,NSError *) in self.openRequests.allValues) pending(nil,ExtensionError(@"The account changed."));
            for (void (^pending)(id,NSString *) in self.compatReplies.allValues) pending(nil,@"The account changed.");
            [self.compatReplies removeAllObjects];
            [self.openRequests removeAllObjects]; [self.openingTabs removeAllObjects];
            for (NSString *key in self.contexts.allKeys) [self unload:key];
            for (NSWindow *window in self.optionsWindows) [window close];
            [self.optionsWindows removeAllObjects]; [self.descriptors removeAllObjects];
            [self.loadTokens removeAllObjects]; [self.tabs removeAllObjects]; [self.windows removeAllObjects]; [self.pending removeAllObjects]; self.controller = nil; self.store = nil;
            self.account = account.length ? account : nil;
            self.controllerIdentifier = request[@"controllerId"];
        }
        reply(@{@"supported":@YES}); return;
    }
    if (!self.account || ![request[@"account"] isEqual:self.account]) { reply(@{@"error":@"The extension account changed."}); return; }
    if ([self compatRequest:request reply:reply]) return;
    if ([operation isEqual:@"diagnostics"]) {
        reply(@{@"runtimeCount":@(self.contexts.count),@"bridgeViewCount":@(self.bridges.count),@"platform":NSProcessInfo.processInfo.operatingSystemVersionString,@"minimumOS":@"15.4",@"manifestVersions":@[@2,@3],@"compatibility":@"Version-specific testing required",@"acquisition":@[@"firefox-addons"],@"knownUnavailable":@[@"debugger",@"proxy",@"sidePanel"],@"limited":@[@"webRequestBlocking",@"identity",@"management",@"tabHide",@"contextualIdentities",@"bookmarks",@"privacy"],@"compatibilityLayer":@[@"notifications",@"downloads",@"history",@"topSites",@"search",@"sessions",@"browsingData",@"find",@"idle",@"tts",@"theme"],@"hostLimitations":@[@"new-tab overrides",@"moving existing tabs into new windows",@"pinned and reader-mode tabs"]}); return;
    }
    if ([operation isEqual:@"validate"]) {
        NSURL *root=[NSURL fileURLWithPath:request[@"runtimePath"] isDirectory:YES];
        [WKWebExtension extensionWithResourceBaseURL:root completionHandler:^(WKWebExtension *extension,NSError *error) {
            if (!extension || error) { reply(@{@"error":error.localizedDescription ?: @"Invalid extension manifest."}); return; }
            NSMutableArray *errors=[NSMutableArray array]; BOOL blocked=NO;
            for (NSError *issue in extension.errors) {
                [errors addObject:issue.localizedDescription];
                if (issue.code==WKWebExtensionErrorInvalidManifest || issue.code==WKWebExtensionErrorUnsupportedManifestVersion || issue.code==WKWebExtensionErrorResourceNotFound || issue.code==WKWebExtensionErrorInvalidArchive) blocked=YES;
            }
            reply(@{@"findings":errors,@"blocked":@(blocked),@"platform":NSProcessInfo.processInfo.operatingSystemVersionString,@"hosts":[extension.allRequestedMatchPatterns.allObjects valueForKey:@"string"] ?: @[]});
        }]; return;
    }
    if ([operation isEqual:@"layout"]) {
        NSMutableSet *seen=[NSMutableSet set];
        for (NSDictionary *item in request[@"tabs"]) {
            NSURL *logicalURL=[NSURL URLWithString:item[@"url"]];
            if (![@[@"http",@"https",@"webkit-extension"] containsObject:logicalURL.scheme] && ![logicalURL.absoluteString isEqual:@"about:blank"]) continue;
            NSString *key=item[@"id"], *windowId=item[@"windowId"];
            BOOL privateTab=[item[@"private"] boolValue];
            NSString *windowKey=[NSString stringWithFormat:@"%@:%d",windowId,privateTab];
            MistyExtensionWindow *window=self.windows[windowKey];
            if (!window) { window=[MistyExtensionWindow new]; window.identifier=windowId; window.host=self; window.privateWindow=privateTab; self.windows[windowKey]=window; [self.controller didOpenWindow:window]; }
            MistyExtensionTab *tab=self.tabs[key]; BOOL isNew=!tab;
            if (!tab) { tab=[MistyExtensionTab new]; tab.identifier=key; tab.host=self; }
            MistyExtensionWindow *old=tab.window; NSUInteger oldIndex=tab.position;
            tab.window=window; if (tab.view.window) window.native=tab.view.window;
            tab.position=[item[@"index"] unsignedIntegerValue]; tab.logicalURL=[NSURL URLWithString:item[@"url"]]; tab.logicalTitle=item[@"title"];
            tab.selected=[item[@"active"] boolValue];
            WKWebExtensionTabChangedProperties changed=WKWebExtensionTabChangedPropertiesNone;
            if (tab.muted!=[item[@"muted"] boolValue]) { tab.muted=[item[@"muted"] boolValue]; changed|=WKWebExtensionTabChangedPropertiesMuted; }
            if (tab.audible!=[item[@"audible"] boolValue]) { tab.audible=[item[@"audible"] boolValue]; changed|=WKWebExtensionTabChangedPropertiesPlayingAudio; }
            self.tabs[key]=tab; [seen addObject:key];
            [self registerOpenTab:tab];
            if (!isNew && changed) [self.controller didChangeTabProperties:changed forTab:tab];
            if (!isNew && (old!=window || oldIndex!=tab.position)) [self.controller didMoveTab:tab fromIndex:oldIndex inWindow:old];
            if (tab.selected && [item[@"focused"] boolValue] && ![self.activeTab isEqual:key]) {
                MistyExtensionTab *previous=self.tabs[self.activeTab]; self.activeTab=key;
                [self.controller didActivateTab:tab previousActiveTab:previous]; [self.controller didFocusWindow:window];
            }
        }
        for (NSString *key in self.tabs.allKeys) if (![seen containsObject:key] && !self.tabs[key].view) { [self.controller didCloseTab:self.tabs[key] windowIsClosing:NO]; [self.tabs removeObjectForKey:key]; }
        for (NSString *key in self.windows.allKeys) {
            MistyExtensionWindow *window=self.windows[key];
            BOOL used=NO; for (MistyExtensionTab *tab in self.tabs.allValues) if (tab.window==window) used=YES;
            if (!used) { [self.controller didCloseWindow:window]; [self.windows removeObjectForKey:key]; }
        }
        reply(@{}); return;
    }
    if ([operation isEqual:@"permission-response"]) {
        void (^complete)(BOOL) = self.pending[request[@"requestId"]];
        if (complete) { [self.pending removeObjectForKey:request[@"requestId"]]; complete([request[@"allowed"] boolValue]); }
        reply(@{}); return;
    }
    if ([operation isEqual:@"pending-navigation"]) { reply(@{@"pending":@(self.tabs[request[@"tabId"]].pendingNavigation!=nil)}); return; }
    if ([operation isEqual:@"tab-created"]) {
        NSString *requestId=request[@"requestId"], *tabId=request[@"tabId"];
        void (^done)(MistyExtensionTab *,NSError *)=self.openRequests[requestId];
        if (done) {
            if (self.tabs[tabId]) { [self.openRequests removeObjectForKey:requestId]; done(self.tabs[tabId],nil); }
            else self.openingTabs[tabId]=requestId;
        }
        reply(@{}); return;
    }
    if ([operation isEqual:@"sync-restored"]) {
        if (self.contexts[identifier] && ![self.restored containsObject:identifier]) { [self.restored addObject:identifier]; [self event:@"actions-changed" data:@{}]; }
        reply(@{}); return;
    }
    if ([operation isEqual:@"load"]) { [self load:request reply:reply]; return; }
    if ([operation isEqual:@"unload"] || [operation isEqual:@"remove"]) {
        WKWebExtensionContext *context = self.contexts[identifier];
        [self unload:identifier]; [self.descriptors removeObjectForKey:identifier];
        if ([operation isEqual:@"remove"]) {
            if (!self.controller) [self configureStore:self.store ?: [WKWebsiteDataStore nonPersistentDataStore]];
            WKWebExtensionController *controller = self.controller;
            NSString *guid = request[@"guid"] ?: context.uniqueIdentifier;
            [controller fetchDataRecordsOfTypes:WKWebExtensionController.allExtensionDataTypes completionHandler:^(NSArray<WKWebExtensionDataRecord *> *records) {
                NSMutableArray *matching = [NSMutableArray array];
                for (WKWebExtensionDataRecord *record in records) if ([record.uniqueIdentifier isEqual:guid]) [matching addObject:record];
                [controller removeDataOfTypes:WKWebExtensionController.allExtensionDataTypes fromDataRecords:matching completionHandler:^{ reply(@{}); }];
            }];
        } else reply(@{});
        return;
    }
    if ([operation isEqual:@"actions"]) {
        NSMutableArray *actions = [NSMutableArray array];
        MistyExtensionTab *tab = self.tabs[request[@"tabId"]];
        for (NSString *key in self.contexts) {
            WKWebExtensionContext *context = self.contexts[key];
            WKWebExtensionAction *action = [context actionForTab:tab];
            NSImage *icon = [action iconForSize:NSMakeSize(20, 20)];
            NSBitmapImageRep *bitmap = icon ? [[NSBitmapImageRep alloc] initWithData:icon.TIFFRepresentation] : nil;
            NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
            [actions addObject:@{@"id":key, @"title":action.label ?: @"", @"badge":action.badgeText ?: @"", @"enabled":@(action.enabled && [self.restored containsObject:key] && (!tab.window.privateWindow || context.hasAccessToPrivateData)), @"icon":png ? [@"data:image/png;base64," stringByAppendingString:[png base64EncodedStringWithOptions:0]] : @""}];
        }
        reply(@{@"actions":actions}); return;
    }
    if ([operation isEqual:@"context-menu"]) {
        MistyExtensionTab *tab=self.tabs[request[@"tabId"]];
        NSMenu *menu=[NSMenu new];
        for (NSString *key in self.contexts) {
            if (![request[@"allowedIds"] containsObject:key]) continue;
            WKWebExtensionContext *context=self.contexts[key];
            if (!tab || (tab.window.privateWindow && !context.hasAccessToPrivateData) || ![self.restored containsObject:key]) continue;
            for (NSMenuItem *item in [context menuItemsForTab:tab]) [menu addItem:item];
        }
        if (!menu.numberOfItems) { NSMenuItem *empty=[[NSMenuItem alloc] initWithTitle:@"No extension actions for this page" action:nil keyEquivalent:@""]; empty.enabled=NO; [menu addItem:empty]; }
        [menu popUpMenuPositioningItem:nil atLocation:NSEvent.mouseLocation inView:nil];
        reply(@{}); return;
    }
    WKWebExtensionContext *context = self.contexts[identifier];
    if (!context) { reply(@{@"error":@"This extension is not running."}); return; }
    if ([operation isEqual:@"invoke"] || [operation isEqual:@"options"]) { if (![self.restored containsObject:identifier]) { reply(@{@"error":@"Extension settings are still restoring. Unlock account sync to continue."}); return; } }
    if ([operation isEqual:@"invoke"]) {
        MistyExtensionTab *tab = self.tabs[request[@"tabId"]];
        if (!tab || (tab.window.privateWindow && !context.hasAccessToPrivateData)) { reply(@{@"error":@"This extension cannot access the current tab."}); return; }
        self.popupTab=tab.identifier;
        self.popupParent = tab.view.window.contentView;
        NSDictionary *anchor = [request[@"anchor"] isKindOfClass:NSDictionary.class] ? request[@"anchor"] : @{@"x":@0.94,@"y":@0.04,@"width":@0.02,@"height":@0.02};
        CGSize size=self.popupParent.bounds.size;
        self.popupAnchor = NSMakeRect([anchor[@"x"] doubleValue]*size.width, size.height*(1-[anchor[@"y"] doubleValue]-[anchor[@"height"] doubleValue]), MAX(1,[anchor[@"width"] doubleValue]*size.width), MAX(1,[anchor[@"height"] doubleValue]*size.height));
        [context performActionForTab:tab]; reply(@{}); return;
    }
    if ([operation isEqual:@"options"]) {
        if (!context.optionsPageURL) { reply(@{@"error":@"This extension has no options page."}); return; }
        [self event:@"open-tab" data:@{@"url":context.optionsPageURL.absoluteString, @"private":@NO}]; reply(@{}); return;
    }
    if ([operation isEqual:@"popup-evaluate"]) {
        MistyExtensionTab *tab=self.tabs[request[@"tabId"]];
        WKWebExtensionAction *action=[context actionForTab:tab];
        if (!tab || (tab.window.privateWindow && !context.hasAccessToPrivateData) || !action.popupPopover.shown || action.associatedTab!=tab || [self.controller extensionContextForURL:action.popupWebView.URL]!=context || ![self.restored containsObject:identifier]) { reply(@{@"error":@"Open this extension's popup on the granted tab before inspecting it."}); return; }
        NSString *script=request[@"script"];
        [action.popupWebView evaluateJavaScript:script completionHandler:^(id result,NSError *error) { reply(error ? @{@"error":@"The extension popup changed. Inspect it again."} : @{@"result":result ?: NSNull.null}); }];
        return;
    }
    if ([operation isEqual:@"sync-apply"]) {
        WKWebView *bridge = self.bridges[identifier];
        if (!bridge) { reply(@{@"error":@"Extension sync is not ready."}); return; }
        [bridge callAsyncJavaScript:@"return await window.mistyApplySync(changes)" arguments:@{@"changes":request[@"changes"] ?: @{}} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id result, NSError *error) { (void)result; reply(error ? @{@"error":error.localizedDescription} : @{}); }]; return;
    }
    reply(@{@"error":@"Unknown extension operation."});
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
- (void)webView:(WKWebView *)view decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))done {
    NSURL *url = action.request.URL;
    BOOL allowed = [self isCompatNavigation:view url:url];
    for (NSString *identifier in self.bridges) {
        if (self.bridges[identifier] != view) continue;
        NSURL *expected = [NSURL URLWithString:@"__misty_sync__/bridge.html" relativeToURL:self.contexts[identifier].baseURL];
        allowed = [url.absoluteString isEqual:expected.absoluteString];
        break;
    }
    done(allowed ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}
- (NSArray<id<WKWebExtensionWindow>> *)webExtensionController:(WKWebExtensionController *)controller openWindowsForExtensionContext:(WKWebExtensionContext *)context {
    NSMutableOrderedSet *windows = [NSMutableOrderedSet orderedSet];
    for (MistyExtensionTab *tab in self.tabs.allValues) if (!tab.window.privateWindow || context.hasAccessToPrivateData) [windows addObject:tab.window];
    return windows.array;
}
- (id<WKWebExtensionWindow>)webExtensionController:(WKWebExtensionController *)controller focusedWindowForExtensionContext:(WKWebExtensionContext *)context {
    MistyExtensionWindow *window=self.tabs[self.activeTab].window;
    return window.privateWindow && !context.hasAccessToPrivateData ? nil : window;
}
- (void)permissionsRemoved:(NSNotification *)notification {
    WKWebExtensionContext *context=notification.object;
    NSString *identifier=[self.contexts allKeysForObject:context].firstObject;
    if (!identifier) return;
    NSSet *removed=notification.userInfo[WKWebExtensionContextNotificationUserInfoKeyPermissions];
    NSSet *patterns=notification.userInfo[WKWebExtensionContextNotificationUserInfoKeyMatchPatterns];
    NSMutableArray *permissions=[NSMutableArray array], *hosts=[NSMutableArray array];
    NSDictionary *descriptor=self.descriptors[identifier];
    for (NSString *permission in removed) if ([descriptor[@"permissions"] containsObject:permission]) [permissions addObject:permission];
    for (WKWebExtensionMatchPattern *pattern in patterns) if ([descriptor[@"hosts"] containsObject:pattern.string]) [hosts addObject:pattern.string];
    // Temporary activeTab access is never copied into durable account grants.
    if (permissions.count || hosts.count) [self event:@"permissions-removed" data:@{@"id":identifier,@"permissions":permissions,@"hosts":hosts}];
}
- (void)runtimeErrors:(NSNotification *)notification {
    WKWebExtensionContext *context=notification.object;
    NSString *identifier=[self.contexts allKeysForObject:context].firstObject;
    if (!identifier) return;
    NSArray *messages=[context.errors valueForKey:@"localizedDescription"];
    [self event:@"runtime-error" data:@{@"id":identifier,@"detail":[messages componentsJoinedByString:@"\n"] ?: @""}];
}
- (void)popupClosed:(NSNotification *)notification {
    (void)notification;
    MistyExtensionTab *tab=self.tabs[self.popupTab];
    if (tab.view.window.isKeyWindow) [tab.view.window makeFirstResponder:tab.view];
    self.popupTab=nil;
}
- (void)windowFocused:(NSNotification *)notification {
    for (MistyExtensionTab *tab in self.tabs.allValues) if (tab.window.native == notification.object && tab.selected) { [self.controller didFocusWindow:tab.window]; break; }
}
- (void)webExtensionController:(WKWebExtensionController *)controller didUpdateAction:(WKWebExtensionAction *)action forExtensionContext:(WKWebExtensionContext *)context { [self event:@"actions-changed" data:@{}]; }
- (void)webExtensionController:(WKWebExtensionController *)controller presentPopupForAction:(WKWebExtensionAction *)action forExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSError *))done {
    NSView *parent = self.popupParent ?: ((MistyExtensionTab *)action.associatedTab).view.window.contentView;
    if (!parent || !action.popupPopover) { done(ExtensionError(@"Open a browser tab to use this extension.")); return; }
    action.popupPopover.behavior = NSPopoverBehaviorTransient;
    [action.popupPopover showRelativeToRect:self.popupAnchor ofView:parent preferredEdge:NSRectEdgeMinY];
    done(nil);
}
- (void)webExtensionController:(WKWebExtensionController *)controller openOptionsPageForExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSError *))done {
    if (context.optionsPageURL) [self event:@"open-tab" data:@{@"url":context.optionsPageURL.absoluteString, @"private":@NO}];
    done(context.optionsPageURL ? nil : ExtensionError(@"No options page is available."));
}
- (void)openTabURL:(NSURL *)url private:(BOOL)privateTab options:(NSDictionary *)options complete:(void (^)(MistyExtensionTab *,NSError *))done {
    if (!url) url=[NSURL URLWithString:@"about:blank"];
    if (![@[@"https",@"http",@"webkit-extension",@"about"] containsObject:url.scheme] || ([url.scheme isEqual:@"about"] && ![url.absoluteString isEqual:@"about:blank"])) { done(nil,ExtensionError(@"This URL cannot be opened by an extension.")); return; }
    NSString *requestId=NSUUID.UUID.UUIDString;
    self.openRequests[requestId]=[done copy];
    NSMutableDictionary *event=[options mutableCopy];
    [event addEntriesFromDictionary:@{@"requestId":requestId,@"url":url.absoluteString,@"private":@(privateTab)}];
    [self event:@"open-tab" data:event];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,30*NSEC_PER_SEC),dispatch_get_main_queue(), ^{
        void (^pending)(MistyExtensionTab *,NSError *)=self.openRequests[requestId];
        if (pending) { [self.openRequests removeObjectForKey:requestId]; pending(nil,ExtensionError(@"The browser tab could not be opened.")); }
    });
}
- (void)webExtensionController:(WKWebExtensionController *)controller openNewTabUsingConfiguration:(WKWebExtensionTabConfiguration *)configuration forExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(id<WKWebExtensionTab>,NSError *))done {
    BOOL privateTab=[configuration.window isPrivateForWebExtensionContext:context];
    if (privateTab && !context.hasAccessToPrivateData) { done(nil,ExtensionError(@"Private access is disabled.")); return; }
    // Misty has no pinned or reader-mode tabs; those requests open an ordinary tab.
    NSMutableDictionary *options=[@{@"focused":@(configuration.shouldBeActive),@"index":@(configuration.index)} mutableCopy];
    NSString *windowId=((MistyExtensionWindow *)configuration.window).identifier;
    if (windowId) options[@"windowId"]=windowId;
    BOOL muted=configuration.shouldBeMuted;
    MistyExtensionTab *parent=[(NSObject *)configuration.parentTab isKindOfClass:MistyExtensionTab.class] ? (MistyExtensionTab *)configuration.parentTab : nil;
    [self openTabURL:configuration.url private:privateTab options:options complete:^(MistyExtensionTab *tab,NSError *error) {
        tab.parent=parent;
        if (tab && muted) [tab setMuted:YES forWebExtensionContext:context completionHandler:^(NSError *failure) { (void)failure; }];
        done(tab,error);
    }];
}
- (void)webExtensionController:(WKWebExtensionController *)controller openNewWindowUsingConfiguration:(WKWebExtensionWindowConfiguration *)configuration forExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(id<WKWebExtensionWindow>,NSError *))done {
    if (configuration.shouldBePrivate && !context.hasAccessToPrivateData) { done(nil,ExtensionError(@"Private access is disabled.")); return; }
    if (configuration.tabs.count) { done(nil,ExtensionError(@"Moving existing tabs into a new window is not available.")); return; }
    NSString *requestId=NSUUID.UUID.UUIDString;
    self.openRequests[requestId]=[^(MistyExtensionTab *tab,NSError *error) { done(tab.window,error); } copy];
    NSMutableArray *tabs=[NSMutableArray array]; for (MistyExtensionTab *tab in configuration.tabs) [tabs addObject:tab.identifier];
    NSMutableArray *urls=[NSMutableArray array]; for (NSURL *url in configuration.tabURLs) {
        if (![@[@"http",@"https",@"webkit-extension",@"about"] containsObject:url.scheme]) { [self.openRequests removeObjectForKey:requestId]; done(nil,ExtensionError(@"This URL cannot be opened.")); return; }
        [urls addObject:url.absoluteString];
    }
    [self event:@"open-window" data:@{@"requestId":requestId,@"urls":urls,@"tabs":tabs,@"private":@(configuration.shouldBePrivate),@"focused":@(configuration.shouldBeFocused)}];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,30*NSEC_PER_SEC),dispatch_get_main_queue(), ^{
        void (^pending)(MistyExtensionTab *,NSError *)=self.openRequests[requestId]; if (pending) { [self.openRequests removeObjectForKey:requestId]; pending(nil,ExtensionError(@"The browser window could not be opened.")); }
    });
}
- (void)permission:(WKWebExtensionContext *)context data:(NSDictionary *)data complete:(void (^)(BOOL))complete {
    NSString *requestId = NSUUID.UUID.UUIDString;
    self.pending[requestId] = [complete copy];
    NSMutableDictionary *event = [data mutableCopy]; event[@"requestId"] = requestId; event[@"guid"] = context.uniqueIdentifier;
    [self event:@"permission-request" data:event];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,60*NSEC_PER_SEC),dispatch_get_main_queue(), ^{
        void (^pending)(BOOL) = self.pending[requestId];
        if (pending) { [self.pending removeObjectForKey:requestId]; pending(NO); [self event:@"permission-expired" data:@{@"requestId":requestId}]; }
    });
}
- (void)webExtensionController:(WKWebExtensionController *)controller promptForPermissions:(NSSet<WKWebExtensionPermission> *)permissions inTab:(id<WKWebExtensionTab>)tab forExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSSet<WKWebExtensionPermission> *, NSDate *))done {
    [self permission:context data:@{@"permissions":permissions.allObjects} complete:^(BOOL allowed) { done(allowed ? permissions : [NSSet set], nil); }];
}
- (void)webExtensionController:(WKWebExtensionController *)controller promptForPermissionMatchPatterns:(NSSet<WKWebExtensionMatchPattern *> *)patterns inTab:(id<WKWebExtensionTab>)tab forExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSSet<WKWebExtensionMatchPattern *> *, NSDate *))done {
    [self permission:context data:@{@"hosts":[patterns.allObjects valueForKey:@"string"]} complete:^(BOOL allowed) { done(allowed ? patterns : [NSSet set], nil); }];
}
- (void)webExtensionController:(WKWebExtensionController *)controller promptForPermissionToAccessURLs:(NSSet<NSURL *> *)urls inTab:(id<WKWebExtensionTab>)tab forExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSSet<NSURL *> *, NSDate *))done {
    NSMutableArray *patterns = [NSMutableArray array];
    for (NSURL *url in urls) [patterns addObject:[NSString stringWithFormat:@"%@://%@/*",url.scheme,url.host]];
    [self permission:context data:@{@"hosts":patterns} complete:^(BOOL allowed) { done(allowed ? urls : [NSSet set], nil); }];
}
- (MistyExtensionNativeMessaging *)nativeConnection:(NSString *)application context:(WKWebExtensionContext *)context error:(NSError **)error {
    if (![context hasPermission:@"nativeMessaging"]) { *error=ExtensionError(@"Native messaging permission is required."); return nil; }
    NSString *owner = [self.contexts allKeysForObject:context].firstObject;
    if (!owner) { *error=ExtensionError(@"This extension is no longer running."); return nil; }
    NSMutableArray *connections=self.nativeConnections[owner];
    NSIndexSet *finished=[connections indexesOfObjectsPassingTest:^BOOL(MistyExtensionNativeMessaging *connection,NSUInteger index,BOOL *stop) { (void)index; (void)stop; return !connection.task.running; }];
    [connections removeObjectsAtIndexes:finished];
    if (connections.count>=16) { *error=ExtensionError(@"This extension has too many native connections open."); return nil; }
    MistyExtensionNativeMessaging *connection = [MistyExtensionNativeMessaging connect:application extension:context.uniqueIdentifier error:error];
    if (connection) {
        NSString *identifier = [self.contexts allKeysForObject:context].firstObject;
        if (!self.nativeConnections[identifier]) self.nativeConnections[identifier]=[NSMutableArray array];
        [self.nativeConnections[identifier] addObject:connection];
    }
    return connection;
}
- (void)webExtensionController:(WKWebExtensionController *)controller sendMessage:(id)message toApplicationWithIdentifier:(NSString *)application forExtensionContext:(WKWebExtensionContext *)context replyHandler:(void (^)(id, NSError *))reply {
    NSError *error; MistyExtensionNativeMessaging *connection=[self nativeConnection:application context:context error:&error];
    if (!connection) { reply(nil,error); return; }
    __block BOOL replied=NO;
    [connection receive:^(id response,NSError *failure) { if (!replied) { replied=YES; reply(response,failure); } [connection stop]; }];
    [connection send:message];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,30*NSEC_PER_SEC),dispatch_get_main_queue(), ^{ if (!replied) { replied=YES; reply(nil,ExtensionError(@"The native application did not respond.")); [connection stop]; } });
}
- (void)webExtensionController:(WKWebExtensionController *)controller connectUsingMessagePort:(WKWebExtensionMessagePort *)port forExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSError *))done {
    NSError *error; MistyExtensionNativeMessaging *connection=[self nativeConnection:port.applicationIdentifier context:context error:&error];
    if (!connection) { done(error); return; }
    [connection receive:^(id message,NSError *failure) { if (failure) [port disconnectWithError:failure]; else [port sendMessage:message completionHandler:nil]; }];
    port.messageHandler=^(id message,NSError *failure) { if (failure) [connection stop]; else [connection send:message]; };
    port.disconnectHandler=^(NSError *failure) { (void)failure; [connection stop]; };
    done(nil);
}
@end

void misty_extensions_set_events(MistyExtensionEvent callback) { emitEvent = callback; }
void misty_extensions_request(const char *json, MistyExtensionReply callback, void *pointer) {
    NSData *data = [[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding];
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            Reply reply = ^(NSDictionary *result) { callback(pointer, JSON(result).UTF8String); };
            if (@available(macOS 15.4, *)) {
                NSDictionary *request = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
                if (![request isKindOfClass:NSDictionary.class]) { reply(@{@"error":@"Invalid extension request."}); return; }
                if (!host) host = [MistyExtensionHost new];
                [host request:request reply:reply];
            } else reply(@{@"supported":@NO, @"error":@"Extensions require macOS 15.4 or later."});
        }
    });
}
void *misty_extensions_configuration(void *pointer, const char *urlString, bool defaultStore) {
    if (@available(macOS 15.4, *)) {
        if (!host.account) return NULL;
        WKWebViewConfiguration *config = (__bridge WKWebViewConfiguration *)pointer;
        if (defaultStore || !host.controller) [host configureStore:config.websiteDataStore];
        NSURL *url = [NSURL URLWithString:[NSString stringWithUTF8String:urlString]];
        WKWebExtensionContext *context = [host.controller extensionContextForURL:url];
        // WebKit ties extension-origin configurations to their background view.
        // Changing that configuration's store is invalid. Ordinary private
        // websites keep the supplied nonpersistent store; extension pages use
        // their extension's shared storage and swap views before website navigation.
        if (context) {
            config = context.webViewConfiguration;
            config.userContentController = [WKUserContentController new];
        }
        else config.webExtensionController = host.controller;
        return (__bridge_retained void *)config;
    }
    return NULL;
}
void misty_extensions_register_tab(void *pointer, const char *identifier, bool privateTab, const char *urlString) {
    if (@available(macOS 15.4, *)) {
        if (!host.controller) return;
        WKWebView *view = (__bridge WKWebView *)pointer;
        NSString *key = [NSString stringWithUTF8String:identifier];
        MistyExtensionTab *tab = host.tabs[key];
        if (!tab) { tab = [MistyExtensionTab new]; tab.identifier = key; tab.host = host; }
        tab.view = view;
        NSURL *intendedURL=[NSURL URLWithString:[NSString stringWithUTF8String:urlString]];
        tab.configuredOrigin=[intendedURL.scheme isEqual:@"webkit-extension"] ? intendedURL.host : nil;
        for (MistyExtensionTab *other in host.tabs.allValues) if (!tab.window && other.window.native == view.window && other.window.privateWindow == privateTab) { tab.window = other.window; break; }
        if (!tab.window) {
            tab.window = [MistyExtensionWindow new]; tab.window.native = view.window; tab.window.host = host; tab.window.privateWindow = privateTab;
            [host.controller didOpenWindow:tab.window];
        }
        tab.window.native=view.window;
        host.tabs[key] = tab;
        [host registerOpenTab:tab];
        if (tab.pendingNavigation) { NSURLRequest *request=tab.pendingNavigation; tab.pendingNavigation=nil; [view loadRequest:request]; }
        NSString *requestId=host.openingTabs[key];
        void (^done)(MistyExtensionTab *,NSError *)=requestId ? host.openRequests[requestId] : nil;
        if (done) { [host.openRequests removeObjectForKey:requestId]; [host.openingTabs removeObjectForKey:key]; done(tab,nil); }
    }
}
void misty_extensions_tab_event(const char *identifier, const char *kind) {
    if (@available(macOS 15.4, *)) {
        NSString *key = [NSString stringWithUTF8String:identifier], *event = [NSString stringWithUTF8String:kind];
        MistyExtensionTab *tab = host.tabs[key]; if (!tab) return;
        if (![event isEqual:@"close"]) [host registerOpenTab:tab];
        if ([event isEqual:@"close"]) { [host.controller didCloseTab:tab windowIsClosing:NO]; [host.tabs removeObjectForKey:key]; }
        else if ([event isEqual:@"activate"]) {
            MistyExtensionTab *previous = host.tabs[host.activeTab]; previous.selected = NO;
            host.activeTab = key; tab.selected = YES; [host.controller didActivateTab:tab previousActiveTab:previous];
        } else [host.controller didChangeTabProperties:(WKWebExtensionTabChangedPropertiesURL | WKWebExtensionTabChangedPropertiesTitle | WKWebExtensionTabChangedPropertiesLoading) forTab:tab];
    }
}

bool misty_extensions_supported(void) { if (@available(macOS 15.4, *)) return true; return false; }
bool misty_extensions_navigation(void *viewPointer, void *actionPointer) {
    if (@available(macOS 15.4, *)) {
        WKWebView *view=(__bridge WKWebView *)viewPointer;
        WKNavigationAction *action=(__bridge WKNavigationAction *)actionPointer;
        if (!action.targetFrame.isMainFrame) return false;
        NSURL *url=action.request.URL;
        if (![@[@"http",@"https",@"webkit-extension"] containsObject:url.scheme]) return false;
        NSURL *identity=[host identityRedirect:url];
        for (MistyExtensionTab *tab in host.tabs.allValues) {
            if (tab.view!=view) continue;
            if (identity) {
                tab.pendingNavigation=[NSURLRequest requestWithURL:identity];
                [host event:@"replace-view" data:@{@"tabId":tab.identifier,@"url":identity.absoluteString}];
                return true;
            }
            NSString *origin=[url.scheme isEqual:@"webkit-extension"] ? url.host : nil;
            if ((!origin && !tab.configuredOrigin) || [origin isEqual:tab.configuredOrigin]) return false;
            // Preserve the actual request, including POST bodies. Only the native
            // view changes; tab identity and granted browser scope remain intact.
            tab.pendingNavigation=action.request;
            [host event:@"replace-view" data:@{@"tabId":tab.identifier,@"url":url.absoluteString}];
            return true;
        }
    }
    return false;
}
