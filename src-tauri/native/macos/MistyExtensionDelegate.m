// SPDX-License-Identifier: MIT
// WebKit's navigation and extension-controller callbacks for a Space's host:
// windows, popups, options pages, new tabs, permission prompts and native messaging.
#import "MistyExtensions.h"
#import "MistyExtensionsInternal.h"

@implementation MistyExtensionHost (Delegate)
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
    // An extension's own popup window counts while it's in front.
    for (MistyExtensionTab *tab in self.tabs.allValues) if (tab.window.popupWindow && tab.window.native.isKeyWindow) window=tab.window;
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
    // Every Space's host hears every popover close; only the one that showed a popup acts.
    if (!self.popupTab) return;
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
    // The popover's frame follows Misty's window, so a dark popup isn't ringed in light.
    action.popupPopover.appearance = parent.window.effectiveAppearance;
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
    if ([self openPopupWindow:configuration context:context done:done]) return;
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
