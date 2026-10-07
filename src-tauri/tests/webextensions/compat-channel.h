// SPDX-License-Identifier: MIT
// Shared by the native probes that load the compatibility layer.
#import "../../native/macos/MistyExtensions.h"
#import <WebKit/WebKit.h>

// Stands in for Kiri's extension transport (kiri/src/extensions/bridge.rs),
// which the app installs from Rust: the same handler name and admission rule.
@interface ProbeCompatChannel : NSObject <WKScriptMessageHandlerWithReply>
@end
@implementation ProbeCompatChannel
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message replyHandler:(void (^)(id, NSString *))reply {
    if (!message.frameInfo.isMainFrame || ![message.body isKindOfClass:NSDictionary.class]) { reply(nil, @"Invalid extension request."); return; }
    misty_extensions_compat_message((__bridge void *)message, (__bridge void *)reply);
}
@end
static void installCompatChannel(void *controller) {
    [(__bridge WKUserContentController *)controller addScriptMessageHandlerWithReply:[ProbeCompatChannel new] contentWorld:WKContentWorld.pageWorld name:@"kiriExtension"];
}
