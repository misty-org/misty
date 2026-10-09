// Precise pointing for the cursor companion; see
// src/features/agents/companion/DESIGN.md. A model's point comes from a
// downscaled screenshot. Accessibility can name the real control near it, and
// a full-resolution crop lets the model place it again when Accessibility
// cannot. Both read the screen only; neither presses or focuses anything.
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>

static char *PointingJSON(NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  return strdup([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}

static NSString *PointingString(AXUIElementRef element, CFStringRef attribute) {
  CFTypeRef value = NULL;
  if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess || !value) return @"";
  NSString *text = CFGetTypeID(value) == CFStringGetTypeID() ? [(__bridge NSString *)value copy] : @"";
  CFRelease(value);
  return text;
}

static BOOL PointingFrame(AXUIElementRef element, CGRect *frame) {
  CFTypeRef position = NULL, size = NULL;
  BOOL ok = NO;
  if (AXUIElementCopyAttributeValue(element, kAXPositionAttribute, &position) == kAXErrorSuccess &&
      AXUIElementCopyAttributeValue(element, kAXSizeAttribute, &size) == kAXErrorSuccess && position && size) {
    CGPoint origin;
    CGSize extent;
    ok = AXValueGetValue((AXValueRef)position, (AXValueType)kAXValueCGPointType, &origin) &&
         AXValueGetValue((AXValueRef)size, (AXValueType)kAXValueCGSizeType, &extent);
    if (ok) *frame = CGRectMake(origin.x, origin.y, extent.width, extent.height);
  }
  if (position) CFRelease(position);
  if (size) CFRelease(size);
  return ok;
}

static BOOL PointingPressable(AXUIElementRef element) {
  CFArrayRef names = NULL;
  if (AXUIElementCopyActionNames(element, &names) != kAXErrorSuccess || !names) return NO;
  BOOL found = CFArrayContainsValue(names, CFRangeMake(0, CFArrayGetCount(names)), kAXPressAction);
  CFRelease(names);
  return found;
}

// Roles a person points at; containers such as groups and web areas are not.
static BOOL PointingTargetRole(NSString *role) {
  static NSSet *roles;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    roles = [NSSet setWithArray:@[
      @"AXButton", @"AXMenuItem", @"AXMenuBarItem", @"AXMenuButton", @"AXPopUpButton", @"AXCheckBox",
      @"AXRadioButton", @"AXTextField", @"AXTextArea", @"AXSearchField", @"AXComboBox", @"AXLink",
      @"AXSlider", @"AXDisclosureTriangle", @"AXIncrementor", @"AXColorWell", @"AXTab", @"AXDockItem",
      @"AXCell", @"AXRow", @"AXImage", @"AXStaticText"
    ]];
  });
  return [roles containsObject:role];
}

static NSString *PointingWindowTitle(AXUIElementRef element) {
  CFTypeRef window = NULL;
  if (AXUIElementCopyAttributeValue(element, kAXWindowAttribute, &window) != kAXErrorSuccess || !window) return @"";
  NSString *title = PointingString((AXUIElementRef)window, kAXTitleAttribute);
  CFRelease(window);
  return title;
}

// Words of the model's label that name the control, without the instruction.
static NSArray<NSString *> *PointingWords(NSString *label) {
  static NSSet *skip;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    skip = [NSSet setWithArray:@[@"click", @"open", @"press", @"choose", @"select", @"tap", @"the", @"a", @"an",
                                 @"on", @"to", @"in", @"go", @"use", @"pick", @"this", @"that", @"here", @"type",
                                 @"into", @"enter", @"button", @"menu", @"field", @"icon", @"tab", @"your", @"of"]];
  });
  NSMutableArray *words = [NSMutableArray new];
  NSCharacterSet *separators = [[NSCharacterSet alphanumericCharacterSet] invertedSet];
  for (NSString *word in [label.lowercaseString componentsSeparatedByCharactersInSet:separators]) {
    if (word.length > 1 && ![skip containsObject:word]) [words addObject:word];
  }
  return words;
}

typedef struct {
  double match;
  double distance;
} PointingScore;

/// Finds the control a companion point names: the actionable element at or
/// near the point, preferring one whose text matches the label. Points are
/// global display points with a top-left origin, like cursor samples.
char *misty_companion_snap_point(double x, double y, const char *rawLabel) {
  @autoreleasepool {
    if (!AXIsProcessTrusted()) return PointingJSON(@{@"error": @"accessibility"});
    NSString *label = rawLabel ? [NSString stringWithUTF8String:rawLabel] ?: @"" : @"";
    NSArray<NSString *> *words = PointingWords(label);
    AXUIElementRef system = AXUIElementCreateSystemWide();
    NSMutableArray *offsets = [NSMutableArray arrayWithObject:[NSValue valueWithPoint:NSZeroPoint]];
    for (NSNumber *radius in @[@14, @32]) {
      for (int step = 0; step < 8; step++) {
        double angle = step * M_PI / 4;
        [offsets addObject:[NSValue valueWithPoint:NSMakePoint(cos(angle) * radius.doubleValue, sin(angle) * radius.doubleValue)]];
      }
    }
    NSMutableArray *seen = [NSMutableArray new];
    NSDictionary *best = nil;
    PointingScore bestScore = {-1, INFINITY};
    for (NSValue *value in offsets) {
      NSPoint offset = value.pointValue;
      AXUIElementRef element = NULL;
      if (AXUIElementCopyElementAtPosition(system, x + offset.x, y + offset.y, &element) != kAXErrorSuccess || !element) continue;
      AXUIElementRef current = element;
      for (int depth = 0; depth < 5 && current; depth++) {
        // Per element, never on the system-wide object: that would change the
        // timeout for every Accessibility call Misty makes, desktop control included.
        AXUIElementSetMessagingTimeout(current, 0.25);
        NSString *role = PointingString(current, kAXRoleAttribute);
        if ([role isEqualToString:@"AXWindow"] || [role isEqualToString:@"AXApplication"]) break;
        CGRect frame;
        BOOL candidate = (PointingTargetRole(role) || PointingPressable(current)) && PointingFrame(current, &frame) &&
                         frame.size.width >= 4 && frame.size.height >= 4 && frame.size.width <= 480 && frame.size.height <= 240;
        if (candidate) {
          // Neighboring samples often land on the same control; score it once.
          if ([seen containsObject:(__bridge id)current]) break;
          [seen addObject:(__bridge id)current];
          if ([PointingWindowTitle(current) isEqualToString:@"Misty cursor"]) break;
          NSString *text = [@[
            PointingString(current, kAXTitleAttribute), PointingString(current, kAXDescriptionAttribute),
            PointingString(current, kAXValueAttribute), PointingString(current, kAXHelpAttribute),
            PointingString(current, kAXIdentifierAttribute)
          ] componentsJoinedByString:@" "].lowercaseString;
          NSUInteger matched = 0;
          for (NSString *word in words) if ([text containsString:word]) matched++;
          PointingScore score = {words.count ? (double)matched / words.count : 0,
                                 hypot(CGRectGetMidX(frame) - x, CGRectGetMidY(frame) - y)};
          BOOL contains = CGRectContainsPoint(frame, CGPointMake(x, y));
          // A named match anywhere nearby wins; otherwise only the control
          // under the point itself is trusted.
          BOOL acceptable = score.match >= 0.5 || contains;
          if (acceptable && (score.match > bestScore.match || (score.match == bestScore.match && score.distance < bestScore.distance))) {
            bestScore = score;
            best = @{
              @"x": @(CGRectGetMidX(frame)), @"y": @(CGRectGetMidY(frame)),
              @"frame": @{@"x": @(frame.origin.x), @"y": @(frame.origin.y), @"width": @(frame.size.width), @"height": @(frame.size.height)},
              @"role": role, @"title": PointingString(current, kAXTitleAttribute), @"matched": @(score.match >= 0.5)
            };
          }
          break;
        }
        AXUIElementRef parent = NULL;
        AXUIElementCopyAttributeValue(current, kAXParentAttribute, (CFTypeRef *)&parent);
        if (current != element) CFRelease(current);
        current = parent;
      }
      if (current && current != element) CFRelease(current);
      CFRelease(element);
    }
    CFRelease(system);
    return PointingJSON(best ? @{@"element": best} : @{});
  }
}

/// Captures a region of one display at its native pixel density, as JPEG.
/// The rectangle is in that display's local points; companion overlays are
/// excluded so the crop shows only what the person sees.
char *misty_companion_capture_region(uint32_t displayID, double x, double y, double width, double height, double maxSide) {
  @autoreleasepool {
    if (@available(macOS 14.0, *)) {
      dispatch_semaphore_t done = dispatch_semaphore_create(0);
      __block NSDictionary *result;
      [SCShareableContent getShareableContentExcludingDesktopWindows:NO onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *content, NSError *error) {
        if (error) { result = @{@"error": error.localizedDescription}; dispatch_semaphore_signal(done); return; }
        SCDisplay *target;
        for (SCDisplay *display in content.displays) if (display.displayID == displayID) { target = display; break; }
        if (!target) { result = @{@"error": @"Display disconnected."}; dispatch_semaphore_signal(done); return; }
        NSMutableArray<SCWindow *> *excluded = [NSMutableArray new];
        for (SCWindow *window in content.windows) {
          if (window.owningApplication.processID == NSProcessInfo.processInfo.processIdentifier && [window.title isEqualToString:@"Misty cursor"]) [excluded addObject:window];
        }
        CGRect bounds = CGRectIntersection(CGRectMake(x, y, width, height), CGRectMake(0, 0, target.width, target.height));
        if (CGRectIsEmpty(bounds)) { result = @{@"error": @"The region is outside the display."}; dispatch_semaphore_signal(done); return; }
        SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:target excludingWindows:excluded];
        SCStreamConfiguration *config = [SCStreamConfiguration new];
        double density = filter.pointPixelScale > 0 ? filter.pointPixelScale : 1;
        double scale = MIN(density, maxSide / MAX(bounds.size.width, bounds.size.height));
        config.sourceRect = bounds;
        config.width = MAX(1, (size_t)(bounds.size.width * scale));
        config.height = MAX(1, (size_t)(bounds.size.height * scale));
        config.showsCursor = NO;
        config.capturesAudio = NO;
        [SCScreenshotManager captureImageWithFilter:filter configuration:config completionHandler:^(CGImageRef image, NSError *captureError) {
          if (captureError || !image) result = @{@"error": captureError.localizedDescription ?: @"Screen capture returned no image."};
          else {
            NSData *jpeg = [[[NSBitmapImageRep alloc] initWithCGImage:image] representationUsingType:NSBitmapImageFileTypeJPEG properties:@{NSImageCompressionFactor: @0.85}];
            if (!jpeg.length) result = @{@"error": @"Screen capture returned an empty image."};
            else result = @{@"jpeg": [jpeg base64EncodedStringWithOptions:0], @"width": @(CGImageGetWidth(image)), @"height": @(CGImageGetHeight(image)),
                            @"x": @(bounds.origin.x), @"y": @(bounds.origin.y), @"regionWidth": @(bounds.size.width), @"regionHeight": @(bounds.size.height)};
          }
          dispatch_semaphore_signal(done);
        }];
      }];
      if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 8 * NSEC_PER_SEC))) return PointingJSON(@{@"error": @"Screen capture timed out."});
      return PointingJSON(result);
    }
    return PointingJSON(@{@"legacy_capture": @YES});
  }
}
