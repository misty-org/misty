#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <string.h>
// Best-effort legacy migration must NEVER display authentication UI.
char *misty_permission_read_legacy(const char *owner) {
    @autoreleasepool {
        NSDictionary *query = @{
            (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: @"misty.native-app.permissions.v1",
            (__bridge id)kSecAttrAccount: @(owner),
            (__bridge id)kSecReturnData: @YES,
            (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne,
            (__bridge id)kSecUseAuthenticationUI: (__bridge id)kSecUseAuthenticationUIFail
        };
        CFTypeRef result = NULL;
        OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
        if (status != errSecSuccess) { if (result) CFRelease(result); return NULL; }
        NSData *data = CFBridgingRelease(result);
        if (![data isKindOfClass:[NSData class]] || data.length > 65536) return NULL;
        NSString *value = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        return value ? strdup(value.UTF8String) : NULL;
    }
}
