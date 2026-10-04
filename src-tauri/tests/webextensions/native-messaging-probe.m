// SPDX-License-Identifier: MIT
#import "../../native/macos/MistyExtensionNativeMessaging.h"
#import <AppKit/AppKit.h>
static MistyExtensionNativeMessaging *connection;
static int messages;
static void fail(NSString *message) { fprintf(stderr,"FAIL: %s\n",message.UTF8String); [connection stop]; exit(1); }
int main(int argc,const char *argv[]) {
    @autoreleasepool {
        if (argc!=2) return 2;
        [NSApplication sharedApplication];
        NSString *name=[NSString stringWithUTF8String:argv[1]];
        NSError *error;
        if ([MistyExtensionNativeMessaging connect:name extension:@"unapproved@misty.test" error:&error] || !error) fail(@"Unauthorized identity was accepted");
        error=nil;
        if ([MistyExtensionNativeMessaging connect:@"../escape" extension:@"native-fixture@misty.test" error:&error] || !error) fail(@"Invalid host name was accepted");
        connection=[MistyExtensionNativeMessaging connect:name extension:@"native-fixture@misty.test" error:&error];
        if (!connection) fail(error.localizedDescription);
        [connection receive:^(id value,NSError *error) {
            if (messages==3) {
                if (!error) fail(@"Oversized incoming frame was accepted");
                [connection stop];
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW,3*NSEC_PER_SEC),dispatch_get_main_queue(),^{
                    if (connection.task.running) fail(@"Native host survived connection cleanup");
                    puts("PASS: native host identity, direct execution arguments, persistent fragmented framing, size limit, process cleanup"); exit(0);
                });
                return;
            }
            if (error || ![value[@"sequence"] isEqual:@(messages)]) fail(@"Persistent frame round trip failed");
            if (++messages==3) [connection send:@"oversize"];
            else [connection send:@{@"sequence":@(messages)}];
        }];
        [connection send:@{@"sequence":@0}];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW,15*NSEC_PER_SEC),dispatch_get_main_queue(),^{ fail(@"Native messaging timeout"); });
        [NSApp run];
    }
}
