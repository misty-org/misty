// SPDX-License-Identifier: MIT
#import <WebKit/WebKit.h>
API_AVAILABLE(macos(15.4))
@interface MistyExtensionNativeMessaging : NSObject
@property (readonly) NSTask *task;
+ (instancetype)connect:(NSString *)name extension:(NSString *)identifier error:(NSError **)error;
- (void)send:(id)message;
- (void)receive:(void (^)(id, NSError *))handler;
- (void)stop;
@end
