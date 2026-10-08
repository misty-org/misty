#import <AppKit/AppKit.h>
#import <CoreServices/CoreServices.h>

// Whether LaunchServices currently opens web links with this app.
bool misty_default_browser_is_current(void) {
    @autoreleasepool {
        NSURL *app = [[NSWorkspace sharedWorkspace]
            URLForApplicationToOpenURL:[NSURL URLWithString:@"https://example.com"]];
        NSString *current = app ? [NSBundle bundleWithURL:app].bundleIdentifier : nil;
        NSString *own = NSBundle.mainBundle.bundleIdentifier;
        return current && own && [current caseInsensitiveCompare:own] == NSOrderedSame;
    }
}

// Asks macOS to make this app the default for http and https. macOS shows its own
// confirmation; the caller re-reads the status when the window regains focus.
void misty_default_browser_request(void) {
    @autoreleasepool {
        NSString *own = NSBundle.mainBundle.bundleIdentifier;
        if (!own) return;
        if (@available(macOS 12.0, *)) {
            NSURL *bundle = NSBundle.mainBundle.bundleURL;
            for (NSString *scheme in @[@"http", @"https"]) {
                [[NSWorkspace sharedWorkspace] setDefaultApplicationAtURL:bundle
                                               toOpenURLsWithScheme:scheme
                                                  completionHandler:^(NSError *error) {}];
            }
        } else {
            LSSetDefaultHandlerForURLScheme(CFSTR("http"), (__bridge CFStringRef)own);
            LSSetDefaultHandlerForURLScheme(CFSTR("https"), (__bridge CFStringRef)own);
        }
    }
}
