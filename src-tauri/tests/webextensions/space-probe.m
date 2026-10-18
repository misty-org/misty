// SPDX-License-Identifier: MIT
// Spike (docs/plans/spikes/space-web-data.md): one extension controller per Space,
// both live at once, each bound to its Space's named website data store.
// Usage: space-probe <extension-dir> <page-url> <write|verify|cleanup> <uuid> x4
//   uuids: Space A store, Space B store, Space A controller, Space B controller.
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

API_AVAILABLE(macos(15.4))
@interface SpaceProbe : NSObject
@property NSArray<NSUUID *> *stores, *controllerIds;
@property NSMutableArray<WKWebExtensionController *> *controllers;
@property NSMutableArray<WKWebView *> *views;
@property NSString *mode;
@property NSURL *page;
@end

static void fail(NSString *message) {
    fprintf(stderr, "FAIL: %s\n", message.UTF8String);
    exit(1);
}

@implementation SpaceProbe
- (void)start:(NSURL *)root {
    self.controllers = [NSMutableArray array];
    self.views = [NSMutableArray array];
    [WKWebExtension extensionWithResourceBaseURL:root completionHandler:^(WKWebExtension *extension, NSError *error) {
        if (!extension) fail(error.description ?: @"Extension was nil");
        for (NSUInteger i = 0; i < 2; i++) {
            WKWebsiteDataStore *store = [WKWebsiteDataStore dataStoreForIdentifier:self.stores[i]];
            WKWebExtensionControllerConfiguration *config =
                [WKWebExtensionControllerConfiguration configurationWithIdentifier:self.controllerIds[i]];
            config.defaultWebsiteDataStore = store;
            WKWebExtensionController *controller = [[WKWebExtensionController alloc] initWithConfiguration:config];
            WKWebExtensionContext *context = [[WKWebExtensionContext alloc] initForExtension:extension];
            context.uniqueIdentifier = @"space-fixture@misty.test";
            for (WKWebExtensionPermission permission in extension.requestedPermissions)
                [context setPermissionStatus:WKWebExtensionContextPermissionStatusGrantedExplicitly forPermission:permission];
            for (WKWebExtensionMatchPattern *pattern in extension.allRequestedMatchPatterns)
                [context setPermissionStatus:WKWebExtensionContextPermissionStatusGrantedExplicitly forMatchPattern:pattern];
            NSError *loadError;
            if (![controller loadExtensionContext:context error:&loadError]) fail(loadError.description);
            [self.controllers addObject:controller];
            // A Space's page: its own store, its own controller, in its own window.
            WKWebViewConfiguration *viewConfig = [WKWebViewConfiguration new];
            viewConfig.websiteDataStore = store;
            viewConfig.webExtensionController = controller;
            NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 300)
                styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
            window.releasedWhenClosed = NO;
            WKWebView *view = [[WKWebView alloc] initWithFrame:window.contentView.bounds configuration:viewConfig];
            window.contentView = view;
            [self.views addObject:view];
        }
        [self visit:0];
    }];
}
- (void)visit:(NSUInteger)index {
    NSString *space = index == 0 ? @"a" : @"b";
    NSURLComponents *url = [NSURLComponents componentsWithURL:self.page resolvingAgainstBaseURL:NO];
    url.queryItems = @[[NSURLQueryItem queryItemWithName:@"space" value:space]];
    [self.views[index] loadRequest:[NSURLRequest requestWithURL:url.URL]];
    [self poll:index tries:100];
}
- (void)poll:(NSUInteger)index tries:(NSUInteger)tries {
    if (tries == 0) fail(@"The content script never ran");
    NSString *space = index == 0 ? @"a" : @"b";
    [self.views[index] evaluateJavaScript:@"[document.documentElement.dataset.ext, document.documentElement.dataset.before].join(',')"
                        completionHandler:^(NSString *result, NSError *error) {
        if (![result hasPrefix:@"ran,"]) {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
                [self poll:index tries:tries - 1];
            });
            return;
        }
        NSString *before = [result substringFromIndex:4];
        // Write: B runs after A wrote, so "none" proves per-Space extension storage.
        // Verify (after restart): each Space finds only its own value.
        NSString *expected = [self.mode isEqual:@"write"] ? @"none" : space;
        printf("%s space %s: content script ran, extension storage held %s\n",
               self.mode.UTF8String, space.UTF8String, before.UTF8String);
        if (![before isEqual:expected]) fail([NSString stringWithFormat:@"Space %@ expected %@", space, expected]);
        if (index == 0) [self visit:1];
        else {
            printf("PASS %s: two live extension controllers, one per Space store\n", self.mode.UTF8String);
            exit(0);
        }
    }];
}
- (void)cleanup {
    __block NSUInteger pending = 4;
    void (^done)(void) = ^{ if (--pending == 0) { puts("PASS cleanup"); exit(0); } };
    for (NSUInteger i = 0; i < 2; i++) {
        WKWebExtensionControllerConfiguration *config =
            [WKWebExtensionControllerConfiguration configurationWithIdentifier:self.controllerIds[i]];
        WKWebExtensionController *controller = [[WKWebExtensionController alloc] initWithConfiguration:config];
        [self.controllers addObject:controller];
        [controller fetchDataRecordsOfTypes:WKWebExtensionController.allExtensionDataTypes completionHandler:^(NSArray *records) {
            [controller removeDataOfTypes:WKWebExtensionController.allExtensionDataTypes fromDataRecords:records completionHandler:done];
        }];
        [WKWebsiteDataStore removeDataStoreForIdentifier:self.stores[i] completionHandler:^(NSError *error) {
            if (error) fail(error.description);
            done();
        }];
    }
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (@available(macOS 15.4, *)) {
            if (argc != 8) { fprintf(stderr, "Usage: space-probe <dir> <url> <mode> <uuid>x4\n"); return 2; }
            NSMutableArray<NSUUID *> *ids = [NSMutableArray array];
            for (int i = 4; i < 8; i++) {
                NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:@(argv[i])];
                if (!uuid) { fprintf(stderr, "Invalid UUID\n"); return 2; }
                [ids addObject:uuid];
            }
            [NSApplication sharedApplication];
            SpaceProbe *probe = [SpaceProbe new];
            probe.stores = [ids subarrayWithRange:NSMakeRange(0, 2)];
            probe.controllerIds = [ids subarrayWithRange:NSMakeRange(2, 2)];
            probe.mode = @(argv[3]);
            probe.page = [NSURL URLWithString:@(argv[2])];
            if ([probe.mode isEqual:@"cleanup"]) {
                // Removal must not be the first WebKit call in a process.
                (void)[[WKWebView alloc] initWithFrame:NSZeroRect];
                [probe cleanup];
            } else {
                [probe start:[NSURL fileURLWithPath:@(argv[1]) isDirectory:YES]];
            }
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ fail(@"Timed out"); });
            [NSApp run];
        } else {
            fprintf(stderr, "Extensions require macOS 15.4 or later\n");
            return 1;
        }
    }
    return 0;
}
