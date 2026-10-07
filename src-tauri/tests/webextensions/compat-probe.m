// SPDX-License-Identifier: MIT
// Exercises Misty's WebExtension compatibility layer through the production
// native host: shims, native answers, requests forwarded to the app, tab moves,
// the OAuth redirect rewrite, and learned blocking rules.
#import "../../native/macos/MistyExtensions.h"
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

static NSString *account, *origin, *pageURL;
static NSWindow *window;
static NSMutableArray<WKWebView *> *views;
static WKWebView *page;
static WKWebsiteDataStore *store;
static BOOL moved, forwardedHistory, forwardedNotification;
typedef void (^Completion)(NSDictionary *);

@interface ProbeNavigation : NSObject <WKNavigationDelegate>
@end
@implementation ProbeNavigation
- (void)webView:(WKWebView *)view decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))done {
    done(misty_extensions_navigation((__bridge void *)view, (__bridge void *)action) ? WKNavigationActionPolicyCancel : WKNavigationActionPolicyAllow);
}
@end
static ProbeNavigation *navigation;

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
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    misty_extensions_request([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String, replied, (__bridge_retained void *)[completion copy]);
}
static WKWebView *viewFor(NSString *url, NSString *identifier) {
    WKWebViewConfiguration *original = [WKWebViewConfiguration new];
    // WebKit treats a nonpersistent store as private browsing, where an
    // extension without private access has no rules. Normal tabs persist.
    original.websiteDataStore = store;
    WKWebViewConfiguration *configuration = CFBridgingRelease(misty_extensions_configuration((__bridge void *)original, url.UTF8String, false));
    if (!configuration) fail(@"Native configuration was not returned");
    WKWebView *view = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 500, 300) configuration:configuration];
    view.navigationDelegate = navigation;
    [views addObject:view];
    [window.contentView addSubview:view];
    misty_extensions_register_tab((__bridge void *)view, identifier.UTF8String, false, url.UTF8String);
    [view loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:url]]];
    return view;
}
static void after(double seconds, dispatch_block_t block) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), block);
}
static void expect(NSDictionary *results, NSString *name, id expected) {
    if (![results[name] isEqual:expected]) fail([NSString stringWithFormat:@"%@: expected %@, got %@", name, expected, results[name]]);
}

/// The app's side of forwarded requests, as useExtensionsRuntime answers them.
static void answer(NSDictionary *event) {
    NSString *method = event[@"method"];
    id result = NSNull.null;
    if ([method isEqual:@"history.search"]) { forwardedHistory = YES; result = @[@{@"id":@"1", @"url":@"https://example.org/", @"title":@"Example", @"lastVisitTime":@0, @"visitCount":@1, @"typedCount":@0}]; }
    else if ([method isEqual:@"notifications.create"]) forwardedNotification = YES;
    else { request(@{@"operation":@"compat-reply", @"requestId":event[@"requestId"], @"error":[@"Unexpected forwarded method " stringByAppendingString:method]}, ^(NSDictionary *r) {}); return; }
    request(@{@"operation":@"compat-reply", @"requestId":event[@"requestId"], @"result":result}, ^(NSDictionary *r) {});
}

static void checkIdentity(NSString *redirect) {
    // The provider's redirect must land on the extension's identity page.
    [page loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:[redirect stringByAppendingString:@"?code=probe"]]]];
    after(5, ^{ fail(@"OAuth redirect was not rewritten"); });
}

static void checkBlocking(NSString *redirect) {
    NSString *script = @"const fetchStatus = (url) => fetch(url, { cache: 'no-store' }).then((r) => r.status, () => 'blocked');"
        "const first = await fetchStatus(base + 'content.js?misty-block=1');"
        "await new Promise((resolve) => setTimeout(resolve, 2000));"
        "const second = await fetchStatus(base + 'content.js?misty-block=2');"
        "const control = await fetchStatus(base + 'background.js?allowed=1');"
        "return [first, second, control];";
    [page callAsyncJavaScript:script arguments:@{@"base":pageURL} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id result, NSError *error) {
        if (error || ![result isKindOfClass:NSArray.class]) fail([NSString stringWithFormat:@"Blocking check failed: %@", error]);
        NSArray *statuses = result;
        if (![statuses[0] isEqual:@200]) fail([NSString stringWithFormat:@"First request should pass before learning: %@", statuses]);
        if (![statuses[1] isEqual:@"blocked"]) fail([NSString stringWithFormat:@"Learned rule did not block the repeat request: %@", statuses]);
        if (![statuses[2] isEqual:@200]) fail([NSString stringWithFormat:@"Learned rule blocked an unrelated request: %@", statuses]);
        checkIdentity(redirect);
    }];
}

static void runChecks(void) {
    WKWebView *checks = viewFor([NSString stringWithFormat:@"webkit-extension://%@/check.html", origin], @"checks");
    after(2, ^{
        [checks callAsyncJavaScript:@"return await window.runChecks()" arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id value, NSError *error) {
            if (error || ![value isKindOfClass:NSDictionary.class]) fail([NSString stringWithFormat:@"Checks did not run: %@", error]);
            NSDictionary *results = value;
            fprintf(stderr, "results: %s\n", results.description.UTF8String);
            expect(results, @"browserInfo", @"Misty");
            expect(results, @"self", @"Misty compat fixture");
            expect(results, @"managed", @"{}");
            expect(results, @"language", @"fr");
            if (![@[@"active", @"idle", @"locked"] containsObject:results[@"idle"]]) fail(@"idle.queryState returned no state");
            expect(results, @"history", @"https://example.org/");
            expect(results, @"notification", @"probe");
            expect(results, @"browsingData", @"removed");
            expect(results, @"move", @"moved");
            NSString *redirect = results[@"redirect"];
            if (![redirect hasPrefix:[NSString stringWithFormat:@"https://%@.extensions.misty.invalid/", origin]]) fail(@"identity.getRedirectURL used the wrong address");
            if (!forwardedHistory || !forwardedNotification) fail(@"Forwarded requests did not reach the app");
            if (!moved) fail(@"tabs.move did not ask the workspace to move the tab");
            checkBlocking(redirect);
        }];
    });
}

static void events(const char *json) {
    NSDictionary *value = [NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    NSString *kind = value[@"kind"];
    if ([kind isEqual:@"compat-request"]) answer(value);
    if ([kind isEqual:@"move-tab"]) moved = [value[@"tabId"] isEqual:@"normal"] && [value[@"index"] isEqual:@0];
    if ([kind isEqual:@"replace-view"] && [value[@"tabId"] isEqual:@"normal"]) {
        NSString *url = value[@"url"];
        NSString *expected = [NSString stringWithFormat:@"webkit-extension://%@/__misty_compat__/identity.html#", origin];
        if (![url hasPrefix:expected] || ![url containsString:@"code%3Dprobe"]) fail([@"Unexpected identity page: " stringByAppendingString:url]);
        [store removeDataOfTypes:WKWebsiteDataStore.allWebsiteDataTypes modifiedSince:NSDate.distantPast completionHandler:^{}];
        puts("PASS: compatibility layer shims, native language/idle/site data, forwarded history and notifications, tabs.move, OAuth redirect rewrite, learned blocking");
        exit(0);
    }
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (!misty_extensions_supported() || argc != 3) return 2;
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        account = [@"compat-" stringByAppendingString:NSUUID.UUID.UUIDString];
        origin = NSUUID.UUID.UUIDString.lowercaseString;
        NSString *root = [NSString stringWithUTF8String:argv[1]];
        pageURL = [NSString stringWithUTF8String:argv[2]];
        navigation = [ProbeNavigation new];
        store = [WKWebsiteDataStore dataStoreForIdentifier:[[NSUUID alloc] initWithUUIDString:@"6d4a6c2e-3f1b-4f7e-9a51-0c0de5c0a7b1"]];
        views = [NSMutableArray array];
        window = [[NSWindow alloc] initWithContentRect:NSMakeRect(80, 80, 500, 400) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        [window makeKeyAndOrderFront:nil];
        misty_extensions_set_events(events);
        NSArray *permissions = @[@"storage", @"webRequest", @"webRequestBlocking", @"declarativeNetRequest", @"history", @"idle", @"notifications", @"browsingData", @"tabs"];
        request(@{@"operation":@"configure", @"controllerId":NSUUID.UUID.UUIDString}, ^(NSDictionary *result) {
            request(@{@"operation":@"load", @"id":@"1", @"guid":@"compat-fixture@misty.test", @"origin":origin, @"runtimePath":root, @"privateAccess":@NO, @"permissions":permissions, @"hosts":@[@"http://127.0.0.1/*"]}, ^(NSDictionary *loaded) {
                page = viewFor(pageURL, @"normal");
                misty_extensions_tab_event("normal", "activate");
                after(2, ^{ runChecks(); });
            });
        });
        after(60, ^{ fail(@"Compatibility probe timed out"); });
        [NSApp run];
    }
}
