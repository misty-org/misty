// SPDX-License-Identifier: MIT
// Native side of Misty's WebExtension compatibility layer.
//
// Each running extension gets a hidden page in its own origin
// (__misty_compat__/host.html). The extension's background and pages reach it
// over a same-origin BroadcastChannel; the page reaches Misty through a
// reply-capable script message handler. Requests are checked against the
// permissions the account granted before Misty reads or changes anything.
#import "MistyExtensions.h"
#import "MistyExtensionsInternal.h"

/// The granted permission each compatibility method requires. An empty string
/// means any extension may call it, as in Firefox.
static NSString *CompatPermission(id method) {
    if (![method isKindOfClass:NSString.class]) return nil;
    if ([@[@"i18n.detectLanguage", @"tabs.move", @"tabs.group", @"tabs.ungroup", @"runtime.reportError"] containsObject:method]) return @"";
    NSString *namespace = [method componentsSeparatedByString:@"."].firstObject;
    return @{@"notifications":@"notifications", @"downloads":@"downloads", @"history":@"history",
             @"topSites":@"topSites", @"search":@"search", @"sessions":@"sessions",
             @"browsingData":@"browsingData", @"find":@"find", @"idle":@"idle", @"tts":@"tts",
             @"bookmarks":@"bookmarks", @"tabGroups":@"tabGroups", @"userScripts":@"userScripts"}[namespace];
}

/// Kiri's extension transport installer (kiri/src/extensions/bridge.rs).
static MistyCompatChannelInstaller installCompatChannel;
void misty_extensions_set_compat_channel(MistyCompatChannelInstaller install) { installCompatChannel = install; }

@implementation MistyExtensionHost (Compat)
- (NSURL *)compatPage:(WKWebExtensionContext *)context {
    return [NSURL URLWithString:@"__misty_compat__/host.html" relativeToURL:context.baseURL];
}
- (void)startCompat:(NSString *)identifier context:(WKWebExtensionContext *)context {
    [self stopCompat:identifier];
    WKWebViewConfiguration *config = context.webViewConfiguration;
    if (!config) return;
    // Like the sync bridge, the host gets its own handler namespace. Kiri owns
    // the transport; its requests return through misty_extensions_compat_message.
    config.userContentController = [WKUserContentController new];
    if (!installCompatChannel) return;
    installCompatChannel((__bridge void *)config.userContentController);
    WKWebView *view = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 1, 1) configuration:config];
    view.navigationDelegate = self;
    self.compatViews[identifier] = view;
    [view loadRequest:[NSURLRequest requestWithURL:[self compatPage:context]]];
}
- (void)stopCompat:(NSString *)identifier {
    WKWebView *view = self.compatViews[identifier];
    if (!view) return;
    [view stopLoading];
    [view.configuration.userContentController removeAllScriptMessageHandlers];
    [self.compatViews removeObjectForKey:identifier];
}
- (BOOL)isCompatNavigation:(WKWebView *)view url:(NSURL *)url {
    for (NSString *identifier in self.compatViews) {
        if (self.compatViews[identifier] != view) continue;
        WKWebExtensionContext *context = self.contexts[identifier];
        return context && [url.absoluteString isEqual:[self compatPage:context].absoluteString];
    }
    return NO;
}

- (void)compatMessage:(WKScriptMessage *)message reply:(void (^)(id, NSString *))reply {
    NSString *identifier = nil;
    for (NSString *key in self.compatViews) if (self.compatViews[key] == message.webView) identifier = key;
    WKWebExtensionContext *context = identifier ? self.contexts[identifier] : nil;
    NSDictionary *body = [message.body isKindOfClass:NSDictionary.class] ? message.body : nil;
    if (!context || !message.frameInfo.isMainFrame || ![message.frameInfo.request.URL.absoluteString isEqual:[self compatPage:context].absoluteString] || ![body[@"method"] isKindOfClass:NSString.class]) {
        reply(nil, @"Invalid extension request."); return;
    }
    NSString *method = body[@"method"];
    NSArray *args = [body[@"args"] isKindOfClass:NSArray.class] ? body[@"args"] : @[];
    NSString *permission = CompatPermission(method);
    if (!permission) { reply(nil, @"This extension API is not available in Misty."); return; }
    if (permission.length && ![self.descriptors[identifier][@"permissions"] containsObject:permission]) {
        reply(nil, [NSString stringWithFormat:@"The %@ permission is required.", permission]); return;
    }
    if ([method isEqual:@"tts.allowed"]) { reply(NSNull.null, nil); return; }
    if ([method isEqual:@"idle.queryState"]) { reply([self idleState:args.firstObject], nil); return; }
    if ([method isEqual:@"runtime.reportError"]) {
        NSString *message = [args.firstObject isKindOfClass:NSString.class] ? args.firstObject : @"";
        [self event:@"background-error" data:@{@"id":identifier, @"detail":[message substringToIndex:MIN(message.length, 2000)]}];
        reply(NSNull.null, nil);
        return;
    }
    if ([method isEqual:@"userScripts.write"]) {
        NSString *path = [self writeUserScript:args.firstObject identifier:identifier];
        reply(path, path ? nil : @"Misty could not store that user script.");
        return;
    }
    if ([method isEqual:@"i18n.detectLanguage"]) { reply([self detectLanguage:args.firstObject], nil); return; }
    if ([method hasPrefix:@"notifications."] && [self handleNotification:method args:args identifier:identifier reply:reply]) return;
    if ([method isEqual:@"tabs.move"]) { NSString *failure = [self moveTab:args.firstObject context:context]; reply(failure ? nil : NSNull.null, failure); return; }
    if ([method isEqual:@"tabs.group"] || [method isEqual:@"tabs.ungroup"]) {
        // Misty's app knows tabs by their runtime ids; send those, never the extension's view of them.
        NSArray *located = [args.firstObject isKindOfClass:NSArray.class] ? args.firstObject : @[];
        NSMutableArray *ids = [NSMutableArray array];
        for (id request in located) {
            MistyExtensionTab *tab = [self locateTab:request context:context];
            if (!tab) { reply(nil, @"Misty could not identify that tab."); return; }
            [ids addObject:tab.identifier];
        }
        if (!ids.count) { reply(nil, @"Choose at least one tab."); return; }
        NSMutableArray *forwarded = [NSMutableArray arrayWithObject:ids];
        if (args.count > 1) [forwarded addObject:args[1]];
        [self forwardCompat:method args:forwarded identifier:identifier context:context reply:reply];
        return;
    }
    if ([method isEqual:@"browsingData.remove"]) {
        NSDictionary *options = [args.firstObject isKindOfClass:NSDictionary.class] ? args.firstObject : @{};
        NSDictionary *types = args.count > 1 && [args[1] isKindOfClass:NSDictionary.class] ? args[1] : @{};
        [self removeWebsiteData:options types:types complete:^{
            // History and downloads belong to Misty's library; the app removes those.
            if ([types[@"history"] boolValue] || [types[@"downloads"] boolValue]) [self forwardCompat:method args:args identifier:identifier context:context reply:reply];
            else reply(NSNull.null, nil);
        }];
        return;
    }
    if ([method isEqual:@"downloads.download"]) {
        NSString *failure = [self startDownload:args.firstObject context:context];
        if (failure) { reply(nil, failure); return; }
        // Misty reports the new download's id once its download list has it.
    }
    [self forwardCompat:method args:args identifier:identifier context:context reply:reply];
}

- (void)forwardCompat:(NSString *)method args:(NSArray *)args identifier:(NSString *)identifier context:(WKWebExtensionContext *)context reply:(void (^)(id, NSString *))reply {
    NSString *requestId = NSUUID.UUID.UUIDString;
    self.compatReplies[requestId] = [reply copy];
    [self event:@"compat-request" data:@{@"id":identifier, @"requestId":requestId, @"method":method, @"args":args, @"privateAccess":@(context.hasAccessToPrivateData)}];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        void (^pending)(id, NSString *) = self.compatReplies[requestId];
        if (pending) { [self.compatReplies removeObjectForKey:requestId]; pending(nil, @"Misty did not respond."); }
    });
}

- (BOOL)compatRequest:(NSDictionary *)request reply:(Reply)reply {
    NSString *operation = request[@"operation"];
    if ([operation isEqual:@"compat-reply"]) {
        NSString *requestId = request[@"requestId"];
        void (^pending)(id, NSString *) = [requestId isKindOfClass:NSString.class] ? self.compatReplies[requestId] : nil;
        if (pending) {
            [self.compatReplies removeObjectForKey:requestId];
            id error = request[@"error"];
            if ([error isKindOfClass:NSString.class]) pending(nil, error);
            else pending(request[@"result"] ?: NSNull.null, nil);
        }
        reply(@{}); return YES;
    }
    if ([operation isEqual:@"compat-event"]) {
        NSString *event = request[@"event"];
        NSString *permission = CompatPermission(event);
        NSArray *args = [request[@"args"] isKindOfClass:NSArray.class] ? request[@"args"] : @[];
        if (!permission) { reply(@{@"error":@"Invalid extension event."}); return YES; }
        for (NSString *identifier in self.compatViews) {
            if (request[@"id"] && ![request[@"id"] isEqual:identifier]) continue;
            if ([request[@"private"] boolValue] && !self.contexts[identifier].hasAccessToPrivateData) continue;
            [self deliverCompatEvent:event args:args to:identifier];
        }
        reply(@{}); return YES;
    }
    return NO;
}

- (void)deliverCompatEvent:(NSString *)event args:(NSArray *)args to:(NSString *)identifier {
    NSString *permission = CompatPermission(event);
    if (!permission || (permission.length && ![self.descriptors[identifier][@"permissions"] containsObject:permission])) return;
    [self.compatViews[identifier] callAsyncJavaScript:@"window.mistyCompatEvent?.(event, args)" arguments:@{@"event":event, @"args":args} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:nil];
}

@end
