// SPDX-License-Identifier: MIT
// Exercises the production native host with MIT-owned fixtures, in a unique controller.
#import "../../native/macos/MistyExtensions.h"
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <sys/resource.h>

static NSString *account, *root, *pageURL;
static NSWindow *window;
static NSMutableArray<WKWebView *> *views;
static BOOL bridgeReady, pageReady, privateReady, completed, replacing;
@interface FixtureNavigation : NSObject <WKNavigationDelegate>
@end
@implementation FixtureNavigation
- (void)webView:(WKWebView *)view decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))done {
    done(misty_extensions_navigation((__bridge void *)view, (__bridge void *)action) ? WKNavigationActionPolicyCancel : WKNavigationActionPolicyAllow);
}
@end
static FixtureNavigation *navigation;
static NSUInteger attempts;
typedef void (^Completion)(NSDictionary *);
static void fail(NSString *message) { fprintf(stderr,"FAIL: %s\n",message.UTF8String); exit(1); }
static void replied(void *pointer,const char *json) {
    Completion completion=CFBridgingRelease(pointer);
    NSDictionary *value=[NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    if (value[@"error"]) fail(value[@"error"]);
    completion(value);
}
static void request(NSDictionary *input,Completion completion) {
    NSMutableDictionary *value=[input mutableCopy]; if (!value[@"account"]) value[@"account"]=account;
    NSData *data=[NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    misty_extensions_request([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String,replied,(__bridge_retained void *)[completion copy]);
}
static WKWebView *viewFor(NSString *url,NSString *identifier,BOOL privateTab) {
    WKWebViewConfiguration *original=[WKWebViewConfiguration new]; original.websiteDataStore=[WKWebsiteDataStore nonPersistentDataStore];
    WKWebViewConfiguration *configuration=CFBridgingRelease(misty_extensions_configuration((__bridge void *)original,url.UTF8String,false));
    if (!configuration) fail(@"Native configuration was not returned");
    WKWebView *view=[[WKWebView alloc] initWithFrame:NSMakeRect(0,0,500,300) configuration:configuration];
    view.navigationDelegate=navigation;
    [views addObject:view]; [window.contentView addSubview:view];
    misty_extensions_register_tab((__bridge void *)view,identifier.UTF8String,privateTab,url.UTF8String);
    if (!replacing) [view loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:url]]];
    return view;
}
static void finishWhenReady(void) {
    if (!bridgeReady || !pageReady || !privateReady || completed) return;
    completed=YES;
    request(@{@"operation":@"sync-apply",@"id":@"1",@"changes":@{@"fixture":@{@"value":@"replicated-value"}}},^(NSDictionary *result) {
        request(@{@"operation":@"sync-restored",@"id":@"1"},^(NSDictionary *result) {
            request(@{@"operation":@"invoke",@"id":@"1",@"tabId":@"normal"},^(NSDictionary *result) {
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC),dispatch_get_main_queue(),^{
                    request(@{@"operation":@"popup-evaluate",@"id":@"1",@"tabId":@"normal",@"script":@"document.title"},^(NSDictionary *result) {
                        if (![result[@"result"] isEqual:@"Misty fixture"]) fail(@"Action popup did not load fixture HTML");
                        request(@{@"operation":@"options",@"id":@"1"},^(NSDictionary *result) {});
                    });
                });
            });
        });
    });
}
static void events(const char *json) {
    NSDictionary *value=[NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    fprintf(stderr,"event: %s\n",[value[@"kind"] UTF8String]);
    if ([value[@"kind"] isEqual:@"sync-ready"]) { bridgeReady=YES; finishWhenReady(); }
    if ([value[@"kind"] isEqual:@"sync-error"]) fail(@"Production bridge failed");
    if ([value[@"kind"] isEqual:@"replace-view"]) {
        if (![value[@"tabId"] isEqual:@"options"]) fail(@"Logical tab identity changed during navigation");
        replacing=YES;
        WKWebView *website=viewFor(value[@"url"],@"options",NO);
        replacing=NO;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC),dispatch_get_main_queue(),^{
            [website evaluateJavaScript:@"document.title" completionHandler:^(id title,NSError *error) {
                if (error || ![title isEqual:@"POST retained"]) fail(@"Navigation swap lost the original POST request");
                request(@{@"operation":@"unload",@"id":@"1"},^(NSDictionary *result) {
                    request(@{@"operation":@"remove",@"id":@"1",@"guid":@"native-fixture@misty.test"},^(NSDictionary *result) {
                        struct rusage usage; getrusage(RUSAGE_SELF,&usage);
                        printf("PASS: production host, normal/private content scripts, background messages, sync bridge apply, action popup, options storage, navigation swap preserving POST and logical identity, disabled-extension cleanup; peak process RSS %.1f MiB\n",usage.ru_maxrss/1048576.0);
                        exit(0);
                    });
                });
            }];
        });
    }
    if ([value[@"kind"] isEqual:@"open-tab"]) {
        WKWebView *options=viewFor(value[@"url"],@"options",NO);
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC),dispatch_get_main_queue(),^{
            [options callAsyncJavaScript:@"return (await browser.storage.sync.get('fixture')).fixture" arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id result,NSError *error) {
                if (error || ![result isEqual:@"replicated-value"]) fail(@"Options page could not read replicated storage");
                NSMutableURLRequest *post=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:pageURL]];
                post.HTTPMethod=@"POST"; post.HTTPBody=[@"fixture=retained" dataUsingEncoding:NSUTF8StringEncoding];
                [options loadRequest:post];
            }];
        });
    }
}
static void poll(void) {
    if (++attempts>40) fail([NSString stringWithFormat:@"Production host probe timed out (bridge=%d normal=%d private=%d)",bridgeReady,pageReady,privateReady]);
    if (views.count>=2) {
        [views[0] evaluateJavaScript:@"document.documentElement.dataset.mistyFixture" completionHandler:^(id result,NSError *error) { if (attempts==5) fprintf(stderr,"normal: %s %s\n",[result description].UTF8String,error.description.UTF8String); if ([result isEqual:@"content-and-background"]) pageReady=YES; finishWhenReady(); }];
        [views[1] evaluateJavaScript:@"document.documentElement.dataset.mistyFixture" completionHandler:^(id result,NSError *error) { if (attempts==5) fprintf(stderr,"private: %s %s\n",[result description].UTF8String,error.description.UTF8String); if ([result isEqual:@"content-and-background"]) privateReady=YES; finishWhenReady(); }];
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC),dispatch_get_main_queue(),^{ poll(); });
}
int main(int argc,const char *argv[]) {
    @autoreleasepool {
        if (!misty_extensions_supported() || argc!=3) return 2;
        [NSApplication sharedApplication]; [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        account=[@"fixture-" stringByAppendingString:NSUUID.UUID.UUIDString]; root=[NSString stringWithUTF8String:argv[1]];
        pageURL=[NSString stringWithUTF8String:argv[2]];
        navigation=[FixtureNavigation new];
        views=[NSMutableArray array];
        window=[[NSWindow alloc] initWithContentRect:NSMakeRect(80,80,500,400) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        [window makeKeyAndOrderFront:nil];
        misty_extensions_set_events(events);
        request(@{@"operation":@"configure",@"controllerId":NSUUID.UUID.UUIDString},^(NSDictionary *result) {
            request(@{@"operation":@"load",@"id":@"1",@"guid":@"native-fixture@misty.test",@"origin":NSUUID.UUID.UUIDString.lowercaseString,@"runtimePath":root,@"privateAccess":@YES,@"permissions":@[@"storage",@"activeTab",@"scripting"],@"hosts":@[@"http://127.0.0.1/*"]},^(NSDictionary *result) {
                viewFor(pageURL,@"normal",NO);
                viewFor(pageURL,@"private",YES);
                misty_extensions_tab_event("normal","activate"); poll();
            });
        });
        [NSApp run];
    }
}
