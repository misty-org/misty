// SPDX-License-Identifier: MIT
// Public-API feasibility check. Synthetic resources; no user browser data.
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

API_AVAILABLE(macos(15.4))
@interface MistyExtensionProbe : NSObject <WKScriptMessageHandler, WKNavigationDelegate>
@property NSMutableArray<WKWebExtensionController *> *controllers;
@property NSMutableArray<WKWebExtensionContext *> *contexts;
@property NSMutableArray<WKWebView *> *views;
@property NSUInteger ready;
@property BOOL replicated;
@end

@implementation MistyExtensionProbe
- (instancetype)init {
    if ((self = [super init])) {
        _controllers = [NSMutableArray array];
        _contexts = [NSMutableArray array];
        _views = [NSMutableArray array];
    }
    return self;
}
- (void)fail:(NSString *)message {
    fprintf(stderr, "FAIL: %s\n", message.UTF8String);
    exit(1);
}
- (void)start:(NSURL *)root {
    for (NSUInteger i = 0; i < 2; i++) {
        [WKWebExtension extensionWithResourceBaseURL:root completionHandler:^(WKWebExtension *extension, NSError *error) {
            if (error || !extension) { [self fail:error.description ?: @"Extension was nil"]; return; }
            WKWebExtensionControllerConfiguration *config = [WKWebExtensionControllerConfiguration nonPersistentConfiguration];
            config.defaultWebsiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
            WKWebExtensionController *controller = [[WKWebExtensionController alloc] initWithConfiguration:config];
            WKWebExtensionContext *context = [[WKWebExtensionContext alloc] initForExtension:extension];
            context.uniqueIdentifier = @"native-fixture@misty.test";
            context.hasAccessToPrivateData = YES;
            for (WKWebExtensionPermission permission in extension.requestedPermissions)
                [context setPermissionStatus:WKWebExtensionContextPermissionStatusGrantedExplicitly forPermission:permission];
            NSError *loadError;
            if (![controller loadExtensionContext:context error:&loadError]) { [self fail:loadError.description]; return; }
            [self.controllers addObject:controller];
            [self.contexts addObject:context];
            WKWebViewConfiguration *viewConfig = context.webViewConfiguration;
            [viewConfig.userContentController addScriptMessageHandler:self name:@"probe"];
            WKWebView *view = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 400, 300) configuration:viewConfig];
            view.navigationDelegate = self;
            [self.views addObject:view];
            [view loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@"bridge.html" relativeToURL:context.baseURL]]];
        }];
    }
}
- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error { [self fail:error.description]; }
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    NSDictionary *body = message.body;
    if (![body isKindOfClass:NSDictionary.class] || !message.frameInfo.isMainFrame) { [self fail:@"Invalid bridge message"]; return; }
    if ([body[@"event"] isEqual:@"error"]) { [self fail:body[@"message"]]; return; }
    if ([body[@"event"] isEqual:@"ready"]) {
        if (![body[@"reply"][@"background"] boolValue]) { [self fail:@"Background messaging failed"]; return; }
        if ([body[@"data"] count]) { [self fail:@"Nonpersistent storage was not empty"]; return; }
        if (++self.ready == 2) {
            [self.views[0] evaluateJavaScript:@"browser.storage.sync.set({probe: 'first-device'}); void 0" completionHandler:^(id result, NSError *error) { if (error) [self fail:error.description]; }];
        }
    }
    if ([body[@"event"] isEqual:@"changed"] && [body[@"area"] isEqual:@"sync"]) {
        if (message.webView == self.views[0] && !self.replicated) {
            self.replicated = YES;
            [self.views[1] evaluateJavaScript:@"browser.storage.sync.set({probe: 'first-device'}); void 0" completionHandler:^(id result, NSError *error) { if (error) [self fail:error.description]; }];
        } else if (message.webView == self.views[1] && [body[@"changes"][@"probe"][@"newValue"] isEqual:@"first-device"]) {
            puts("PASS: native extension loading, background messaging, extension-origin pages, isolated storage.sync, host replication and onChanged");
            exit(0);
        }
    }
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (@available(macOS 15.4, *)) {
            if (argc != 2) { fprintf(stderr, "Usage: probe <extension-directory>\n"); return 2; }
            [NSApplication sharedApplication];
            MistyExtensionProbe *probe = [MistyExtensionProbe new];
            [probe start:[NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]] isDirectory:YES]];
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ [probe fail:@"Native extension probe timed out"]; });
            [NSApp run];
        } else { fprintf(stderr, "Requires macOS 15.4+\n"); return 2; }
    }
}
