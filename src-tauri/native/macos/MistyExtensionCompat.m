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
#import <objc/message.h>
#import <NaturalLanguage/NaturalLanguage.h>

static NSString *const IdentitySuffix = @".extensions.misty.invalid";

/// The granted permission each compatibility method requires. An empty string
/// means any extension may call it, as in Firefox.
static NSString *CompatPermission(id method) {
    if (![method isKindOfClass:NSString.class]) return nil;
    if ([@[@"i18n.detectLanguage", @"tabs.move"] containsObject:method]) return @"";
    NSString *namespace = [method componentsSeparatedByString:@"."].firstObject;
    return @{@"notifications":@"notifications", @"downloads":@"downloads", @"history":@"history",
             @"topSites":@"topSites", @"search":@"search", @"sessions":@"sessions",
             @"browsingData":@"browsingData", @"find":@"find", @"idle":@"idle", @"tts":@"tts"}[namespace];
}

/// WebKit data types for each browsingData key.
static NSSet<NSString *> *WebsiteDataTypes(NSDictionary *types) {
    NSDictionary<NSString *, NSArray *> *map = @{
        @"cookies":@[WKWebsiteDataTypeCookies],
        @"localStorage":@[WKWebsiteDataTypeLocalStorage, WKWebsiteDataTypeSessionStorage],
        @"indexedDB":@[WKWebsiteDataTypeIndexedDBDatabases],
        @"serviceWorkers":@[WKWebsiteDataTypeServiceWorkerRegistrations],
        @"cache":@[WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeFetchCache],
        @"cacheStorage":@[WKWebsiteDataTypeFetchCache],
        @"fileSystems":@[WKWebsiteDataTypeFileSystem],
        @"webSQL":@[WKWebsiteDataTypeWebSQLDatabases],
    };
    NSMutableSet *result = [NSMutableSet set];
    for (NSString *key in map) if ([types[key] boolValue]) [result addObjectsFromArray:map[key]];
    return result;
}

/// Whether a website data record (named by registrable domain) belongs to one of the hosts.
static BOOL RecordMatches(WKWebsiteDataRecord *record, NSArray *hosts) {
    NSString *name = record.displayName.lowercaseString;
    for (id value in hosts) {
        if (![value isKindOfClass:NSString.class]) continue;
        NSString *host = [value lowercaseString];
        NSURL *url = [NSURL URLWithString:host];
        if (url.host) host = url.host.lowercaseString;
        if ([host isEqual:name] || [host hasSuffix:[@"." stringByAppendingString:name]]) return YES;
    }
    return NO;
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
    if ([method isEqual:@"i18n.detectLanguage"]) { reply([self detectLanguage:args.firstObject], nil); return; }
    if ([method hasPrefix:@"notifications."] && [self handleNotification:method args:args identifier:identifier reply:reply]) return;
    if ([method isEqual:@"tabs.move"]) { NSString *failure = [self moveTab:args.firstObject context:context]; reply(failure ? nil : NSNull.null, failure); return; }
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

- (NSDictionary *)detectLanguage:(id)text {
    NLLanguageRecognizer *recognizer = [NLLanguageRecognizer new];
    if ([text isKindOfClass:NSString.class]) [recognizer processString:[(NSString *)text substringToIndex:MIN([(NSString *)text length], 20000)]];
    NSDictionary<NLLanguage, NSNumber *> *hypotheses = [recognizer languageHypothesesWithMaximum:3];
    NSMutableArray *languages = [NSMutableArray array];
    double best = 0;
    for (NLLanguage language in hypotheses) {
        double probability = hypotheses[language].doubleValue;
        best = MAX(best, probability);
        [languages addObject:@{@"language":language, @"percentage":@((NSInteger)llround(probability * 100))}];
    }
    [languages sortUsingDescriptors:@[[NSSortDescriptor sortDescriptorWithKey:@"percentage" ascending:NO]]];
    return @{@"isReliable":@(best >= 0.8), @"languages":languages};
}

/// Removes website data from the browsing profile's store, for every site or
/// for named hosts. Hosts take precedence over a start time, as WebKit cannot
/// filter by both.
- (void)removeWebsiteData:(NSDictionary *)options types:(NSDictionary *)types complete:(void (^)(void))complete {
    NSSet *dataTypes = WebsiteDataTypes(types);
    WKWebsiteDataStore *store = self.store;
    if (!dataTypes.count || !store) { complete(); return; }
    NSArray *hosts = [options[@"hostnames"] isKindOfClass:NSArray.class] ? options[@"hostnames"] : [options[@"origins"] isKindOfClass:NSArray.class] ? options[@"origins"] : nil;
    NSArray *excluded = [options[@"excludeOrigins"] isKindOfClass:NSArray.class] ? options[@"excludeOrigins"] : nil;
    if (!hosts && !excluded) {
        double since = [options[@"since"] isKindOfClass:NSNumber.class] ? [options[@"since"] doubleValue] / 1000 : 0;
        [store removeDataOfTypes:dataTypes modifiedSince:[NSDate dateWithTimeIntervalSince1970:since] completionHandler:complete];
        return;
    }
    [store fetchDataRecordsOfTypes:dataTypes completionHandler:^(NSArray<WKWebsiteDataRecord *> *records) {
        NSMutableArray *matching = [NSMutableArray array];
        for (WKWebsiteDataRecord *record in records) {
            if (hosts && !RecordMatches(record, hosts)) continue;
            if (excluded && RecordMatches(record, excluded)) continue;
            [matching addObject:record];
        }
        [store removeDataOfTypes:dataTypes forDataRecords:matching completionHandler:complete];
    }];
}

/// Finds an extension-visible tab by its window's tab order and position, then
/// asks Misty's workspace to move it. WebKit keeps its tab ids private.
- (NSString *)moveTab:(id)request context:(WKWebExtensionContext *)context {
    if (![request isKindOfClass:NSDictionary.class] || ![request[@"urls"] isKindOfClass:NSArray.class]) return @"Invalid tab move.";
    NSArray *urls = request[@"urls"];
    NSUInteger from = [request[@"from"] unsignedIntegerValue], to = [request[@"to"] unsignedIntegerValue];
    MistyExtensionTab *found = nil;
    NSUInteger candidates = 0;
    for (MistyExtensionWindow *window in [NSSet setWithArray:[self.tabs.allValues valueForKey:@"window"]]) {
        if (![window isKindOfClass:MistyExtensionWindow.class]) continue;
        NSArray<MistyExtensionTab *> *tabs = (NSArray *)[window tabsForWebExtensionContext:context];
        if (tabs.count != urls.count || from >= tabs.count) continue;
        BOOL same = YES;
        for (NSUInteger i = 0; i < tabs.count && same; i++) {
            NSString *expected = [urls[i] isKindOfClass:NSString.class] ? urls[i] : @"";
            NSString *actual = [tabs[i] urlForWebExtensionContext:context].absoluteString ?: @"";
            same = !expected.length || [expected isEqual:actual];
        }
        if (same) { found = tabs[from]; candidates++; }
    }
    if (candidates != 1) return @"Misty could not identify that tab.";
    [self event:@"move-tab" data:@{@"tabId":found.identifier, @"index":@(to)}];
    return nil;
}

- (NSString *)idleState:(id)threshold {
    double seconds = [threshold isKindOfClass:NSNumber.class] ? MAX(15, [threshold doubleValue]) : 60;
    NSDictionary *session = CFBridgingRelease(CGSessionCopyCurrentDictionary());
    if ([session[@"CGSSessionScreenIsLocked"] boolValue]) return @"locked";
    CFTimeInterval idle = CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateCombinedSessionState, kCGAnyInputEventType);
    return idle >= seconds ? @"idle" : @"active";
}

/// Starts a download in a browser tab of the matching privacy, so Misty's own
/// download handling saves it and lists it. Returns an error message on failure.
- (NSString *)startDownload:(id)options context:(WKWebExtensionContext *)context {
    if (![options isKindOfClass:NSDictionary.class]) return @"A download needs a URL.";
    NSURL *url = [options[@"url"] isKindOfClass:NSString.class] ? [NSURL URLWithString:options[@"url"]] : nil;
    if (![@[@"http", @"https", @"data"] containsObject:url.scheme.lowercaseString]) return @"Only http, https and data URLs can be downloaded.";
    BOOL incognito = [options[@"incognito"] boolValue];
    if (incognito && !context.hasAccessToPrivateData) return @"Private access is disabled.";
    MistyExtensionTab *tab = self.tabs[self.activeTab];
    if (!tab.view || tab.window.privateWindow != incognito) {
        tab = nil;
        for (MistyExtensionTab *candidate in self.tabs.allValues) if (candidate.view && candidate.window.privateWindow == incognito) { tab = candidate; break; }
    }
    WKWebView *view = tab.view;
    if (!view) return @"Open a browser tab to download files.";
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    if ([options[@"method"] isEqual:@"POST"]) {
        request.HTTPMethod = @"POST";
        if ([options[@"body"] isKindOfClass:NSString.class]) request.HTTPBody = [options[@"body"] dataUsingEncoding:NSUTF8StringEncoding];
    }
    if ([options[@"headers"] isKindOfClass:NSArray.class]) {
        for (NSDictionary *header in options[@"headers"]) {
            if ([header isKindOfClass:NSDictionary.class] && [header[@"name"] isKindOfClass:NSString.class] && [header[@"value"] isKindOfClass:NSString.class])
                [request setValue:header[@"value"] forHTTPHeaderField:header[@"name"]];
        }
    }
    __weak WKWebView *weakView = view;
    [view startDownloadUsingRequest:request completionHandler:^(WKDownload *download) {
        WKWebView *strongView = weakView;
        id<WKNavigationDelegate> delegate = strongView.navigationDelegate;
        SEL selector = @selector(webView:navigationAction:didBecomeDownload:);
        // wry adopts downloads here; its handler ignores the action argument.
        if (strongView && [delegate respondsToSelector:selector])
            ((void (*)(id, SEL, WKWebView *, WKNavigationAction *, WKDownload *))objc_msgSend)(delegate, selector, strongView, [WKNavigationAction new], download);
    }];
    return nil;
}

- (NSURL *)identityRedirect:(NSURL *)url {
    NSString *name = url.host.lowercaseString;
    if (![url.scheme.lowercaseString isEqual:@"https"] || ![name hasSuffix:IdentitySuffix]) return nil;
    NSString *origin = [name substringToIndex:name.length - IdentitySuffix.length];
    for (WKWebExtensionContext *context in self.contexts.allValues) {
        if (![context.baseURL.host.lowercaseString isEqual:origin]) continue;
        NSString *fragment = [url.absoluteString stringByAddingPercentEncodingWithAllowedCharacters:NSCharacterSet.alphanumericCharacterSet];
        return [NSURL URLWithString:[@"__misty_compat__/identity.html#" stringByAppendingString:fragment] relativeToURL:context.baseURL].absoluteURL;
    }
    return nil;
}
@end
