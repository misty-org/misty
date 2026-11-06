// Asks the person to confirm with Touch ID or this Mac's password before Misty fills a saved card.
#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>

// Outcomes, as `infra/local_auth.rs` reads them.
enum { MistyAuthConfirmed = 0, MistyAuthCanceled = 1, MistyAuthUnavailable = 2, MistyAuthFailed = 3 };

// `done` is called exactly once, on any thread. macOS words the prompt as
// "Misty is trying to <reason>".
void misty_local_auth_confirm(const char *reason, void *context, void (*done)(void *, int)) {
  LAContext *auth = [[LAContext alloc] init];
  NSString *why = [NSString stringWithUTF8String:reason] ?: @"fill your card";
  NSError *unavailable = nil;
  if (![auth canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:&unavailable]) {
    done(context, MistyAuthUnavailable);
    return;
  }
  [auth evaluatePolicy:LAPolicyDeviceOwnerAuthentication
       localizedReason:why
                 reply:^(BOOL success, NSError *failure) {
                   if (success) {
                     done(context, MistyAuthConfirmed);
                   } else if (failure.code == LAErrorUserCancel ||
                              failure.code == LAErrorSystemCancel ||
                              failure.code == LAErrorAppCancel) {
                     done(context, MistyAuthCanceled);
                   } else {
                     done(context, MistyAuthFailed);
                   }
                 }];
}
