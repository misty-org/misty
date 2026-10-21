// Adapted from Clicky's CompanionScreenCaptureUtility.swift (MIT, Farza 2026).
// Capture for the cursor companion; see src/features/agents/companion/DESIGN.md.
/*
MIT License

Copyright (c) 2026 Farza

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>

// Vision providers resize larger images before the model sees them (OpenAI to
// a 768px short side, Anthropic to a 1568px long side). Labels state the sent
// size, so a resize would shift every point; stay inside both bounds instead.
static double CompanionCaptureScale(double width, double height) {
  return MIN(1.0, MIN(768.0 / MIN(width, height), 1568.0 / MAX(width, height)));
}

static char *CompanionJSON(NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  return strdup([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}

// Runs on Rust's blocking worker. Completion blocks own their state even after timeout.
char *misty_companion_capture_display(uint32_t displayID) {
  @autoreleasepool {
    if (@available(macOS 14.0, *)) {
      dispatch_semaphore_t done = dispatch_semaphore_create(0);
      __block NSDictionary *result;
      [SCShareableContent getShareableContentExcludingDesktopWindows:NO onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *content, NSError *error) {
        if (error) { result = @{@"error": error.localizedDescription}; dispatch_semaphore_signal(done); return; }
        SCDisplay *target;
        for (SCDisplay *display in content.displays) if (display.displayID == displayID) { target = display; break; }
        if (!target) { result = @{@"error": @"Display disconnected. Capture the screen again."}; dispatch_semaphore_signal(done); return; }
        NSMutableArray<SCWindow *> *excluded = [NSMutableArray new];
        for (SCWindow *window in content.windows) {
          // Misty's own workspaces are user content; exclude only companion overlays.
          if (window.owningApplication.processID == NSProcessInfo.processInfo.processIdentifier && [window.title isEqualToString:@"Misty cursor"]) [excluded addObject:window];
        }
        SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:target excludingWindows:excluded];
        SCStreamConfiguration *config = [SCStreamConfiguration new];
        double scale = CompanionCaptureScale(target.width, target.height);
        config.width = MAX(1, (size_t)(target.width * scale));
        config.height = MAX(1, (size_t)(target.height * scale));
        config.showsCursor = NO;
        config.capturesAudio = NO;
        [SCScreenshotManager captureImageWithFilter:filter configuration:config completionHandler:^(CGImageRef image, NSError *captureError) {
          if (captureError || !image) result = @{@"error": captureError.localizedDescription ?: @"Screen capture returned no image."};
          else {
            NSData *jpeg = [[[NSBitmapImageRep alloc] initWithCGImage:image] representationUsingType:NSBitmapImageFileTypeJPEG properties:@{NSImageCompressionFactor: @0.8}];
            if (!jpeg.length) result = @{@"error": @"Screen capture returned an empty image."};
            else result = @{@"jpeg": [jpeg base64EncodedStringWithOptions:0], @"width": @(CGImageGetWidth(image)), @"height": @(CGImageGetHeight(image))};
          }
          dispatch_semaphore_signal(done);
        }];
      }];
      if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 8 * NSEC_PER_SEC))) return CompanionJSON(@{@"error": @"Screen capture timed out. Try again."});
      return CompanionJSON(result);
    }
    // Misty supports macOS 12; SCScreenshotManager is only available on 14+.
    // The host keeps its existing CoreGraphics still path on older systems.
    return CompanionJSON(@{@"legacy_capture": @YES});
  }
}

// The frontmost app's frontmost ordinary window, in CG global display points
// (top-left origin, like cursor samples). Window numbers in `ignored` are
// Misty's own companion, overlay and panel windows. NULL when none qualifies.
char *misty_companion_foreground_window(const int64_t *ignored, size_t count) {
  @autoreleasepool {
    pid_t front = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
    if (front <= 0) return NULL;
    CFArrayRef list = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
    if (!list) return NULL;
    NSArray<NSDictionary *> *windows = CFBridgingRelease(list);
    for (NSDictionary *window in windows) {
      if ([window[(id)kCGWindowOwnerPID] intValue] != front || [window[(id)kCGWindowLayer] intValue] != 0) continue;
      if ([window[(id)kCGWindowAlpha] doubleValue] <= 0) continue;
      int64_t number = [window[(id)kCGWindowNumber] longLongValue];
      BOOL skip = NO;
      for (size_t i = 0; i < count; i++) if (ignored[i] == number) { skip = YES; break; }
      if (skip) continue;
      CGRect bounds;
      if (!CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)window[(id)kCGWindowBounds], &bounds)) continue;
      if (bounds.size.width < 1 || bounds.size.height < 1) continue;
      return CompanionJSON(@{
        @"number": @(number),
        @"x": @(bounds.origin.x), @"y": @(bounds.origin.y),
        @"width": @(bounds.size.width), @"height": @(bounds.size.height),
        @"app": window[(id)kCGWindowOwnerName] ?: @"",
        @"title": window[(id)kCGWindowName] ?: @"",
      });
    }
    return NULL;
  }
}

// One area of a display (display-local points) at its full pixel resolution,
// fitted inside the providers' sizes like a display capture.
char *misty_companion_capture_rect(uint32_t displayID, double x, double y, double width, double height, double pixelScale) {
  @autoreleasepool {
    if (@available(macOS 14.0, *)) {
      dispatch_semaphore_t done = dispatch_semaphore_create(0);
      __block NSDictionary *result;
      [SCShareableContent getShareableContentExcludingDesktopWindows:NO onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *content, NSError *error) {
        if (error) { result = @{@"error": error.localizedDescription}; dispatch_semaphore_signal(done); return; }
        SCDisplay *target;
        for (SCDisplay *display in content.displays) if (display.displayID == displayID) { target = display; break; }
        if (!target) { result = @{@"error": @"Display disconnected. Capture the screen again."}; dispatch_semaphore_signal(done); return; }
        NSMutableArray<SCWindow *> *excluded = [NSMutableArray new];
        for (SCWindow *window in content.windows) {
          if (window.owningApplication.processID == NSProcessInfo.processInfo.processIdentifier && [window.title isEqualToString:@"Misty cursor"]) [excluded addObject:window];
        }
        SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:target excludingWindows:excluded];
        SCStreamConfiguration *config = [SCStreamConfiguration new];
        double pixels = MAX(1.0, pixelScale);
        double scale = CompanionCaptureScale(width * pixels, height * pixels);
        config.sourceRect = CGRectMake(x, y, width, height);
        config.width = MAX(1, (size_t)(width * pixels * scale));
        config.height = MAX(1, (size_t)(height * pixels * scale));
        config.showsCursor = NO;
        config.capturesAudio = NO;
        [SCScreenshotManager captureImageWithFilter:filter configuration:config completionHandler:^(CGImageRef image, NSError *captureError) {
          if (captureError || !image) result = @{@"error": captureError.localizedDescription ?: @"Window capture returned no image."};
          else {
            NSData *jpeg = [[[NSBitmapImageRep alloc] initWithCGImage:image] representationUsingType:NSBitmapImageFileTypeJPEG properties:@{NSImageCompressionFactor: @0.8}];
            if (!jpeg.length) result = @{@"error": @"Window capture returned an empty image."};
            else result = @{@"jpeg": [jpeg base64EncodedStringWithOptions:0], @"width": @(CGImageGetWidth(image)), @"height": @(CGImageGetHeight(image))};
          }
          dispatch_semaphore_signal(done);
        }];
      }];
      if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 8 * NSEC_PER_SEC))) return CompanionJSON(@{@"error": @"Window capture timed out. Try again."});
      return CompanionJSON(result);
    }
    return CompanionJSON(@{@"legacy_capture": @YES});
  }
}
