// SPDX-License-Identifier: MIT
// Exercises extension notifications through UNUserNotificationCenter. It must
// run inside an app bundle (run-native.py --notifications builds one), and the
// first run asks for notification permission.
//
// macOS cannot be made to click a banner, so the delegate receives stand-in
// responses carrying the delivered notification. That covers Misty's routing of
// clicks, buttons and dismissals; the system's own delivery of a click is left
// to a manual check in Misty.
#import "../../native/macos/MistyExtensions.h"
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <UserNotifications/UserNotifications.h>

static NSString *account, *origin;
static NSWindow *window;
static WKWebView *page;
static UNNotification *delivered;
typedef void (^Completion)(NSDictionary *);

/// The delegate reads only these two properties of a response.
@interface StandInResponse : NSObject
@property UNNotification *notification;
@property NSString *actionIdentifier;
@end
@implementation StandInResponse
@end

static void fail(NSString *message) { fprintf(stderr, "FAIL: %s\n", message.UTF8String); exit(1); }
static void after(double seconds, dispatch_block_t block) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), block);
}
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
static void evaluate(NSString *script, void (^done)(id)) {
    [page callAsyncJavaScript:script arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id result, NSError *error) {
        if (error) fail([NSString stringWithFormat:@"%@ failed: %@", script, error.userInfo[@"WKJavaScriptExceptionMessage"] ?: error.localizedDescription]);
        done(result);
    }];
}
static void respond(NSString *action) {
    StandInResponse *response = [StandInResponse new];
    response.notification = delivered;
    response.actionIdentifier = action;
    UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
    [center.delegate userNotificationCenter:center didReceiveNotificationResponse:(UNNotificationResponse *)response withCompletionHandler:^{}];
}

static void checkRouting(void) {
    respond(UNNotificationDefaultActionIdentifier);
    respond(@"button-1");
    respond(UNNotificationDismissActionIdentifier);
    after(1, ^{
        evaluate(@"return JSON.stringify(window.notificationEvents)", ^(id events) {
            NSString *expected = @"[[\"onShown\",\"probe\"],[\"onClicked\",\"probe\"],[\"onButtonClicked\",\"probe\",1],[\"onClosed\",\"probe\",true]]";
            if (![events isEqual:expected]) fail([@"Unexpected notification events: " stringByAppendingString:[events description]]);
            // The dismissal already forgot it, so clearing reports false.
            evaluate(@"return await browser.notifications.clear('probe')", ^(id cleared) {
                if (![cleared isEqual:@NO]) fail([@"clear was wrong: " stringByAppendingString:[cleared description]]);
                // Notification Center removes delivered notifications asynchronously.
                after(1, ^{
                    evaluate(@"return JSON.stringify(await browser.notifications.getAll())", ^(id all) {
                        if (![all isEqual:@"{}"]) fail([@"getAll after clear was wrong: " stringByAppendingString:[all description]]);
                        puts("PASS: native notification with buttons and image attachment, getAll, click/button/dismiss routing to extension events, clear");
                        exit(0);
                    });
                });
            });
        });
    });
}

static void inspectDelivered(void) {
    [UNUserNotificationCenter.currentNotificationCenter getDeliveredNotificationsWithCompletionHandler:^(NSArray<UNNotification *> *notifications) {
        dispatch_async(dispatch_get_main_queue(), ^{
            for (UNNotification *notification in notifications)
                if ([notification.request.content.userInfo[@"mistyNotification"] isEqual:@"probe"]) delivered = notification;
            if (!delivered) fail(@"The notification was not delivered");
            UNNotificationContent *content = delivered.request.content;
            if (![content.title isEqual:@"Misty notification probe"]) fail(@"Delivered title was wrong");
            if (content.attachments.count != 1) fail(@"The icon was not attached");
            [UNUserNotificationCenter.currentNotificationCenter getNotificationCategoriesWithCompletionHandler:^(NSSet<UNNotificationCategory *> *categories) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    UNNotificationCategory *category = nil;
                    for (UNNotificationCategory *candidate in categories) if ([candidate.identifier isEqual:content.categoryIdentifier]) category = candidate;
                    if (![[category.actions valueForKey:@"title"] isEqual:@[@"Yes", @"No"]]) fail(@"Notification buttons were not registered");
                    checkRouting();
                });
            }];
        });
    }];
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (!misty_extensions_supported() || argc != 2) return 2;
        if (![NSBundle.mainBundle.bundlePath hasSuffix:@".app"]) { fprintf(stderr, "Run this probe from its app bundle.\n"); return 2; }
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        account = [@"notifications-" stringByAppendingString:NSUUID.UUID.UUIDString];
        origin = NSUUID.UUID.UUIDString.lowercaseString;
        NSString *root = [NSString stringWithUTF8String:argv[1]];
        window = [[NSWindow alloc] initWithContentRect:NSMakeRect(80, 80, 400, 300) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        request(@{@"operation":@"configure", @"controllerId":NSUUID.UUID.UUIDString}, ^(NSDictionary *configured) {
            request(@{@"operation":@"load", @"id":@"1", @"guid":@"compat-fixture@misty.test", @"origin":origin, @"runtimePath":root, @"privateAccess":@NO, @"permissions":@[@"notifications"], @"hosts":@[]}, ^(NSDictionary *loaded) {
                NSString *url = [NSString stringWithFormat:@"webkit-extension://%@/notifications.html", origin];
                WKWebViewConfiguration *original = [WKWebViewConfiguration new];
                WKWebViewConfiguration *configuration = CFBridgingRelease(misty_extensions_configuration((__bridge void *)original, url.UTF8String, false));
                page = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 400, 300) configuration:configuration];
                [window.contentView addSubview:page];
                misty_extensions_register_tab((__bridge void *)page, "notifications", false, url.UTF8String);
                [page loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:url]]];
                after(2, ^{
                    [UNUserNotificationCenter.currentNotificationCenter getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
                        fprintf(stderr, "Notification authorization status: %ld (0 not asked, 1 denied, 2 allowed)\n", (long)settings.authorizationStatus);
                    }];
                    fprintf(stderr, "Posting a test notification. Allow notifications if macOS asks.\n");
                    evaluate(@"return await window.createNotification()", ^(id name) {
                        if (![name isEqual:@"probe"]) fail([NSString stringWithFormat:@"create returned %@", name]);
                        evaluate(@"return JSON.stringify(await browser.notifications.getAll())", ^(id all) {
                            if (![all isEqual:@"{\"probe\":true}"]) fail([@"getAll was wrong: " stringByAppendingString:[all description]]);
                            inspectDelivered();
                        });
                    });
                });
            });
        });
        // Leaves time to answer the first-run permission prompt.
        after(120, ^{ fail(@"Notification probe timed out"); });
        [NSApp run];
    }
}
