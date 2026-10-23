#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#import "MistyDesktopCapture.h"
#import "MistyAgentPointer.h"
#import "MistyAgentRing.h"

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
// The control island: the in-app island's view outside Misty during desktop
// control. Misty's island owns its state and actions; this panel shows them
// and sends the person's presses back (docs/design/agents-at-cursor/BRIEF.md).
static void (*notifyIsland)(const char *);
static NSTextField *islandStatus, *islandMeta, *islandField;
static NSButton *islandSend, *islandQueue, *islandTake, *islandDone;
static NSString *islandStatusText, *islandMetaText, *islandWaitingText;
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
static const int64_t agentEventTag = MistyAgentEventTag;

static char *DesktopJSON(NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  return strdup([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}
static void onMain(void (^work)(void)) {
  if (NSThread.isMainThread) work(); else dispatch_sync(dispatch_get_main_queue(), work);
}
static void islandMode(BOOL waiting);
// Gives the desktop back without ending the task: no input tap, cursor or
// capture. While the task waits for the person the island stays and the mist
// thins; otherwise both go. The next visual tool call enters control again.
static void releaseControl(BOOL waiting) {
  controlling = NO;
  if (inputTap) {
    CGEventTapEnable(inputTap, NO);
    CFMachPortInvalidate(inputTap);
    CFRelease(inputTap); inputTap = NULL;
  }
  if (inputSource) {
    CFRunLoopRemoveSource(CFRunLoopGetMain(), inputSource, kCFRunLoopCommonModes);
    CFRelease(inputSource); inputSource = NULL;
  }
  misty_agent_pointer_hide();
  MistyDesktopCaptureStop();
  if (waiting && controlPanel) {
    islandMode(YES);
    misty_agent_mist_waiting(true);
    return;
  }
  [controlPanel orderOut:nil]; controlPanel = nil;
  misty_agent_ring_hide();
  misty_agent_mist_waiting(false);
}
static void stopControl(NSString *reason) {
  BOOL announce = !stopped && reason.length;
  stopped = YES;
  [askPanel decline:nil]; askPanel = nil;
  releaseControl(NO);
  [watchdog invalidate]; watchdog = nil;
  if (announce && notifyStopped) {
    char *value = DesktopJSON(@{@"taskId": task ?: @"", @"reason": reason});
    notifyStopped(value); free(value);
  }
}
static void islandSendAction(NSString *action, NSString *text) {
  if (!notifyIsland || !task.length) return;
  char *value = DesktopJSON(@{@"taskId": task, @"action": action, @"text": text ?: @""});
  notifyIsland(value); free(value);
}
@interface MistyDesktopPanel : NSPanel
- (void)stopPressed:(id)sender;
@end
@implementation MistyDesktopPanel
// Key only when the person clicks into the field, never by being shown; the
// app they work in stays active. Agent input never reaches it: Accessibility
// refuses Misty's own process and agent keys go to the other app's process.
- (BOOL)canBecomeKeyWindow { return YES; }
- (BOOL)canBecomeMainWindow { return NO; }
- (void)stopPressed:(id)sender { stopControl(@"Desktop control stopped. You have control."); }
- (void)submit:(NSString *)action {
  NSString *text = [islandField.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (!text.length) return;
  islandField.stringValue = @"";
  [self makeFirstResponder:nil];
  islandSendAction(action, text);
}
- (void)sendPressed:(id)sender { [self submit:@"send"]; }
- (void)queuePressed:(id)sender { [self submit:@"queue"]; }
- (void)takeOverPressed:(id)sender { islandSendAction(@"takeover", nil); }
- (void)donePressed:(id)sender { islandSendAction(@"done", nil); }
@end

static NSTextField *islandLabel(NSRect frame, CGFloat size, NSColor *color) {
  NSTextField *label = [NSTextField labelWithString:@""];
  label.frame = frame;
  label.textColor = color;
  label.font = [NSFont systemFontOfSize:size weight:NSFontWeightMedium];
  label.lineBreakMode = NSLineBreakByTruncatingTail;
  return label;
}
static NSButton *islandButton(NSString *title, SEL action, NSRect frame, NSPanel *panel) {
  NSButton *button = [NSButton buttonWithTitle:title target:panel action:action];
  button.frame = frame;
  button.bezelStyle = NSBezelStyleRounded;
  button.controlSize = NSControlSizeRegular;
  [panel.contentView addSubview:button];
  return button;
}
// Status, a field to steer or queue, Take over, Stop and Escape; Done while
// the task waits for the person.
static NSPanel *islandPanel(CGRect display) {
  CGFloat top = CGDisplayBounds(CGMainDisplayID()).size.height, width = 560, height = 116;
  NSRect frame = NSMakeRect(display.origin.x + (display.size.width - width) / 2,
    top - CGRectGetMaxY(display) + 24, width, height);
  MistyDesktopPanel *panel = [[MistyDesktopPanel alloc] initWithContentRect:frame
    styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
  panel.title = @"Misty desktop control";
  panel.level = NSStatusWindowLevel;
  panel.hidesOnDeactivate = NO;
  panel.becomesKeyOnlyIfNeeded = YES;
  panel.sharingType = NSWindowSharingNone;
  panel.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
  panel.backgroundColor = NSColor.clearColor;
  panel.opaque = NO;
  panel.hasShadow = YES;
  NSView *content = panel.contentView;
  content.wantsLayer = YES;
  content.layer.backgroundColor = [NSColor colorWithWhite:0.08 alpha:0.96].CGColor;
  content.layer.cornerRadius = 16;
  content.layer.borderWidth = 1;
  content.layer.borderColor = [NSColor colorWithWhite:1 alpha:0.12].CGColor;
  islandStatus = islandLabel(NSMakeRect(16, 84, 392, 18), 12.5, NSColor.whiteColor);
  islandMeta = islandLabel(NSMakeRect(412, 84, 132, 18), 12, [NSColor colorWithWhite:1 alpha:0.6]);
  islandMeta.alignment = NSTextAlignmentRight;
  [content addSubview:islandStatus];
  [content addSubview:islandMeta];
  islandField = [NSTextField textFieldWithString:@""];
  islandField.frame = NSMakeRect(12, 47, 356, 28);
  islandField.placeholderString = @"Tell Misty what to change, or ask for something new";
  islandField.target = panel;
  islandField.action = @selector(sendPressed:);
  [content addSubview:islandField];
  islandSend = islandButton(@"Send", @selector(sendPressed:), NSMakeRect(372, 44, 80, 34), panel);
  islandQueue = islandButton(@"New task", @selector(queuePressed:), NSMakeRect(454, 44, 94, 34), panel);
  islandTake = islandButton(@"Take over", @selector(takeOverPressed:), NSMakeRect(8, 6, 100, 34), panel);
  NSTextField *escape = islandLabel(NSMakeRect(318, 15, 140, 16), 11.5, [NSColor colorWithWhite:1 alpha:0.55]);
  escape.stringValue = @"Esc stops";
  escape.alignment = NSTextAlignmentRight;
  [content addSubview:escape];
  islandDone = islandButton(@"Done", @selector(donePressed:), NSMakeRect(380, 6, 80, 34), panel);
  NSButton *stop = islandButton(@"Stop", @selector(stopPressed:), NSMakeRect(462, 6, 86, 34), panel);
  stop.keyEquivalent = @"";
  return panel;
}
static void islandMode(BOOL waiting) {
  islandStatus.stringValue = waiting
    ? (islandWaitingText.length ? islandWaitingText : @"Misty is waiting for you. Press Done when you're finished.")
    : (islandStatusText.length ? islandStatusText : @"Misty is working with its own cursor");
  islandMeta.stringValue = waiting ? @"" : (islandMetaText ?: @"");
  for (NSView *view in @[islandField, islandSend, islandQueue, islandTake]) view.hidden = waiting;
  islandDone.hidden = !waiting;
  if (waiting) islandDone.keyEquivalent = @"\r";
}

// Misty acts with its own cursor, so the person's input is never blocked. The
// tap only listens for Escape and the voice shortcut, which stop the task.
static CGEventRef guardInput(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *info) {
  (void)proxy;
  (void)info;
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    stopControl(@"Desktop control stopped. You have control."); return event;
  }
  if (!controlling || CGEventGetIntegerValueField(event, kCGEventSourceUserData) == agentEventTag) return event;
  if (type == kCGEventKeyDown && CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode) == kVK_Escape) {
    stopControl(@"Desktop control stopped with Escape. You have control."); return NULL;
  }
  CGEventFlags flags = CGEventGetFlags(event);
  if (type == kCGEventFlagsChanged && (flags & kCGEventFlagMaskControl) && (flags & kCGEventFlagMaskAlternate))
    stopControl(@"Desktop control interrupted by the voice shortcut.");
  return event;
}

static NSString *beginControl(CGDirectDisplayID displayID) {
  if (stopped || !task.length) return @"Desktop control stopped. Start or resume a task.";
  if (leaseUntil <= NSProcessInfo.processInfo.systemUptime) return @"The desktop execution lease expired.";
  if (controlling) return nil;
  NSString *name = [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleDisplayName"] ?: NSProcessInfo.processInfo.processName;
  if (!CGPreflightScreenCaptureAccess()) return [NSString stringWithFormat:@"Allow %@ in System Settings → Privacy & Security → Screen Recording, then retry.", name];
  if (!AXIsProcessTrusted()) return [NSString stringWithFormat:@"Allow %@ in System Settings → Privacy & Security → Accessibility to control the desktop, then retry.", name];
  CGEventMask mask = CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventFlagsChanged);
  inputTap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionDefault, mask, guardInput, NULL);
  if (!inputTap) return @"Desktop control is unavailable. Check Accessibility for Misty.";
  inputSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, inputTap, 0);
  if (!inputSource) { stopControl(nil); return @"Desktop control could not start."; }
  CFRunLoopAddSource(CFRunLoopGetMain(), inputSource, kCFRunLoopCommonModes);
  CGEventTapEnable(inputTap, YES);
  controlling = YES;
  controlledDisplay = displayID;
  CGRect display = CGDisplayBounds(displayID);
  if (!controlPanel) controlPanel = islandPanel(display);
  islandMode(NO);
  [controlPanel orderFrontRegardless];
  misty_agent_mist_waiting(false);
  misty_agent_ring_show(display);
  return nil;
}

// Registration does not capture or take input. The first visual tool call enters
// control, so a question answered from its initial screenshot does not lock input.
void misty_desktop_prepare(const char *taskID, bool ask, void (*callback)(const char *), void (*island)(const char *)) {
  NSString *next = [NSString stringWithUTF8String:taskID];
  onMain(^{
    stopControl(nil);
    task = next; stopped = NO; notifyStopped = callback; notifyIsland = island; lastActionAt = 0;
    islandStatusText = islandMetaText = islandWaitingText = nil;
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
    NSTextField *label = [NSTextField wrappingLabelWithString:@"Misty is ready to use your apps with its own cursor for this task. Your pointer and keyboard stay yours. Stop at any time with Escape or Stop."];
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
// The task waits for the person: hand the desktop back but keep the task.
void misty_desktop_yield(const char *taskID) {
  NSString *expected = [NSString stringWithUTF8String:taskID];
  onMain(^{ if (!stopped && [task isEqualToString:expected]) releaseControl(YES); });
}
// What Misty's island shows: a status line, a meta line (sub-agents, where)
// and what the person needs to do while the task waits.
void misty_desktop_island(const char *taskID, const char *json) {
  NSString *expected = [NSString stringWithUTF8String:taskID];
  NSDictionary *input = [NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  if (![input isKindOfClass:NSDictionary.class]) return;
  NSString *(^text)(NSString *) = ^NSString *(NSString *key) {
    id value = input[key];
    return [value isKindOfClass:NSString.class] ? [value substringToIndex:MIN([value length], (NSUInteger)240)] : nil;
  };
  onMain(^{
    if (stopped || ![task isEqualToString:expected]) return;
    islandStatusText = text(@"status");
    islandMetaText = text(@"meta");
    islandWaitingText = text(@"waiting");
    if (controlPanel) islandMode(!controlling);
  });
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

// Rust validates the task, operation grant, one-use snapshot and action first.
// Main-queue dispatch rechecks native Stop and display geometry before acting.
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
    // The person may keep working in other apps, so the foreground app can
    // change; Accessibility targets the control under Misty's own cursor.
    NSDictionary *action = input[@"action"];
    double x = [action[@"x"] doubleValue], y = [action[@"y"] doubleValue];
    CGPoint point = CGPointMake(bounds.origin.x + x * bounds.size.width, bounds.origin.y + y * bounds.size.height);
    NSDictionary *result = MistyAgentDesktopAction(action, point);
    if (result[@"error"]) return DesktopJSON(@{@"error": result[@"error"]});
    lastActionAt = NSDate.date.timeIntervalSince1970;
    NSMutableDictionary *output = [@{@"attempted": @YES, @"verified": @NO, @"input": @"accessibility", @"effect": result[@"effect"] ?: @""} mutableCopy];
    if (result[@"role"]) output[@"target"] = @{@"role": result[@"role"], @"title": result[@"title"] ?: @""};
    NSString *kind = action[@"kind"];
    if ([kind isEqual:@"point"] || [kind isEqual:@"scroll"]) output[@"cursor"] = @{@"x": @(x), @"y": @(y)};
    return DesktopJSON(output);
  }
}
