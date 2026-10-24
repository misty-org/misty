// SPDX-License-Identifier: MIT
// The C entry points Misty's Rust side calls, and the per-Space hosts behind them.
#import "MistyExtensions.h"
#import "MistyExtensionsInternal.h"

/// One host per Space, keyed by the Space's key. A single shared controller would
/// let an extension's own requests carry one Space's cookies into another.
API_AVAILABLE(macos(15.4)) static NSMutableDictionary<NSString *, MistyExtensionHost *> *hosts;
MistyExtensionHost *MistyExtensionHostForSpace(NSString *space) {
    return [space isKindOfClass:NSString.class] ? hosts[space] : nil;
}

/// Checks a downloaded package before any Space installs it; needs no host.
API_AVAILABLE(macos(15.4))
static void ValidatePackage(NSDictionary *request, Reply reply) {
    NSURL *root=[NSURL fileURLWithPath:request[@"runtimePath"] isDirectory:YES];
    [WKWebExtension extensionWithResourceBaseURL:root completionHandler:^(WKWebExtension *extension,NSError *error) {
        if (!extension || error) { reply(@{@"error":error.localizedDescription ?: @"Invalid extension manifest."}); return; }
        NSMutableArray *errors=[NSMutableArray array]; BOOL blocked=NO;
        for (NSError *issue in extension.errors) {
            [errors addObject:issue.localizedDescription];
            if (issue.code==WKWebExtensionErrorInvalidManifest || issue.code==WKWebExtensionErrorUnsupportedManifestVersion || issue.code==WKWebExtensionErrorResourceNotFound || issue.code==WKWebExtensionErrorInvalidArchive) blocked=YES;
        }
        reply(@{@"findings":errors,@"blocked":@(blocked),@"platform":NSProcessInfo.processInfo.operatingSystemVersionString,@"hosts":[extension.allRequestedMatchPatterns.allObjects valueForKey:@"string"] ?: @[]});
    }];
}
/// Erases what a removed Space's controller kept: every extension's storage.
API_AVAILABLE(macos(15.4))
static void RemoveControllerData(NSString *identifier, Reply reply) {
    NSUUID *uuid = [identifier isKindOfClass:NSString.class] ? [[NSUUID alloc] initWithUUIDString:identifier] : nil;
    if (!uuid) { reply(@{@"error":@"Invalid extension controller."}); return; }
    WKWebExtensionController *controller = [[WKWebExtensionController alloc] initWithConfiguration:[WKWebExtensionControllerConfiguration configurationWithIdentifier:uuid]];
    [controller fetchDataRecordsOfTypes:WKWebExtensionController.allExtensionDataTypes completionHandler:^(NSArray<WKWebExtensionDataRecord *> *records) {
        // The controller stays alive until WebKit has removed its records.
        [controller removeDataOfTypes:WKWebExtensionController.allExtensionDataTypes fromDataRecords:records completionHandler:^{ (void)controller; reply(@{}); }];
    }];
}
API_AVAILABLE(macos(15.4))
static void HandleRequest(NSDictionary *request, Reply reply) {
    NSString *operation = request[@"operation"];
    NSString *space = [request[@"space"] isKindOfClass:NSString.class] ? request[@"space"] : nil;
    if (!hosts) hosts = [NSMutableDictionary dictionary];
    if ([operation isEqual:@"validate"]) { ValidatePackage(request, reply); return; }
    if ([operation isEqual:@"configure"] && ![request[@"account"] length]) {
        // Signing out stops every Space's host.
        for (MistyExtensionHost *host in hosts.allValues) {
            if (host.account) [host event:@"runtime-reset" data:@{}];
            [host shutdown];
        }
        [hosts removeAllObjects];
        reply(@{@"supported":@YES}); return;
    }
    if (!space.length) { reply(@{@"error":@"Extensions run in a Space."}); return; }
    if ([operation isEqual:@"release-space"] || [operation isEqual:@"remove-space"]) {
        // The Space's last window closed, or the Space is gone: free its host.
        [hosts[space] shutdown];
        [hosts removeObjectForKey:space];
        if ([operation isEqual:@"remove-space"]) RemoveControllerData(request[@"controllerId"], reply);
        else reply(@{});
        return;
    }
    MistyExtensionHost *host = hosts[space];
    if (!host && [operation isEqual:@"configure"]) {
        host = [MistyExtensionHost new]; host.space = space; hosts[space] = host;
    }
    if (!host) { reply(@{@"error":@"The extension account changed."}); return; }
    [host request:request reply:reply];
}
/// The host whose tab shows `view`.
API_AVAILABLE(macos(15.4))
static MistyExtensionHost *HostForView(WKWebView *view) {
    for (MistyExtensionHost *host in hosts.allValues)
        for (MistyExtensionTab *tab in host.tabs.allValues) if (tab.view == view) return host;
    return nil;
}

void misty_extensions_compat_message(void *message, void *reply) {
    void (^answer)(id, NSString *) = (__bridge void (^)(id, NSString *))reply;
    if (@available(macOS 15.4, *)) {
        // The compat page that asked belongs to exactly one Space's host.
        WKScriptMessage *script = (__bridge WKScriptMessage *)message;
        for (MistyExtensionHost *host in hosts.allValues) {
            if (![host.compatViews.allValues containsObject:script.webView]) continue;
            [host compatMessage:script reply:answer]; return;
        }
    }
    answer(nil, @"The extension host stopped.");
}
void misty_extensions_request(const char *json, MistyExtensionReply callback, void *pointer) {
    NSData *data = [[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding];
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            Reply reply = ^(NSDictionary *result) { callback(pointer, ExtensionJSON(result).UTF8String); };
            if (@available(macOS 15.4, *)) {
                NSDictionary *request = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
                if (![request isKindOfClass:NSDictionary.class]) { reply(@{@"error":@"Invalid extension request."}); return; }
                HandleRequest(request, reply);
            } else reply(@{@"supported":@NO, @"error":@"Extensions require macOS 15.4 or later."});
        }
    });
}
void *misty_extensions_configuration(const char *spaceKey, void *pointer, const char *urlString) {
    if (@available(macOS 15.4, *)) {
        MistyExtensionHost *host = hosts[[NSString stringWithUTF8String:spaceKey]];
        if (!host.account || !host.controller) return NULL;
        WKWebViewConfiguration *config = (__bridge WKWebViewConfiguration *)pointer;
        NSURL *url = [NSURL URLWithString:[NSString stringWithUTF8String:urlString]];
        WKWebExtensionContext *context = [host.controller extensionContextForURL:url];
        // WebKit ties extension-origin configurations to their background view.
        // Changing that configuration's store is invalid. Website pages keep the
        // Space's store; extension pages use their extension's shared storage and
        // swap views before website navigation.
        if (context) {
            config = context.webViewConfiguration;
            config.userContentController = [WKUserContentController new];
        }
        else config.webExtensionController = host.controller;
        return (__bridge_retained void *)config;
    }
    return NULL;
}
void misty_extensions_register_tab(const char *spaceKey, void *pointer, const char *identifier, bool privateTab, const char *urlString) {
    if (@available(macOS 15.4, *)) {
        MistyExtensionHost *host = hosts[[NSString stringWithUTF8String:spaceKey]];
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
void misty_extensions_tab_event(const char *spaceKey, const char *identifier, const char *kind) {
    if (@available(macOS 15.4, *)) {
        NSString *space = [NSString stringWithUTF8String:spaceKey];
        NSString *key = [NSString stringWithUTF8String:identifier], *event = [NSString stringWithUTF8String:kind];
        MistyExtensionHost *host = space.length ? hosts[space] : nil;
        // The host that registered the tab, when the page's Space now names another (a tab opened
        // before its window took a Space, a window that switched Space), so extensions
        // hear every close.
        if (!host.tabs[key]) for (MistyExtensionHost *candidate in hosts.allValues) if (candidate.tabs[key]) host = candidate;
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
        // Only the Space that owns this tab may redirect it into its extensions.
        MistyExtensionHost *host=HostForView(view);
        if (!host) return false;
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
