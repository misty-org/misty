#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#import "MistyDesktopCapture.h"

static NSString *task;
static BOOL stopped, controlling;
static BOOL askBeforeControl;
static NSTimeInterval leaseUntil;
static NSTimeInterval lastActionAt;
static CGDirectDisplayID controlledDisplay;
static CFMachPortRef inputTap;
static CFRunLoopSourceRef inputSource;
static NSPanel *controlPanel;
static NSTimer *watchdog;
static void (*notifyStopped)(const char *);
@interface MistyDesktopAsk : NSPanel
@property dispatch_semaphore_t answer;
@property BOOL accepted, answered;
- (void)allow:(id)sender;
- (void)decline:(id)sender;
@end
@implementation MistyDesktopAsk
- (BOOL)canBecomeKeyWindow { return YES; }
- (void)allow:(id)sender {
  if (self.answered) return;
  self.answered = YES; self.accepted = YES;
  [self orderOut:nil]; dispatch_semaphore_signal(self.answer);
}
- (void)decline:(id)sender {
  if (self.answered) return;
  self.answered = YES;
  [self orderOut:nil]; dispatch_semaphore_signal(self.answer);
}
@end
static MistyDesktopAsk *askPanel;
static const int64_t agentEventTag = 0x4d49535459414754;

static char *DesktopJSON(NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  return strdup([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}
static void onMain(void (^work)(void)) {
  if (NSThread.isMainThread) work(); else dispatch_sync(dispatch_get_main_queue(), work);
}
static void stopControl(NSString *reason) {
  BOOL announce = !stopped && reason.length;
  stopped = YES; controlling = NO;
  [askPanel decline:nil]; askPanel = nil;
  if (inputTap) {
    CGEventTapEnable(inputTap, NO);
    CFMachPortInvalidate(inputTap);
    CFRelease(inputTap); inputTap = NULL;
  }
  if (inputSource) {
    CFRunLoopRemoveSource(CFRunLoopGetMain(), inputSource, kCFRunLoopCommonModes);
    CFRelease(inputSource); inputSource = NULL;
  }
  [watchdog invalidate]; watchdog = nil;
  [controlPanel orderOut:nil]; controlPanel = nil;
  MistyDesktopCaptureStop();
  if (announce && notifyStopped) {
    char *value = DesktopJSON(@{@"taskId": task ?: @"", @"reason": reason});
    notifyStopped(value); free(value);
  }
}
@interface MistyDesktopPanel : NSPanel
- (void)stopPressed:(id)sender;
@end
@implementation MistyDesktopPanel
- (BOOL)canBecomeKeyWindow { return NO; }
- (BOOL)canBecomeMainWindow { return NO; }
- (void)stopPressed:(id)sender { stopControl(@"Desktop control stopped. You have control."); }
@end

static CGEventRef guardInput(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *info) {
  (void)proxy;
  (void)info;
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    stopControl(@"Desktop input protection stopped. You have control."); return event;
  }
  if (!controlling || CGEventGetIntegerValueField(event, kCGEventSourceUserData) == agentEventTag) return event;
  if (type == kCGEventKeyDown && CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode) == kVK_Escape) {
    stopControl(@"Desktop control stopped with Escape. You have control."); return NULL;
  }
  CGEventFlags flags = CGEventGetFlags(event);
  if (type == kCGEventFlagsChanged && (flags & kCGEventFlagMaskControl) && (flags & kCGEventFlagMaskAlternate)) {
    stopControl(@"Desktop control interrupted by the voice shortcut."); return event;
  }
  // Let the user reach the native Stop button. Clicks/keys elsewhere cannot
  // navigate, type, scroll, switch tabs, or alter the agent's target.
  if (type == kCGEventMouseMoved) return event;
  CGPoint point = CGEventGetLocation(event);
  CGFloat top = CGDisplayBounds(CGMainDisplayID()).size.height;
  if (controlPanel.visible && NSPointInRect(NSMakePoint(point.x, top - point.y), controlPanel.frame) &&
      (type == kCGEventLeftMouseDown || type == kCGEventLeftMouseUp)) return event;
  return NULL;
}

static NSString *beginControl(CGDirectDisplayID displayID) {
  if (stopped || !task.length) return @"Desktop control stopped. Start or resume a task.";
  if (leaseUntil <= NSProcessInfo.processInfo.systemUptime) return @"The desktop execution lease expired.";
  if (controlling) return nil;
  NSString *name = [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleDisplayName"] ?: NSProcessInfo.processInfo.processName;
  if (!CGPreflightScreenCaptureAccess()) return [NSString stringWithFormat:@"Allow %@ in System Settings → Privacy & Security → Screen Recording, then retry.", name];
  if (!AXIsProcessTrusted()) return [NSString stringWithFormat:@"Allow %@ in System Settings → Privacy & Security → Accessibility to control the desktop, then retry.", name];
  CGEventMask mask = CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventKeyUp) | CGEventMaskBit(kCGEventFlagsChanged) |
    CGEventMaskBit(kCGEventLeftMouseDown) | CGEventMaskBit(kCGEventLeftMouseUp) | CGEventMaskBit(kCGEventRightMouseDown) |
    CGEventMaskBit(kCGEventRightMouseUp) | CGEventMaskBit(kCGEventOtherMouseDown) | CGEventMaskBit(kCGEventOtherMouseUp) |
    CGEventMaskBit(kCGEventMouseMoved) | CGEventMaskBit(kCGEventLeftMouseDragged) | CGEventMaskBit(kCGEventRightMouseDragged) |
    CGEventMaskBit(kCGEventOtherMouseDragged) | CGEventMaskBit(kCGEventScrollWheel);
  inputTap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionDefault, mask, guardInput, NULL);
  if (!inputTap) return @"Desktop input protection is unavailable. Check Accessibility and Input Monitoring for Misty.";
  inputSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, inputTap, 0);
  if (!inputSource) { stopControl(nil); return @"Desktop input protection could not start."; }
  CFRunLoopAddSource(CFRunLoopGetMain(), inputSource, kCFRunLoopCommonModes);
  CGEventTapEnable(inputTap, YES);
  controlling = YES;
  controlledDisplay = displayID;
  CGRect display = CGDisplayBounds(displayID);
  CGFloat top = CGDisplayBounds(CGMainDisplayID()).size.height;
  NSRect frame = NSMakeRect(display.origin.x + (display.size.width - 420) / 2,
    top - CGRectGetMaxY(display) + 24, 420, 44);
  MistyDesktopPanel *panel = [[MistyDesktopPanel alloc] initWithContentRect:frame
    styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
  panel.title = @"Misty desktop control";
  panel.level = NSStatusWindowLevel;
  panel.hidesOnDeactivate = NO;
  panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
  panel.backgroundColor = [NSColor colorWithWhite:0.10 alpha:1];
  panel.contentView.wantsLayer = YES;
  panel.contentView.layer.cornerRadius = 10;
  NSTextField *label = [NSTextField labelWithString:@"Misty is controlling this screen · Esc to stop"];
  label.frame = NSMakeRect(12, 13, 333, 18);
  label.textColor = NSColor.whiteColor;
  label.font = [NSFont systemFontOfSize:12 weight:NSFontWeightMedium];
  [panel.contentView addSubview:label];
  NSButton *stop = [NSButton buttonWithTitle:@"Stop" target:panel action:@selector(stopPressed:)];
  stop.frame = NSMakeRect(352, 8, 58, 28);
  [panel.contentView addSubview:stop];
  controlPanel = panel;
  [panel orderFrontRegardless];
  return nil;
}

// Registration does not capture or take input. The first visual tool call enters
// control, so a question answered from its initial screenshot does not lock input.
void misty_desktop_prepare(const char *taskID, bool ask, void (*callback)(const char *)) {
  NSString *next = [NSString stringWithUTF8String:taskID];
  onMain(^{
    stopControl(nil);
    task = next; stopped = NO; notifyStopped = callback; lastActionAt = 0;
    askBeforeControl = ask;
    leaseUntil = NSProcessInfo.processInfo.systemUptime + 30;
    watchdog = [NSTimer timerWithTimeInterval:0.5 repeats:YES block:^(NSTimer *timer) {
      (void)timer;
      if (NSProcessInfo.processInfo.systemUptime >= leaseUntil)
        stopControl(@"Desktop control paused because its connection expired. You have control.");
    }];
    [NSRunLoop.mainRunLoop addTimer:watchdog forMode:NSRunLoopCommonModes];
  });
}

// This confirmation is outside the model's action surface. Until the human
// accepts, there is no input tap, stream, or actionable desktop snapshot.
static NSString *confirmControl(NSString *expected) {
  __block MistyDesktopAsk *panel;
  __block NSRunningApplication *previous;
  __block NSString *failure;
  onMain(^{
    if (stopped || ![task isEqualToString:expected]) { failure = @"Desktop task stopped."; return; }
    if (!askBeforeControl || controlling) return;
    if (askPanel) { failure = @"Desktop confirmation is already pending."; return; }
    previous = NSWorkspace.sharedWorkspace.frontmostApplication;
    panel = [[MistyDesktopAsk alloc] initWithContentRect:NSMakeRect(0, 0, 410, 156)
      styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
    panel.title = @"Allow desktop control?";
    panel.answer = dispatch_semaphore_create(0);
    panel.level = NSStatusWindowLevel;
    panel.hidesOnDeactivate = NO;
    panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
    NSTextField *label = [NSTextField wrappingLabelWithString:@"Misty is ready to use your screen, mouse, and keyboard for this task. You can stop at any time with Escape or Stop."];
    label.frame = NSMakeRect(20, 65, 370, 70);
    [panel.contentView addSubview:label];
    NSButton *cancel = [NSButton buttonWithTitle:@"Cancel" target:panel action:@selector(decline:)];
    cancel.frame = NSMakeRect(190, 18, 90, 30); cancel.keyEquivalent = @"\e";
    [panel.contentView addSubview:cancel];
    NSButton *allow = [NSButton buttonWithTitle:@"Allow control" target:panel action:@selector(allow:)];
    allow.frame = NSMakeRect(280, 18, 115, 30);
    [panel.contentView addSubview:allow];
    askPanel = panel;
    [panel center]; [panel makeKeyAndOrderFront:nil]; [panel orderFrontRegardless];
  });
  if (failure || !panel) return failure;
  BOOL timedOut = dispatch_semaphore_wait(panel.answer, dispatch_time(DISPATCH_TIME_NOW, 25 * NSEC_PER_SEC)) != 0;
  onMain(^{
    BOOL current = !stopped && [task isEqualToString:expected] && askPanel == panel;
    [panel orderOut:nil];
    if (askPanel == panel) askPanel = nil;
    if (!current || timedOut || !panel.accepted) {
      failure = timedOut ? @"Desktop confirmation expired. Ask Misty to try again when ready." : @"Desktop control was not approved. You have control.";
      if (current) stopControl(failure);
    } else {
      askBeforeControl = NO;
      [previous activateWithOptions:0];
    }
  });
  return failure;
}
void misty_desktop_renew(const char *taskID) {
  NSString *expected = [NSString stringWithUTF8String:taskID];
  onMain(^{ if (!stopped && [task isEqualToString:expected]) leaseUntil = NSProcessInfo.processInfo.systemUptime + 30; });
}
void misty_desktop_stop(const char *taskID) {
  NSString *expected = [NSString stringWithUTF8String:taskID];
  onMain(^{ if ([task isEqualToString:expected]) { stopControl(nil); task = nil; } });
}

// Called on a worker. All state, HUD, and input ownership live on the main queue.
char *misty_desktop_capture(const char *taskID) {
  @autoreleasepool {
    __block NSString *owner, *failure;
    NSString *expected = [NSString stringWithUTF8String:taskID];
    failure = confirmControl(expected);
    if (failure) return DesktopJSON(@{@"error": failure});
    __block NSTimeInterval after;
    __block CGDirectDisplayID displayID;
    __block pid_t foreground;
    onMain(^{
      if (![task isEqualToString:expected]) { failure = @"Desktop task changed."; return; }
      CGEventRef event = CGEventCreate(NULL);
      CGPoint point = CGEventGetLocation(event); CFRelease(event);
      uint32_t count;
      CGGetDisplaysWithPoint(point, 1, &displayID, &count);
      if (!count) displayID = CGMainDisplayID();
      // Moving the human pointer must not silently retarget the agent's frame.
      if (controlling) displayID = controlledDisplay;
      failure = beginControl(displayID);
      owner = task;
      foreground = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
      after = MAX(lastActionAt + 0.15, NSDate.date.timeIntervalSince1970 - 1);
    });
    if (failure) {
      onMain(^{ if (owner && [task isEqualToString:owner]) stopControl(failure); });
      return DesktopJSON(@{@"error": failure});
    }
    NSDictionary *image = MistyDesktopFrame(displayID, after);
    __block BOOL valid;
    onMain(^{ valid = !stopped && controlling && [task isEqualToString:owner] && leaseUntil > NSProcessInfo.processInfo.systemUptime; });
    if (!valid) return DesktopJSON(@{@"error": @"Desktop control stopped during capture."});
    if (image[@"error"]) {
      onMain(^{ if ([task isEqualToString:owner]) stopControl(image[@"error"]); });
      return DesktopJSON(image);
    }
    CGRect bounds = CGDisplayBounds(displayID);
    return DesktopJSON(@{@"image": image, @"desktop": @YES, @"taskID": owner, @"displayID": @(displayID), @"foregroundPID": @(foreground),
      @"frame": @[@(bounds.origin.x), @(bounds.origin.y), @(bounds.size.width), @(bounds.size.height)]});
  }
}

static void post(CGEventRef event) {
  if (!event) return;
  CGEventSetIntegerValueField(event, kCGEventSourceUserData, agentEventTag);
  CGEventPost(kCGSessionEventTap, event);
  CFRelease(event);
}
// Rust validates the task, operation grant, one-use snapshot and action first.
// Main-queue dispatch rechecks native Stop and foreground identity before input.
char *misty_desktop_action(const char *json) {
  @autoreleasepool {
    if (stopped || !controlling || leaseUntil <= NSProcessInfo.processInfo.systemUptime)
      return DesktopJSON(@{@"error": @"Desktop control stopped. You have control."});
    NSDictionary *input = [NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    if (![task isEqualToString:input[@"taskID"]]) return DesktopJSON(@{@"error": @"Desktop task changed."});
    NSArray *frame = input[@"frame"];
    CGRect bounds = CGDisplayBounds([input[@"displayID"] unsignedIntValue]);
    if (frame.count != 4 || !CGDisplayIsActive([input[@"displayID"] unsignedIntValue]) ||
        !CGRectEqualToRect(bounds, CGRectMake([frame[0] doubleValue], [frame[1] doubleValue], [frame[2] doubleValue], [frame[3] doubleValue])))
      return DesktopJSON(@{@"error": @"browser_snapshot_stale: display geometry changed; inspect again"});
    if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != [input[@"foregroundPID"] intValue])
      return DesktopJSON(@{@"error": @"browser_snapshot_stale: the foreground app changed; inspect again"});
    NSDictionary *action = input[@"action"];
    NSString *kind = action[@"kind"];
    if ([kind isEqual:@"point"] || [kind isEqual:@"scroll"]) {
      CGPoint point = CGPointMake(bounds.origin.x + [action[@"x"] doubleValue] * bounds.size.width,
        bounds.origin.y + [action[@"y"] doubleValue] * bounds.size.height);
      post(CGEventCreateMouseEvent(NULL, kCGEventMouseMoved, point, kCGMouseButtonLeft));
      if ([kind isEqual:@"point"]) {
        for (NSNumber *type in @[@(kCGEventLeftMouseDown), @(kCGEventLeftMouseUp)]) {
          CGEventRef event = CGEventCreateMouseEvent(NULL, type.unsignedIntValue, point, kCGMouseButtonLeft);
          CGEventSetIntegerValueField(event, kCGMouseEventClickState, 1);
          post(event);
        }
      } else {
        CGEventRef event = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitPixel, 2,
          -[action[@"deltaY"] intValue], -[action[@"deltaX"] intValue]);
        CGEventSetLocation(event, point); post(event);
      }
    } else if ([kind isEqual:@"type"]) {
      NSString *text = action[@"text"];
      for (NSUInteger offset = 0; offset < text.length;) {
        NSRange range = [text rangeOfComposedCharacterSequencesForRange:NSMakeRange(offset, MIN(20, text.length - offset))];
        UniChar chars[64];
        if (range.length > 64) return DesktopJSON(@{@"error": @"Text contains an unsupported character sequence."});
        [text getCharacters:chars range:range];
        CGEventRef event = CGEventCreateKeyboardEvent(NULL, 0, YES);
        CGEventSetFlags(event, 0); CGEventKeyboardSetUnicodeString(event, range.length, chars); post(event);
        CGEventRef up = CGEventCreateKeyboardEvent(NULL, 0, NO); CGEventSetFlags(up, 0); post(up);
        offset = NSMaxRange(range);
      }
    } else if ([kind isEqual:@"key"]) {
      NSString *key = action[@"key"];
      NSDictionary *keys = @{@"Enter": @(kVK_Return), @"Escape": @(kVK_Escape), @"Tab": @(kVK_Tab), @"Backspace": @(kVK_Delete),
        @"ArrowLeft": @(kVK_LeftArrow), @"ArrowRight": @(kVK_RightArrow), @"ArrowUp": @(kVK_UpArrow), @"ArrowDown": @(kVK_DownArrow),
        @"SelectAll": @(kVK_ANSI_A), @"Undo": @(kVK_ANSI_Z), @"AddressBar": @(kVK_ANSI_L), @"NewTab": @(kVK_ANSI_T), @"Find": @(kVK_ANSI_F)};
      NSNumber *code = keys[key];
      if (!code) return DesktopJSON(@{@"error": @"Unsupported desktop key."});
      BOOL command = [@[@"SelectAll", @"Undo", @"AddressBar", @"NewTab", @"Find"] containsObject:key];
      for (NSNumber *down in @[@YES, @NO]) {
        CGEventRef event = CGEventCreateKeyboardEvent(NULL, code.unsignedShortValue, down.boolValue);
        CGEventSetFlags(event, command ? kCGEventFlagMaskCommand : 0); post(event);
      }
    } else return DesktopJSON(@{@"error": @"Unsupported desktop action."});
    lastActionAt = NSDate.date.timeIntervalSince1970;
    return DesktopJSON(@{@"attempted": @YES, @"verified": @NO, @"input": @"macos-events"});
  }
}
