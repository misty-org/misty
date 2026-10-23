#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Carbon/Carbon.h>
#import <Vision/Vision.h>

// Screen memory: while a person's capture session runs, read the words on the front window.
// Pixels stay in memory; only the recognized text leaves this file.

static const size_t gridSide = 64;
static uint8_t previousGrid[64 * 64];
static BOOL hasPreviousGrid = NO;
static NSObject *gridLock(void) {
  static NSObject *lock;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ lock = [NSObject new]; });
  return lock;
}

static char *MistyJSON(NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  return strdup([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}

// Apps whose windows are never read, and title words that mean a private or sensitive page.
static NSArray<NSString *> *blockedApps(void) {
  return @[@"1password", @"agilebits", @"bitwarden", @"keychainaccess", @"com.apple.passwords", @"keepassxc", @"lastpass", @"dashlane"];
}
static NSArray<NSString *> *blockedTitleWords(void) {
  return @[@"private browsing", @"incognito", @"inprivate", @"private window", @"password", @"sign in", @"log in", @"login",
           @"verification code", @"credit card", @"checkout"];
}
static BOOL containsAny(NSString *text, NSArray<NSString *> *needles) {
  NSString *lower = text.lowercaseString;
  for (NSString *needle in needles) if (needle.length && [lower containsString:needle]) return YES;
  return NO;
}

void misty_screen_memory_reset(void) {
  @synchronized(gridLock()) { hasPreviousGrid = NO; }
}

// Seconds since the last keyboard or pointer event, and whether the screen is locked.
char *misty_screen_memory_state(void) {
  @autoreleasepool {
    double idle = CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateCombinedSessionState, (CGEventType)~0);
    NSDictionary *session = CFBridgingRelease(CGSessionCopyCurrentDictionary());
    BOOL locked = [session[@"CGSSessionScreenIsLocked"] boolValue];
    return MistyJSON(@{@"idle": @(idle), @"locked": @(locked)});
  }
}

// A coarse picture of the window, to tell whether anything on it changed since the last read.
static BOOL windowChanged(CGImageRef image) {
  uint8_t grid[64 * 64];
  CGColorSpaceRef gray = CGColorSpaceCreateDeviceGray();
  CGContextRef context = CGBitmapContextCreate(grid, gridSide, gridSide, 8, gridSide, gray, kCGImageAlphaNone);
  CGColorSpaceRelease(gray);
  if (!context) return YES;
  CGContextSetInterpolationQuality(context, kCGInterpolationMedium);
  CGContextDrawImage(context, CGRectMake(0, 0, gridSide, gridSide), image);
  CGContextRelease(context);
  BOOL changed = YES;
  @synchronized(gridLock()) {
    if (hasPreviousGrid) {
      NSUInteger different = 0;
      for (size_t i = 0; i < gridSide * gridSide; i++) {
        int delta = (int)grid[i] - (int)previousGrid[i];
        if (delta > 24 || delta < -24) different++;
      }
      changed = different > 12;
    }
    if (changed) { memcpy(previousGrid, grid, sizeof(grid)); hasPreviousGrid = YES; }
  }
  return changed;
}

static NSString *recognizedText(CGImageRef image) {
  VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
  VNRecognizeTextRequest *request = [VNRecognizeTextRequest new];
  request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
  request.usesLanguageCorrection = YES;
  NSError *error = nil;
  if (![handler performRequests:@[request] error:&error]) return @"";
  NSMutableArray<NSString *> *lines = [NSMutableArray array];
  for (VNRecognizedTextObservation *observation in request.results) {
    NSString *line = [observation topCandidates:1].firstObject.string;
    if (line.length) [lines addObject:line];
  }
  return [lines componentsJoinedByString:@"\n"];
}

// Called on a Rust blocking worker. excludedCSV lists app names or bundle ids to skip.
// Returns {"skipped": why} when nothing was read, {"error": why} when capture failed, or the window's text.
char *misty_screen_memory_read(const char *excludedCSV) {
  @autoreleasepool {
    if (@available(macOS 14.0, *)) {
      if (!CGPreflightScreenCaptureAccess()) return MistyJSON(@{@"error": @"Screen access is off."});
      NSMutableArray<NSString *> *excluded = [NSMutableArray array];
      for (NSString *part in [[NSString stringWithUTF8String:excludedCSV ?: ""] componentsSeparatedByString:@","]) {
        NSString *name = [part stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].lowercaseString;
        if (name.length) [excluded addObject:name];
      }
      dispatch_semaphore_t done = dispatch_semaphore_create(0);
      __block NSDictionary *result;
      __block CGImageRef captured = NULL;
      dispatch_async(dispatch_get_main_queue(), ^{
        NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;
        if (!front || front.processIdentifier == NSProcessInfo.processInfo.processIdentifier) {
          result = @{@"skipped": @"misty"}; dispatch_semaphore_signal(done); return;
        }
        NSString *identity = [NSString stringWithFormat:@"%@ %@", front.localizedName ?: @"", front.bundleIdentifier ?: @""];
        if (IsSecureEventInputEnabled()) { result = @{@"skipped": @"secure"}; dispatch_semaphore_signal(done); return; }
        if (containsAny(identity, blockedApps()) || containsAny(identity, excluded)) {
          result = @{@"skipped": @"excluded"}; dispatch_semaphore_signal(done); return;
        }
        pid_t pid = front.processIdentifier;
        [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *content, NSError *error) {
          if (error) { result = @{@"error": error.localizedDescription}; dispatch_semaphore_signal(done); return; }
          NSArray *order = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
          SCWindow *target = nil;
          for (NSDictionary *info in order) {
            if ([info[(id)kCGWindowOwnerPID] intValue] != pid || [info[(id)kCGWindowLayer] intValue] != 0) continue;
            CGWindowID wid = [info[(id)kCGWindowNumber] unsignedIntValue];
            for (SCWindow *window in content.windows) if (window.windowID == wid) { target = window; break; }
            if (target) break;
          }
          if (!target) { result = @{@"skipped": @"no-window"}; dispatch_semaphore_signal(done); return; }
          if (containsAny(target.title ?: @"", blockedTitleWords())) { result = @{@"skipped": @"private"}; dispatch_semaphore_signal(done); return; }
          SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:target];
          SCStreamConfiguration *config = [SCStreamConfiguration new];
          double scale = MIN(1.0, 1600.0 / MAX(target.frame.size.width, target.frame.size.height));
          config.width = MAX(1, target.frame.size.width * scale);
          config.height = MAX(1, target.frame.size.height * scale);
          config.showsCursor = NO;
          NSDictionary *meta = @{@"app": front.localizedName ?: @"App", @"bundle": front.bundleIdentifier ?: @"", @"title": target.title ?: @""};
          [SCScreenshotManager captureImageWithFilter:filter configuration:config completionHandler:^(CGImageRef image, NSError *captureError) {
            if (captureError || !image) result = @{@"error": captureError.localizedDescription ?: @"This window cannot be captured."};
            else { captured = CGImageRetain(image); result = meta; }
            dispatch_semaphore_signal(done);
          }];
        }];
      });
      if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 8 * NSEC_PER_SEC))) return MistyJSON(@{@"error": @"Screen capture timed out."});
      if (!captured) return MistyJSON(result);
      NSMutableDictionary *reply = [result mutableCopy];
      if (!windowChanged(captured)) {
        CGImageRelease(captured);
        return MistyJSON(@{@"skipped": @"unchanged"});
      }
      NSString *text = recognizedText(captured);
      CGImageRelease(captured);
      text = [text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
      if (text.length < 20) return MistyJSON(@{@"skipped": @"empty"});
      if (text.length > 18000) text = [text substringToIndex:18000];
      reply[@"text"] = text;
      return MistyJSON(reply);
    }
    return MistyJSON(@{@"error": @"Screen capture requires macOS 14 or later."});
  }
}
