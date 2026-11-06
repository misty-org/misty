// SPDX-License-Identifier: MIT
// Runs an extension that asks for everything through the production native host, grants it only
// part of that, and checks what it can reach: WebKit's own APIs, Misty's native answers, other
// hosts, the page's world, extension pages it wasn't given, and access taken back while it runs.
#import "../../native/macos/MistyExtensions.h"
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import "compat-channel.h"

static NSString *account, *origin, *root, *granted, *other;
static NSString *const ProbeStore = @"6D697374-7900-4000-8000-70726F626574";
static NSWindow *window;
static NSMutableArray<WKWebView *> *views;
static WKWebView *page;
static WKWebsiteDataStore *store;
static NSMutableArray<NSString *> *swaps;
typedef void (^Completion)(NSDictionary *);

@interface ProbeNavigation : NSObject <WKNavigationDelegate>
@end
@implementation ProbeNavigation
- (void)webView:(WKWebView *)view decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))done {
    done(misty_extensions_navigation((__bridge void *)view, (__bridge void *)action) ? WKNavigationActionPolicyCancel : WKNavigationActionPolicyAllow);
}
@end
static ProbeNavigation *navigation;

@interface ProbeHostHandler : NSObject <WKScriptMessageHandler>
@end
@implementation ProbeHostHandler
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {}
@end

static void fail(NSString *message) { fprintf(stderr, "FAIL: %s\n", message.UTF8String); exit(1); }
static void replied(void *pointer, const char *json) {
    Completion completion = CFBridgingRelease(pointer);
    NSDictionary *value = [NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    if (value[@"error"]) fail(value[@"error"]);
    completion(value);
}
static void request(NSDictionary *input, Completion completion) {
    NSMutableDictionary *value = [input mutableCopy];
    value[@"account"] = account;
    value[@"space"] = @"probe";
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    misty_extensions_request([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String, replied, (__bridge_retained void *)[completion copy]);
}
static WKWebView *viewFor(NSString *url, NSString *identifier) {
    WKWebViewConfiguration *original = [WKWebViewConfiguration new];
    original.websiteDataStore = store;
    // A handler and a global in the page's world, standing in for Misty's own.
    [original.userContentController addScriptMessageHandler:[ProbeHostHandler new] name:@"probeHost"];
    [original.userContentController addUserScript:[[WKUserScript alloc] initWithSource:@"window.__PROBE_PAGE_SECRET__ = 'token'; document.documentElement.dataset.pageSawHandler = typeof window.webkit?.messageHandlers?.probeHost;" injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
    WKWebViewConfiguration *configuration = CFBridgingRelease(misty_extensions_configuration("probe", (__bridge void *)original, url.UTF8String));
    if (!configuration) fail(@"Native configuration was not returned");
    WKWebView *view = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 500, 300) configuration:configuration];
    view.navigationDelegate = navigation;
    [views addObject:view];
    [window.contentView addSubview:view];
    misty_extensions_register_tab("probe", (__bridge void *)view, identifier.UTF8String, false, url.UTF8String);
    [view loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:url]]];
    return view;
}
static void after(double seconds, dispatch_block_t block) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), block);
}
static void expectRefused(NSDictionary *results, NSString *name) {
    id value = results[name];
    BOOL refused = [value isKindOfClass:NSString.class] && [value hasPrefix:@"error:"];
    if (!refused) fail([NSString stringWithFormat:@"%@ should be refused, got %@ (%@)", name, value, results]);
}
static void expectEqual(NSDictionary *results, NSString *name, id expected) {
    if (![results[name] isEqual:expected]) fail([NSString stringWithFormat:@"%@: expected %@, got %@", name, expected, results[name]]);
}
static void runChecks(void (^then)(NSDictionary *)) {
    WKWebView *checks = viewFor([NSString stringWithFormat:@"webkit-extension://%@/check.html", origin], [@"checks-" stringByAppendingString:NSUUID.UUID.UUIDString]);
    after(2, ^{
        [checks callAsyncJavaScript:@"return await window.runChecks()" arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id value, NSError *error) {
            if (error || ![value isKindOfClass:NSDictionary.class]) fail([NSString stringWithFormat:@"Checks did not run: %@", error]);
            fprintf(stderr, "results: %s\n", [value description].UTF8String);
            [checks removeFromSuperview];
            then(value);
        }];
    });
}

/// Misty's rule stands in here: only `public.html`, as the manifest lists it.
static bool policy(const char *tab, const char *url, const char *source) {
    (void)tab; (void)source;
    return [[NSString stringWithUTF8String:url] hasSuffix:@"/public.html"];
}

static void finish(void) {
    [store removeDataOfTypes:WKWebsiteDataStore.allWebsiteDataTypes modifiedSince:NSDate.distantPast completionHandler:^{
        puts("PASS: ungranted WebKit and native APIs refused, hidden hosts stay hidden, content scripts only on granted hosts and cut off from the page's world, downloads.open and unsafe download headers refused, unlisted extension pages closed to websites, removed access stops at once, another extension's storage and pages out of reach");
        exit(0);
    }];
}

static NSDictionary *descriptor(NSString *identifier, NSString *guid, NSString *originName, NSArray *permissions, NSArray *hosts) {
    return @{@"operation":@"load", @"id":identifier, @"guid":guid, @"origin":originName, @"runtimePath":root, @"privateAccess":@NO, @"permissions":permissions, @"hosts":hosts};
}

/// A second extension with the same package reads its own storage, never the first one's.
static void checkOtherExtension(void) {
    other = NSUUID.UUID.UUIDString.lowercaseString;
    request(descriptor(@"2", @"other-fixture@misty.test", other, @[@"storage"], @[]), ^(NSDictionary *loaded) {
        WKWebView *check = viewFor([NSString stringWithFormat:@"webkit-extension://%@/check.html", other], @"other");
        after(2, ^{
            [check callAsyncJavaScript:@"return JSON.stringify(await browser.storage.local.get('mine'))" arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id value, NSError *error) {
                if (error || ![value isEqual:@"{}"]) fail([NSString stringWithFormat:@"Another extension's storage leaked: %@ %@", value, error]);
                NSString *open = @"try { await browser.tabs.create({ url }); return 'opened'; } catch (failure) { return failure.message; }";
                [check callAsyncJavaScript:open arguments:@{@"url":[NSString stringWithFormat:@"webkit-extension://%@/options.html", origin]} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id answer, NSError *openError) {
                    if (openError || [answer isEqual:@"opened"]) fail([NSString stringWithFormat:@"An extension opened another's page: %@ %@", answer, openError]);
                    finish();
                }];
            }];
        });
    });
}

/// Access taken away from a running extension stops without a restart.
static void checkRevoke(void) {
    request(descriptor(@"1", @"permissions-fixture@misty.test", origin, @[@"storage", @"history"], @[@"http://127.0.0.1/*"]), ^(NSDictionary *loaded) {
        runChecks(^(NSDictionary *wide) {
            if ([wide[@"history"] isKindOfClass:NSString.class] && [wide[@"history"] containsString:@"permission is required"]) fail(@"Granted history was refused");
            request(descriptor(@"1", @"permissions-fixture@misty.test", origin, @[@"storage"], @[@"http://127.0.0.1/*"]), ^(NSDictionary *narrow) {
                runChecks(^(NSDictionary *results) {
                    expectRefused(results, @"history");
                    checkOtherExtension();
                });
            });
        });
    });
}

/// A website can't move a tab into an extension page the manifest doesn't list.
static void checkNavigation(void) {
    [page evaluateJavaScript:[NSString stringWithFormat:@"location.href='webkit-extension://%@/options.html?do=harm'", origin] completionHandler:nil];
    after(1.5, ^{
        if (swaps.count) fail([@"A website opened an unlisted extension page: " stringByAppendingString:swaps.firstObject]);
        [page evaluateJavaScript:[NSString stringWithFormat:@"location.href='webkit-extension://%@/public.html'", origin] completionHandler:nil];
        after(1.5, ^{
            if (![swaps.firstObject hasSuffix:@"/public.html"]) fail(@"A listed extension page did not open");
            checkRevoke();
        });
    });
}

static void checkDownloads(void);
static void checkIsolation(void) {
    NSString *script = @"return document.documentElement.dataset.mistyPermissions ?? 'none'";
    [page callAsyncJavaScript:@"return document.documentElement.dataset.pageSawHandler" arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id own, NSError *ownError) {
        if (![own isEqual:@"object"]) fail([NSString stringWithFormat:@"The page's world should see its handler: %@ %@", own, ownError]);
        [page callAsyncJavaScript:@"return document.documentElement.dataset.mainWorldSawSecret ?? 'did not run'" arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id main, NSError *mainError) {
            fprintf(stderr, "A main-world content script at document_start saw the embedder's script: %s\n", [main description].UTF8String);
            if (![main isEqual:@"string"]) fail([NSString stringWithFormat:@"A main-world content script ran before the embedder's script: %@ %@", main, mainError]);
        }];
        [page callAsyncJavaScript:script arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id value, NSError *error) {
            if (error || ![value isKindOfClass:NSString.class] || [value isEqual:@"none"]) fail([NSString stringWithFormat:@"The content script did not run on a granted host: %@ %@", value, error]);
            NSDictionary *seen = [NSJSONSerialization JSONObjectWithData:[value dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
            for (NSString *key in @[@"handler", @"pageSecret", @"tauri"]) if (![seen[key] isEqual:@"undefined"]) fail([NSString stringWithFormat:@"A content script reached the page's %@: %@", key, seen]);
            WKWebView *hidden = viewFor([granted stringByReplacingOccurrencesOfString:@"127.0.0.1" withString:@"localhost"], @"ungranted-host");
            after(2, ^{
                [hidden callAsyncJavaScript:script arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id blocked, NSError *blockedError) {
                    if (![blocked isEqual:@"none"]) fail([NSString stringWithFormat:@"A content script ran on a host it wasn't granted: %@ %@", blocked, blockedError]);
                    runChecks(^(NSDictionary *results) {
                        expectEqual(results, @"storage", @"kept");
                        for (NSString *name in @[@"cookies", @"rules", @"history", @"bookmarks", @"downloads", @"downloadsOpen", @"cookieHeader", @"browsingData"]) expectRefused(results, name);
                        expectEqual(results, @"webNavigation", @"undefined");
                        if ([results[@"ungrantedTab"] containsString:@"localhost"]) fail([NSString stringWithFormat:@"A tab on an ungranted host was visible: %@", results[@"ungrantedTab"]]);
                        if (![results[@"grantedTab"] containsString:@"127.0.0.1"]) fail([NSString stringWithFormat:@"A tab on a granted host was hidden: %@", results[@"grantedTab"]]);
                        checkDownloads();
                    });
                }];
            });
        }];
    }];
}

/// With the downloads permission granted, the two things it still can't do.
static void checkDownloads(void) {
    request(descriptor(@"1", @"permissions-fixture@misty.test", origin, @[@"storage", @"downloads"], @[@"http://127.0.0.1/*"]), ^(NSDictionary *loaded) {
        runChecks(^(NSDictionary *results) {
            expectRefused(results, @"downloadsOpen");
            if (![results[@"downloadsOpen"] containsString:@"not available"]) fail(results[@"downloadsOpen"]);
            if (![results[@"cookieHeader"] containsString:@"Unsafe download header"]) fail([NSString stringWithFormat:@"Cookie header: %@", results[@"cookieHeader"]]);
            checkNavigation();
        });
    });
}

static void events(const char *json) {
    NSDictionary *value = [NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    NSString *kind = value[@"kind"];
    if ([kind isEqual:@"replace-view"]) [swaps addObject:value[@"url"]];
    // The app's side of a request the native host let through.
    if ([kind isEqual:@"compat-request"]) request(@{@"operation":@"compat-reply", @"requestId":value[@"requestId"], @"result":@[]}, ^(NSDictionary *r) {});
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (!misty_extensions_supported() || argc != 3) return 2;
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        account = [@"permissions-" stringByAppendingString:NSUUID.UUID.UUIDString];
        origin = NSUUID.UUID.UUIDString.lowercaseString;
        root = [NSString stringWithUTF8String:argv[1]];
        granted = [NSString stringWithUTF8String:argv[2]];
        navigation = [ProbeNavigation new];
        swaps = [NSMutableArray array];
        store = [WKWebsiteDataStore dataStoreForIdentifier:[[NSUUID alloc] initWithUUIDString:@"7d4a6c2e-3f1b-4f7e-9a51-0c0de5c0a7b2"]];
        views = [NSMutableArray array];
        window = [[NSWindow alloc] initWithContentRect:NSMakeRect(80, 80, 500, 400) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        [window makeKeyAndOrderFront:nil];
        misty_extensions_set_events(events);
        misty_extensions_set_compat_channel(installCompatChannel);
        misty_extensions_set_navigation_policy(policy);
        request(@{@"operation":@"configure", @"controllerId":NSUUID.UUID.UUIDString, @"store":ProbeStore}, ^(NSDictionary *result) {
            // The manifest asks for all of it; only this much is granted.
            request(descriptor(@"1", @"permissions-fixture@misty.test", origin, @[@"storage"], @[@"http://127.0.0.1/*"]), ^(NSDictionary *loaded) {
                page = viewFor(granted, @"normal");
                misty_extensions_tab_event("probe", "normal", "activate");
                after(2, ^{ checkIsolation(); });
            });
        });
        after(240, ^{ fail(@"Permissions probe timed out"); });
        [NSApp run];
    }
}
