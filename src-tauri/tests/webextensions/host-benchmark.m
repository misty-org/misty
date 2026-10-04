// SPDX-License-Identifier: MIT
// Counts native runtime/bridge views and measures this host process only.
#import "../../native/macos/MistyExtensions.h"
#import <AppKit/AppKit.h>
#import <sys/resource.h>
static NSString *account,*root;
static NSInteger count,ready;
static struct rusage baseline;
static CFAbsoluteTime began;
typedef void (^Reply)(NSDictionary *);
static void reply(void *pointer,const char *json) {
    Reply block=CFBridgingRelease(pointer);
    NSDictionary *value=[NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    if (value[@"error"]) { fprintf(stderr,"FAIL: %s\n",[value[@"error"] UTF8String]); exit(1); }
    block(value);
}
static void request(NSDictionary *input,Reply block) {
    NSMutableDictionary *value=[input mutableCopy];if (!value[@"account"]) value[@"account"]=account;
    NSData *data=[NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    misty_extensions_request([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String,reply,(__bridge_retained void *)[block copy]);
}
static double cpu(struct rusage value) { return value.ru_utime.tv_sec+value.ru_utime.tv_usec/1e6+value.ru_stime.tv_sec+value.ru_stime.tv_usec/1e6; }
static void measure(void) {
    double startup=CFAbsoluteTimeGetCurrent()-began;
    getrusage(RUSAGE_SELF,&baseline);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,5*NSEC_PER_SEC),dispatch_get_main_queue(),^{
        struct rusage usage;getrusage(RUSAGE_SELF,&usage);
        request(@{@"operation":@"diagnostics"},^(NSDictionary *value){
            if ([value[@"runtimeCount"] integerValue]!=count || [value[@"bridgeViewCount"] integerValue]!=count) exit(1);
            printf("contexts=%ld bridge_views=%ld ready_seconds=%.3f host_peak_RSS_MiB=%.1f host_idle_CPU_seconds_over_5s=%.4f\n",(long)count,(long)[value[@"bridgeViewCount"] integerValue],startup,usage.ru_maxrss/1048576.0,cpu(usage)-cpu(baseline));
            request(@{@"operation":@"configure",@"account":@"",@"controllerId":NSUUID.UUID.UUIDString},^(NSDictionary *value){exit(0);});
        });
    });
}
static void events(const char *json) {
    NSDictionary *event=[NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    if ([event[@"kind"] isEqual:@"sync-ready"] && ++ready==count) measure();
}
int main(int argc,const char *argv[]) {
    @autoreleasepool {
        if (argc!=3 || !misty_extensions_supported()) return 2;
        [NSApplication sharedApplication]; count=atoi(argv[2]); root=[NSString stringWithUTF8String:argv[1]];
        account=[@"benchmark-" stringByAppendingString:NSUUID.UUID.UUIDString];began=CFAbsoluteTimeGetCurrent();
        misty_extensions_set_events(events);
        request(@{@"operation":@"configure",@"controllerId":NSUUID.UUID.UUIDString},^(NSDictionary *value){
            if (!count) { measure(); return; }
            for (NSInteger i=0;i<count;i++) request(@{@"operation":@"load",@"id":[NSString stringWithFormat:@"%ld",(long)i],@"guid":[NSString stringWithFormat:@"benchmark-%ld@misty.test",(long)i],@"origin":NSUUID.UUID.UUIDString.lowercaseString,@"runtimePath":root,@"permissions":@[@"storage"],@"hosts":@[],@"privateAccess":@YES},^(NSDictionary *value){});
        });
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW,30*NSEC_PER_SEC),dispatch_get_main_queue(),^{fprintf(stderr,"Benchmark timeout\n");exit(1);});
        [NSApp run];
    }
}
