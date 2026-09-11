#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <Carbon/Carbon.h>
#import <CoreGraphics/CoreGraphics.h>
#include <stdatomic.h>

static _Atomic(pid_t) mistySourcePID = 0;
static void (*mistyToggle)(void) = NULL;
static EventHotKeyRef mistyHotKey;
static OSStatus MistyHotKey(EventHandlerCallRef handler, EventRef event, void *data) {
  (void)handler; (void)event; (void)data;
  if (mistyToggle) mistyToggle();
  return noErr;
}
void misty_context_configure_window(void *pointer) {
  NSWindow *window = (__bridge NSWindow *)pointer;
  window.collectionBehavior = (window.collectionBehavior & ~NSWindowCollectionBehaviorFullScreenPrimary) | NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
  window.hidesOnDeactivate = NO;
}
void misty_context_start(void (*toggle)(void)) {
  mistyToggle = toggle;
  NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;
  if (front.processIdentifier != NSProcessInfo.processInfo.processIdentifier) mistySourcePID = front.processIdentifier;
  [NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:NSWorkspaceDidActivateApplicationNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
    NSRunningApplication *app = note.userInfo[NSWorkspaceApplicationKey];
    // Ignore only our companion activation. Main Misty workspace is resolved by SDK.
    if (app.processIdentifier != NSProcessInfo.processInfo.processIdentifier) mistySourcePID = app.processIdentifier;
  }];
  EventTypeSpec spec = { kEventClassKeyboard, kEventHotKeyPressed };
  InstallApplicationEventHandler(&MistyHotKey, 1, &spec, NULL, NULL);
  EventHotKeyID identifier = { 'Msty', 1 };
  RegisterEventHotKey(kVK_ANSI_K, cmdKey | shiftKey, identifier, GetApplicationEventTarget(), 0, &mistyHotKey);
}
static char *MistyJSON(NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  return strdup([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}
void misty_context_main_focused(void) { mistySourcePID = 0; }
char *misty_context_status(bool request) {
  @autoreleasepool {
    if (@available(macOS 14.0, *)) {
      bool allowed = CGPreflightScreenCaptureAccess();
      if (request && !allowed) allowed = CGRequestScreenCaptureAccess();
      return MistyJSON(@{@"supported":@YES,@"allowed":@(allowed),@"shortcutRegistered":@(mistyHotKey != NULL),@"external":@(mistySourcePID != 0)});
    }
    return MistyJSON(@{@"supported":@NO,@"allowed":@NO,@"shortcutRegistered":@(mistyHotKey != NULL),@"external":@(mistySourcePID != 0)});
  }
}
// Called on a Rust blocking worker. AppKit work is dispatched to the main queue.
char *misty_context_capture(void) {
  @autoreleasepool {
    if (@available(macOS 14.0, *)) {
      if (!CGPreflightScreenCaptureAccess()) return MistyJSON(@{@"error":@"Enable screen access to attach this window."});
      dispatch_semaphore_t done = dispatch_semaphore_create(0);
      __block NSDictionary *result;
      dispatch_async(dispatch_get_main_queue(), ^{
        NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;
        pid_t pid = front.processIdentifier == NSProcessInfo.processInfo.processIdentifier ? mistySourcePID : front.processIdentifier;
        [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *content, NSError *error) {
          if (error) { result=@{@"error":error.localizedDescription}; dispatch_semaphore_signal(done); return; }
          NSArray *order = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
          SCWindow *target = nil;
          for (NSDictionary *info in order) {
            if ([info[(id)kCGWindowOwnerPID] intValue] != pid || [info[(id)kCGWindowLayer] intValue] != 0) continue;
            CGWindowID wid = [info[(id)kCGWindowNumber] unsignedIntValue];
            for (SCWindow *window in content.windows) if (window.windowID == wid) { target=window; break; }
            if (target) break;
          }
          if (!target) { result=@{@"error":@"The source window is unavailable. Return to it and try again."}; dispatch_semaphore_signal(done); return; }
          SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:target];
          SCStreamConfiguration *config = [SCStreamConfiguration new];
          double scale = MIN(1.0, 1600.0 / MAX(target.frame.size.width,target.frame.size.height));
          config.width = MAX(1, target.frame.size.width * scale);
          config.height = MAX(1, target.frame.size.height * scale);
          config.showsCursor = NO;
          [SCScreenshotManager captureImageWithFilter:filter configuration:config completionHandler:^(CGImageRef image, NSError *captureError) {
            if (captureError || !image) result=@{@"error":captureError.localizedDescription ?: @"This window cannot be captured."};
            else {
              NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:image];
              NSData *jpeg = [rep representationUsingType:NSBitmapImageFileTypeJPEG properties:@{NSImageCompressionFactor:@0.7}];
              result=@{@"dataUrl":[@"data:image/jpeg;base64," stringByAppendingString:[jpeg base64EncodedStringWithOptions:0]],@"width":@(CGImageGetWidth(image)),@"height":@(CGImageGetHeight(image)),@"title":target.title ?: @"Window",@"appName":target.owningApplication.applicationName ?: @"App"};
            }
            dispatch_semaphore_signal(done);
          }];
        }];
      });
      if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 8 * NSEC_PER_SEC))) return MistyJSON(@{@"error":@"Screen capture timed out. Try again."});
      return MistyJSON(result);
    }
    return MistyJSON(@{@"error":@"Screen context requires macOS 14 or later."});
  }
}
